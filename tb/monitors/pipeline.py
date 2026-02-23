# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Pipeline commit monitor: builds CommitTx from internal DUT signals over multiple stages.

from __future__ import annotations

from typing import Any, Optional

from cocotb.triggers import RisingEdge
from forastero import BaseIO, IORole
from forastero.monitor import BaseMonitor

from ..transactions import CommitTx


class RheonCoreIO(BaseIO):
    """
    Minimal IO for pipeline monitor: satisfies forastero BaseIO, reads hierarchical
    DUT signals by dotted path (e.g. 'commit_i.instr_valid') via get().
    """

    def __init__(self, dut: Any) -> None:
        super().__init__(
            dut=dut,
            name="rheon_core",
            role=IORole.INITIATOR,
            init_sigs=[],
            resp_sigs=[],
        )

    def get(self, key: str, default: int = 0) -> int:
        obj: Any = self._dut
        for part in key.split("."):
            obj = getattr(obj, part)
        if hasattr(obj, "value"):
            return int(obj.value)
        return default


class PipelineCommitMonitor(BaseMonitor):
    """
    Observe internal rheon_core signals; build CommitTx over multiple stages.
    On commit: emit transaction with GPR writeback and (if PC matches) pending store.
    """

    async def monitor(self, capture: Any) -> None:
        dut = self.tb.dut
        pending_store: Optional[tuple[int, int, int, int]] = (
            None  # (pc, addr, data, wstrb)
        )

        while True:
            await RisingEdge(self.clk)
            if self.rst.value == self.tb.rst_active_value:
                pending_store = None
                continue

            # Commit stage: emit transaction when instruction commits
            instr_valid = int(dut.commit_i.instr_valid) == 1
            if instr_valid:
                c_pc_plus4 = int(dut.c_pc_plus4)
                commit_pc = (c_pc_plus4 - 4) & ((1 << 64) - 1)
                next_pc = int(dut.next_pc)
                rd = int(dut.gpr_rd)
                wdata = int(dut.gpr_wdata)
                gpr_we = int(dut.gpr_we) == 1

                # Source registers (C-stage)
                rs1 = int(dut.c_rs1)
                rs1_val = int(dut.c_rdata1)
                rs2 = int(dut.c_rs2)
                rs2_val = int(dut.c_rdata2)

                is_store = False
                store_addr_val: Optional[int] = None
                store_data_val: Optional[int] = None
                store_wstrb_val: Optional[int] = None
                if pending_store is not None and pending_store[0] == commit_pc:
                    is_store = True
                    store_addr_val = pending_store[1]
                    store_data_val = pending_store[2]
                    store_wstrb_val = pending_store[3]
                    pending_store = None

                # Load (C-stage)
                is_load = int(dut.c_is_load) == 1
                load_addr_val: Optional[int] = None
                load_data_val: Optional[int] = None
                load_strb_val: Optional[int] = None
                if is_load:
                    load_addr_val = int(dut.c_load_addr)
                    load_data_val = int(dut.c_load_data)
                    load_strb_val = 0xFF  # full doubleword

                tx = CommitTx(
                    pc=commit_pc,
                    next_pc=next_pc,
                    rd=rd,
                    wdata=wdata,
                    we=gpr_we,
                    rs1=rs1,
                    rs1_val=rs1_val,
                    rs2=rs2,
                    rs2_val=rs2_val,
                    is_store=is_store,
                    store_addr=store_addr_val,
                    store_data=store_data_val,
                    store_wstrb=store_wstrb_val,
                    is_load=is_load,
                    load_addr=load_addr_val,
                    load_data=load_data_val,
                    load_strb=load_strb_val,
                )
                capture(tx)

            # Store request from E stage: record by PC for correlation at commit
            if int(dut.dmem_req_valid) == 1 and int(dut.dmem_req_is_store) == 1:
                e_pc = int(dut.e_pc_r)
                pending_store = (
                    e_pc,
                    int(dut.dmem_req_addr),
                    int(dut.dmem_req_wdata),
                    int(dut.dmem_req_wstrb),
                )
