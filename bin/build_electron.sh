#!/usr/bin/env bash
# Build helper for the local Rheon Electron app.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_DIR="$ROOT_DIR/electron"
ELECTRON_DIST_DIR="$ELECTRON_DIR/dist"
OUTPUT_DIR="$ROOT_DIR/build/rheon_regr_app"
LEGACY_OUTPUT_DIR="$ROOT_DIR/.build/rheon_regr_app"
APP_BUNDLE=""
INSTALL_REQUESTED=0
INSTALL_DIR="/Applications"
SKIP_NPM_CI=0
CLEAN_REQUESTED=0

usage() {
  cat <<'USAGE'
Usage: build_electron.sh [options]

Options:
  --clean              remove previous build artifacts first
  --install [path]     copy the app bundle into the target directory (default: /Applications)
  --skip-npm-ci        skip automatic npm ci in electron/
  --help, -h           show this help

Examples:
  ./bin/build_electron.sh
  ./bin/build_electron.sh --clean
  ./bin/build_electron.sh --skip-npm-ci
  ./bin/build_electron.sh --install
  ./bin/build_electron.sh --install "/tmp/My Apps"
USAGE
}

while [[ $# -gt 0 ]]; do
  case "${1-}" in
    --clean)
      CLEAN_REQUESTED=1
      shift
      ;;
    --install)
      INSTALL_REQUESTED=1
      if [[ "${2-}" != "" && "${2-}" != --* ]]; then
        INSTALL_DIR="$2"
        shift 2
      else
        shift
      fi
      ;;
    --skip-npm-ci)
      SKIP_NPM_CI=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument(s): $*" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$CLEAN_REQUESTED" -eq 1 ]]; then
  echo "Cleaning build artifacts"
  rm -rf "$OUTPUT_DIR" "$LEGACY_OUTPUT_DIR" "$ELECTRON_DIST_DIR"
fi

ensure_electron_dependencies() {
  local lock_file="$ELECTRON_DIR/package-lock.json"
  local node_modules_dir="$ELECTRON_DIR/node_modules"
  local node_modules_lock="$node_modules_dir/.package-lock.json"

  if [[ "$SKIP_NPM_CI" -eq 1 ]]; then
    echo "Skipping npm ci in electron/ (--skip-npm-ci)"
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install Electron dependencies." >&2
    exit 1
  fi

  if [[ ! -f "$lock_file" ]]; then
    echo "Missing lock file: $lock_file" >&2
    exit 1
  fi

  if [[ ! -d "$node_modules_dir" || ! -f "$node_modules_lock" || "$lock_file" -nt "$node_modules_lock" ]]; then
    echo "Installing Electron dependencies (npm ci)..."
    (cd "$ELECTRON_DIR" && npm ci)
  else
    echo "Electron dependencies are up to date (npm ci not needed)."
  fi
}

build_mac_bundle() {
  printf '%s\n' "$ROOT_DIR" > "$ELECTRON_DIR/source_root.txt"
  echo "Building Electron macOS app..."
  (cd "$ELECTRON_DIR" && npm run build:mac)

  local found
  found="$(find "$ELECTRON_DIST_DIR" -maxdepth 5 -type d -name 'Rheon Regr.app' | head -n1)"
  if [[ -z "$found" || ! -d "$found" ]]; then
    echo "Electron build succeeded but no Rheon Regr.app was found under $ELECTRON_DIST_DIR" >&2
    exit 1
  fi

  mkdir -p "$OUTPUT_DIR"
  rm -rf "$OUTPUT_DIR/Rheon Regr.app"
  cp -R "$found" "$OUTPUT_DIR/"
  APP_BUNDLE="$OUTPUT_DIR/Rheon Regr.app"
}

ensure_electron_dependencies

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Building Electron UI assets (non-macOS host)..."
  (cd "$ELECTRON_DIR" && npm run ui:build)
  echo "Build complete. Launch with: (cd $ELECTRON_DIR && npm run dev)"
  exit 0
fi

build_mac_bundle

echo "Build complete."
echo "Electron app: $APP_BUNDLE"
echo "Open with: open '$APP_BUNDLE'"

if [[ "$INSTALL_REQUESTED" -eq 1 ]]; then
  if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
    echo "Build did not produce a mac app bundle." >&2
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
  APP_INSTALL_TARGET="$INSTALL_DIR/Rheon Regr.app"
  rm -rf "$APP_INSTALL_TARGET"
  cp -R "$APP_BUNDLE" "$INSTALL_DIR/"

  if command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$APP_INSTALL_TARGET" 2>/dev/null || true
    xattr -cr "$APP_INSTALL_TARGET" 2>/dev/null || true
  fi

  echo "Installed app: $APP_INSTALL_TARGET"
fi
