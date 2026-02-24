#!/usr/bin/env python
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Test: load ELF and run core; scoreboard compares each commit to Lome.

import os
from pathlib import Path

from cocotb.triggers import Timer

from tb import Testbench


@Testbench.testcase()
async def test_elf_loaded(tb: Testbench, log):
    """Load ELF from TEST_ELF env or default path, run for a bounded time; scoreboard checks each commit.
    ELF can be set via command line: make run ELF=path/to.elf"""
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
            await Timer(10, units="ns")
        return

    log.info("Loading ELF %s", elf_path)
    entry = tb.load_elf(elf_path)
    log.info("ELF entry point set to 0x%x", entry)
    tb.set_entry_point(entry)
    await tb.reset()
    run_ns = 50_000  # 50 us
    log.info("Running core for %d ns (%.2f us).", run_ns, run_ns / 1_000.0)
    await Timer(run_ns, units="ns")
