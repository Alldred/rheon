#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

from types import SimpleNamespace

from eumos import instruction_loader
from eumos.decoder import Decoder

from tb.coverage.i_extension import IExtensionCoverage, _load_i_instruction_defs


def test_i_instruction_defs_include_expected_mnemonics() -> None:
    i_defs = _load_i_instruction_defs()
    assert i_defs
    for mnemonic in ("addi", "lw", "jalr"):
        assert mnemonic in i_defs


def test_operand_class_derivation_is_stable_for_representative_mnemonics() -> None:
    collector = IExtensionCoverage()
    i_defs = _load_i_instruction_defs()
    assert i_defs["addi"].in_group("alu")
    assert i_defs["lw"].in_group("memory/load")
    assert i_defs["mret"].in_group("system/return")
    assert "alu_ri" in collector.operand_classes
    assert "memory_load" in collector.operand_classes
    assert "system_return" in collector.operand_classes


def test_sample_commit_ignores_non_i_instructions() -> None:
    instrs = instruction_loader.load_all_instructions()
    decoder = Decoder(instrs)
    collector = IExtensionCoverage(decoder=decoder)

    addi_word = decoder.from_asm("addi x1, x0, 1").to_opc()
    fadd_word = decoder.from_asm("fadd.s f1, f2, f3").to_opc()

    collector.sample_commit(SimpleNamespace(instr=addi_word))
    collector.sample_commit(SimpleNamespace(instr=fadd_word))

    mnemonic_cp = collector.coverage.i_extension_mnemonic
    operand_cp = collector.coverage.i_extension_operand_class

    assert mnemonic_cp._cvg_hits[("addi",)] == 1
    assert sum(mnemonic_cp._cvg_hits.values()) == 1
    assert sum(operand_cp._cvg_hits.values()) == 1
