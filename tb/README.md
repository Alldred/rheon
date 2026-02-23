<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

# Testbench (cocotb + Forastero)

Cocotb testbench for **rheon_core**: shared Python memory, I/D memory drivers, pipeline commit monitor, and Lome-based scoreboard.

## Layout

| Path | Role |
|------|------|
| **testbench.py** | `Testbench` (Forastero `BaseBench`): wires memory, request monitors, memory callback, response drivers, pipeline monitor, scoreboard; `load_elf()`, `set_entry_point()`. |
| **io.py** | `rheon_io_style` (plain `bus_component` naming), `ImemIO` / `DmemIO` (Forastero `BaseIO`). |
| **memory.py** | `DictMemory` (byte-addressed dict), `load_elf()`; constants aligned with `rheon_pkg`. |
| **transactions.py** | `CommitTx`, `ImemRequest` / `DmemRequest` (with payload), shared `MemoryResponse` (aliased as `ImemResponse` / `DmemResponse`) as Forastero `BaseTransaction`. |
| **drivers.py** | `ImemResponseDriver` / `DmemResponseDriver` (Forastero `BaseDriver`): drive rsp_ready and rsp_data/rsp_rdata from response transactions only. |
| **monitors/** | `ImemRequestMonitor` / `DmemRequestMonitor`: capture req_* from bus, emit request transactions. Pipeline commit monitor: `RheonCoreIO`, builds `CommitTx` over stages. |
| **scoreboard.py** | `lome_push_reference`: on each monitor CAPTURE, runs Lome, builds expected `CommitTx`, pushes to Forastero scoreboard reference queue; scoreboard compares actual (monitor) vs expected (model). |

## Data flow

- **IO**: I-mem and D-mem use `ImemIO` / `DmemIO` with `rheon_io_style` (no `i_`/`o_` prefix; signals like `imem_req_valid`, `imem_rsp_ready`). Pipeline monitor uses `RheonCoreIO` for internal/hierarchical signals (e.g. `commit_i.instr_valid`).
- **Memory** is the single backing store (ELF-loaded). **Request monitors** (`ImemRequestMonitor`, `DmemRequestMonitor`) observe req_valid and capture request transactions (addr, store, wdata, wstrb). On CAPTURE, `_memory_response()` runs: it performs the memory access and enqueues shared `MemoryResponse` transactions to the **response drivers** (`ImemResponseDriver`, `DmemResponseDriver`), which drive rsp_ready and rsp_data/rsp_rdata only.
- **Pipeline monitor** observes internal hierarchy (`dut.commit_i.*`, `dut.e_pc_r`, `dut.dmem_req_*`), correlates store by PC, emits `CommitTx` on commit.
- **Scoreboard**: Monitor is attached to the Forastero scoreboard (channel `pipe_mon`). On each CAPTURE we push the expected `CommitTx` from Lome via `push_reference()`; the scoreboard compares actual (monitor) vs expected (model) and reports mismatches.

## Usage

Tests live under `tests/cocotb/` and import the testbench:

```python
from tb import Testbench

@Testbench.testcase()
async def test_elf_loaded(tb: Testbench):
    tb.load_elf("path/to.elf")
    await tb.reset()
    ...
```

Run with: `make` (or `MODULE=tests.cocotb.test_elf make`). Top-level is `rheon_core`; no wrapper.

**ELF from command line:** `make run ELF=path/to.elf`. **Scripts** (all use `--test` and `--seed`): `./scripts/rheon_gen` (generate only); `./scripts/rheon_sim` (run only, `--test` is elf path); `./scripts/rheon_run` (generate then run). Or `./scripts/run_test.sh` for legacy generate+run with default generator.
