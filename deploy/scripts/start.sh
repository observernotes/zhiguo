#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/_paths.sh"

LOG_FILE="${LOG_DIR}/cloudcli.out.log"

export SERVER_PORT="${SERVER_PORT:-3300}"
export PORT="${PORT:-$SERVER_PORT}"
export HOST="${HOST:-0.0.0.0}"
export NODE_ENV="${NODE_ENV:-production}"
export CLAUDE_CLI_PATH="${CLAUDE_CLI_PATH:-/Users/yuyan/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe}"
export PATH="/Users/yuyan/.local/share/fnm/node-versions/v24.16.0/installation/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"

mkdir -p "$LOG_DIR"
cd "$ROOT"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE")"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Already running (PID $OLD_PID), log: $LOG_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ ! -f "$ROOT/dist-server/server/index.js" ]]; then
  echo "Building CloudCLI..."
  npm run build >> "$LOG_FILE" 2>&1
fi

NODE_BIN="${NODE_BIN:-/Users/yuyan/.local/share/fnm/node-versions/v24.16.0/installation/bin/node}"

nohup "$NODE_BIN" dist-server/server/index.js >> "$LOG_FILE" 2>&1 &
NODE_PID=$!
echo "$NODE_PID" > "$PID_FILE"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${SERVER_PORT}/" >/dev/null 2>&1; then
    echo "Started CloudCLI PID ${NODE_PID} on http://127.0.0.1:${SERVER_PORT}"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "Process exited during startup. Check log: $LOG_FILE"
    tail -30 "$LOG_FILE" || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
done

echo "Timed out waiting for HTTP on port ${SERVER_PORT}. PID ${NODE_PID}, log: $LOG_FILE"
exit 1
