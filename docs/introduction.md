<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Introduction

Rheon is an experimental project with three parts:

- `rheon_core/`: SystemVerilog RTL for the core.
- `tb/` + `testcases/`: cocotb/Forastero/Lome testbench.
- regression tooling: CLI + browser app + Electron app.

## Project Status

Be explicit: this is vibe-coded and currently "functional enough" for the original
goal, which was to test Tibbar-driven flows.

The core and RTL should be treated as experimental. It is not expected to be
portable or robust enough for arbitrary workloads without more engineering.

Use this project as:

- a test vehicle for generator/regression workflows,
- a sandbox for tooling experiments,
- a basis for iterative hardening.

---

Prev: [Getting Started](index.md)
Next: [Getting Started (Full Walkthrough)](getting_started.md)
