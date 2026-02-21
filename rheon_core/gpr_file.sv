// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Stuart Alldred.
// General-purpose register file: 32 x XLEN, x0 hardwired to zero.

import rheon_pkg::*;

module gpr_file (
  input  logic        clk,
  input  logic        rst_n,
  // Read port 1
  input  logic [4:0]  rs1,
  output logic [XLEN-1:0] rdata1,
  // Read port 2
  input  logic [4:0]  rs2,
  output logic [XLEN-1:0] rdata2,
  // Write port (from COMMIT)
  input  logic [4:0]  rd,
  input  logic [XLEN-1:0] wdata,
  input  logic        we
);

  logic [XLEN-1:0] regs [1:GPR_COUNT-1];  // x1..x31; x0 is always 0

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      for (int i = 1; i < GPR_COUNT; i++)
        regs[i] <= '0;
    end else if (we && rd != 5'b0)
      regs[rd] <= wdata;
  end

  assign rdata1 = (rs1 == 5'b0) ? '0 : regs[rs1];
  assign rdata2 = (rs2 == 5'b0) ? '0 : regs[rs2];

endmodule
