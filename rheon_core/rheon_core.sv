// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// Top-level RV64I 4-stage pipeline: FETCH, DECODE, EXECUTE, COMMIT.
// Ready/valid I and D memory; flush on branch/jump; load/store stall; forwarding.

import rheon_pkg::*;

module rheon_core #(
  parameter int ADDR_W = ADDR_WIDTH
) (
  input  logic        clk,
  input  logic        rst_n,
  // Boot address (e.g. ELF entry); use 0 if not connected
  input  logic [ADDR_W-1:0] start_pc,
  // I-memory (req: DUT initiator; rsp: TB initiator)
  output logic        imem_req_valid,
  output logic [ADDR_W-1:0] imem_req_addr,
  input  logic        imem_req_ready,
  input  logic        imem_rsp_valid,
  input  logic [63:0] imem_rsp_data,
  output logic        imem_rsp_ready,
  // D-memory (req: DUT initiator; rsp: TB initiator)
  output logic        dmem_req_valid,
  output logic [ADDR_W-1:0] dmem_req_addr,
  output logic [XLEN-1:0] dmem_req_wdata,
  output logic [7:0]  dmem_req_wstrb,
  output logic        dmem_req_is_store,
  input  logic        dmem_req_ready,
  input  logic        dmem_rsp_valid,
  input  logic [XLEN-1:0] dmem_rsp_rdata,
  output logic        dmem_rsp_ready
);

  // ----- FETCH -----
  logic [INSTR_WIDTH-1:0] f_instr;
  logic [ADDR_W-1:0]     f_instr_pc;
  logic                  f_valid;
  logic [ADDR_W-1:0]     next_pc;
  logic                  flush;
  logic                  stall;

  fetch #(.ADDR_W(ADDR_W)) fetch_i (
    .clk            (clk),
    .rst_n          (rst_n),
    .start_pc       (start_pc),
    .next_pc        (next_pc),
    .flush          (flush),
    .stall          (stall),
    .instr          (f_instr),
    .instr_pc       (f_instr_pc),
    .valid          (f_valid),
    .imem_req_valid (imem_req_valid),
    .imem_req_addr  (imem_req_addr),
    .imem_req_ready (imem_req_ready),
    .imem_rsp_valid (imem_rsp_valid),
    .imem_rsp_data  (imem_rsp_data),
    .imem_rsp_ready (imem_rsp_ready)
  );

  // ----- F->D pipeline reg -----
  logic [INSTR_WIDTH-1:0] d_instr;
  logic [ADDR_W-1:0]     d_pc;
  logic                  d_valid;

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      d_valid <= 1'b0;
    end else if (flush) begin
      d_valid <= 1'b0;
    end else if (!stall) begin
      d_instr <= f_instr;
      d_pc    <= f_instr_pc;
      d_valid <= f_valid;
    end
  end

  // ----- DECODE (combinatorial) -----
  logic [4:0]  dec_rd, dec_rs1, dec_rs2;
  logic [XLEN-1:0] dec_imm;
  logic [3:0]  dec_alu_op;
  logic        dec_is_branch;
  logic [2:0]  dec_branch_funct3;
  logic        dec_is_jal, dec_is_jalr;
  logic        dec_is_load, dec_is_store;
  logic [2:0]  dec_load_store_funct3;
  logic        dec_wb_src_alu, dec_wb_src_pc4, dec_wb_src_load;
  logic        dec_op_a_is_pc, dec_op_a_is_zero, dec_op_b_is_imm;

  decode decode_i (
    .instr            (d_instr),
    .pc               (d_pc),
    .rd               (dec_rd),
    .rs1              (dec_rs1),
    .rs2              (dec_rs2),
    .imm              (dec_imm),
    .alu_op           (dec_alu_op),
    .is_branch        (dec_is_branch),
    .branch_funct3    (dec_branch_funct3),
    .is_jal           (dec_is_jal),
    .is_jalr          (dec_is_jalr),
    .is_load          (dec_is_load),
    .is_store         (dec_is_store),
    .load_store_funct3(dec_load_store_funct3),
    .wb_src_alu       (dec_wb_src_alu),
    .wb_src_pc4       (dec_wb_src_pc4),
    .wb_src_load      (dec_wb_src_load),
    .op_a_is_pc       (dec_op_a_is_pc),
    .op_a_is_zero     (dec_op_a_is_zero),
    .op_b_is_imm      (dec_op_b_is_imm)
  );

  // ----- GPR -----
  logic [XLEN-1:0] gpr_rdata1, gpr_rdata2;
  logic [4:0]  gpr_rd;
  logic [XLEN-1:0] gpr_wdata;
  logic        gpr_we;

  gpr_file gpr_i (
    .clk    (clk),
    .rst_n  (rst_n),
    .rs1    (dec_rs1),
    .rdata1 (gpr_rdata1),
    .rs2    (dec_rs2),
    .rdata2 (gpr_rdata2),
    .rd     (gpr_rd),
    .wdata  (gpr_wdata),
    .we     (gpr_we)
  );

  // ----- Forwarding for D stage (to fill D->E) -----
  logic [XLEN-1:0] e_alu_result;
  logic [4:0]  e_rd;
  logic        e_wb_src_alu, e_wb_src_pc4, e_wb_src_load;
  logic        e_writes_rd;
  assign e_writes_rd = e_valid && (e_wb_src_alu | e_wb_src_pc4);

  // x0 always reads 0: do not forward from commit or E when consumer is x0.
  logic [XLEN-1:0] d_rdata1_fwd, d_rdata2_fwd;
  assign d_rdata1_fwd = (dec_rs1 == 5'b0) ? 64'b0 :
                        (gpr_we && gpr_rd == dec_rs1) ? gpr_wdata :
                        (e_writes_rd && e_rd == dec_rs1) ? e_alu_result : gpr_rdata1;
  assign d_rdata2_fwd = (dec_rs2 == 5'b0) ? 64'b0 :
                        (gpr_we && gpr_rd == dec_rs2) ? gpr_wdata :
                        (e_writes_rd && e_rd == dec_rs2) ? e_alu_result : gpr_rdata2;

  // ----- D->E pipeline reg -----
  logic [4:0]  e_rd_r, e_rs1_r, e_rs2_r;
  logic [INSTR_WIDTH-1:0] e_instr_r;
  logic [XLEN-1:0] e_rdata1, e_rdata2, e_imm_r;
  logic [ADDR_W-1:0] e_pc_r;
  logic [3:0]  e_alu_op_r;
  logic        e_is_branch_r, e_is_jal_r, e_is_jalr_r, e_is_load_r, e_is_store_r;
  logic [2:0]  e_branch_funct3_r, e_load_store_funct3_r;
  logic        e_wb_src_alu_r, e_wb_src_pc4_r, e_wb_src_load_r;
  logic        e_op_a_is_pc_r, e_op_a_is_zero_r, e_op_b_is_imm_r;
  logic        e_valid;

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      e_valid <= 1'b0;
    end else if (flush) begin
      e_valid <= 1'b0;
    end else if (!stall) begin
      e_rd_r    <= dec_rd;
      e_instr_r <= d_instr;
      e_rs1_r   <= dec_rs1;
      e_rs2_r   <= dec_rs2;
      e_rdata1  <= d_rdata1_fwd;
      e_rdata2  <= d_rdata2_fwd;
      e_imm_r   <= dec_imm;
      e_pc_r    <= d_pc;
      e_alu_op_r <= dec_alu_op;
      e_is_branch_r <= dec_is_branch;
      e_branch_funct3_r <= dec_branch_funct3;
      e_is_jal_r  <= dec_is_jal;
      e_is_jalr_r <= dec_is_jalr;
      e_is_load_r <= dec_is_load;
      e_is_store_r <= dec_is_store;
      e_load_store_funct3_r <= dec_load_store_funct3;
      e_wb_src_alu_r <= dec_wb_src_alu;
      e_wb_src_pc4_r <= dec_wb_src_pc4;
      e_wb_src_load_r <= dec_wb_src_load;
      e_op_a_is_pc_r <= dec_op_a_is_pc;
      e_op_a_is_zero_r <= dec_op_a_is_zero;
      e_op_b_is_imm_r <= dec_op_b_is_imm;
      e_valid   <= d_valid;
    end
  end

  // ----- Forwarding for E stage (C result to E operands); x0 reads 0 -----
  logic [XLEN-1:0] e_op_a, e_op_b;
  logic [XLEN-1:0] e_rs1_val, e_rs2_val;
  assign e_rs1_val = (e_rs1_r == 5'b0) ? 64'b0 : (gpr_we && gpr_rd == e_rs1_r) ? gpr_wdata : e_rdata1;
  assign e_rs2_val = (e_rs2_r == 5'b0) ? 64'b0 : (gpr_we && gpr_rd == e_rs2_r) ? gpr_wdata : e_rdata2;
  assign e_op_a = e_op_a_is_zero_r ? 64'b0 : e_rs1_val;
  assign e_op_b = e_op_b_is_imm_r ? e_imm_r : e_rs2_val;

  // ----- EXECUTE -----
  logic [ADDR_W-1:0] e_branch_target;
  logic        e_branch_taken;
  logic [2:0]  e_store_size_r;
  logic [ADDR_W-1:0] ldst_addr;
  logic [2:0]  c_load_store_funct3;
  logic [XLEN-1:0] c_load_data_wb;

  execute #(.ADDR_W(ADDR_W)) execute_i (
    .clk               (clk),
    .rst_n              (rst_n),
    .rd                 (e_rd_r),
    .rs1                (e_rs1_r),
    .rs2                (e_rs2_r),
    .rdata1             (e_rdata1),
    .rdata2             (e_rdata2),
    .imm                (e_imm_r),
    .pc                 (e_pc_r),
    .alu_op             (e_alu_op_r),
    .is_branch          (e_is_branch_r),
    .branch_funct3      (e_branch_funct3_r),
    .is_jal             (e_is_jal_r),
    .is_jalr            (e_is_jalr_r),
    .is_load            (e_is_load_r),
    .is_store           (e_is_store_r),
    .load_store_funct3  (e_load_store_funct3_r),
    .instr_valid        (e_valid),
    .wb_src_alu         (e_wb_src_alu_r),
    .wb_src_pc4         (e_wb_src_pc4_r),
    .wb_src_load        (e_wb_src_load_r),
    .op_a_is_pc         (e_op_a_is_pc_r),
    .op_b_is_imm        (e_op_b_is_imm_r),
    .op_a               (e_op_a),
    .op_b               (e_op_b),
    .alu_result         (e_alu_result),
    .branch_target      (e_branch_target),
    .branch_taken       (e_branch_taken),
    .ldst_addr          (ldst_addr),
    .store_data         (),
    .store_size         (e_store_size_r),
    .ldst_is_store      (),
    .result_rd          (e_rd),
    .result_wb_src_alu  (e_wb_src_alu),
    .result_wb_src_pc4  (e_wb_src_pc4),
    .result_wb_src_load (e_wb_src_load),
    .result_is_branch   (),
    .result_is_jal      (),
    .result_is_jalr     (),
    .dmem_req_valid     (dmem_req_valid),
    .dmem_req_addr      (dmem_req_addr),
    .dmem_req_wdata     (dmem_req_wdata),
    .dmem_req_wstrb     (dmem_req_wstrb),
    .dmem_req_is_store  (dmem_req_is_store),
    .dmem_req_ready     (dmem_req_ready),
    .dmem_rsp_valid     (dmem_rsp_valid),
    .dmem_rsp_rdata     (dmem_rsp_rdata),
    .dmem_rsp_ready     (dmem_rsp_ready)
  );

  // Stall pipeline until load/store completes (D-mem response accepted)
  wire dmem_rsp_accepted = dmem_rsp_valid && dmem_rsp_ready;
  assign stall = (dmem_req_valid && !dmem_req_ready) || (dmem_rsp_ready && !dmem_rsp_accepted);

  // ----- E->C pipeline reg -----
  logic [INSTR_WIDTH-1:0] c_instr;
  logic [XLEN-1:0] c_alu_result, c_load_data, c_rdata1, c_rdata2;
  logic [ADDR_W-1:0] c_pc_plus4, c_branch_target, c_load_addr;
  logic        c_branch_taken;
  logic [4:0]  c_rd, c_rs1, c_rs2;
  logic        c_wb_src_alu, c_wb_src_pc4, c_wb_src_load;
  logic        c_is_branch, c_is_jal, c_is_jalr, c_is_load;
  logic        c_valid;

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      c_valid <= 1'b0;
    end else if (flush) begin
      c_valid <= 1'b0;
    end else begin
      // Capture load data as soon as response handshakes, independent of stall
      if (dmem_rsp_accepted)
        c_load_data <= dmem_rsp_rdata;
      if (!stall) begin
        c_instr        <= e_instr_r;
        c_alu_result   <= e_alu_result;
        c_pc_plus4     <= e_pc_r + 64'd4;
        c_branch_target <= e_branch_target;
        c_branch_taken <= e_branch_taken;
        c_rd           <= e_rd;
        c_rs1          <= e_rs1_r;
        c_rs2          <= e_rs2_r;
        c_rdata1       <= e_rdata1;
        c_rdata2       <= e_rdata2;
        c_is_load      <= e_is_load_r;
        c_load_addr    <= ldst_addr;
        c_load_store_funct3 <= e_load_store_funct3_r;
        c_wb_src_alu   <= e_wb_src_alu;
        c_wb_src_pc4   <= e_wb_src_pc4;
        c_wb_src_load  <= e_wb_src_load;
        c_is_branch    <= e_is_branch_r;
        c_is_jal       <= e_is_jal_r;
        c_is_jalr      <= e_is_jalr_r;
        c_valid        <= e_valid;
      end
    end
  end

  // Load data extraction from 64-bit aligned D-mem response.
  always_comb begin
    logic [63:0] shifted;
    logic [7:0] b;
    logic [15:0] h;
    logic [31:0] w;
    shifted = c_load_data >> {c_load_addr[2:0], 3'b0};
    b = shifted[7:0];
    h = shifted[15:0];
    w = shifted[31:0];
    case (c_load_store_funct3)
      3'b000: c_load_data_wb = {{56{b[7]}}, b};   // LB
      3'b001: c_load_data_wb = {{48{h[15]}}, h};  // LH
      3'b010: c_load_data_wb = {{32{w[31]}}, w};  // LW
      3'b011: c_load_data_wb = shifted;           // LD
      3'b100: c_load_data_wb = {56'b0, b};        // LBU
      3'b101: c_load_data_wb = {48'b0, h};        // LHU
      3'b110: c_load_data_wb = {32'b0, w};        // LWU
      default: c_load_data_wb = shifted;
    endcase
  end

  // ----- COMMIT -----
  commit #(.ADDR_W(ADDR_W)) commit_i (
    .clk          (clk),
    .rst_n        (rst_n),
    .instr        (c_instr),
    .alu_result   (c_alu_result),
    .load_data    (c_load_data_wb),
    .pc_plus4     (c_pc_plus4),
    .branch_target(c_branch_target),
    .branch_taken (c_branch_taken),
    .rd           (c_rd),
    .rs1          (c_rs1),
    .rs1_val      (c_rdata1),
    .wb_src_alu   (c_wb_src_alu),
    .wb_src_pc4   (c_wb_src_pc4),
    .wb_src_load  (c_wb_src_load),
    .is_branch    (c_is_branch),
    .is_jal       (c_is_jal),
    .is_jalr      (c_is_jalr),
    .instr_valid  (c_valid),
    .gpr_rd       (gpr_rd),
    .gpr_wdata    (gpr_wdata),
    .gpr_we       (gpr_we),
    .next_pc      (next_pc),
    .flush        (flush)
  );

endmodule
