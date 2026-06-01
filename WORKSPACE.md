# 智果 · 单一工作区说明

本目录是 **智果** 项目的唯一代码根目录，在 Cursor 中直接打开此文件夹即可。

```
cloudcli/                    ← 工作区根目录（打开这个）
├── src/                     ← 前端（智果 UI）
├── server/                  ← 后端 API
├── android/                 ← Capacitor Android 工程
├── public/                  ← 静态资源（吉祥物等）
├── deploy/                  ← 部署、LaunchAgent、APK 输出
│   ├── scripts/
│   │   ├── start.sh         ← 启动服务
│   │   ├── stop.sh          ← 停止服务
│   │   ├── install-launchagent.sh
│   │   └── build-android-apk.sh
│   ├── releases/            ← 打包好的 APK
│   └── logs/                ← 运行日志
├── capacitor.config.ts
├── .env                       ← 本地环境变量（勿提交）
└── WORKSPACE.md               ← 本文件
```

## 常用命令

```bash
# 开发
npm run dev

# 构建并启动（生产）
npm run build
./deploy/scripts/start.sh

# 安装 macOS 开机自启
./deploy/scripts/install-launchagent.sh

# 打 Android APK
./deploy/scripts/build-android-apk.sh
```

## 线上地址

- Web / App 加载：`https://ai.aicreaverse.com`
- 本地服务：`http://127.0.0.1:3300`

## 用户数据目录

`/Users/yuyan/Documents/智果用户/`

---

原先独立的 `cloudcli-deploy/` 已合并到 `deploy/`，可删除旧目录。
