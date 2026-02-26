// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// FETCH stage: 64-bit I-mem reads; buffer and extract 32-bit instructions at any 2-byte alignment.

import rheon_pkg::*;

module fetch #(
  parameter int ADDR_W = ADDR_WIDTH
) (
  input  logic        clk,
  input  logic        rst_n,
  // Boot address (sampled in reset; use 0 if not connected)
  input  logic [ADDR_W-1:0] start_pc,
  // From COMMIT
  input  logic [ADDR_W-1:0] next_pc,
  input  logic             flush,
  input  logic             stall,
  // To DECODE
  output logic [INSTR_WIDTH-1:0] instr,
  output logic [ADDR_W-1:0]      instr_pc,
  output logic                   valid,
  // I-memory: 64-bit (8-byte) reads; addr 8-byte aligned
  output logic                   imem_req_valid,
  output logic [ADDR_W-1:0]      imem_req_addr,
  input  logic                   imem_req_ready,
  input  logic                   imem_rsp_valid,
  input  logic [63:0]            imem_rsp_data,
  output logic                   imem_rsp_ready
);

  localparam int QWORD_BYTES = 8;
  localparam int INSTR_BYTES = INSTR_WIDTH / 8;

  logic [ADDR_W-1:0]     pc;           // next instruction PC to fetch for
  logic [ADDR_W-1:0]     base_addr;    // 8-byte aligned; q0 at base_addr, q1 at base_addr+8
  logic [63:0]           q0, q1;       // two 64-bit words for extraction (instr can span boundary)
  logic                  have_one;     // we have q0 (and base_addr)
  logic                  have_two;     // we have q0 and q1; can form any instr in [base_addr, base_addr+8)
  logic                  pending_req;
  logic [ADDR_W-1:0]     req_addr;

  function automatic logic [ADDR_W-1:0] qword_align(logic [ADDR_W-1:0] a);
    return {a[ADDR_W-1:3], 3'b0};
  endfunction

  // Byte offset of pc within first qword (0..7); 2-byte aligned so 0,2,4,6
  wire [2:0] offset_in_q0 = pc[2:0];
  // Extract 32-bit instruction at pc from (q0, q1). Little-endian: byte at addr is LSB of qword.
  // offset 0: instr = q0[31:0];  2: q0[47:16];  4: q0[63:32];  6: {q1[15:0], q0[63:48]}
  wire [INSTR_WIDTH-1:0] instr_at_0 = q0[31:0];
  wire [INSTR_WIDTH-1:0] instr_at_2 = q0[47:16];
  wire [INSTR_WIDTH-1:0] instr_at_4 = q0[63:32];
  wire [INSTR_WIDTH-1:0] instr_at_6 = {q1[15:0], q0[63:48]};

  wire need_qword = !have_two && !pending_req && !flush;
  assign imem_req_valid = need_qword;
  assign imem_req_addr  = have_one ? (base_addr + 64'(QWORD_BYTES)) : qword_align(pc);
  assign imem_rsp_ready = pending_req;

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      pc          <= start_pc;
      base_addr   <= '0;
      q0          <= '0;
      q1          <= '0;
      have_one    <= 1'b0;
      have_two    <= 1'b0;
      pending_req <= 1'b0;
      req_addr    <= '0;
    end else if (flush) begin
      pc          <= next_pc;
      have_one    <= 1'b0;
      have_two    <= 1'b0;
      pending_req <= 1'b0;
    end else begin
      if (imem_rsp_valid && imem_rsp_ready && pending_req) begin
        pending_req <= 1'b0;
        if (!have_one) begin
          q0        <= imem_rsp_data;
          base_addr <= req_addr;
          have_one  <= 1'b1;
        end else begin
          q1       <= imem_rsp_data;
          have_two <= 1'b1;
        end
      end else if (need_qword && imem_req_ready) begin
        pending_req <= 1'b1;
        req_addr    <= have_one ? (base_addr + 64'(QWORD_BYTES)) : qword_align(pc);
      end

      if (have_two && !stall) begin
        pc <= pc + 64'(INSTR_BYTES);
        if (pc + 64'(INSTR_BYTES) >= base_addr + 64'(QWORD_BYTES)) begin
          base_addr <= base_addr + 64'(QWORD_BYTES);
          q0        <= q1;
          have_two  <= 1'b0;
        end
      end
    end
  end

  assign instr   = (offset_in_q0 == 3'd0) ? instr_at_0 :
                   (offset_in_q0 == 3'd2) ? instr_at_2 :
                   (offset_in_q0 == 3'd4) ? instr_at_4 : instr_at_6;
  assign instr_pc = pc;
  assign valid    = have_two && !flush;

endmodule
