# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# RISC-V instruction disassembly (Eumos Decoder); reuse Lome model's decoder when available.

from __future__ import annotations

from typing import Any

# Lazy fallback decoder for callers that don't have a model (e.g. standalone scripts).
_decoder: Any = None


def _get_decoder():
    global _decoder
    if _decoder is None:
        from eumos import instruction_loader
        from eumos.decoder import Decoder

        _decoder = Decoder(instruction_loader.load_all_instructions())
    return _decoder


def disasm_insn(instr: int, pc: int = 0, decoder: Any = None) -> str:
    """Return a single RISC-V instruction as an ASM string, e.g. 'addi x1, x0, 264'.
    Uses Eumos Decoder.from_opc() and InstructionInstance.to_asm().
    If decoder is provided (e.g. tb.model.decoder from Lome), it is used; otherwise a lazy-built decoder is used."""
    instr = instr & 0xFFFFFFFF
    dec = decoder if decoder is not None else _get_decoder()
    try:
        instance = dec.from_opc(instr)
        return instance.to_asm()
    except Exception:
        return f".word 0x{instr:08x}"
