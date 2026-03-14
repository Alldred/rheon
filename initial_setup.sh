#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Bootstrap Rheon on a new machine.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_SYSTEM_DEPS=0
SKIP_ELECTRON=0
SKIP_TESTS=0

log() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*" >&2
}

usage() {
  cat <<'EOF'
Usage: ./initial_setup.sh [options]

Options:
  --skip-system-deps   Do not attempt Homebrew/apt installs
  --skip-electron      Do not run npm install for electron app
  --skip-tests         Do not run smoke tests and first simple run
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-system-deps)
      SKIP_SYSTEM_DEPS=1
      shift
      ;;
    --skip-electron)
      SKIP_ELECTRON=1
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

install_uv_if_missing() {
  if command -v uv >/dev/null 2>&1; then
    return
  fi
  log "uv not found; installing via official installer"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v uv >/dev/null 2>&1; then
    warn "uv still not found on PATH. Re-open shell and run again."
    exit 1
  fi
}

install_system_dependencies() {
  if [[ "$SKIP_SYSTEM_DEPS" -eq 1 ]]; then
    log "Skipping system dependency install (--skip-system-deps)"
    return
  fi

  case "$(uname -s)" in
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        warn "Homebrew not found. Install Homebrew first: https://brew.sh/"
        return
      fi
      log "Installing macOS dependencies with Homebrew"
      brew install uv node@20 verilator icarus-verilog surfer riscv-gnu-toolchain || {
        warn "One or more brew installs failed. Continue with manual setup as needed."
      }
      ;;
    Linux)
      if ! command -v apt-get >/dev/null 2>&1; then
        warn "apt-get not found. Install dependencies manually for your distro."
        return
      fi
      log "Installing Linux dependencies with apt-get (sudo required)"
      sudo apt-get update
      # gtkwave for waveforms; Surfer preferred (brew install surfer or install from source)
      sudo apt-get install -y \
        build-essential ca-certificates curl git make \
        nodejs npm \
        verilator gtkwave \
        gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf || {
        warn "One or more apt installs failed. Continue with manual setup as needed."
      }
      ;;
    *)
      warn "Unsupported OS for automatic system dependency install: $(uname -s)"
      ;;
  esac
}

run_smoke_tests() {
  if [[ "$SKIP_TESTS" -eq 1 ]]; then
    log "Skipping smoke tests (--skip-tests)"
    return
  fi

  log "Running CLI/regression smoke tests"
  uv run pytest \
    tests/test_rheon_scripts_cli.py \
    tests/test_rheon_regr_app.py \
    tests/test_rheon_regr_app_launcher.py \
    tests/test_rheon_regress.py -q

  log "Running first end-to-end test: simple"
  uv run bin/rheon_run --test simple --seed 1
}

main() {
  cd "$ROOT_DIR"

  install_system_dependencies
  install_uv_if_missing

  log "Installing Python dependencies"
  uv sync --extra dev --extra docs

  if [[ "$SKIP_ELECTRON" -eq 0 ]]; then
    log "Installing Electron dependencies"
    (cd electron && npm ci)
  else
    log "Skipping Electron dependency install (--skip-electron)"
  fi

  run_smoke_tests

  cat <<'EOF'

Setup complete.

Recommended next step:
  ./bin/shell --dev

Inside that shell you can run:
  rheon_run --test simple --seed 1
  cd electron && npm start
EOF
}

main "$@"
