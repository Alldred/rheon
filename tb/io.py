# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Forastero BaseIO and IOStyle for rheon_core (plain signal names, no i_/o_ prefix).

from __future__ import annotations

from typing import Any, Callable, List, Optional

from forastero import BaseIO, IORole


def rheon_io_style(
    bus: Optional[str],
    component: str,
    role_bus: IORole,
    role_comp: IORole,
) -> str:
    """IOStyle for rheon_core: signals are named {bus}_{component} (e.g. imem_req_valid)."""
    if bus:
        return f"{bus}_{component}"
    return component


# Shared signal lists: req = ready/valid handshake (DUT initiator), rsp = ready/valid (TB initiator).
# init_sigs = from DUT (req_*, rsp_ready); resp_sigs = from TB (req_ready, rsp_valid, rsp_data/rsp_rdata).
IMEM_INIT_SIGS: List[str] = ["req_valid", "req_addr", "rsp_ready"]
IMEM_RESP_SIGS: List[str] = ["req_ready", "rsp_valid", "rsp_data"]
DMEM_INIT_SIGS: List[str] = [
    "req_valid",
    "req_addr",
    "req_wdata",
    "req_wstrb",
    "req_is_store",
    "rsp_ready",
]
DMEM_RESP_SIGS: List[str] = ["req_ready", "rsp_valid", "rsp_rdata"]


class MemIO(BaseIO):
    """
    Shared memory-bus IO: one IOStyle (rheon_io_style), parametrised by init_sigs and resp_sigs.
    Use ImemIO / DmemIO for the concrete I-mem and D-mem interfaces.
    """

    def __init__(
        self,
        dut: Any,
        name: str,
        role: IORole = IORole.INITIATOR,
        init_sigs: Optional[List[str]] = None,
        resp_sigs: Optional[List[str]] = None,
        io_style: Optional[Callable[[Optional[str], str, IORole, IORole], str]] = None,
    ) -> None:
        super().__init__(
            dut=dut,
            name=name,
            role=role,
            init_sigs=init_sigs or [],
            resp_sigs=resp_sigs or [],
            io_style=io_style or rheon_io_style,
        )


class ImemIO(MemIO):
    """I-memory interface: req_valid, req_addr (from DUT), rsp_ready, rsp_data (from TB)."""

    def __init__(
        self,
        dut: Any,
        name: str = "imem",
        role: IORole = IORole.INITIATOR,
        io_style: Optional[Callable[[Optional[str], str, IORole, IORole], str]] = None,
    ) -> None:
        super().__init__(
            dut=dut,
            name=name,
            role=role,
            init_sigs=IMEM_INIT_SIGS,
            resp_sigs=IMEM_RESP_SIGS,
            io_style=io_style,
        )


class DmemIO(MemIO):
    """D-memory interface: req_* from DUT, rsp_ready/rsp_rdata from TB."""

    def __init__(
        self,
        dut: Any,
        name: str = "dmem",
        role: IORole = IORole.INITIATOR,
        io_style: Optional[Callable[[Optional[str], str, IORole, IORole], str]] = None,
    ) -> None:
        super().__init__(
            dut=dut,
            name=name,
            role=role,
            init_sigs=DMEM_INIT_SIGS,
            resp_sigs=DMEM_RESP_SIGS,
            io_style=io_style,
        )
