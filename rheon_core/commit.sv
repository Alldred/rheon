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
  input  logic [INSTR_WIDTH-1:0] instr,
  input  logic [XLEN-1:0] alu_result,
  input  logic [XLEN-1:0] load_data,
  input  logic [ADDR_W-1:0] pc_plus4,
  input  logic [ADDR_W-1:0] branch_target,
  input  logic        branch_taken,
  input  logic [4:0]  rd,
  input  logic [4:0]  rs1,
  input  logic [XLEN-1:0] rs1_val,
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

  localparam logic [6:0] OPC_SYSTEM = 7'b1110011;
  localparam logic [2:0] CSRRW  = 3'b001;
  localparam logic [2:0] CSRRS  = 3'b010;
  localparam logic [2:0] CSRRC  = 3'b011;
  localparam logic [2:0] CSRRWI = 3'b101;
  localparam logic [2:0] CSRRSI = 3'b110;
  localparam logic [2:0] CSRRCI = 3'b111;

  logic [XLEN-1:0] csr_regs [0:4095];
  logic [2:0] csr_funct3;
  logic [11:0] csr_addr;
  logic is_csr_instr;
  logic [XLEN-1:0] csr_old;
  logic [XLEN-1:0] csr_new;
  logic csr_write;
  logic has_gpr_writeback;
  integer i;

  assign csr_funct3 = instr[14:12];
  assign csr_addr = instr[31:20];
  assign is_csr_instr =
      (instr[6:0] == OPC_SYSTEM) &&
      (
        (csr_funct3 == CSRRW) ||
        (csr_funct3 == CSRRS) ||
        (csr_funct3 == CSRRC) ||
        (csr_funct3 == CSRRWI) ||
        (csr_funct3 == CSRRSI) ||
        (csr_funct3 == CSRRCI)
      );
  assign csr_old = csr_regs[csr_addr];

  always_comb begin
    csr_new = csr_old;
    csr_write = 1'b0;
    if (is_csr_instr) begin
      case (csr_funct3)
        CSRRW: begin
          csr_new = rs1_val;
          csr_write = 1'b1;
        end
        CSRRS: begin
          if (rs1 != 5'b0) begin
            csr_new = csr_old | rs1_val;
            csr_write = 1'b1;
          end
        end
        CSRRC: begin
          if (rs1 != 5'b0) begin
            csr_new = csr_old & ~rs1_val;
            csr_write = 1'b1;
          end
        end
        CSRRWI: begin
          csr_new = {{(XLEN-5){1'b0}}, rs1};
          csr_write = 1'b1;
        end
        CSRRSI: begin
          if (rs1 != 5'b0) begin
            csr_new = csr_old | {{(XLEN-5){1'b0}}, rs1};
            csr_write = 1'b1;
          end
        end
        CSRRCI: begin
          if (rs1 != 5'b0) begin
            csr_new = csr_old & ~{{(XLEN-5){1'b0}}, rs1};
            csr_write = 1'b1;
          end
        end
        default: begin
          csr_new = csr_old;
          csr_write = 1'b0;
        end
      endcase
    end
  end

  always_comb begin
    gpr_rd    = rd;
    has_gpr_writeback = is_csr_instr || wb_src_alu || wb_src_pc4 || wb_src_load;
    gpr_wdata = is_csr_instr ? csr_old : (wb_src_alu ? alu_result : (wb_src_pc4 ? pc_plus4 : load_data));
    gpr_we    = do_commit && has_gpr_writeback && (rd != 5'b0);
  end

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      for (i = 0; i < 4096; i++)
        csr_regs[i] <= '0;
    end else if (do_commit && is_csr_instr && csr_write)
      csr_regs[csr_addr] <= csr_new;
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
