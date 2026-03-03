#!/usr/bin/env python
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Test: load ELF and run core; scoreboard compares each commit to Lome.

import os
from pathlib import Path

from cocotb.triggers import Timer
from forastero.monitor import MonitorEvent

from tb import Testbench
from tb.memory import read_exit_address
from tb.verbosity import configure_logging_from_env


@Testbench.testcase(timeout=100_000, shutdown_loops=1, shutdown_delay=1)
async def test_elf_loaded(tb: Testbench, log):
    """Load ELF from TEST_ELF env or default path, run for a bounded time; scoreboard checks each commit.
    ELF can be set via command line: make run ELF=path/to.elf"""
    configure_logging_from_env()
    elf_path = os.environ.get("TEST_ELF")
    if not elf_path:
        log.info("TEST_ELF not set; probing default ELF locations.")
        for candidate in (
            Path("tests/data/hello.elf"),
            Path("build/hello.elf"),
            Path("tests/elfs/simple.elf"),
        ):
            if candidate.exists():
                elf_path = str(candidate)
                log.info("Using default ELF %s", elf_path)
                break

    if not elf_path:
        log.warning("No ELF found; running from reset vector 0 with short smoke test.")
        tb.set_entry_point(0)
        await tb.reset()
        for _ in range(100):
            await Timer(10, unit="ns")
        return

    log.info("Loading ELF %s", elf_path)
    entry = tb.load_elf(elf_path)
    log.info("ELF entry point set to 0x%x", entry)
    exit_addr = read_exit_address(elf_path)
    if exit_addr is None:
        raise AssertionError(
            "Unable to resolve exit address from test artifacts/ELF; cannot detect end-of-test loop."
        )
    log.info("Exit address resolved to 0x%x", exit_addr)
    tb.set_entry_point(entry)
    await tb.reset()
    commit_count = 0
    log.info("Running until commit reaches exit self-loop at 0x%x.", exit_addr)
    while True:
        obj = await tb.pipe_mon.wait_for(MonitorEvent.CAPTURE)
        pc = getattr(obj, "pc", None)
        next_pc = getattr(obj, "next_pc", None)
        if pc is None or next_pc is None:
            continue
        commit_count += 1
        if pc == exit_addr and next_pc == pc:
            log.info(
                "Detected test completion at self-loop PC 0x%x after %d commits.",
                pc,
                commit_count,
            )
            tb.request_stop()
            return
