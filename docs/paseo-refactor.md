# 智果 × Paseo 架构

智果的用户层（账号、会话、品牌 UI）保持不变，Agent 执行层已切换到 [Paseo](https://github.com/getpaseo/paseo) daemon，并且**仅启用 Claude Code** 作为 provider。

## 分层

```text
浏览器 / Android WebView
  └─ 智果前端 (public/)
       └─ REST + SSE (/api/*)
            └─ server.js（账号、会话、品牌网关）
                 └─ server/paseo-bridge.mjs
                      └─ @getpaseo/client → WebSocket
                           └─ @getpaseo/server daemon（本地 6767）
                                └─ Claude Code CLI / Agent SDK
```

## 数据目录

```text
~/Documents/userinfo/
  system/
    paseo/                 # Paseo daemon 状态与 config.json
  users/
    <username>/            # 每个账号的工作区与 sessions/
```

## 配置

- 模板：`config/paseo.config.json`
- 运行时：`$PASEO_HOME/config.json`（默认 `~/Documents/userinfo/system/paseo/config.json`）
- 已禁用：codex、copilot、opencode、pi、relay、voice

环境变量：

```sh
PASEO_HOME=~/Documents/userinfo/system/paseo
PASEO_LISTEN=127.0.0.1:6767
PORT=3300
```

## 开发

```sh
npm start
```

## 许可说明

Paseo 为 AGPL-3.0。智果通过 npm 依赖 `@getpaseo/server` 与 `@getpaseo/client` 与其集成；若对外分发修改后的组合产品，需遵守 AGPL 义务。
