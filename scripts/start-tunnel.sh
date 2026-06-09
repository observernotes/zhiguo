#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

PORT="${PORT:-3300}"
HOST="${HOST:-0.0.0.0}"
TUNNEL_MODE="${TUNNEL_MODE:-cloudflared}"
FRPC_CONFIG="${FRPC_CONFIG:-$ROOT_DIR/deploy/frpc.ini}"
PID_FILE="$ROOT_DIR/.zhiguo-server.pid"
LOG_DIR="$ROOT_DIR/logs"
SERVER_LOG="$LOG_DIR/zhiguo-server.log"

mkdir -p "$LOG_DIR"

if [[ -z "${COOKIE_SECURE:-}" && "${ZHIGUO_PUBLIC_URL:-}" == https://* ]]; then
  export COOKIE_SECURE=1
fi

export HOST
export PORT
export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:6767}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

wait_for_server() {
  local i
  for i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    if curl -sf "http://127.0.0.1:${PORT}/api/me" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "智果服务在 60 秒内未就绪，请查看 $SERVER_LOG" >&2
  return 1
}

stop_existing() {
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE")"
    if kill -0 "$old_pid" >/dev/null 2>&1; then
      kill "$old_pid" >/dev/null 2>&1 || true
      wait "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  if command -v lsof >/dev/null 2>&1; then
    local port_pid
    port_pid="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
    if [[ -n "$port_pid" ]]; then
      echo "[tunnel] 释放占用 ${PORT} 的进程: $port_pid"
      kill "$port_pid" >/dev/null 2>&1 || true
      wait "$port_pid" 2>/dev/null || true
      sleep 1
    fi
  fi
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

stop_existing

echo "[tunnel] 启动智果 (HOST=$HOST PORT=$PORT, Paseo 仅本机 ${PASEO_LISTEN})"
node server.js >>"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

wait_for_server
echo "[tunnel] 智果已就绪: http://127.0.0.1:${PORT}"

case "$TUNNEL_MODE" in
  cloudflared|cloudflared-quick)
    require_cmd cloudflared
    echo "[tunnel] 使用 Cloudflare Quick Tunnel 暴露 http://127.0.0.1:${PORT}"
    echo "[tunnel] 启动后请把分配的 https://*.trycloudflare.com 写入 .env 的 ZHIGUO_PUBLIC_URL，并重启以启用 Secure Cookie"
    if cloudflared tunnel --url "http://127.0.0.1:${PORT}"; then
      exit 0
    fi
    echo "[tunnel] cloudflared 未能建立隧道，智果仍在本地运行: http://127.0.0.1:${PORT}" >&2
    echo "[tunnel] 可改用 TUNNEL_MODE=frpc 或 TUNNEL_MODE=none 自行反代" >&2
    wait "$SERVER_PID"
    ;;
  frpc)
    require_cmd frpc
    if [[ ! -f "$FRPC_CONFIG" ]]; then
      echo "未找到 $FRPC_CONFIG" >&2
      echo "请先复制 deploy/frpc.example.ini 为 deploy/frpc.ini 并填写 frps 信息" >&2
      exit 1
    fi
    if [[ -z "${ZHIGUO_PUBLIC_URL:-}" ]]; then
      echo "警告: 未设置 ZHIGUO_PUBLIC_URL，HTTPS Cookie 可能无法正常工作" >&2
    fi
    echo "[tunnel] 使用 frpc 配置文件: $FRPC_CONFIG"
    exec frpc -c "$FRPC_CONFIG"
    ;;
  none)
    if [[ -f "${HOME}/.cloudflared/config.yml" ]] && rg -q "127\\.0\\.0\\.1:${PORT}|localhost:${PORT}" "${HOME}/.cloudflared/config.yml" 2>/dev/null; then
      echo "[tunnel] 检测到 ~/.cloudflared/config.yml 已映射端口 ${PORT}，请确认 cloudflared LaunchAgent 在运行"
    fi
    echo "[tunnel] 未启动穿透客户端 (TUNNEL_MODE=none)"
    echo "[tunnel] 请自行将公网 HTTPS 反代到 http://127.0.0.1:${PORT}"
    if [[ -n "${ZHIGUO_PUBLIC_URL:-}" ]]; then
      echo "[tunnel] 期望公网地址: $ZHIGUO_PUBLIC_URL"
    fi
    wait "$SERVER_PID"
    ;;
  *)
    echo "未知 TUNNEL_MODE: $TUNNEL_MODE (可选: cloudflared | frpc | none)" >&2
    exit 1
    ;;
esac
