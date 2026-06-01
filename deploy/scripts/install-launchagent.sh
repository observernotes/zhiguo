#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/_paths.sh"
PLIST_DST="$HOME/Library/LaunchAgents/com.aicreaverse.cloudcli.plist"
UID_NUM="$(id -u)"

mkdir -p "$(dirname "$PLIST_DST")"
mkdir -p "$LOG_DIR"
cp "$PLIST_SRC" "$PLIST_DST"

launchctl bootout "gui/${UID_NUM}" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST_DST"
launchctl enable "gui/${UID_NUM}/com.aicreaverse.cloudcli" 2>/dev/null || true

echo "Installed LaunchAgent: $PLIST_DST"
echo "Logs: $LOG_DIR/cloudcli.launchd.{out,err}.log"
launchctl print "gui/${UID_NUM}/com.aicreaverse.cloudcli" | rg 'state =|program =' || true
