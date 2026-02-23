# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Test: load ELF and run core; scoreboard compares each commit to Lome.

import os
from pathlib import Path

from cocotb.triggers import Timer

from tb import Testbench


@Testbench.testcase()
async def test_elf_loaded(tb: Testbench):
    """Load ELF from TEST_ELF env or default path, run for a bounded time; scoreboard checks each commit.
    ELF can be set via command line: make run ELF=path/to.elf"""
    elf_path = os.environ.get("TEST_ELF")
    if not elf_path:
        for candidate in (
            Path("tests/data/hello.elf"),
            Path("build/hello.elf"),
            Path("tests/elfs/simple.elf"),
        ):
            if candidate.exists():
                elf_path = str(candidate)
                break

    if not elf_path:
        tb.set_entry_point(0)
        await tb.reset()
        for _ in range(100):
            await Timer(10, units="ns")
        return

    entry = tb.load_elf(elf_path)
    tb.set_entry_point(entry)
    await tb.reset()
    run_ns = 50_000  # 50 us
    await Timer(run_ns, units="ns")
