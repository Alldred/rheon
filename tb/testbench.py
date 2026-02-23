# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Forastero BaseBench for rheon_core: request monitors -> memory callback -> response drivers.

from __future__ import annotations

from functools import partial
from pathlib import Path
from typing import Optional

from forastero import BaseBench, IORole
from forastero.monitor import MonitorEvent

from .drivers import (
    DmemResponseDriver,
    ImemResponseDriver,
    dmem_req_ready_driver,
    imem_req_ready_driver,
)
from .io import DmemIO, ImemIO
from .memory import DictMemory, load_elf
from .monitors.memory import DmemRequestMonitor, ImemRequestMonitor
from .monitors.pipeline import PipelineCommitMonitor, RheonCoreIO
from .scoreboard import lome_push_reference
from .transactions import DmemRequest, ImemRequest, MemoryResponse


def _make_lome_model():
    try:
        from eumos import Eumos
        from lome import Lome
    except ImportError as e:
        raise ImportError(
            "Lome and Eumos are required; add lome to dependencies"
        ) from e
    isa = Eumos()
    return Lome(isa)


class Testbench(BaseBench):
    """
    Testbench for rheon_core: request monitors capture I/D mem requests;
    memory_response callback performs memory access and enqueues to response drivers.
    Pipeline commit monitor and Lome scoreboard unchanged.
    """

    __test__ = False

    def __init__(self, dut) -> None:
        super().__init__(
            dut,
            clk=dut.clk,
            rst=dut.rst_n,
            rst_active_high=False,
        )
        self.memory = DictMemory()
        self._entry_point: Optional[int] = 0

        # Lome model (same initial PC as RTL after reset)
        self._model = _make_lome_model()

        # I-memory: req_ready driver, request monitor -> memory_response -> response driver
        imem_io = ImemIO(dut, name="imem", role=IORole.INITIATOR)
        imem_io.initialise(IORole.RESPONDER)
        self.register(
            "imem_req_ready_drv",
            imem_req_ready_driver(self, imem_io, self.clk, self.rst),
        )
        self.register(
            "imem_req_mon",
            ImemRequestMonitor(self, imem_io, self.clk, self.rst),
            scoreboard=False,
        )
        self.register(
            "imem_rsp_drv",
            ImemResponseDriver(self, imem_io, self.clk, self.rst),
        )
        self.imem_req_mon.subscribe(MonitorEvent.CAPTURE, self._memory_response)

        # D-memory: req_ready driver, request monitor -> memory_response -> response driver
        dmem_io = DmemIO(dut, name="dmem", role=IORole.INITIATOR)
        dmem_io.initialise(IORole.RESPONDER)
        self.register(
            "dmem_req_ready_drv",
            dmem_req_ready_driver(self, dmem_io, self.clk, self.rst),
        )
        self.register(
            "dmem_req_mon",
            DmemRequestMonitor(self, dmem_io, self.clk, self.rst),
            scoreboard=False,
        )
        self.register(
            "dmem_rsp_drv",
            DmemResponseDriver(self, dmem_io, self.clk, self.rst),
        )
        self.dmem_req_mon.subscribe(MonitorEvent.CAPTURE, self._memory_response)

        # Pipeline commit monitor (BaseMonitor) -> Forastero scoreboard channel "pipe_mon"
        pipe_io = RheonCoreIO(self.dut)
        self.register(
            "pipe_mon",
            PipelineCommitMonitor(self, pipe_io, self.clk, self.rst),
        )
        # On each CAPTURE (actual from RTL), push expected CommitTx from Lome for scoreboard compare
        self.pipe_mon.subscribe(
            MonitorEvent.CAPTURE,
            partial(
                lome_push_reference,
                tb=self,
                model=self._model,
                memory=self.memory,
            ),
        )

    def _memory_response(self, component, event, transaction) -> None:
        """On request capture: access memory and enqueue response to the appropriate driver."""
        if component is self.imem_req_mon and isinstance(transaction, ImemRequest):
            line_addr = self.memory.line_align(transaction.req_addr)
            data = self.memory.read_line(line_addr)
            self.imem_rsp_drv.enqueue(MemoryResponse(data=data))
        elif component is self.dmem_req_mon and isinstance(transaction, DmemRequest):
            if transaction.req_is_store:
                self.memory.write(
                    transaction.req_addr,
                    8,
                    transaction.req_wdata,
                    wstrb=transaction.req_wstrb,
                )
                rdata = 0
            else:
                rdata = self.memory.read(transaction.req_addr, 8)
            self.dmem_rsp_drv.enqueue(MemoryResponse(data=rdata))

    @property
    def model(self):
        return self._model

    def load_elf(self, path: str | Path) -> int:
        """Load ELF into memory; set model PC to entry point; return entry point."""
        entry = load_elf(path, self.memory)
        self._entry_point = entry
        self._model.set_pc(entry)
        return entry

    def set_entry_point(self, addr: int) -> None:
        """Set initial PC for RTL and model (e.g. after reset)."""
        self._entry_point = addr
        self._model.set_pc(addr)
