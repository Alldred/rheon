#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Launch the rheon regression app as a self-contained mac workflow:
# starts the web server if needed and opens the UI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="127.0.0.1"
PORT="8765"
ATTACH=""
SERVER_PID=""
SERVER_STARTED=0
STOP_ONLY=0
APP_LAUNCHED_FROM_BUNDLE=0
SOURCE_ROOT_FILE="$SCRIPT_DIR/../Resources/source_root.txt"

while [[ $# -gt 0 ]]; do
  case "${1-}" in
    --host)
      HOST="${2-}"
      shift 2
      ;;
    --port)
      PORT="${2-}"
      shift 2
      ;;
    --attach)
      ATTACH="${2-}"
      shift 2
      ;;
    --stop)
      STOP_ONLY=1
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--host 127.0.0.1] [--port 8765] [--attach /path/to/runs/regressions/...]"
      echo "       $0 --stop"
      exit 0
      ;;
    *)
      echo "Unknown argument: ${1-}" >&2
      exit 1
      ;;
  esac
done

if [ "${SCRIPT_DIR#*Contents/Resources}" != "$SCRIPT_DIR" ]; then
  APP_LAUNCHED_FROM_BUNDLE=1
fi

# GUI app launchers often have a reduced PATH. Keep common install locations.
PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export PATH

if [ "$APP_LAUNCHED_FROM_BUNDLE" -eq 1 ]; then
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "Warning: app launcher style detected on non-macOS host." >&2
  fi
fi

LOG_DIR="${HOME}/Library/Caches/RheonRegrApp"
if ! mkdir -p "$LOG_DIR" 2>/dev/null || ! touch "$LOG_DIR/.write_test" 2>/dev/null; then
  LOG_DIR="${TMPDIR:-/tmp}/RheonRegrApp"
  mkdir -p "$LOG_DIR"
fi
rm -f "$LOG_DIR/.write_test" 2>/dev/null || true
SERVER_LOG="${LOG_DIR}/rheon_regr_app.log"
SERVER_PID_FILE="${LOG_DIR}/rheon_regr_app.pid"

show_error_to_user() {
  local message="$1"

  echo "$message" >&2
  echo "See server log: $SERVER_LOG" >&2

  if [ "$APP_LAUNCHED_FROM_BUNDLE" -eq 1 ] && command -v osascript >/dev/null 2>&1; then
    osascript -e "display alert \"Rheon Regression App\" message \"${message//\"/\\\"}\" buttons {\"OK\"} default button \"OK\" as critical"
  fi
}

is_source_root() {
  local candidate="$1"
  [ -x "$candidate/bin/rheon_regr_app" ] &&
    [ -d "$candidate/scripts" ] &&
    [ -d "$candidate/tb" ] &&
    { [ -d "$candidate/.git" ] || [ -x "$candidate/.venv/bin/python" ]; }
}

is_bundle_root() {
  local candidate="$1"
  [ -x "$candidate/bin/rheon_regr_app" ] &&
    [ -d "$candidate/scripts" ] &&
    [ -d "$candidate/tb" ]
}

resolve_dir() {
  local candidate="$1"
  if [ -z "$candidate" ] || [ ! -d "$candidate" ]; then
    return 1
  fi
  (
    cd "$candidate"
    pwd
  )
}

PROJECT_ROOT=""
SOURCE_ROOT_HINT=""
BUNDLE_RUNTIME_DIR=""

if [ -f "$SOURCE_ROOT_FILE" ]; then
  IFS= read -r SOURCE_ROOT_HINT < "$SOURCE_ROOT_FILE" || true
  if [ -n "$SOURCE_ROOT_HINT" ]; then
    if resolved_source_root="$(resolve_dir "$SOURCE_ROOT_HINT")" && is_source_root "$resolved_source_root"; then
      PROJECT_ROOT="$resolved_source_root"
    else
      show_error_to_user "Source checkout not found: $SOURCE_ROOT_HINT. Rebuild the app from the current repo location."
      exit 1
    fi
  fi
fi

if [ -z "$PROJECT_ROOT" ]; then
  SEARCH_DIR="$SCRIPT_DIR"
  for _ in 0 1 2 3 4 5; do
    SEARCH_DIR="$(cd "$SEARCH_DIR/.." && pwd)"
    if is_source_root "$SEARCH_DIR"; then
      PROJECT_ROOT="$SEARCH_DIR"
      break
    fi
  done
fi

if [ -z "$PROJECT_ROOT" ] && [ -d "$SCRIPT_DIR/../Resources/rheon_regr_app" ]; then
  BUNDLE_RUNTIME_DIR="$(cd "$SCRIPT_DIR/../Resources/rheon_regr_app" && pwd)"
  if is_bundle_root "$BUNDLE_RUNTIME_DIR"; then
    PROJECT_ROOT="$BUNDLE_RUNTIME_DIR"
  fi
fi

if [ -z "$PROJECT_ROOT" ]; then
  show_error_to_user "Unable to locate the Rheon checkout for the regression app."
  exit 1
fi

stop_server() {
  if [ -f "$SERVER_PID_FILE" ]; then
    pid="$(cat "$SERVER_PID_FILE")"
    if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$SERVER_PID_FILE"
  fi
}

if [ "$STOP_ONLY" -eq 1 ]; then
  stop_server
  exit 0
fi

encode_path() {
  local value="$1"
  python3 - "$value" <<'PY'
import sys
from urllib.parse import quote

print(quote(sys.argv[1], safe=""))
PY
}

is_port_open() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

sock = socket.socket()
sock.settimeout(0.2)
try:
    sock.connect((host, port))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
}

open_url() {
  local host="$1"
  local port="$2"
  local attach_path="$3"
  local base_url="http://${host}:${port}"
  local open_target="$base_url"

  if [ -n "$attach_path" ]; then
    encoded="$(encode_path "$attach_path")"
    open_target="${base_url}/?attach=${encoded}"
  fi

  if command -v open >/dev/null 2>&1; then
    open "$open_target"
  else
    python3 - "$open_target" <<'PY'
import sys
import webbrowser
webbrowser.open(sys.argv[1])
PY
  fi
}

wait_for_server() {
  local host="$1"
  local port="$2"
  local attempts=80

  while [ "$attempts" -gt 0 ]; do
    if is_port_open "$host" "$port"; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 0.1
  done
  return 1
}

cleanup() {
  if [ "$SERVER_STARTED" -eq 1 ] && [ -n "$SERVER_PID" ]; then
    if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      kill "$SERVER_PID" >/dev/null 2>&1 || true
      wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    if [ -f "$SERVER_PID_FILE" ]; then
      rm -f "$SERVER_PID_FILE"
    fi
  fi
}

trap cleanup EXIT INT TERM HUP QUIT

arch_prefix() {
  if [ "$(uname -s)" = "Darwin" ] && command -v arch >/dev/null 2>&1; then
    if arch -arm64 /usr/bin/true >/dev/null 2>&1; then
      printf '%s\n' "arch -arm64"
      return 0
    fi
  fi
  printf '%s\n' ""
}

launch_server() {
  local project_root="$1"
  shift
  local args=("$@")
  local launch_prefix

  launch_prefix="$(arch_prefix)"
  : >"$SERVER_LOG"

  if [ -x "$project_root/.venv/bin/python" ]; then
    (
      cd "$project_root"
      export VIRTUAL_ENV="$project_root/.venv"
      export PATH="$project_root/.venv/bin:$PATH"
      if [ -n "$launch_prefix" ]; then
        $launch_prefix "$project_root/.venv/bin/python" "$project_root/bin/rheon_regr_app" "${args[@]}" \
          >>"$SERVER_LOG" 2>&1
      else
        "$project_root/.venv/bin/python" "$project_root/bin/rheon_regr_app" "${args[@]}" \
          >>"$SERVER_LOG" 2>&1
      fi
    ) &
  elif command -v uv >/dev/null 2>&1 && [ -f "$project_root/pyproject.toml" ]; then
    (
      cd "$project_root"
      if [ -n "$launch_prefix" ]; then
        $launch_prefix uv run bin/rheon_regr_app "${args[@]}" \
          >>"$SERVER_LOG" 2>&1
      else
        uv run bin/rheon_regr_app "${args[@]}" \
          >>"$SERVER_LOG" 2>&1
      fi
    ) &
  else
    (
      cd "$project_root"
      if [ -n "$launch_prefix" ]; then
        $launch_prefix "$project_root/bin/rheon_regr_app" "${args[@]}" \
          >>"$SERVER_LOG" 2>&1
      else
        "$project_root/bin/rheon_regr_app" "${args[@]}" \
          >>"$SERVER_LOG" 2>&1
      fi
    ) &
  fi

  SERVER_PID=$!
  echo "$SERVER_PID" >"$SERVER_PID_FILE"
  SERVER_STARTED=1
}

run_args=(--host "$HOST" --port "$PORT")
if [ -n "$ATTACH" ]; then
  run_args+=(--attach "$ATTACH")
fi

if ! is_port_open "$HOST" "$PORT"; then
  launch_server "$PROJECT_ROOT" "${run_args[@]}"

  if ! wait_for_server "$HOST" "$PORT"; then
    show_error_to_user "Timeout waiting for rheon_regr_app to start."
    exit 1
  fi
else
  if [ -f "$SERVER_PID_FILE" ]; then
    existing_pid="$(cat "$SERVER_PID_FILE" || true)"
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      SERVER_PID="$existing_pid"
    fi
  fi
fi

open_url "$HOST" "$PORT" "$ATTACH"

if [ -n "$SERVER_PID" ]; then
  if [ "$SERVER_STARTED" -eq 1 ]; then
    wait "$SERVER_PID"
  else
    while kill -0 "$SERVER_PID" >/dev/null 2>&1; do
      sleep 1
    done
  fi
elif [ "$APP_LAUNCHED_FROM_BUNDLE" -eq 1 ]; then
  # keep the bundle process alive when attaching to a pre-existing server
  # so the app icon stays active and can be quit cleanly.
  while true; do
    sleep 1
  done
fi
