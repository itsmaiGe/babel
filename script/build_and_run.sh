#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-run}"
APP_NAME="Babel Manager"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if pgrep -x "$APP_NAME" >/dev/null; then
  /usr/bin/osascript -e 'tell application "Babel Manager" to quit'
  sleep 1
  if pgrep -x "$APP_NAME" >/dev/null; then
    echo "Manager is busy; wait for its operation to finish before rebuilding." >&2
    exit 1
  fi
fi
BABEL_NODE="${BABEL_NODE:-$(command -v node || true)}"
if [[ -z "$BABEL_NODE" ]]; then
  BABEL_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
"$BABEL_NODE" scripts/build.js
APP_BUNDLE="$ROOT_DIR/dist/$APP_NAME.app"
case "$MODE" in
  run) /usr/bin/open -n "$APP_BUNDLE" ;;
  --verify|verify)
    /usr/bin/open -n "$APP_BUNDLE"
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  --debug|debug) lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME" ;;
  --logs|logs|--telemetry|telemetry)
    /usr/bin/open -n "$APP_BUNDLE"
    /usr/bin/log stream --info --style compact --predicate 'process == "Babel Manager"'
    ;;
  *) echo "usage: $0 [run|--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;;
esac
