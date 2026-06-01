# 智果（豆包式体验 × Claude Code 底层）产品规划

> 目标：让**普通人**像用豆包一样聊天、提问、完成任务；**底层引擎仍是 Claude Code**（工具调用、读写文件、代码能力保留，但对用户不可见或极简呈现）。

## 一、产品定位

| 维度 | 豆包（参考） | 智果（本方案） |
|------|-------------|----------------|
| 用户 | 大众消费者 | 普通用户 / 小团队 |
| 界面 | 单聊天气泡、少设置 | 同：聊天为主，隐藏 IDE |
| 能力 | 通用对话 + 插件 | Claude Code Agent（更强，包装成「助手」） |
| 后端 | 字节模型 | **Claude Code CLI + SDK**（不变） |
| 部署 | 云端 SaaS | 自托管（现有 Cloudflare 隧道） |

**原则**：改「壳」不改「引擎」；用 `VITE_CONSUMER_MODE` 开关，便于与上游 CloudCLI 同步。

---

## 二、能力分层

### L0 — 必须有（Phase 1，已启动）

- [x] 消费模式开关 `VITE_CONSUMER_MODE=true`
- [x] 品牌：智果、中文默认、暖色主题
- [x] 仅保留「聊天」主 Tab（隐藏终端 / 文件 / Git / 任务 / 插件 Tab）
- [x] 锁定 Provider = Claude，默认模型 Sonnet
- [x] 隐藏权限模式、Thinking、Token、斜杠命令等开发者控件
- [x] 简化引导：跳过 Git 配置，仅确认 Claude 已登录
- [x] 设置仅保留：外观、通知

### L1 — 体验抛光（Phase 2）

- [ ] 登录/注册文案全面中文化、单栏居中布局（类豆包）
- [ ] 空状态：大标题 + 示例问题 chips（「帮我写邮件」「总结这篇文章」）
- [ ] 侧边栏：会话列表为主，弱化「项目/路径」概念
- [ ] 默认单一工作区（如 `~/Documents/智果工作区`），用户无感
- [ ] 工具执行结果折叠为「正在处理…」卡片，默认不展示原始 JSON
- [ ] 移动端：全屏聊天、底部输入框固定

### L2 — 普通人友好能力（Phase 3）

- [ ] **场景模板**：写作、翻译、学习、办公（System 提示词预设，仍走 Claude Code）
- [ ] **安全沙箱**：消费模式默认 `acceptEdits` 或受限工具集，禁止 `bypassPermissions`
- [ ] **用量提示**：简单条「今日还可对话 N 次」（本地计数或接 API 配额）
- [ ] **多用户**：账号体系保留，管理员可开邀请码
- [ ] 可选：接 `ANTHROPIC_BASE_URL` 统一网关与密钥

### L3 — 生态与运营（Phase 4）

- [ ] 自定义 Logo / 主题色（env 或管理后台）
- [ ] 快捷入口：语音输入、图片理解（Claude 已支持则直接开）
- [ ] 插件仅开放「内容类」插件，屏蔽 Terminal 类
- [ ] 监控与日志：会话审计（合规）

---

## 三、技术架构（不变部分）

```
浏览器 → CloudCLI Express (3300) → WebSocket → claude-sdk.js → Claude Code CLI
                                              ↘ ~/.claude 会话与配置
```

改造面**仅限** `src/` 前端 + `.env` 构建变量；服务端 Claude 链路不动。

---

## 四、关键环境变量

| 变量 | 说明 |
|------|------|
| `VITE_CONSUMER_MODE=true` | 启用消费模式 |
| `VITE_PRODUCT_NAME=智果` | 产品名 |
| `VITE_DEFAULT_LOCALE=zh-CN` | 默认语言 |
| `VITE_CONSUMER_CLAUDE_MODEL=sonnet` | 默认模型 |
| `SERVER_PORT=3300` | 与隧道一致 |

---

## 五、风险与约束

1. **商标**：界面学豆包体验，品牌用「智果」，不直接使用「豆包」商标。
2. **上游合并**：改动集中在 `product.ts` 与 `IS_CONSUMER_MODE` 分支，便于 `git pull` 后解决冲突。
3. **Claude 登录**：用户机器需已 `claude login`；引导页会检测并提示。
4. **工具风险**：Phase 2 需限制危险工具；当前 Phase 1 仍沿用 Claude Code 默认审批流。

---

## 六、验收标准（Phase 1）

- [ ] https://ai.aicreaverse.com 打开为「智果」中文界面
- [ ] 无终端/文件/Git Tab
- [ ] 新用户：注册 → 简短引导 → 直接聊天
- [ ] 发送消息后 Claude Code 正常流式回复
