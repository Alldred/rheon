# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Lome-based scoreboard: push expected CommitTx (from model) for Forastero scoreboard compare.

from __future__ import annotations

import logging
from typing import Any, Optional

from forastero.monitor import MonitorEvent

from .disasm import disasm_insn
from .memory import DictMemory
from .transactions import CommitTx
from .verbosity import get_verbosity

_log = logging.getLogger(__name__)

# Channel name for pipeline commit monitor (must match register name in testbench)
PIPE_MON_CHANNEL = "pipe_mon"


def _size_to_strobe(size: int) -> int:
    if size <= 0:
        return 0
    if size >= 8:
        return 0xFF
    return (1 << size) - 1


def _rd_operand(instr: int) -> Optional[int]:
    """Return decoded destination register index when the instruction has rd, else None."""
    opcode = instr & 0x7F
    if opcode in (0x03, 0x07, 0x13, 0x17, 0x1B, 0x33, 0x37, 0x3B, 0x67, 0x6F, 0x73):
        return (instr >> 7) & 0x1F
    return None


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

    verbose_debug = get_verbosity() == "debug"
    if verbose_debug:
        # Ensure DEBUG records are not dropped by logger/handler thresholds.
        for lg in (logging.getLogger("tb"), logging.getLogger()):
            if lg.level > logging.DEBUG:
                lg.setLevel(logging.DEBUG)
            for handler in lg.handlers:
                if handler.level > logging.DEBUG:
                    handler.setLevel(logging.DEBUG)
        asm = disasm_insn(obj.instr, obj.pc, decoder=tb.model.decoder)
        _log.debug("  %#x: %s", obj.pc, asm)

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

    exp_instr = memory.read_instr(ref_pc_before) & 0xFFFFFFFF

    # Expected architectural destination: suppress x0 writes as no writeback.
    reg_writes = changes.gpr_writes
    exp_rd = _rd_operand(exp_instr)
    exp_rd_val: Optional[int] = None
    if exp_rd == 0:
        exp_rd = None
    if exp_rd is not None and reg_writes:
        rw = reg_writes[0]
        if int(rw.register) == exp_rd:
            exp_rd_val = int(rw.value)

    # Expected GPR reads: None when this instruction has no such operand.
    reg_reads = changes.gpr_reads
    exp_rs1: Optional[int] = None
    exp_rs1_val: Optional[int] = None
    exp_rs2: Optional[int] = None
    exp_rs2_val: Optional[int] = None
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

    instr_asm = ""
    if verbose_debug:
        instr_asm = disasm_insn(exp_instr, ref_pc_before, decoder=tb.model.decoder)

    expected = CommitTx(
        pc=ref_pc_before,
        next_pc=expected_pc,
        instr=exp_instr,
        instr_asm=instr_asm,
        rd=exp_rd,
        rd_val=exp_rd_val,
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
