// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// RV64I ALU: arithmetic, shifts, compare, logic. No M extension.

import rheon_pkg::*;

module alu (
  input  logic [XLEN-1:0] op_a,
  input  logic [XLEN-1:0] op_b,
  input  logic [3:0]     op,      // alu_op encoding
  output logic [XLEN-1:0] result
);

  localparam [3:0]
    ALU_ADD   = 4'd0,
    ALU_SUB   = 4'd1,
    ALU_SLL   = 4'd2,
    ALU_SLT   = 4'd3,
    ALU_SLTU  = 4'd4,
    ALU_XOR   = 4'd5,
    ALU_SRL   = 4'd6,
    ALU_SRA   = 4'd7,
    ALU_OR    = 4'd8,
    ALU_AND   = 4'd9,
    ALU_ADDW  = 4'd10,
    ALU_SUBW  = 4'd11,
    ALU_SLLW  = 4'd12,
    ALU_SRLW  = 4'd13,
    ALU_SRAW  = 4'd14;

  logic [XLEN-1:0] add_sub_result, shift_result, w_result;
  logic [31:0]      op_a_lo, op_b_lo, addw_subw_lo, shiftw_lo;
  logic signed [31:0] op_a_lo_signed;
  logic [4:0]      shiftw_shamt;
  logic             sub;
  logic [XLEN-1:0]  add_b, add_cin;

  assign sub = (op == ALU_SUB || op == ALU_SUBW);
  assign add_b = sub ? ~op_b : op_b;
  assign add_cin = sub ? 64'd1 : 64'd0;

  assign add_sub_result = op_a + add_b + add_cin;

  assign op_a_lo = op_a[31:0];
  assign op_b_lo = op_b[31:0];
  assign op_a_lo_signed = op_a[31:0];
  assign shiftw_shamt = op_b_lo[4:0];
  assign addw_subw_lo = op_a_lo + (sub ? ~op_b_lo : op_b_lo) + (sub ? 32'd1 : 32'd0);
  always_comb begin
    unique case (op)
      ALU_SRAW: shiftw_lo = $unsigned(op_a_lo_signed >>> shiftw_shamt);
      ALU_SRLW: shiftw_lo = op_a_lo >> shiftw_shamt;
      default:  shiftw_lo = op_a_lo << shiftw_shamt;
    endcase
  end

  always_comb begin
    w_result = '0;
    w_result[31:0] = (op == ALU_ADDW || op == ALU_SUBW) ? addw_subw_lo : shiftw_lo;
    w_result[63:32] = {32{op == ALU_ADDW || op == ALU_SUBW ? addw_subw_lo[31] : shiftw_lo[31]}};
  end

  // Shifter for 64-bit
  logic [XLEN-1:0] shamt_mask;
  assign shamt_mask = {{(XLEN-6){1'b0}}, op_b[5:0]};  // RV64I: shift amount is 6-bit for 64-bit, lower 5 for 32-bit W
  always_comb begin
    shift_result = '0;
    case (op)
      ALU_SLL:  shift_result = op_a << shamt_mask;
      ALU_SRL:  shift_result = op_a >> shamt_mask;
      ALU_SRA:  shift_result = $signed(op_a) >>> shamt_mask;
      default:  shift_result = op_a >> shamt_mask;
    endcase
  end

  always_comb begin
    result = '0;
    case (op)
      ALU_ADD, ALU_SUB:   result = add_sub_result;
      ALU_SLL, ALU_SRL, ALU_SRA: result = shift_result;
      ALU_SLT:            result = ($signed(op_a) < $signed(op_b)) ? 64'd1 : 64'd0;
      ALU_SLTU:           result = (op_a < op_b) ? 64'd1 : 64'd0;
      ALU_XOR:            result = op_a ^ op_b;
      ALU_OR:             result = op_a | op_b;
      ALU_AND:            result = op_a & op_b;
      ALU_ADDW, ALU_SUBW, ALU_SLLW, ALU_SRLW, ALU_SRAW: result = w_result;
      default:            result = add_sub_result;
    endcase
  end

endmodule
