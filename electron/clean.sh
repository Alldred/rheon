#!/usr/bin/env bash
# Clean helper for the Rheon Electron app.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOVE_NODE_MODULES=0

if [[ "${1-}" == "--node-modules" || "${1-}" == "-n" ]]; then
  REMOVE_NODE_MODULES=1
fi

if [ -d "$SCRIPT_DIR/dist" ]; then
  rm -rf "$SCRIPT_DIR/dist"
  echo "Removed $SCRIPT_DIR/dist"
fi

if [ -f "$SCRIPT_DIR/source_root.txt" ]; then
  rm -f "$SCRIPT_DIR/source_root.txt"
  echo "Removed $SCRIPT_DIR/source_root.txt"
fi

if [ "$REMOVE_NODE_MODULES" -eq 1 ] && [ -d "$SCRIPT_DIR/node_modules" ]; then
  rm -rf "$SCRIPT_DIR/node_modules"
  echo "Removed $SCRIPT_DIR/node_modules"
fi
