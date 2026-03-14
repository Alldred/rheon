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

2. **Run simulation only** — run the testbench with an existing ELF (optional `--seed` for reproducibility, `--waves` for waveform dump):
   ```bash
   rheon_sim --test <elf_path> [--seed <seed>] [--waves]  # e.g. rheon_sim --test runs/simple_seed42_*/test.elf --seed 42 --waves
   ```

3. **Generate then run** — generate with Tibbar and run the testbench with the same seed (optional `--waves`):
   ```bash
   rheon_run --test <testname> --seed <seed> [--waves]   # e.g. rheon_run --test simple --seed 42 --waves
   ```

4. **Run regressions in parallel** — run many generated tests with live status (`PENDING`, `RUNNING`, `PASSED`, `FAILED`, elapsed timer):
   ```bash
   rheon_regr --test simple,100 --seed 1
   rheon_regr --file examples/regression.example.yaml
   rheon_regr --resume latest
   rheon_regr --test simple,200 --timeout-sec 120 --max-failures 10
   rheon_regr --test simple,50 --fail-fast --report-json runs/regressions/report.json
   ```
   - Status refresh interval defaults to `2s`; override with `--update <seconds>`.
- Parallel worker count defaults to CPU cores minus one; override with `--jobs <N>`.
- `--resume` accepts either an explicit regression directory path or `latest`.
- `runs/regressions/latest` is updated to the most recent regression output directory.
- Optional stop controls: `--timeout-sec`, `--fail-fast`, and `--max-failures`.
- Failed-job triage includes mismatch instruction context (`pc`, instruction word, disassembly, mismatched fields).
- Optional JSON report output: `--report-json <path>`.
- Web app status link is always printed as a full clickable URL after a run.
- Optional custom URL: `--app-url <url>` or `RHEON_REGR_APP_URL` (defaults to `http://127.0.0.1:8765`).
- If the app is not already running, `rheon_regr` prints the command to start it for that run.
- Each regression creates `runs/regressions/<timestamp>/` and each job writes logs to `<job_dir>/sim.log`.
- Example YAML file: `examples/regression.example.yaml`.

### Browser Regression App

There is a lightweight browser app for interactive regression control and live job
monitoring with:

- test and job selection (`tests` plus count)
- seed and stage options
- controls for pause / resume / cancel
- adjustable parallelism during execution
- rerun failed jobs
- import and export in `rheon_regr` YAML format

Start the app:

```bash
rheon_regr_app --host 127.0.0.1 --port 8765
rheon_regr_app --attach runs/regressions/20260306_120000
```

Then open the URL printed by the app in your browser.

For fast UI iteration without rebuilding Electron each time, run the backend and
renderer dev server together:

```bash
rheon_regr_app --host 127.0.0.1 --port 8765
cd electron
npm run ui:dev
```

Then open `http://127.0.0.1:5173`. The Vite dev server proxies `/api/*` calls to
`http://127.0.0.1:8765` by default. You can override this with
`VITE_API_PROXY_TARGET`.

Build a standalone artifact bundle (for packaging or distribution):

```bash
./bin/build_electron.sh
./bin/build_electron.sh --clean  # wipe staged build artifacts first
```

### macOS One-Click App

`./bin/build_electron.sh` also creates a macOS app bundle at
`build/rheon_regr_app/Rheon Regr.app` (on Darwin systems):

```bash
open build/rheon_regr_app/Rheon\ Regr.app
```

The app starts the server automatically and opens the UI. You can also start with an
existing output directory:

```bash
rheon_regr_app_mac --attach runs/regressions/20260306_120000
```

The app exposes a simple shutdown path so quitting the app (or closing its process) also
stops the local server it started:

```bash
rheon_regr_app_mac --stop
```

To install, copy the built app into Applications:

```bash
cp -R build/rheon_regr_app/Rheon\ Regr.app /Applications/
```

Or use the build helper directly:

```bash
./bin/build_electron.sh --install
./bin/build_electron.sh --install /path/to/your/apps
```

The installed app is a launcher for the current Rheon checkout and its `.venv`, so build it after
running `uv sync`. If the repo moves, rebuild the app from the new checkout location. Provide your
logo at `assets/rheon_regr_app.icns` (preferred) or `assets/rheon_regr_app.png` before running
`./bin/build_electron.sh`.
