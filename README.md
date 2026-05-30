# 智果

智果是一个本地优先的 Agent 助手 Web 应用，当前底层通过本机命令行智能引擎执行对话和任务。

## Features

- Simple account registration and login
- One local folder per account under `~/Documents/userinfo/users/<username>`
- Consumer-style chat workspace with a session sidebar
- Paseo-inspired timeline cards for assistant output, tool calls, metadata, and errors
- Local agent engine bridge through streaming JSON output
- Session rename, archive, stop, mode, model, and per-user settings

## Run

```sh
node server.js
```

Open:

```text
http://localhost:3300
```

Public tunnel:

```text
Configure your own HTTPS tunnel/domain outside the repository.
```

Environment variables:

```sh
PORT=3300
HOST=0.0.0.0
CLAUDE_PATH=claude
ZHIGUO_USERINFO_DIR=~/Documents/userinfo
APP_DATA_DIR=~/Documents/userinfo/system
USER_WORKSPACES_DIR=~/Documents/userinfo/users
COOKIE_SECURE=1
```

`COOKIE_SECURE=1` should only be used when the app is served over HTTPS.

Build the Android wrapper with the deployment URL injected at build time:

```sh
ZHIGUO_APP_URL=https://your-domain.example scripts/build-android-apk.sh
```

## Local Agent Engine

The app calls the configured local engine in print mode with streaming JSON:

```sh
claude -p "prompt" --output-format stream-json --verbose --include-partial-messages
```

It also passes a stable `--session-id` for each web session, so the local engine can keep its own persisted conversation state.

If the app cannot find the engine, open Settings and set the full executable path, for example:

```text
/opt/homebrew/bin/claude
```

Useful permission modes:

- `plan`: read-only planning mode, safest default
- `default`: asks before tools
- `auto`: local engine auto mode
- `acceptEdits`: auto-accept edit-focused tools
- `bypassPermissions`: skips permission prompts

## Data

```text
~/Documents/userinfo/
  system/
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
