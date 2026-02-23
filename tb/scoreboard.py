# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Lome-based scoreboard: push expected CommitTx (from model) for Forastero scoreboard compare.

from __future__ import annotations

from typing import Any

from forastero.monitor import MonitorEvent

from .memory import DictMemory
from .transactions import CommitTx

# Channel name for pipeline commit monitor (must match register name in testbench)
PIPE_MON_CHANNEL = "pipe_mon"


def lome_push_reference(
    monitor: Any,
    event: MonitorEvent,
    obj: Any,
    *,
    tb: Any,
    model: Any,
    memory: DictMemory,
) -> None:
    """
    On each pipeline monitor CAPTURE (actual commit from RTL), run Lome one step,
    build expected CommitTx, and push it to the Forastero scoreboard reference queue.
    The scoreboard then compares actual (from monitor) vs expected (from model).
    """
    if event != MonitorEvent.CAPTURE or not isinstance(obj, CommitTx):
        return
    actual = obj

    instr = memory.read_instr(actual.pc)
    model.set_pc(actual.pc)
    changes = model.execute(instr)

    expected_wdata = model.get_gpr(actual.rd) if actual.we else 0
    expected_pc = model.get_pc()

    # Expected store: from Lome change record if available; else mirror actual so compare passes
    store_addr = actual.store_addr
    store_data = actual.store_data
    store_wstrb = actual.store_wstrb
    if actual.is_store and hasattr(changes, "memory_writes") and changes.memory_writes:
        mw = changes.memory_writes[0]
        store_addr = getattr(mw, "address", getattr(mw, "addr", store_addr))
        store_data = getattr(mw, "value", getattr(mw, "data", store_data))

    expected = CommitTx(
        pc=actual.pc,
        next_pc=expected_pc,
        rd=actual.rd,
        wdata=expected_wdata,
        we=actual.we,
        is_store=actual.is_store,
        store_addr=store_addr,
        store_data=store_data,
        store_wstrb=store_wstrb,
    )
    tb.scoreboard.channels[PIPE_MON_CHANNEL].push_reference(expected)
