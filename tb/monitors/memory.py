# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# I-memory and D-memory request monitors: capture req_* from bus, emit request transactions.

from __future__ import annotations

from cocotb.triggers import RisingEdge
from forastero.monitor import BaseMonitor

from ..transactions import DmemRequest, ImemRequest


class ImemRequestMonitor(BaseMonitor):
    """
    Observe I-memory request bus; on req_valid && req_ready handshake, sample
    req_addr and capture ImemRequest(req_addr=...).
    """

    async def monitor(self, capture) -> None:
        while True:
            await RisingEdge(self.clk)
            if self.rst.value == self.tb.rst_active_value:
                continue
            if (
                int(self.io.get("req_valid", 0)) != 1
                or int(self.io.get("req_ready", 0)) != 1
            ):
                continue
            addr = int(self.io.get("req_addr", 0))
            capture(ImemRequest(req_addr=addr))


class DmemRequestMonitor(BaseMonitor):
    """
    Observe D-memory request bus; on req_valid && req_ready handshake, sample
    req_* and capture DmemRequest(req_addr=..., req_is_store=..., ...).
    """

    async def monitor(self, capture) -> None:
        while True:
            await RisingEdge(self.clk)
            if self.rst.value == self.tb.rst_active_value:
                continue
            if (
                int(self.io.get("req_valid", 0)) != 1
                or int(self.io.get("req_ready", 0)) != 1
            ):
                continue
            addr = int(self.io.get("req_addr", 0))
            is_store = int(self.io.get("req_is_store", 0)) == 1
            wdata = int(self.io.get("req_wdata", 0))
            wstrb = int(self.io.get("req_wstrb", 0))
            capture(
                DmemRequest(
                    req_addr=addr,
                    req_is_store=is_store,
                    req_wdata=wdata,
                    req_wstrb=wstrb,
                )
            )
