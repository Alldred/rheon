<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

# rheon

Vibe-coded RISC-V core and cocotb testbench.

## Testbench

The testbench lives in `tb/` (Forastero + dict memory, I/D drivers, pipeline monitor, Lome scoreboard). Test cases are in `testcases/`. See **tb/README.md** for layout and data flow.

**Run simulation** (requires cocotb deps: `uv sync`):

```bash
make
# Or: SIM=verilator make
```

**Load an ELF via command line:**

```bash
make run ELF=path/to/program.elf
# Or: TEST_ELF=path/to/program.elf make run
```

**Tibbar tests** (tibbar is a project dependency; RISC-V toolchain must be on PATH for building ELF from assembly). Commands use `--test` and `--seed`. If you use the project shell (`./bin/shell`), `bin/` is on PATH so you can run `rheon_gen`, `rheon_sim`, `rheon_run`, and `rheon_regr` directly:

1. **Generate a Tibbar test only** — produces `runs/<testname>_seed<N>_<timestamp>/` with `test.S`, `test.elf`, and `instructions_modelled.yaml`:
   ```bash
   ./bin/rheon_gen --test <testname> --seed <seed>   # e.g. ./bin/rheon_gen --test simple --seed 42
   ```

2. **Run simulation only** — run the testbench with an existing ELF (optional `--seed` for reproducibility, `--waves` for waveform dump):
   ```bash
   ./bin/rheon_sim --test <elf_path> [--seed <seed>] [--waves]  # e.g. ./bin/rheon_sim --test runs/simple_seed42_*/test.elf --seed 42 --waves
   ```

3. **Generate then run** — generate with Tibbar and run the testbench with the same seed (optional `--waves`):
   ```bash
   ./bin/rheon_run --test <testname> --seed <seed> [--waves]   # e.g. ./bin/rheon_run --test simple --seed 42 --waves
   ```

4. **Run regressions in parallel** — run many generated tests with live status (`PENDING`, `RUNNING`, `PASSED`, `FAILED`, elapsed timer):
   ```bash
   ./bin/rheon_regr --test simple,100 --seed 1
   ./bin/rheon_regr --file examples/regression.example.yaml
   ./bin/rheon_regr --resume latest
   ./bin/rheon_regr --test simple,200 --timeout-sec 120 --max-failures 10
   ./bin/rheon_regr --test simple,50 --fail-fast --report-json runs/regressions/report.json
   ```
   - Status refresh interval defaults to `2s`; override with `--update <seconds>`.
   - Parallel worker count defaults to CPU cores minus one; override with `--jobs <N>`.
   - `--resume` accepts either an explicit regression directory path or `latest`.
   - `runs/regressions/latest` is updated to the most recent regression output directory.
   - Optional stop controls: `--timeout-sec`, `--fail-fast`, and `--max-failures`.
   - Failed-job triage includes mismatch instruction context (`pc`, instruction word, disassembly, mismatched fields).
   - Optional JSON report output: `--report-json <path>`.
   - Each regression creates `runs/regressions/<timestamp>/` and each job writes logs to `<job_dir>/sim.log`.
   - Example YAML file: `examples/regression.example.yaml`.

**Legacy:** `./scripts/run_test.sh` (no args or `--seed N`) generates with default generator and runs; `./scripts/run_test.sh path/to/program.elf` runs with that ELF only.

Compatibility note: `./scripts/rheon_gen`, `./scripts/rheon_sim`, `./scripts/rheon_run`, and `./scripts/rheon_regr` remain as forwarding wrappers to the `bin/` commands.

If `uv lock` fails due to tibbar’s internal dependencies, install tibbar separately and set `TIBBAR_CMD=tibbar` when using the run script.

Without an ELF, the test runs with empty memory for a short time.
