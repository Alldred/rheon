// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// DECODE: RV64I instruction decode, produces control bundle + rs1/rs2/imm.
// GPR read and forwarding are done in the top; this module is combinatorial decode only.

import rheon_pkg::*;

module decode (
  input  logic [INSTR_WIDTH-1:0] instr,
  input  logic [ADDR_WIDTH-1:0]  pc,
  // Decoded outputs (to pipeline reg / EXECUTE)
  output logic [4:0]  rd,
  output logic [4:0]  rs1,
  output logic [4:0]  rs2,
  output logic [XLEN-1:0] imm,
  output logic [3:0]  alu_op,
  output logic        is_branch,
  output logic [2:0]  branch_funct3,
  output logic        is_jal,
  output logic        is_jalr,
  output logic        is_load,
  output logic        is_store,
  output logic [2:0]  load_store_funct3,
  output logic        wb_src_alu,
  output logic        wb_src_pc4,
  output logic        wb_src_load,
  output logic        op_a_is_pc,   // AUIPC / branch target
  output logic        op_a_is_zero, // LUI: use 0
  output logic        op_b_is_imm   // immediate op (not rs2)
);

  logic [6:0] opcode;
  logic [2:0] funct3;
  logic [6:0] funct7;

  assign opcode = instr[6:0];
  assign funct3 = instr[14:12];
  assign funct7 = instr[31:25];
  assign rd     = instr[11:7];
  assign rs1    = instr[19:15];
  assign rs2    = instr[24:20];

  // Immediate decoding (all formats)
  logic [XLEN-1:0] imm_i, imm_s, imm_b, imm_u, imm_j;
  assign imm_i = {{XLEN-12{instr[31]}}, instr[31:20]};
  assign imm_s = {{XLEN-12{instr[31]}}, instr[31:25], instr[11:7]};
  assign imm_b = {{XLEN-13{instr[31]}}, instr[31], instr[7], instr[30:25], instr[11:8], 1'b0};
  assign imm_u = {{XLEN-32{instr[31]}}, instr[31:12], 12'b0};
  assign imm_j = {{XLEN-21{instr[31]}}, instr[31], instr[19:12], instr[20], instr[30:21], 1'b0};

  always_comb begin
    imm = '0;
    case (opcode)
      7'b0010011: imm = imm_i;  // imm arith
      7'b0011011: imm = imm_i;  // imm W
      7'b0000011: imm = imm_i;  // load
      7'b0100011: imm = imm_s;  // store
      7'b1100011: imm = imm_b;  // branch
      7'b1101111: imm = imm_j;  // JAL
      7'b1100111: imm = imm_i;  // JALR
      7'b0110111,
      7'b0010111: imm = imm_u;  // LUI, AUIPC
      default:   imm = imm_i;
    endcase
  end

  // ALU op encoding (match alu.sv)
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

  always_comb begin
    alu_op = ALU_ADD;
    is_branch = 1'b0;
    branch_funct3 = funct3;
    is_jal = 1'b0;
    is_jalr = 1'b0;
    is_load = 1'b0;
    is_store = 1'b0;
    load_store_funct3 = funct3;
    wb_src_alu = 1'b0;
    wb_src_pc4 = 1'b0;
    wb_src_load = 1'b0;
    op_a_is_pc = 1'b0;
    op_a_is_zero = 1'b0;
    op_b_is_imm = 1'b0;
    case (opcode)
      7'b0110111: begin // LUI
        wb_src_alu = 1'b1;
        op_a_is_zero = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_ADD;  // result = 0 + imm
      end
      7'b0010111: begin // AUIPC
        wb_src_alu = 1'b1;
        op_a_is_pc = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_ADD;
      end
      7'b1101111: begin // JAL
        is_jal = 1'b1;
        wb_src_pc4 = 1'b1;
        op_a_is_pc = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_ADD;
      end
      7'b1100111: begin // JALR
        is_jalr = 1'b1;
        wb_src_pc4 = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_ADD;
      end
      7'b1100011: begin // branch
        is_branch = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_SUB;  // compare
      end
      7'b0000011: begin // load
        is_load = 1'b1;
        wb_src_load = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_ADD;
      end
      7'b0100011: begin // store
        is_store = 1'b1;
        op_b_is_imm = 1'b1;
        alu_op = ALU_ADD;
      end
      7'b0010011: begin // imm arith
        wb_src_alu = 1'b1;
        op_b_is_imm = 1'b1;
        case (funct3)
          3'b000: alu_op = ALU_ADD;
          3'b010: alu_op = ALU_SLT;
          3'b011: alu_op = ALU_SLTU;
          3'b100: alu_op = ALU_XOR;
          3'b110: alu_op = ALU_OR;
          3'b111: alu_op = ALU_AND;
          3'b001: alu_op = ALU_SLL;
          3'b101: alu_op = (funct7[5] ? ALU_SRA : ALU_SRL);
          default: alu_op = ALU_ADD;
        endcase
      end
      7'b0011011: begin // imm W
        wb_src_alu = 1'b1;
        op_b_is_imm = 1'b1;
        case (funct3)
          3'b000: alu_op = ALU_ADDW;
          3'b001: alu_op = ALU_SLLW;
          3'b101: alu_op = (funct7[5] ? ALU_SRAW : ALU_SRLW);
          default: alu_op = ALU_ADDW;
        endcase
      end
      7'b0110011: begin // reg arith
        wb_src_alu = 1'b1;
        case (funct3)
          3'b000: alu_op = (funct7[5] ? ALU_SUB : ALU_ADD);
          3'b001: alu_op = ALU_SLL;
          3'b010: alu_op = ALU_SLT;
          3'b011: alu_op = ALU_SLTU;
          3'b100: alu_op = ALU_XOR;
          3'b101: alu_op = (funct7[5] ? ALU_SRA : ALU_SRL);
          3'b110: alu_op = ALU_OR;
          3'b111: alu_op = ALU_AND;
          default: alu_op = ALU_ADD;
        endcase
      end
      7'b0111011: begin // reg W
        wb_src_alu = 1'b1;
        case (funct3)
          3'b000: alu_op = (funct7[5] ? ALU_SUBW : ALU_ADDW);
          3'b001: alu_op = ALU_SLLW;
          3'b101: alu_op = (funct7[5] ? ALU_SRAW : ALU_SRLW);
          default: alu_op = ALU_ADDW;
        endcase
      end
      default: ;
    endcase
  end

endmodule
