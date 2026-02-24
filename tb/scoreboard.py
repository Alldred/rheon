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


def _size_to_strobe(size: int) -> int:
    if size <= 0:
        return 0
    if size >= 8:
        return 0xFF
    return (1 << size) - 1


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

    # Lome model is run in lockstep with the DUT using tick():
    # - Model PC is initialised once at boot (poke_pc).
    # - On each retired instruction we supply a fetch callback and let Lome
    #   fetch+execute and advance its own PC. Expected values come entirely
    #   from the model; RTL values are used only for comparison.
    # - Architectural exceptions/traps are reported in ChangeRecord and Lome
    #   updates PC (e.g. mtvec redirection) during tick().
    # - Unexpected execution/decode failures may still raise from tick().
    def fetch_instr(pc: int) -> int:
        return memory.read_instr(pc)

    ref_pc_before = model.get_pc()
    try:
        changes = model.tick(fetch_instr)
    except Exception as e:
        raise RuntimeError(
            f"Lome tick failed at PC 0x{ref_pc_before:x} (unexpected model failure)"
        ) from e
    expected_pc = model.get_pc()
    if changes is None:
        raise RuntimeError(f"Lome returned no ChangeRecord at PC 0x{ref_pc_before:x}")

    # Expected GPR writeback from canonical Lome ChangeRecord.
    reg_writes = changes.gpr_writes
    exp_rd = 0
    exp_wdata = 0
    exp_we = False
    if reg_writes:
        rw = reg_writes[0]
        exp_rd = int(rw.register)
        exp_wdata = int(rw.value)
        exp_we = True

    # Expected GPR reads from canonical Lome ChangeRecord. First two reads map to rs1/rs2.
    reg_reads = changes.gpr_reads
    exp_rs1 = 0
    exp_rs1_val = 0
    exp_rs2 = 0
    exp_rs2_val = 0
    if len(reg_reads) >= 1:
        r0 = reg_reads[0]
        exp_rs1 = int(r0.register)
        exp_rs1_val = int(r0.value)
    if len(reg_reads) >= 2:
        r1 = reg_reads[1]
        exp_rs2 = int(r1.register)
        exp_rs2_val = int(r1.value)

    # Expected memory activity from canonical Lome ChangeRecord.
    accesses = changes.memory_accesses
    mem_writes = [a for a in accesses if a.is_write]
    mem_reads = [a for a in accesses if not a.is_write]

    is_store = False
    store_addr: int | None = None
    store_data: int | None = None
    store_wstrb: int | None = None
    if mem_writes:
        mw = mem_writes[0]
        is_store = True
        store_addr = int(mw.address)
        store_data = int(mw.value) if mw.value is not None else None
        store_wstrb = _size_to_strobe(int(mw.size))

    is_load = False
    load_addr: int | None = None
    load_data: int | None = None
    load_strb: int | None = None
    if mem_reads:
        mr = mem_reads[0]
        is_load = True
        load_addr = int(mr.address)
        load_data = int(mr.value) if mr.value is not None else None
        load_strb = _size_to_strobe(int(mr.size))

    expected = CommitTx(
        pc=ref_pc_before,
        next_pc=expected_pc,
        rd=exp_rd,
        wdata=exp_wdata,
        we=exp_we,
        rs1=exp_rs1,
        rs1_val=exp_rs1_val,
        rs2=exp_rs2,
        rs2_val=exp_rs2_val,
        is_store=is_store,
        store_addr=store_addr,
        store_data=store_data,
        store_wstrb=store_wstrb,
        is_load=is_load,
        load_addr=load_addr,
        load_data=load_data,
        load_strb=load_strb,
    )
    tb.scoreboard.channels[PIPE_MON_CHANNEL].push_reference(expected)
