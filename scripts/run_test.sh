#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Generate a test with tibbar (optional), then run the cocotb testbench with an ELF.
#
# Usage:
#   ./scripts/run_test.sh                    # create run dir (seed + timestamp), generate with tibbar, run testbench
#   ./scripts/run_test.sh --seed 42          # same, with fixed seed
#   ./scripts/run_test.sh /path/to/program.elf  # run testbench with this ELF only (no generation)
#
# Run directory (when generating): runs/seed<N>_<YYYYMMDD>_<HHMMSS>. All artifacts (test.S, test.elf, sim) live there.
# Tibbar is invoked via `uv run tibbar` (project dependency). If uv lock fails due to tibbar's deps, install tibbar
# separately and set TIBBAR_CMD=tibbar (or uv run python -m tibbar from a venv where tibbar is installed).

set -euo pipefail
RHEON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNS_BASE="${RHEON_ROOT}/runs"
TIBBAR_CMD="${TIBBAR_CMD:-uv run tibbar}"
TIBBAR_GENERATOR="${TIBBAR_GENERATOR:-simple}"

usage() {
  echo "Usage: $0 [--seed N]                    # generate test in runs/seed<N>_<timestamp>, then run testbench" >&2
  echo "       $0 /path/to/program.elf         # run testbench with this ELF only" >&2
  exit 1
}

# Parse optional --seed
SEED=""
if [[ "${1:-}" == "--seed" ]]; then
  [[ -n "${2:-}" ]] || usage
  SEED="$2"
  shift 2
fi

if [[ $# -eq 0 ]]; then
  # Generate then run: create run dir, run tibbar, asm2elf, then make run
  TS=$(date +%Y%m%d_%H%M%S)
  if [[ -n "$SEED" ]]; then
    RUN_DIR="${RUNS_BASE}/seed${SEED}_${TS}"
  else
    SEED=$((RANDOM % 100000))
    RUN_DIR="${RUNS_BASE}/seed${SEED}_${TS}"
  fi
  mkdir -p "$RUN_DIR"
  ASM="${RUN_DIR}/test.S"
  ELF="${RUN_DIR}/test.elf"

  echo "Run directory: $RUN_DIR"
  $TIBBAR_CMD --generator "$TIBBAR_GENERATOR" --output "$ASM" --seed "$SEED"
  "${RHEON_ROOT}/scripts/asm2elf.sh" "$ASM" --link -o "$ELF"
  echo "ELF: $ELF"
  cd "$RHEON_ROOT" && TEST_ELF="$ELF" make run
elif [[ $# -eq 1 && "$1" != --* ]]; then
  # Run with provided ELF
  ELF="$1"
  [[ -f "$ELF" ]] || { echo "ELF not found: $ELF" >&2; exit 1; }
  cd "$RHEON_ROOT" && TEST_ELF="$ELF" make run
else
  usage
fi
