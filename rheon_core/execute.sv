// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// EXECUTE: ALU, branch resolution, load/store address. Pipeline stalls until D-mem completes.

import rheon_pkg::*;

module execute #(
  parameter int ADDR_W = ADDR_WIDTH
) (
  input  logic        clk,
  input  logic        rst_n,
  // Decoded from D stage
  input  logic [4:0]  rd,
  input  logic [4:0]  rs1,
  input  logic [4:0]  rs2,
  input  logic [XLEN-1:0] rdata1,
  input  logic [XLEN-1:0] rdata2,
  input  logic [XLEN-1:0] imm,
  input  logic [ADDR_W-1:0] pc,
  input  logic [3:0]  alu_op,
  input  logic        is_branch,
  input  logic [2:0]  branch_funct3,
  input  logic        is_jal,
  input  logic        is_jalr,
  input  logic        is_load,
  input  logic        is_store,
  input  logic [2:0]  load_store_funct3,
  input  logic        wb_src_alu,
  input  logic        wb_src_pc4,
  input  logic        wb_src_load,
  input  logic        op_a_is_pc,
  input  logic        op_b_is_imm,
  // ALU operands (after forwarding)
  input  logic [XLEN-1:0] op_a,
  input  logic [XLEN-1:0] op_b,
  // Results
  output logic [XLEN-1:0] alu_result,
  output logic [ADDR_W-1:0] branch_target,
  output logic        branch_taken,
  output logic [ADDR_W-1:0] ldst_addr,
  output logic [XLEN-1:0] store_data,
  output logic [2:0]  store_size,   // 0=byte, 1=half, 2=word, 3=double
  output logic        ldst_is_store,
  output logic [4:0]  result_rd,
  output logic        result_wb_src_alu,
  output logic        result_wb_src_pc4,
  output logic        result_wb_src_load,
  output logic        result_is_branch,
  output logic        result_is_jal,
  output logic        result_is_jalr,
  // D-memory request (DUT initiator; TB drives req_ready)
  output logic        dmem_req_valid,
  output logic [ADDR_W-1:0] dmem_req_addr,
  output logic [XLEN-1:0] dmem_req_wdata,
  output logic [7:0]  dmem_req_wstrb,
  output logic        dmem_req_is_store,
  input  logic        dmem_req_ready,
  // D-memory response (TB initiator: valid/data; DUT drives ready)
  input  logic        dmem_rsp_valid,
  input  logic [XLEN-1:0] dmem_rsp_rdata,
  output logic        dmem_rsp_ready
);

  logic [XLEN-1:0] alu_a, alu_b;
  assign alu_a = op_a_is_pc ? pc : op_a;
  assign alu_b = op_b_is_imm ? imm : op_b;

  alu alu_i (
    .op_a   (alu_a),
    .op_b   (alu_b),
    .op     (alu_op),
    .result (alu_result)
  );

  assign branch_target = pc + imm;
  assign ldst_addr     = alu_result[ADDR_W-1:0];
  assign store_data    = rdata2;

  // Branch condition
  always_comb begin
    branch_taken = 1'b0;
    if (is_branch)
      case (branch_funct3)
        3'b000: branch_taken = (op_a == op_b);   // BEQ
        3'b001: branch_taken = (op_a != op_b);   // BNE
        3'b100: branch_taken = ($signed(op_a) < $signed(op_b));  // BLT
        3'b101: branch_taken = ($signed(op_a) >= $signed(op_b)); // BGE
        3'b110: branch_taken = (op_a < op_b);     // BLTU
        3'b111: branch_taken = (op_a >= op_b);   // BGEU
        default: branch_taken = 1'b0;
      endcase
  end

  // Store size / strobe from funct3 (intermediate to avoid combinational loop in mux below)
  assign store_size = load_store_funct3[1:0];  // 0=B, 1=H, 2=W, 3=D
  logic [7:0] wstrb_comb;
  always_comb begin
    wstrb_comb = 8'b0;
    if (store_size == 0) wstrb_comb = 8'b0000_0001 << ldst_addr[2:0];
    else if (store_size == 1) wstrb_comb = (8'b11 << {ldst_addr[2:1], 1'b0});
    else if (store_size == 2) wstrb_comb = (8'b1111 << {ldst_addr[2], 2'b0});
    else wstrb_comb = 8'b1111_1111;
  end

  assign ldst_is_store = is_store;
  assign result_rd = rd;
  assign result_wb_src_alu = wb_src_alu;
  assign result_wb_src_pc4 = wb_src_pc4;
  assign result_wb_src_load = wb_src_load;
  assign result_is_branch = is_branch;
  assign result_is_jal = is_jal;
  assign result_is_jalr = is_jalr;

  // Issue load/store request; hold valid and params until response (pipeline stalls)
  logic pending_ldst;
  logic [ADDR_W-1:0] req_addr_r;
  logic [XLEN-1:0]   req_wdata_r;
  logic [7:0]        req_wstrb_r;
  logic              req_is_store_r;

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      pending_ldst    <= 1'b0;
      req_addr_r     <= '0;
      req_wdata_r    <= '0;
      req_wstrb_r    <= '0;
      req_is_store_r <= 1'b0;
    end else if (dmem_rsp_valid && dmem_rsp_ready && pending_ldst) begin
      pending_ldst <= 1'b0;
    end else if ((is_load || is_store) && !pending_ldst) begin
      pending_ldst   <= 1'b1;
      req_addr_r    <= ldst_addr;
      req_wdata_r   <= store_data;
      req_wstrb_r   <= wstrb_comb;
      req_is_store_r <= is_store;
    end
  end

  assign dmem_req_valid   = pending_ldst || (is_load || is_store);
  assign dmem_req_addr    = pending_ldst ? req_addr_r : ldst_addr;
  assign dmem_req_wdata   = pending_ldst ? req_wdata_r : store_data;
  assign dmem_req_wstrb   = pending_ldst ? req_wstrb_r : wstrb_comb;
  assign dmem_req_is_store = pending_ldst ? req_is_store_r : is_store;
  assign dmem_rsp_ready   = pending_ldst;  // DUT ready to accept response when request in flight

endmodule
