# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Bucket functional coverage for RV I-extension instruction retirement.

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from bucket import Coverpoint, Covertop
from bucket.rw import ArchiveAccessor, PointReader
from eumos import instruction_loader
from eumos.decoder import Decoder
from eumos.models import InstructionDef


def _load_i_instruction_defs() -> dict[str, InstructionDef]:
    instrs = instruction_loader.load_all_instructions()
    return {
        mnemonic.lower(): insn
        for mnemonic, insn in instrs.items()
        if getattr(insn, "extension", "") == "I"
    }


def operand_class_for_instruction(instr: InstructionDef) -> str:
    """Derive operand-shape class from Eumos metadata."""
    has_imm = any(op.type == "immediate" for op in instr.operands.values())
    src_count = len(instr.gpr_source_operands())
    dst_count = len(instr.gpr_dest_operands())

    if instr.in_group("memory/load"):
        return "memory_load"
    if instr.in_group("memory/store"):
        return "memory_store"
    if instr.in_group("branch/conditional"):
        return "branch_conditional"
    if instr.in_group("branch/jump"):
        return "branch_jump"
    if instr.in_group("system/csr"):
        return "system_csr"
    if instr.in_group("system/call"):
        return "system_call"
    if instr.in_group("system/return"):
        return "system_return"
    if instr.in_group("system/ordering"):
        return "system_ordering"
    if dst_count == 1 and src_count == 2:
        return "alu_rr"
    if dst_count == 1 and src_count == 1 and has_imm:
        return "alu_ri"
    if dst_count == 1 and src_count == 0 and has_imm:
        return "alu_ui"
    if dst_count == 0 and src_count == 0 and not has_imm:
        return "no_operands"
    return "other"


def default_context_hash(i_instr_defs: dict[str, InstructionDef]) -> str:
    digest = hashlib.sha256()
    digest.update(b"rheon_i_extension_coverage_v1")
    for mnemonic in sorted(i_instr_defs):
        digest.update(mnemonic.encode("utf-8"))
        digest.update(b"|")
        digest.update(
            operand_class_for_instruction(i_instr_defs[mnemonic]).encode("utf-8")
        )
        digest.update(b";")
    return digest.hexdigest()


@dataclass(frozen=True)
class IExtensionTrace:
    mnemonic: str
    operand_class: str


class IExtensionMnemonicCoverpoint(Coverpoint):
    def __init__(self, i_mnemonics: list[str]) -> None:
        self._i_mnemonics = i_mnemonics
        super().__init__()

    def setup(self, ctx: SimpleNamespace):
        self.add_axis(
            "mnemonic",
            {mnemonic: mnemonic for mnemonic in self._i_mnemonics},
            "RV I-extension mnemonic retired",
        )

    def sample(self, trace: IExtensionTrace):
        self.bucket.hit(mnemonic=trace.mnemonic)


class IExtensionOperandClassCoverpoint(Coverpoint):
    def __init__(self, i_mnemonics: list[str], operand_classes: list[str]) -> None:
        self._i_mnemonics = i_mnemonics
        self._operand_classes = operand_classes
        super().__init__()

    def setup(self, ctx: SimpleNamespace):
        self.add_axis(
            "mnemonic",
            {mnemonic: mnemonic for mnemonic in self._i_mnemonics},
            "RV I-extension mnemonic retired",
        )
        self.add_axis(
            "operand_class",
            {name: name for name in self._operand_classes},
            "Operand-shape class from Eumos iSA metadata",
        )

    def sample(self, trace: IExtensionTrace):
        self.bucket.hit(mnemonic=trace.mnemonic, operand_class=trace.operand_class)


class IExtensionCoverageTop(Covertop):
    def __init__(self, i_mnemonics: list[str], operand_classes: list[str]) -> None:
        self._i_mnemonics = i_mnemonics
        self._operand_classes = operand_classes
        super().__init__()

    def setup(self, ctx: SimpleNamespace):
        self.add_coverpoint(
            IExtensionMnemonicCoverpoint(self._i_mnemonics),
            name="i_extension_mnemonic",
        )
        self.add_coverpoint(
            IExtensionOperandClassCoverpoint(self._i_mnemonics, self._operand_classes),
            name="i_extension_operand_class",
        )


class IExtensionCoverage:
    """Collect and export RV I-extension retirement coverage."""

    def __init__(
        self,
        *,
        decoder: Any | None = None,
        context_hash: str | None = None,
    ) -> None:
        self._i_instr_defs = _load_i_instruction_defs()
        self.i_mnemonics = sorted(self._i_instr_defs.keys())
        self.operand_classes = sorted(
            {
                operand_class_for_instruction(insn)
                for insn in self._i_instr_defs.values()
            }
        )
        self.context_hash = context_hash or default_context_hash(self._i_instr_defs)

        all_instrs = instruction_loader.load_all_instructions()
        self._decoder = decoder if decoder is not None else Decoder(all_instrs)
        self.coverage = IExtensionCoverageTop(self.i_mnemonics, self.operand_classes)

    def sample_commit(self, tx: Any) -> None:
        instr_word = int(getattr(tx, "instr", 0)) & 0xFFFFFFFF
        try:
            decoded = self._decoder.from_opc(instr_word)
        except Exception:
            return

        mnemonic = decoded.instruction.mnemonic.lower()
        instr_def = self._i_instr_defs.get(mnemonic)
        if instr_def is None:
            return

        self.coverage.sample(
            IExtensionTrace(
                mnemonic=mnemonic,
                operand_class=operand_class_for_instruction(instr_def),
            )
        )

    def export_archive(self, path: str | Path) -> Path:
        archive_path = Path(path)
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        readout = PointReader(self.context_hash).read(self.coverage)
        ArchiveAccessor(archive_path).writer().write(readout)
        return archive_path
