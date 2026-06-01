# 智果 UI 设计稿（GPT 生图 + 实现对齐）

## 设计原则

- **像豆包，不是 Claude Code**：聊天优先、零工程术语、暖色治愈风
- **品牌角色**：智果 — 橙发小姑娘，友好、可靠、像日常聊天伙伴
- **色板**：背景 `#FFF7ED` / `#FFFBF5`，主色 `#FF6B35`，辅助 `#FFE8D6`

## 设计稿文件

| 稿 | 路径 | 用途 |
|---|---|---|
| 品牌规范 | `public/zhiguo-brand-reference.png` | 吉祥物、色板、App Icon 参考 |
| 登录注册 | `public/zhiguo-login-reference.png` | 登录/注册页布局与层级 |
| 聊天主界面 | `assets/zhiguo-mobile-chat-mockup.png`（Cursor 项目 assets） | 侧栏 + 对话 + 输入框 |
| 线上 SVG 吉祥物 | `public/zhiguo-mascot.svg` | 头像、空状态、Loading |

## 已实现对照

| 设计稿要素 | 代码位置 |
|---|---|
| 登录双 Tab + 大吉祥物 | `src/zhiguo/ZhiguoAuthPage.tsx` |
| 侧栏「新建对话」+ 会话列表 | `src/zhiguo/ZhiguoSidebar.tsx` |
| 主聊天区（无 Tab/终端/Git） | `src/zhiguo/ZhiguoChatPanel.tsx` |
| 助手气泡白卡片 + 智果头像 | `MessageComponent.tsx` + `IS_CONSUMER_MODE` |
| 用户气泡橙色渐变 | `MessageComponent.tsx` |
| 输入框「给智果发消息…」 | `ChatInterface.tsx` |
| 示例问题 chips | `ProviderSelectionEmptyState.tsx` |
| 思考中「智果正在思考…」 | `ChatComposer.tsx` |

## Android

- Capacitor 工程：`/Users/yuyan/Documents/code/cloudcli/android`
- 打包脚本：`/Users/yuyan/Documents/code/cloudcli-deploy/scripts/build-android-apk.sh`
- 需本机安装 **JDK 17+** 后执行脚本，产出 `cloudcli-deploy/releases/zhiguo-debug.apk`
- App 默认加载：`https://ai.aicreaverse.com`
