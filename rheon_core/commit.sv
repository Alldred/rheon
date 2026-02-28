// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// COMMIT: writeback to GPR, PC update, flush on branch/jump. Forwarding source.

import rheon_pkg::*;

module commit #(
  parameter int ADDR_W = ADDR_WIDTH
) (
  input  logic        clk,
  input  logic        rst_n,
  // From EXECUTE (C stage input)
  input  logic [XLEN-1:0] alu_result,
  input  logic [XLEN-1:0] load_data,
  input  logic [ADDR_W-1:0] pc_plus4,
  input  logic [ADDR_W-1:0] branch_target,
  input  logic        branch_taken,
  input  logic [4:0]  rd,
  input  logic [31:0] instr,      // C-stage instruction (opcode = instr[6:0])
  input  logic        wb_src_alu,
  input  logic        wb_src_pc4,
  input  logic        wb_src_load,
  input  logic        is_branch,
  input  logic        is_jal,
  input  logic        is_jalr,
  input  logic        instr_valid,  // C stage has a valid instruction to commit
  // To GPR (writeback)
  output logic [4:0]  gpr_rd,
  output logic [XLEN-1:0] gpr_wdata,
  output logic        gpr_we,
  // To FETCH (PC and flush)
  output logic [ADDR_W-1:0] next_pc,
  output logic        flush
);

  // Instruction is in C only after load/store completed (pipeline stalled until ready)
  logic do_commit;
  assign do_commit = instr_valid;

  // LUI (opcode 0x37) must write alu_result; force path when control is wrong.
  wire is_lui = (instr[6:0] == 7'b0110111);
  always_comb begin
    gpr_rd    = rd;
    gpr_wdata = is_lui ? alu_result : (wb_src_alu ? alu_result : (wb_src_pc4 ? pc_plus4 : load_data));
    gpr_we    = do_commit && (wb_src_alu || wb_src_pc4 || wb_src_load || is_lui) && (rd != 5'b0);
  end

  // Next PC: default sequential; on branch taken or jump use target.
  // JAL uses branch_target (pc+imm) directly; JALR uses alu_result (rs1+imm).
  always_comb begin
    next_pc = pc_plus4;
    flush  = 1'b0;
    if (instr_valid) begin
      if (is_jal)
        { next_pc, flush } = { branch_target, 1'b1 };
      else if (is_jalr)
        { next_pc, flush } = {{alu_result[ADDR_W-1:1], 1'b0}, 1'b1};
      else if (is_branch && branch_taken)
        { next_pc, flush } = { branch_target, 1'b1 };
    end
  end

endmodule
