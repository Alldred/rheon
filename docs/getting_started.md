<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Getting Started (Full Walkthrough)

This guide assumes a completely new machine.

## 0) Clone Rheon

```bash
git clone git@github.com:Alldred/rheon.git
cd rheon
```

## 1) Run Automated Bootstrap (Recommended)

From the repo root:

```bash
./initial_setup.sh
```

This script attempts to:

- install core system dependencies (macOS via Homebrew, Ubuntu/Debian via apt),
- install Python dependencies with `uv`,
- install Electron dependencies with `npm`,
- run first smoke tests,
- run the first Tibbar-driven end-to-end test (`simple`).

After setup, the normal user flow is:
`./bin/shell --dev`, then `rheon_run --test simple --seed 1`.

If any package install step fails due to local permissions/network/policy, continue
with the manual steps below.

## 2) Manual Setup (If Needed)

### 2.1 Install system tools

Required:

- `git`
- `curl`
- `make`
- `python3` (3.13+ recommended)
- `uv`
- `node` + `npm`
- `verilator`
- RISC-V GCC toolchain (`riscv64-unknown-elf-gcc`)

Optional but useful:

- **Surfer** (waveform viewer)

### macOS (Homebrew)

```bash
brew install uv node@20 verilator icarus-verilog surfer riscv-gnu-toolchain
```

### Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential ca-certificates curl git make \
  nodejs npm \
  verilator gtkwave \
  gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf
```

(Surfer is preferred for waveforms; on Linux install via `brew install surfer` if you use Homebrew, or from [surfer-project](https://gitlab.com/surfer-project/surfer).)

Install `uv` if needed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 3) Enter the project shell

The project shell updates/installs dependencies and puts `bin/` commands on your
`PATH`, so you can run `rheon_run`, `rheon_gen`, etc. directly.

```bash
./bin/shell --dev
```

Once inside this shell, continue with the next steps.

## 4) First tests

Inside the Rheon shell:

Run Python CLI/regression tests first:

```bash
pytest \
  tests/test_rheon_scripts_cli.py \
  tests/test_rheon_regr_app.py \
  tests/test_rheon_regr_app_launcher.py \
  tests/test_rheon_regress.py -q
```

Run first Tibbar-based end-to-end test (`simple`):

```bash
rheon_run --test simple --seed 1
```

If you only want generation:

```bash
rheon_gen --test simple --seed 1
```

If you already have an ELF and only want simulation:

```bash
rheon_sim --test path/to/test.elf --seed 1
```

## 5) Build the Electron app

From the repo root (inside or outside the Rheon shell):

```bash
./bin/build_electron.sh
```

`build_electron.sh` handles `electron/` dependencies automatically.

On macOS this creates the app bundle at:
`build/rheon_regr_app/Rheon Regr.app`.

---

Prev: [Introduction](introduction.md)
Next: [Testing](testing.md)
