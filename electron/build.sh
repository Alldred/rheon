#!/usr/bin/env bash
# Build helper for the Rheon Electron app.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT_FILE="$SCRIPT_DIR/source_root.txt"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the Electron app." >&2
  exit 1
fi

printf '%s\n' "$PROJECT_ROOT" > "$SOURCE_ROOT_FILE"

cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "Installing Electron dependencies..."
  npm install
fi

echo "Building Rheon Electron app..."
npm run build:mac

echo "Build complete. Check $SCRIPT_DIR/dist for the .app bundle."
