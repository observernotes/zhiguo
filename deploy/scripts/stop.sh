#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/_paths.sh"

stop_pid() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 2
    kill -9 "$pid" 2>/dev/null || true
    echo "Stopped PID $pid"
  fi
}

if [[ -f "$PID_FILE" ]]; then
  stop_pid "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
else
  echo "No PID file"
fi

for port in 3300 3001; do
  PIDS="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    echo "Freed port $port"
  fi
done
