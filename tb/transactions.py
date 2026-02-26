# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Commit transaction for pipeline monitor and scoreboard.

from __future__ import annotations

import dataclasses
from typing import Optional

try:
    from forastero import BaseTransaction
except ImportError:
    BaseTransaction = object  # type: ignore[misc, assignment]


@dataclasses.dataclass(kw_only=True)
class CommitTx(BaseTransaction if BaseTransaction is not object else object):
    """One committed instruction: PC, next PC, GPR read/write, optional load/store."""

    pc: int = 0
    next_pc: int = 0
    instr: int = 0  # 32-bit instruction word (opcode = instr & 0x7F)
    # Destination (writeback)
    rd: int = 0
    wdata: int = 0
    we: bool = False
    # Source registers (index + value)
    rs1: int = 0
    rs1_val: int = 0
    rs2: int = 0
    rs2_val: int = 0
    # Store
    is_store: bool = False
    store_addr: Optional[int] = None
    store_data: Optional[int] = None
    store_wstrb: Optional[int] = None
    # Load
    is_load: bool = False
    load_addr: Optional[int] = None
    load_data: Optional[int] = None
    load_strb: Optional[int] = None


@dataclasses.dataclass(kw_only=True)
class ImemRequest(BaseTransaction if BaseTransaction is not object else object):
    """I-memory request captured by monitor: address to fetch."""

    req_addr: int = 0


@dataclasses.dataclass(kw_only=True)
class DmemRequest(BaseTransaction if BaseTransaction is not object else object):
    """D-memory request captured by monitor: address, store flag, and write data/strobe."""

    req_addr: int = 0
    req_is_store: bool = False
    req_wdata: int = 0
    req_wstrb: int = 0


@dataclasses.dataclass(kw_only=True)
class MemoryResponse(BaseTransaction if BaseTransaction is not object else object):
    """Generic memory response payload for rsp_* data channels."""

    data: int = 0


# Semantic aliases retained for readability/backward compatibility.
ImemResponse = MemoryResponse
DmemResponse = MemoryResponse
