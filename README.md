# 智果

智果是一个**本地优先的个人 Agent 助手 Web 应用**。它把本机已经安装并登录的 Claude Code 包装成一个可在浏览器、手机浏览器和 Android WebView 中使用的聊天工作台，同时保留本地账号、会话、设置和每个用户独立工作区。

简单说：智果不是云端 SaaS，也不是通用多 Agent 平台；它是一个面向个人和小团队自托管使用的本机 Claude Code 产品壳。

## 项目定位

智果解决的是这几个问题：

- 让本机 Claude Code 有一个更接近日常产品的 Web 聊天界面
- 将账号、会话、设置和用户工作区保存在本机目录中
- 把 Agent 的回复、思考、工具调用、错误和元信息整理成可读的时间线
- 允许通过 HTTPS 穿透或反代在手机上访问同一台电脑上的本机助手
- 提供一个轻量 Android WebView 外壳，便于把公网地址打包进 APK

所有 Agent 执行仍发生在当前机器上。公网部署时只应暴露智果 Web 端口，不应暴露本机 Paseo daemon。

## 核心能力

- 本地账号注册和登录
- 每个账号一个独立工作区：`~/Documents/userinfo/users/<username>`
- 会话列表、搜索、重命名、归档、恢复和停止运行
- Claude Code 工作模式选择：`plan`、`default`、`auto`、`acceptEdits`、`bypassPermissions`
- 基于 Paseo timeline 的流式消息、工具调用、待办、错误和元信息展示
- 用户级设置：Claude 路径、默认模式、默认模型、系统补充提示等
- 内网穿透启动脚本和部署文档
- Android WebView 包装与 APK 构建脚本

## 架构

```text
浏览器 / 手机浏览器 / Android WebView
  -> 智果前端 public/
  -> Node.js server.js: REST + SSE + 账号/会话/设置
  -> server/paseo-bridge.mjs: Paseo WebSocket bridge
  -> 本机 Paseo daemon: 127.0.0.1:6767
  -> 本机 Claude Code
```

执行层使用 [Paseo](https://github.com/getpaseo/paseo) daemon，但当前配置只启用 Claude Code。Codex、Copilot、OpenCode、Pi、relay 和 voice 相关能力在 `config/paseo.config.json` 中默认关闭。

更详细的执行层说明见 [docs/paseo-refactor.md](docs/paseo-refactor.md)。

## 目录结构

```text
.
├── server.js                    # 智果主服务：HTTP、账号、会话、SSE、静态文件
├── server/
│   ├── paseo-runtime.mjs        # 启动和管理本机 Paseo daemon
│   ├── paseo-bridge.mjs         # 智果会话与 Paseo agent 的桥接
│   └── timeline-mapper.mjs      # Paseo timeline 到智果消息结构的映射
├── public/
│   ├── index.html
│   ├── app.js                   # 原生 JS 单页应用
│   ├── styles.css
│   └── assets/
├── android/                     # 轻量 Android WebView 外壳
├── scripts/
│   ├── start-tunnel.sh          # 本地服务 + 穿透启动脚本
│   └── build-android-apk.sh     # Android APK 构建脚本
├── config/paseo.config.json     # Paseo 默认配置模板
├── deploy/frpc.example.ini      # frp 客户端示例
└── docs/
```

## 快速开始

前置条件：

- Node.js 20 或更高版本
- 本机已安装并登录 Claude Code
- 首次运行前执行过 `npm install`

启动本地服务：

```sh
npm install
npm start
```

打开：

```text
http://localhost:3300
```

如果智果在设置页提示找不到 Claude Code，可以填写完整可执行文件路径，例如：

```text
/opt/homebrew/bin/claude
```

## 配置

推荐从示例文件开始：

```sh
cp .env.example .env
```

常用环境变量：

```sh
PORT=3300
HOST=0.0.0.0

ZHIGUO_USERINFO_DIR=~/Documents/userinfo
APP_DATA_DIR=~/Documents/userinfo/system
USER_WORKSPACES_DIR=~/Documents/userinfo/users

PASEO_HOME=~/Documents/userinfo/system/paseo
PASEO_LISTEN=127.0.0.1:6767

CLAUDE_PATH=claude

ZHIGUO_PUBLIC_URL=https://your-domain.example
COOKIE_SECURE=1
TUNNEL_MODE=none
```

`COOKIE_SECURE=1` 用于 HTTPS 公网访问。若 `ZHIGUO_PUBLIC_URL` 以 `https://` 开头，智果会自动启用 Secure Cookie。

## 数据存储

默认数据目录：

```text
~/Documents/userinfo/
  system/
    secret
    users.json
    paseo/
      config.json
  users/
    <username>/
      README.md
      settings.json
      sessions/
        <session-id>.json
```

这是应用层面的账号和目录隔离，不是操作系统级沙箱。Claude Code 和 Paseo 进程仍以当前 macOS 用户身份运行，拥有当前用户本身具备的文件权限。

## 公网访问

智果可以通过 Cloudflare Tunnel、frp、Nginx 或 Caddy 暴露 Web UI。公网部署时只需要暴露 `server.js` 的 Web 端口，默认是 `3300`。

不要把 `PASEO_LISTEN` 对应的 `127.0.0.1:6767` 暴露到公网。

启动辅助脚本：

```sh
npm run start:tunnel
```

完整说明见 [docs/deploy-tunnel.md](docs/deploy-tunnel.md)。

## Android

Android 部分是一个简单 WebView 壳。确定公网 HTTPS 地址后，可以把地址注入 APK：

```sh
ZHIGUO_APP_URL=https://your-domain.example/ scripts/build-android-apk.sh
```

本地模拟器访问开发机服务时通常可以使用：

```text
http://10.0.2.2:3300/
```

## 测试和验证

基础语法检查可以直接使用 Node：

```sh
node --check server.js
node --check public/app.js
node --check server/paseo-runtime.mjs
node --check server/paseo-bridge.mjs
node --check server/timeline-mapper.mjs
```

当前 `npm run test:experience` 被显式暂停，避免自动化体验测试反复调用真实 Claude Code。恢复完整 E2E 时，需要还原 `scripts/experience-e2e.js` 和 `package.json` 中的测试脚本。

## 许可提醒

智果依赖 `@getpaseo/server` 和 `@getpaseo/client`。Paseo 为 AGPL-3.0；如果对外分发修改后的组合产品，需要遵守相应许可义务。
