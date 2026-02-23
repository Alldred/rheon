#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Assemble (and optionally link) RISC-V assembly to ELF for simulation.
# Usage: asm2elf.sh <input.S> [--link] -o <output.elf>
# Requires: RISCV_PREFIX (default riscv64-unknown-elf-) and linker script (default scripts/riscv_bare.ld).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RHEON_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RISCV_PREFIX="${RISCV_PREFIX:-riscv64-unknown-elf-}"
LD_SCRIPT="${RISCV_LD_SCRIPT:-$SCRIPT_DIR/riscv_bare.ld}"

LINK=false
INPUT=""
OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --link) LINK=true; shift ;;
    -o)     OUTPUT="$2"; shift 2 ;;
    *)      INPUT="$1"; shift ;;
  esac
done

if [[ -z "$INPUT" || -z "$OUTPUT" ]]; then
  echo "Usage: $0 <input.S> [--link] -o <output.elf>" >&2
  exit 1
fi

CC="${RISCV_PREFIX}gcc"
AS="${RISCV_PREFIX}as"
OBJCOPY="${RISCV_PREFIX}objcopy"

if ! command -v "$CC" &>/dev/null; then
  echo "RISC-V toolchain not found (tried $CC). Set RISCV_PREFIX or install riscv-gnu-toolchain." >&2
  exit 1
fi

if [[ "$LINK" == true ]]; then
  "$CC" -x assembler-with-cpp -c "$INPUT" -o "${OUTPUT%.elf}.o"
  "$CC" -nostdlib -T "$LD_SCRIPT" "${OUTPUT%.elf}.o" -o "$OUTPUT"
  rm -f "${OUTPUT%.elf}.o"
else
  "$AS" "$INPUT" -o "$OUTPUT"
fi
