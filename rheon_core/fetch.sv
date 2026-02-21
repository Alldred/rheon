// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// FETCH stage: line buffer, PC, flush on branch/jump. Ready/valid to I-memory.

import rheon_pkg::*;

module fetch #(
  parameter int ADDR_W = ADDR_WIDTH
) (
  input  logic        clk,
  input  logic        rst_n,
  // From COMMIT
  input  logic [ADDR_W-1:0] next_pc,
  input  logic             flush,
  input  logic             stall,
  // To DECODE
  output logic [INSTR_WIDTH-1:0] instr,
  output logic [ADDR_W-1:0]      instr_pc,
  output logic                   valid,
  // I-memory request
  output logic                   imem_req_valid,
  output logic [ADDR_W-1:0]      imem_req_addr,
  // I-memory response (line of FETCH_LINE_WORDS instructions)
  input  logic                   imem_rsp_ready,
  input  logic [INSTR_WIDTH*FETCH_LINE_WORDS-1:0] imem_rsp_data
);

  localparam int LINE_BYTES = FETCH_LINE_WORDS * (INSTR_WIDTH/8);
  localparam int LINE_ADDR_LSB = $clog2(LINE_BYTES);

  logic [ADDR_W-1:0]     pc;              // next instruction PC to fetch for
  logic [ADDR_W-1:0]     line_base_pc;     // base address of current buffer line
  logic [INSTR_WIDTH-1:0] buffer [FETCH_LINE_WORDS];
  logic [$clog2(FETCH_LINE_WORDS):0] count;  // 0..FETCH_LINE_WORDS valid in buffer
  logic [$clog2(FETCH_LINE_WORDS)-1:0] rd_ptr;
  logic                  pending_req;
  logic [ADDR_W-1:0]     req_addr;
  // Word offset within the line for the PC we requested (for non-line-aligned branch/jump targets)
  logic [$clog2(FETCH_LINE_WORDS)-1:0] req_start_ptr;

  // Line-aligned address
  function automatic logic [ADDR_W-1:0] line_align(logic [ADDR_W-1:0] a);
    return {a[ADDR_W-1:LINE_ADDR_LSB], {(LINE_ADDR_LSB){1'b0}}};
  endfunction

  // Word index within line: for 32-bit instructions, pc[LINE_ADDR_LSB-1:2]
  localparam int INSTR_BYTES = INSTR_WIDTH / 8;

  wire need_line = (count <= 1) && !pending_req && !flush;
  assign imem_req_valid = need_line;
  assign imem_req_addr  = line_align(pc);

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      pc             <= '0;
      line_base_pc   <= '0;
      count          <= '0;
      rd_ptr         <= '0;
      pending_req     <= 1'b0;
      req_addr       <= '0;
      req_start_ptr  <= '0;
    end else if (flush) begin
      pc             <= next_pc;
      count          <= '0;
      rd_ptr         <= '0;
      pending_req     <= 1'b0;
    end else begin
      if (imem_rsp_ready && pending_req) begin
        for (int i = 0; i < FETCH_LINE_WORDS; i++)
          buffer[i] <= imem_rsp_data[i*INSTR_WIDTH +: INSTR_WIDTH];
        line_base_pc <= req_addr;
        rd_ptr       <= req_start_ptr;
        count        <= FETCH_LINE_WORDS - req_start_ptr;
        pending_req  <= 1'b0;
      end else if (need_line) begin
        pending_req    <= 1'b1;
        req_addr       <= line_align(pc);
        req_start_ptr  <= pc[LINE_ADDR_LSB-1:2];
      end
      if (count > 0 && !stall) begin
        rd_ptr  <= rd_ptr + 1;
        count   <= count - 1;
        pc      <= line_base_pc + (rd_ptr + 1) * INSTR_BYTES;
      end
    end
  end

  assign instr    = buffer[rd_ptr];
  assign instr_pc = line_base_pc + rd_ptr * INSTR_BYTES;
  assign valid    = (count > 0) && !flush;

endmodule
