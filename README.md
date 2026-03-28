<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

# rheon

Vibe-coded RISC-V core and cocotb testbench.

## Documentation

Project docs live under [`docs/`](docs/index.md).

For a brand-new machine, start with:

1. [`docs/getting_started.md`](docs/getting_started.md)
2. [`initial_setup.sh`](initial_setup.sh)

Quick path after setup:

```bash
./bin/shell --dev
rheon_run --test simple --seed 1
```

## Testbench

The testbench lives in `tb/` (Forastero + dict memory, I/D drivers, pipeline monitor, Lome scoreboard). Test cases are in `testcases/`. See **tb/README.md** for layout and data flow.

**Run simulation** (requires cocotb deps: `uv sync`):

```bash
make
```

**Load an ELF via command line:**

```bash
make run ELF=path/to/program.elf
```

Without an ELF, the test runs with empty memory for a short time.

**Tibbar tests** (tibbar is a project dependency; RISC-V toolchain must be on PATH for building ELF from assembly). Commands use `--test` and `--seed`. From the project shell (`./bin/shell`), `bin/` is on PATH so you can run `rheon_gen`, `rheon_sim`, `rheon_run`, and `rheon_regr` directly:

1. **Generate a Tibbar test only** — produces `runs/<testname>_seed<N>_<timestamp>/` with `test.S`, `test.elf`, and `instructions_modelled.yaml`:
   ```bash
   rheon_gen --test <testname> --seed <seed>   # e.g. rheon_gen --test simple --seed 42
   ```

2. **Run simulation only** — run the testbench with an existing ELF (optional `--seed` for reproducibility, `--waves` for waveform dump, `--coverage` for Bucket archive export):
   ```bash
   rheon_sim --test <elf_path> [--seed <seed>] [--waves] [--coverage]  # e.g. rheon_sim --test runs/simple_seed42_*/test.elf --seed 42 --waves --coverage
   ```

3. **Generate then run** — generate with Tibbar and run the testbench with the same seed (optional `--waves`, `--coverage`):
   ```bash
   rheon_run --test <testname> --seed <seed> [--waves] [--coverage]   # e.g. rheon_run --test simple --seed 42 --waves --coverage
   ```

4. **Run regressions in parallel** — run many generated tests with live status (`PENDING`, `RUNNING`, `PASSED`, `FAILED`, elapsed timer):
   ```bash
   rheon_regr --test simple,100 --seed 1
   rheon_regr --file examples/regression.example.yaml
   rheon_regr --resume latest
   rheon_regr --test simple,200 --timeout-sec 120 --max-failures 10 --coverage
   rheon_regr --test simple,50 --fail-fast --report-json runs/regressions/report.json
   ```
   - Status refresh interval defaults to `2s`; override with `--update <seconds>`.
- Parallel worker count defaults to CPU cores minus one; override with `--jobs <N>`.
- `--resume` accepts either an explicit regression directory path or `latest`.
- `runs/regressions/latest` is updated to the most recent regression output directory.
- Optional stop controls: `--timeout-sec`, `--fail-fast`, and `--max-failures`.
- Failed-job triage includes mismatch instruction context (`pc`, instruction word, disassembly, mismatched fields).
- Optional JSON report output: `--report-json <path>`.
- `rheon_regr` prints an Electron open command for the finished regression output.
- Each regression creates `runs/regressions/<timestamp>/` and each job writes logs to `<job_dir>/sim.log`.
- Example YAML file: `examples/regression.example.yaml`.
- Deterministic mixed pass/fail preset for UI testing: `examples/regression.testing.yaml`.

### Electron App

Electron is optional for interactive regression control and live monitoring.
CLI status output from `rheon_regr` remains fully supported.

Build the app:

```bash
./bin/build_electron.sh
open build/rheon_regr_app/Rheon\ Regr.app
```

Install directly to Applications:

```bash
./bin/build_electron.sh --install
./bin/build_electron.sh --install /path/to/your/apps
```

Open a specific regression from Electron:

```bash
open build/rheon_regr_app/Rheon\ Regr.app --args --attach runs/regressions/20260306_120000
```
