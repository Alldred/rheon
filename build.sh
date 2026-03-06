#!/usr/bin/env bash
# Build helper for the local regression app.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$ROOT_DIR/.build/rheon_regr_app"

if [ "${1-}" = "--clean" ]; then
    echo "Cleaning $OUTPUT_DIR"
    rm -rf "$OUTPUT_DIR"
    shift
fi

if [ "${1-}" = "--help" ] || [ "${1-}" = "-h" ]; then
    echo "Usage: $0 [--clean]"
    exit 0
fi

if [ "$#" -ne 0 ]; then
    echo "Unknown argument(s): $*" >&2
    echo "Usage: $0 [--clean]" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Validating python entrypoints..."
uv run python -m compileall \
    "$ROOT_DIR/scripts/rheon_regr_app.py" \
    "$ROOT_DIR/bin/rheon_regr_app" \
    >/dev/null

echo "Copying launch artifacts..."
mkdir -p \
    "$OUTPUT_DIR/app_assets" \
    "$OUTPUT_DIR/bin" \
    "$OUTPUT_DIR/scripts"

cp -R \
    "$ROOT_DIR/scripts/rheon_regr_app.py" \
    "$OUTPUT_DIR/"
cp -R \
    "$ROOT_DIR/scripts/rheon_regr_app_assets" \
    "$OUTPUT_DIR/"
cp -R \
    "$ROOT_DIR/bin/rheon_regr_app" \
    "$OUTPUT_DIR/bin/"
cp -R \
    "$ROOT_DIR/scripts/rheon_regr_app" \
    "$OUTPUT_DIR/scripts/"

chmod +x "$OUTPUT_DIR/bin/rheon_regr_app" "$OUTPUT_DIR/scripts/rheon_regr_app"

echo "Build complete."
echo "Launch with: uv run python $ROOT_DIR/bin/rheon_regr_app --host 127.0.0.1 --port 8765"
echo "Or from build dir: uv run python $OUTPUT_DIR/rheon_regr_app.py --host 127.0.0.1 --port 8765"
