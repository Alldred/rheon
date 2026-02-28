# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Memory interface drivers: req_ready (TB accepts request), rsp_valid/rsp_data (TB presents response).

from __future__ import annotations

from cocotb.triggers import RisingEdge
from forastero import BaseDriver

from .memory import IMEM_QWORD_BYTES, XLEN
from .transactions import MemoryResponse


async def _drive_rsp_valid_ready(
    driver, rsp_data_key: str, data_val: int, mask: int
) -> None:
    """Set rsp_valid and rsp_data; wait until DUT asserts rsp_ready, then clear rsp_valid."""
    driver.io.set(rsp_data_key, data_val & mask)
    driver.io.set("rsp_valid", 1)
    while int(driver.io.get("rsp_ready", 0)) != 1:
        await RisingEdge(driver.clk)
    await RisingEdge(driver.clk)
    driver.io.set("rsp_valid", 0)


class ImemResponseDriver(BaseDriver):
    """Drive I-memory response: assert rsp_valid and rsp_data; complete when DUT asserts rsp_ready."""

    async def drive(self, obj: MemoryResponse) -> None:
        qword_bits = IMEM_QWORD_BYTES * 8
        await _drive_rsp_valid_ready(self, "rsp_data", obj.data, (1 << qword_bits) - 1)


class DmemResponseDriver(BaseDriver):
    """Drive D-memory response: assert rsp_valid and rsp_rdata; complete when DUT asserts rsp_ready."""

    async def drive(self, obj: MemoryResponse) -> None:
        await _drive_rsp_valid_ready(self, "rsp_rdata", obj.data, (1 << XLEN) - 1)


async def imem_req_ready_driver(tb, io, clk, rst) -> None:
    """Drive req_ready high so DUT request handshake can complete (no backpressure)."""
    while True:
        await RisingEdge(clk)
        if rst.value != tb.rst_active_value:
            io.set("req_ready", 1)


async def dmem_req_ready_driver(tb, io, clk, rst) -> None:
    """Drive req_ready high so DUT request handshake can complete (no backpressure)."""
    while True:
        await RisingEdge(clk)
        if rst.value != tb.rst_active_value:
            io.set("req_ready", 1)
