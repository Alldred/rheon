# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Dict-backed memory and ELF loader for rheon testbench.

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Tuple

# Match rheon_core constants (same as rheon_pkg_spec)
INSTR_WIDTH = 32
XLEN = 64
# I-memory: 64-bit (8-byte) reads; fetch extracts 32-bit instructions internally
IMEM_QWORD_BYTES = 8
_EXIT_S_RE = re.compile(r"^\s*#\s*Exit:\s*(0x[0-9a-fA-F]+)\s*$")
_EXIT_YAML_RE = re.compile(r"^\s*exit_address\s*:\s*['\"]?(0x[0-9a-fA-F]+)['\"]?\s*$")


class DictMemory:
    """Byte-addressed memory backed by a Python dict. Used by I/D mem drivers and Lome."""

    def __init__(self) -> None:
        self._mem: dict[int, int] = {}  # address -> byte (0-255)

    def read_byte(self, addr: int) -> int:
        return self._mem.get(addr & ((1 << 64) - 1), 0)

    def write_byte(self, addr: int, value: int) -> None:
        self._mem[addr & ((1 << 64) - 1)] = value & 0xFF

    def read(self, addr: int, size: int) -> int:
        """Read `size` bytes from `addr` (little-endian), return as integer."""
        addr = addr & ((1 << 64) - 1)
        v = 0
        for i in range(size):
            v |= self.read_byte(addr + i) << (i * 8)
        return v

    def write(self, addr: int, size: int, value: int, wstrb: int | None = None) -> None:
        """
        Write `value` (little-endian) to `addr` for `size` bytes.
        If `wstrb` is given, it is a bitmask of bytes to write (e.g. 0xF = all 4 bytes).
        """
        addr = addr & ((1 << 64) - 1)
        if wstrb is not None:
            for i in range(min(8, size)):
                if (wstrb >> i) & 1:
                    self.write_byte(addr + i, (value >> (i * 8)) & 0xFF)
        else:
            for i in range(size):
                self.write_byte(addr + i, (value >> (i * 8)) & 0xFF)

    def read_instr(self, addr: int) -> int:
        """Read one 32-bit instruction at `addr` (must be 4-byte aligned for semantics)."""
        return self.read(addr, 4) & 0xFFFFFFFF

    def read_qword(self, addr: int) -> int:
        """Read one 64-bit qword at 8-byte-aligned `addr` (for I-memory)."""
        return self.read(addr, IMEM_QWORD_BYTES) & ((1 << (IMEM_QWORD_BYTES * 8)) - 1)

    def qword_align(self, addr: int) -> int:
        """Return address aligned down to 8-byte (I-mem qword) boundary."""
        return addr & ~(IMEM_QWORD_BYTES - 1)


class LomeReadOnlyMemory:
    """
    Lome memory adapter backed by DictMemory.

    Loads read through to the shared TB memory. Stores are intentionally
    non-mutating so the model can predict write intents without perturbing
    the memory image used by RTL-side traffic.
    """

    def __init__(self, backing: DictMemory) -> None:
        self._backing = backing
        self.store_log: List[Tuple[int, int, int]] = []  # (addr, value, size)

    def load(self, addr: int, size: int) -> int:
        return self._backing.read(addr, size)

    def store(self, addr: int, value: int, size: int) -> None:
        # Record intent only; never mutate backing memory.
        self.store_log.append((addr, value, size))


def load_elf(path: str | Path, memory: DictMemory) -> int:
    """
    Load ELF file at `path` into `memory`. Write PT_LOAD segments to their vaddr.
    Returns the entry point (e_entry).
    """
    try:
        from elftools.elf.elffile import ELFFile
    except ImportError:
        raise ImportError(
            "pyelftools is required for load_elf(); add it to dependencies"
        ) from None

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)

    entry = 0
    with path.open("rb") as f:
        elf = ELFFile(f)
        entry = elf.header.e_entry

        for segment in elf.iter_segments():
            # pyelftools exposes program header fields via mapping-style access.
            # 'p_type' is usually an enum string like 'PT_LOAD'.
            if segment["p_type"] != "PT_LOAD":
                continue
            vaddr = segment["p_vaddr"]
            data = segment.data()
            for i, b in enumerate(data):
                memory.write_byte(vaddr + i, b)

    return entry


def read_exit_address(path: str | Path) -> int | None:
    """
    Try to resolve test exit address for an ELF.

    Lookup order:
    1. ELF symbol table (_exit/exit/__exit).
    2. Sidecar metadata next to ELF (instructions_modelled.yaml/.yml).
    3. Sidecar assembly header next to ELF (test.S with '# Exit: 0x...').
    """
    elf_path = Path(path)
    if not elf_path.exists():
        return None

    # Prefer ELF-defined exit symbol when present.
    try:
        from elftools.elf.elffile import ELFFile
    except ImportError:
        ELFFile = None  # type: ignore[assignment]
    if ELFFile is not None:
        try:
            with elf_path.open("rb") as f:
                elf = ELFFile(f)
                for sec_name in (".symtab", ".dynsym"):
                    sec = elf.get_section_by_name(sec_name)
                    if sec is None:
                        continue
                    for sym in sec.iter_symbols():
                        if sym.name in {"_exit", "exit", "__exit"}:
                            return int(sym["st_value"])
        except Exception:
            pass

    # Prefer explicit generator metadata when present.
    for meta_name in ("instructions_modelled.yaml", "instructions_modelled.yml"):
        meta_path = elf_path.parent / meta_name
        if not meta_path.exists():
            continue
        for line in meta_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = _EXIT_YAML_RE.match(line)
            if m:
                try:
                    return int(m.group(1), 16)
                except ValueError:
                    break

    # Fallback to assembly header comment.
    asm_path = elf_path.with_suffix(".S")
    if not asm_path.exists():
        alt_asm_path = elf_path.parent / "test.S"
        asm_path = alt_asm_path if alt_asm_path.exists() else asm_path
    if asm_path.exists():
        for line in asm_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = _EXIT_S_RE.match(line)
            if m:
                try:
                    return int(m.group(1), 16)
                except ValueError:
                    break

    return None
