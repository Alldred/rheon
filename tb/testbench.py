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
from .memory import DictMemory, LomeReadOnlyMemory, load_elf
from .monitors.memory import DmemRequestMonitor, ImemRequestMonitor
from .monitors.pipeline import PipelineCommitMonitor, RheonCoreIO
from .scoreboard import lome_push_reference
from .transactions import DmemRequest, ImemRequest, MemoryResponse


def _make_lome_model(*, memory: LomeReadOnlyMemory):
    """Construct the Lome model with explicit read-only memory integration."""
    try:
        from eumos import Eumos
        from lome import Lome

        return Lome(Eumos(), memory=memory)
    except ImportError as e:
        raise ImportError(
            "Lome and Eumos are required; add them to rheon dependencies."
        ) from e


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
        self._lome_memory = LomeReadOnlyMemory(self.memory)
        self._entry_point: Optional[int] = 0
        self._stop_requested = False

        # Lome model (same initial PC as RTL after reset)
        self._model = _make_lome_model(memory=self._lome_memory)

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
            qaddr = self.memory.qword_align(transaction.req_addr)
            data = self.memory.read_qword(qaddr)
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
        """Load ELF into memory; set model and RTL PC to entry point; return entry point."""
        entry = load_elf(path, self.memory)
        self._entry_point = entry
        # One-time boot for Lome and RTL (entry can be 2-byte aligned for future RVC)
        self._model.poke_pc(entry)
        self._drive_start_pc(entry)
        return entry

    def set_entry_point(self, addr: int) -> None:
        """Set initial PC for RTL and model (e.g. after reset)."""
        self._entry_point = addr
        self._model.poke_pc(addr)
        self._drive_start_pc(addr)

    def _drive_start_pc(self, addr: int) -> None:
        """Drive RTL boot address so fetch starts at ELF entry (must be set before reset)."""
        start_pc = getattr(self.dut, "start_pc", None)
        if start_pc is not None:
            start_pc.value = addr

    @property
    def stop_requested(self) -> bool:
        return self._stop_requested

    def request_stop(self) -> None:
        """Request background coroutines to exit so Forastero shutdown can complete."""
        self._stop_requested = True
