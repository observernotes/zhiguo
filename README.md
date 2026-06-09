# 智果

智果是一个本地优先的 Agent 助手 Web 应用。执行层基于 [Paseo](https://github.com/getpaseo/paseo) daemon，**仅驱动本机 Claude Code**；账号、会话与 UI 仍保持智果品牌与体验。

## Features

- Simple account registration and login
- One local folder per account under `~/Documents/userinfo/users/<username>`
- Consumer-style chat workspace with a session sidebar
- Paseo timeline streaming for assistant output, tool calls, metadata, and errors
- Claude Code only (Codex / Copilot / OpenCode / Pi disabled in Paseo config)
- Session rename, archive, stop, mode, model, and per-user settings

## Run

本地开发：

```sh
npm start
```

Open:

```text
http://localhost:3300
```

内网穿透 / 公网 HTTPS 部署见 [docs/deploy-tunnel.md](docs/deploy-tunnel.md)。

```sh
cp .env.example .env
npm run start:tunnel
```

Environment variables:

```sh
PORT=3300
HOST=0.0.0.0
PASEO_HOME=~/Documents/userinfo/system/paseo
PASEO_LISTEN=127.0.0.1:6767
CLAUDE_PATH=claude
ZHIGUO_USERINFO_DIR=~/Documents/userinfo
APP_DATA_DIR=~/Documents/userinfo/system
USER_WORKSPACES_DIR=~/Documents/userinfo/users
ZHIGUO_PUBLIC_URL=https://your-domain.example
COOKIE_SECURE=1
TUNNEL_MODE=cloudflared
```

`COOKIE_SECURE=1` 用于 HTTPS 公网访问；若 `ZHIGUO_PUBLIC_URL` 以 `https://` 开头会自动启用。

Build the Android wrapper with the deployment URL injected at build time:

```sh
ZHIGUO_APP_URL=https://your-domain.example scripts/build-android-apk.sh
```

## Local Agent Engine

智果通过内嵌 Paseo daemon 启动 Claude Code agent。每个智果会话映射为一个 Paseo agent（`paseoAgentId`），多轮对话通过 Paseo WebSocket API 发送消息。

If the app cannot find Claude Code, open Settings and set the full executable path, for example:

```text
/opt/homebrew/bin/claude
```

Useful permission modes:

- `plan`: read-only planning mode, safest default
- `default`: asks before tools
- `auto`: local engine auto mode
- `acceptEdits`: auto-accept edit-focused tools
- `bypassPermissions`: skips permission prompts

See `docs/paseo-refactor.md` for architecture details.

## Data

```text
~/Documents/userinfo/
  system/
    paseo/
  secret
  users.json
  users/
    <username>/
      README.md
      settings.json
      sessions/
        <session-id>.json
```

This is an application-level separation, not an operating-system sandbox. All local engine processes still run as the current macOS user.
