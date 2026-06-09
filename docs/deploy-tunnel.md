# 内网穿透部署

智果对外只需暴露 **Web 端口（默认 3300）**。Paseo daemon 监听 `127.0.0.1:6767`，仅本机 bridge 连接，**不要**把 6767 映射到公网。

## 架构

```text
手机 / 浏览器
  └─ HTTPS 公网域名（穿透或反代）
       └─ 127.0.0.1:3300  智果 server.js
            └─ 127.0.0.1:6767  Paseo daemon（本机）
                 └─ Claude Code
```

## 快速开始

```sh
cp .env.example .env
# 编辑 .env，至少设置 TUNNEL_MODE

npm run start:tunnel
```

## 方式零：Cloudflare 命名隧道（本机已有）

若 `~/.cloudflared/config.yml` 已把域名指到本机 3300（例如 `ai.aicreaverse.com`），且 `com.cloudflare.cloudflared` LaunchAgent 在跑：

```sh
# .env
TUNNEL_MODE=none
ZHIGUO_PUBLIC_URL=https://ai.aicreaverse.com
COOKIE_SECURE=1

npm start
# 或 npm run start:tunnel（同样只起智果，不重复起 cloudflared）
```

验证：

```sh
curl -s http://127.0.0.1:3300/api/health
curl -s https://ai.aicreaverse.com/api/health
```

## 方式一：Cloudflare Quick Tunnel（零配置试用）

`.env`：

```sh
TUNNEL_MODE=cloudflared
PORT=3300
```

需要本机已安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)。

```sh
npm run start:tunnel
```

终端会输出类似 `https://xxxx.trycloudflare.com` 的临时域名。将其写入 `.env`：

```sh
ZHIGUO_PUBLIC_URL=https://xxxx.trycloudflare.com
COOKIE_SECURE=1
```

重启服务后 Cookie 会带 `Secure`，登录态在 HTTPS 下才稳定。

## 方式二：frp（自有域名，推荐长期使用）

1. 在 VPS 上部署 [frps](https://github.com/fatedier/frp)
2. 复制并编辑客户端配置：

```sh
cp deploy/frpc.example.ini deploy/frpc.ini
```

`deploy/frpc.ini` 示例：

```ini
[common]
server_addr = your-frps.example.com
server_port = 7000

[zhiguo]
type = http
local_ip = 127.0.0.1
local_port = 3300
custom_domains = zhiguo.example.com
```

3. `.env`：

```sh
TUNNEL_MODE=frpc
FRPC_CONFIG=deploy/frpc.ini
ZHIGUO_PUBLIC_URL=https://zhiguo.example.com
COOKIE_SECURE=1
```

4. 启动：

```sh
npm run start:tunnel
```

## 方式三：已有 Nginx / Caddy 反代

只跑智果，穿透由你自己管理：

```sh
TUNNEL_MODE=none npm start
```

反代目标：`http://127.0.0.1:3300`

`.env` 设置公网 HTTPS 地址即可：

```sh
ZHIGUO_PUBLIC_URL=https://zhiguo.example.com
COOKIE_SECURE=1
```

## Android 壳

公网域名确定后打包 APK：

```sh
ZHIGUO_APP_URL=https://zhiguo.example.com/ scripts/build-android-apk.sh
```

## 健康检查

```sh
curl -s http://127.0.0.1:3300/api/health
```

## 常见问题

**登录后刷新掉线**  
公网是 HTTPS 但未设 `COOKIE_SECURE=1` 或未配置 `ZHIGUO_PUBLIC_URL`。HTTPS 域名应写入 `.env` 并重启。

**只想局域网访问**  
直接 `npm start`，无需穿透；Android 模拟器可用 `http://10.0.2.2:3300/`。

**Claude 在公网不可用**  
正常。Agent 跑在你本机，穿透只暴露 Web UI；本机需已安装并登录 Claude Code。
