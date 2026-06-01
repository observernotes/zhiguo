# CloudCLI 本地部署

CloudCLI（Claude Code Web UI）源码部署，对接现有 Cloudflare 隧道 `ai.aicreaverse.com` → `127.0.0.1:3300`。

## 目录

| 路径 | 说明 |
|------|------|
| `/Users/yuyan/Documents/code/cloudcli` | 源码（`siteboon/claudecodeui`） |
| `/Users/yuyan/Documents/code/cloudcli-deploy/scripts/` | 启动/停止脚本 |
| `/Users/yuyan/Documents/code/cloudcli-deploy/logs/` | 运行日志 |
| `~/.cloudcli/auth.db` | 认证数据库（首次访问 UI 时注册） |

## 环境要求

- Node.js v22+（当前 v24）
- 已安装并登录 Claude Code CLI（`claude --version`）
- Cloudflare 隧道：`~/.cloudflared/config.yml`

## 常用命令

```bash
# 推荐：LaunchAgent 开机自启（已安装则 reload）
/Users/yuyan/Documents/code/cloudcli-deploy/scripts/install-launchagent.sh

# 手动启停（调试时用；Cursor 沙箱内 nohup 可能被回收）
/Users/yuyan/Documents/code/cloudcli-deploy/scripts/stop.sh
/Users/yuyan/Documents/code/cloudcli-deploy/scripts/start.sh

# 卸载 LaunchAgent
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.aicreaverse.cloudcli.plist

# 查看日志
tail -f /Users/yuyan/Documents/code/cloudcli-deploy/logs/cloudcli.launchd.out.log

# 更新源码
cd /Users/yuyan/Documents/code/cloudcli && git pull && npm install && npm run build
/Users/yuyan/Documents/code/cloudcli-deploy/scripts/stop.sh
/Users/yuyan/Documents/code/cloudcli-deploy/scripts/start.sh
```

## 访问

- 本地：http://127.0.0.1:3300
- 公网：https://ai.aicreaverse.com

首次打开需在 UI 中注册本地账号（数据在 `~/.cloudcli/auth.db`）。MCP、权限等与 `~/.claude` 同步。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SERVER_PORT` | 3300 | 服务端口（与 tunnel 一致） |
| `HOST` | 0.0.0.0 | 监听地址 |
| `NODE_ENV` | production | 生产模式（静态前端） |

可选：在 `/Users/yuyan/Documents/code/cloudcli/.env` 中追加配置（见官方文档）。
