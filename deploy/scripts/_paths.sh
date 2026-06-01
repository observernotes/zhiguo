#!/usr/bin/env bash
# Shared paths: deploy/scripts/* → deploy/ → repo root (cloudcli/)
DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DEPLOY_ROOT/.." && pwd)"
LOG_DIR="${DEPLOY_ROOT}/logs"
RELEASE_DIR="${DEPLOY_ROOT}/releases"
PID_FILE="${DEPLOY_ROOT}/cloudcli.pid"
PLIST_SRC="${DEPLOY_ROOT}/com.aicreaverse.cloudcli.plist"
