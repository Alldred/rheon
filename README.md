<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

# rheon

Vibe-coded RISC-V core and cocotb testbench.

## Testbench

The testbench lives in `tb/` (Forastero + dict memory, I/D drivers, pipeline monitor, Lome scoreboard). Test cases are in `tests/cocotb/`. See **tb/README.md** for layout and data flow.

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

**Tibbar tests** (tibbar is a project dependency; RISC-V toolchain must be on PATH for building ELF from assembly). All scripts use `--test` and `--seed`. If you use the project shell (`./bin/shell`), `scripts/` is on PATH so you can run `rheon_gen`, `rheon_sim`, `rheon_run` directly:

1. **Generate a Tibbar test only** — produces `runs/<testname>_seed<N>_<timestamp>/` with test.S and test.elf:
   ```bash
   ./scripts/rheon_gen --test <testname> --seed <seed>   # e.g. ./scripts/rheon_gen --test simple --seed 42
   ```

2. **Run simulation only** — run the testbench with an existing ELF (optional `--seed` for reproducibility):
   ```bash
   ./scripts/rheon_sim --test <elf_path> [--seed <seed>]  # e.g. ./scripts/rheon_sim --test runs/simple_seed42_*/test.elf --seed 42
   ```

3. **Generate then run** — generate with Tibbar and run the testbench with the same seed:
   ```bash
   ./scripts/rheon_run --test <testname> --seed <seed>   # e.g. ./scripts/rheon_run --test simple --seed 42
   ```

**Legacy:** `./scripts/run_test.sh` (no args or `--seed N`) generates with default generator and runs; `./scripts/run_test.sh path/to/program.elf` runs with that ELF only.

If `uv lock` fails due to tibbar’s internal dependencies, install tibbar separately and set `TIBBAR_CMD=tibbar` when using the run script.

Without an ELF, the test runs with empty memory for a short time.
