<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

# rheon_core

Minimal RV64I 4-stage RISC-V core (FETCH, DECODE, EXECUTE, COMMIT) in SystemVerilog.

## Layout

- **spec/rheon_pkg_spec.py** — Packtype spec (constants). Single source of truth for RTL and testbench.
- **rheon_pkg.sv** — Generated from spec (do not edit). Regenerate with `make pkg` from this directory (requires repo root and `uv`).
- **gpr_file.sv**, **alu.sv**, **fetch.sv**, **decode.sv**, **execute.sv**, **commit.sv** — Pipeline stages.
- **rheon_core.sv** — Top-level core with ready/valid I/D memory ports.

## Regenerating the package

From repo root:

```bash
uv run python -m packtype rheon_core/spec/rheon_pkg_spec.py code package sv rheon_core
```

Or from this directory:

```bash
make pkg
```

## Memory interfaces

- **I-memory**: request `valid` + `addr` (line-aligned); response `ready` + `data` (one line of `FETCH_LINE_WORDS` instructions).
- **D-memory**: request `valid`, `addr`, `wdata`, `wstrb`, `is_store`; response `ready` + `rdata` (loads). Pipeline stalls until the transaction completes.
