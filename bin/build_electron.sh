#!/usr/bin/env bash
# Build helper for the local regression Electron app.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/build/rheon_regr_app"
LEGACY_OUTPUT_DIR="$ROOT_DIR/.build/rheon_regr_app"
APP_BUNDLE=""
INSTALL_REQUESTED=0
INSTALL_DIR="/Applications"
SKIP_NPM_CI=0

usage() {
    cat <<'EOF'
Usage: build_electron.sh [options]

Options:
  --clean              remove previous build artifacts
  --install [path]     copy the app bundle into the target directory (default: /Applications)
  --skip-npm-ci        skip automatic npm ci in electron/
  --help, -h           show this help

Examples:
  ./bin/build_electron.sh
  ./bin/build_electron.sh --clean
  ./bin/build_electron.sh --skip-npm-ci
  ./bin/build_electron.sh --install
  ./bin/build_electron.sh --install "/tmp/My Apps"
EOF
}

while [[ $# -gt 0 ]]; do
    case "${1-}" in
        --clean)
            echo "Cleaning $OUTPUT_DIR"
            rm -rf "$OUTPUT_DIR"
            rm -rf "$LEGACY_OUTPUT_DIR"
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
            echo
            usage >&2
            exit 1
            ;;
    esac
done

ensure_electron_dependencies() {
    local electron_dir="$ROOT_DIR/electron"
    local lock_file="$electron_dir/package-lock.json"
    local node_modules_dir="$electron_dir/node_modules"
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
        (cd "$electron_dir" && npm ci)
    else
        echo "Electron dependencies are up to date (npm ci not needed)."
    fi
}

ensure_electron_dependencies

mkdir -p "$OUTPUT_DIR"

echo "Validating python entrypoints..."
uv run python -m compileall \
    "$ROOT_DIR/scripts/rheon_regr_app.py" \
    "$ROOT_DIR/scripts/rheon_cli_common.py" \
    "$ROOT_DIR/bin/rheon_regr_app" \
    "$ROOT_DIR/scripts/rheon_regr_app_mac.sh" \
    >/dev/null

echo "Copying launch artifacts..."
mkdir -p \
    "$OUTPUT_DIR/app_assets" \
    "$OUTPUT_DIR/bin" \
    "$OUTPUT_DIR/scripts" \
    "$OUTPUT_DIR/tb" \
    "$OUTPUT_DIR/testcases" \
    "$OUTPUT_DIR/rheon_core" \
    "$OUTPUT_DIR/examples"

cp -R \
    "$ROOT_DIR/bin" \
    "$ROOT_DIR/scripts" \
    "$ROOT_DIR/tb" \
    "$ROOT_DIR/testcases" \
    "$ROOT_DIR/rheon_core" \
    "$ROOT_DIR/examples" \
    "$ROOT_DIR/Makefile" \
    "$ROOT_DIR/README.md" \
    "$ROOT_DIR/pyproject.toml" \
    "$ROOT_DIR/uv.lock" \
    "$OUTPUT_DIR/"

chmod +x \
    "$OUTPUT_DIR/bin/rheon_regr_app" \
    "$OUTPUT_DIR/scripts/rheon_regr_app" \
    "$OUTPUT_DIR/scripts/rheon_regr_app_mac.sh"

if [ "$(uname -s)" = "Darwin" ]; then
    APP_BUNDLE="$OUTPUT_DIR/Rheon Regr.app"
    APP_MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
    APP_RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
    APP_ICON_PATH="$APP_RESOURCES_DIR/RheonRegrApp.icns"
    APP_PORTABLE_ROOT="$APP_RESOURCES_DIR/rheon_regr_app"
    APP_SOURCE_ROOT_FILE="$APP_RESOURCES_DIR/source_root.txt"
    rm -rf "$APP_BUNDLE"
    mkdir -p "$APP_MACOS_DIR" "$APP_RESOURCES_DIR" "$APP_PORTABLE_ROOT"

    cp "$OUTPUT_DIR/scripts/rheon_regr_app_mac.sh" "$APP_RESOURCES_DIR/"
    chmod +x "$APP_RESOURCES_DIR/rheon_regr_app_mac.sh"
    printf '%s\n' "$ROOT_DIR" > "$APP_SOURCE_ROOT_FILE"

    cp -R \
        "$OUTPUT_DIR/bin" \
        "$OUTPUT_DIR/scripts" \
        "$OUTPUT_DIR/tb" \
        "$OUTPUT_DIR/testcases" \
        "$OUTPUT_DIR/rheon_core" \
        "$OUTPUT_DIR/examples" \
        "$OUTPUT_DIR/Makefile" \
        "$OUTPUT_DIR/README.md" \
        "$OUTPUT_DIR/pyproject.toml" \
        "$OUTPUT_DIR/uv.lock" \
        "$APP_PORTABLE_ROOT/"

    if [ -f "$ROOT_DIR/assets/rheon_regr_app.icns" ]; then
        cp "$ROOT_DIR/assets/rheon_regr_app.icns" "$APP_ICON_PATH"
    elif [ -f "$ROOT_DIR/assets/rheon_regr_app.png" ] && command -v sips >/dev/null 2>&1 && command -v tiff2icns >/dev/null 2>&1; then
        APP_ICON_TIFF="$OUTPUT_DIR/RheonRegrApp.tiff"
        rm -f "$APP_ICON_TIFF"
        sips -s format tiff "$ROOT_DIR/assets/rheon_regr_app.png" --out "$APP_ICON_TIFF" >/dev/null
        tiff2icns "$APP_ICON_TIFF" "$APP_ICON_PATH" >/dev/null
        rm -f "$APP_ICON_TIFF"
    elif [ -f "/System/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns" ]; then
        cp "/System/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns" "$APP_ICON_PATH"
    fi

    cat > "$APP_BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleGetInfoString</key>
    <string>Rheon Regression App — local browser-based regression runner</string>
    <key>CFBundleDisplayName</key>
    <string>Rheon Regression App</string>
    <key>CFBundleExecutable</key>
    <string>RheonRegrApp</string>
    <key>CFBundleIconFile</key>
    <string>RheonRegrApp</string>
    <key>CFBundleIdentifier</key>
    <string>com.rheon.regression.app</string>
    <key>CFBundleName</key>
    <string>RheonRegrApp</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright (c) 2026 Stuart Alldred. All rights reserved.</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>LSRequiresNativeExecution</key>
    <true/>
    <key>LSArchitecturePriority</key>
    <array>
      <string>arm64</string>
      <string>x86_64</string>
    </array>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
  </dict>
</plist>
EOF

    cat > "$APP_MACOS_DIR/RheonRegrApp" <<'EOF'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../Resources/rheon_regr_app_mac.sh" "$@"
EOF
    chmod +x "$APP_MACOS_DIR/RheonRegrApp"
fi

echo "Build complete."
echo "Launch with: uv run $ROOT_DIR/bin/rheon_regr_app --host 127.0.0.1 --port 8765"
echo "Or from build dir: uv run $OUTPUT_DIR/scripts/rheon_regr_app.py --host 127.0.0.1 --port 8765"
if [ "$(uname -s)" = "Darwin" ]; then
    echo "Mac app: open '$OUTPUT_DIR/Rheon Regr.app'"
    if [ "$INSTALL_REQUESTED" -eq 1 ]; then
        if [ -z "$APP_BUNDLE" ] || [ ! -d "$APP_BUNDLE" ]; then
            echo "Build did not produce a mac app bundle." >&2
            exit 1
        fi
        APP_INSTALL_DIR="$INSTALL_DIR"
        mkdir -p "$APP_INSTALL_DIR"
        APP_INSTALL_DIR="$(cd "$APP_INSTALL_DIR" && pwd)"
        APP_INSTALL_TARGET="$APP_INSTALL_DIR/Rheon Regr.app"
        rm -rf "$APP_INSTALL_TARGET"
        cp -R "$APP_BUNDLE" "$APP_INSTALL_DIR/"
        if command -v xattr >/dev/null 2>&1; then
            xattr -d com.apple.quarantine "$APP_INSTALL_TARGET" 2>/dev/null || true
            xattr -cr "$APP_INSTALL_TARGET" 2>/dev/null || true
        fi
        echo "Installed app: $APP_INSTALL_TARGET"
    fi
fi
