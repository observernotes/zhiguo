"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");

const ROOT_DIR = __dirname;
const USERINFO_ROOT =
  process.env.ZHIGUO_USERINFO_DIR ||
  process.env.APP_USERINFO_DIR ||
  path.join(os.homedir(), "Documents", "userinfo");
const DATA_DIR = process.env.APP_DATA_DIR || path.join(USERINFO_ROOT, "system");
const USERS_ROOT = process.env.USER_WORKSPACES_DIR || path.join(USERINFO_ROOT, "users");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3300);
const COOKIE_NAME = "ccb_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const MAX_BODY_BYTES = 1024 * 1024;
const POST_TOOL_IDLE_TIMEOUT_MS = Math.max(15000, Number(process.env.POST_TOOL_IDLE_TIMEOUT_MS || 45000) || 45000);
const PASEO_HOME = process.env.PASEO_HOME || path.join(DATA_DIR, "paseo");
const PASEO_LISTEN = process.env.PASEO_LISTEN || "127.0.0.1:6767";

const jobs = new Map();
const sseClients = new Map();
let paseoBridge = null;
let paseoRuntime = null;

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return crypto.randomUUID();
}

function safeUsername(username) {
  const value = String(username || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(value)) {
    return null;
  }
  return value;
}

function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

function userDir(username) {
  return path.join(USERS_ROOT, username);
}

function sessionsDir(username) {
  return path.join(userDir(username), "sessions");
}

function settingsPath(username) {
  return path.join(userDir(username), "settings.json");
}

function sessionPath(username, sessionId) {
  return path.join(sessionsDir(username), `${sessionId}.json`);
}

async function ensureBaseDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(USERS_ROOT, { recursive: true });
  await ensureSecret();
  if (!fs.existsSync(dataPath("users.json"))) {
    await writeJsonAtomic(dataPath("users.json"), { users: {} });
  }
}

async function ensureSecret() {
  const file = dataPath("secret");
  if (fs.existsSync(file)) return;
  const secret = crypto.randomBytes(48).toString("base64url");
  await fsp.writeFile(file, secret, { mode: 0o600 });
}

async function appSecret() {
  await ensureSecret();
  return (await fsp.readFile(dataPath("secret"), "utf8")).trim();
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

async function readUsers() {
  return readJson(dataPath("users.json"), { users: {} });
}

async function writeUsers(store) {
  await writeJsonAtomic(dataPath("users.json"), store);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const iterations = 210000;
  const hash = crypto
    .pbkdf2Sync(String(password), salt, iterations, 32, "sha256")
    .toString("base64url");
  return { salt, iterations, hash };
}

function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash || !record.iterations) return false;
  const candidate = crypto
    .pbkdf2Sync(String(password), record.salt, record.iterations, 32, "sha256")
    .toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.hash));
}

async function createAuthCookie(username) {
  const secret = await appSecret();
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function readAuthCookie(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const secret = await appSecret();
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || parsed.exp < Date.now()) return null;
  const username = safeUsername(parsed.u);
  if (!username) return null;
  const store = await readUsers();
  return store.users[username] ? username : null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const out = {};
  for (const chunk of header.split(";")) {
    const [rawKey, ...rawValue] = chunk.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rawValue.join("="));
  }
  return out;
}

function cookieSecureEnabled() {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  const publicUrl = String(process.env.ZHIGUO_PUBLIC_URL || "").trim();
  return publicUrl.startsWith("https://");
}

function setCookie(res, token) {
  const secure = cookieSecureEnabled() ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${
      SESSION_TTL_MS / 1000
    }${secure}`,
  );
}

function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

async function ensureUserFolders(username) {
  await fsp.mkdir(userDir(username), { recursive: true });
  await fsp.mkdir(sessionsDir(username), { recursive: true });
  const readme = path.join(userDir(username), "README.md");
  if (!fs.existsSync(readme)) {
    await fsp.writeFile(
      readme,
      `# ${username}\n\nThis folder is the local workspace for the ${username} account.\n智果 sessions launched from the web app use this directory as cwd.\n`,
    );
  }
}

async function readSettings(username) {
  const defaults = {
    claudePath: process.env.CLAUDE_PATH || "claude",
    defaultMode: "plan",
    defaultModel: "",
    maxTurns: "",
    appendSystemPrompt:
      "You are running inside Zhiguo, a local web product. Preserve user-provided filenames, paths, numbers, and quoted strings exactly when using file tools. After writing or editing files, verify the exact requested path and content, then keep users informed about code actions, files changed, and verification steps.",
  };
  const stored = await readJson(settingsPath(username), {});
  return { ...defaults, ...stored };
}

async function writeSettings(username, patch) {
  const current = await readSettings(username);
  const next = mergeSettingsPatch(current, patch);
  await writeJsonAtomic(settingsPath(username), next);
  return next;
}

function mergeSettingsPatch(current, patch = {}) {
  return {
    ...current,
    claudePath: cleanString(patch.claudePath, current.claudePath),
    defaultMode: cleanMode(patch.defaultMode, current.defaultMode),
    defaultModel: cleanString(patch.defaultModel, current.defaultModel || ""),
    maxTurns: cleanPositiveIntString(patch.maxTurns, current.maxTurns || ""),
    appendSystemPrompt: cleanString(patch.appendSystemPrompt, current.appendSystemPrompt || ""),
  };
}

function cleanString(value, fallback) {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function cleanPositiveIntString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (value === "") return "";
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 50 ? String(parsed) : "";
}

function cleanMode(value, fallback = "plan") {
  const allowed = new Set(["default", "auto", "acceptEdits", "plan", "bypassPermissions"]);
  return allowed.has(value) ? value : fallback;
}

async function listSessions(username, options = {}) {
  await ensureUserFolders(username);
  const dir = sessionsDir(username);
  const files = await fsp.readdir(dir).catch(() => []);
  const sessions = [];
  const archived = options.archived === true;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await readJson(path.join(dir, file), null).catch(() => null);
    const session = raw ? await recoverOrphanedSession(username, normalizeSession(raw, username)) : null;
    if (session && Boolean(session.archivedAt) === archived) sessions.push(projectSession(session));
  }
  sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return sessions;
}

async function readStoredSession(username, sessionId) {
  const session = await readJson(sessionPath(username, sessionId), null);
  if (!session) return null;
  return normalizeSession(session, username);
}

async function readSession(username, sessionId) {
  const session = await readStoredSession(username, sessionId);
  if (!session || session.archivedAt) return null;
  return session;
}

async function saveSession(username, session) {
  session.updatedAt = nowIso();
  await writeJsonAtomic(sessionPath(username, session.id), session);
  broadcast(username, session.id, "session", session);
}

async function recoverOrphanedSession(username, session) {
  if (!session || session.status !== "running" || hasLiveJob(username, session.id)) return session;
  const message = "本机助手连接已中断，请重新发送。";
  const completedAt = nowIso();
  const assistant = [...(session.messages || [])]
    .reverse()
    .find((item) => item.type === "assistant" && item.status === "streaming");
  if (assistant) {
    assistant.status = "error";
    assistant.completedAt = completedAt;
    if (!assistant.text) assistant.text = message;
  }
  for (const item of session.messages || []) {
    if (item.type === "tool" && item.status === "running") item.status = "error";
    if (item.type === "thinking" && item.status === "streaming") item.status = "done";
  }
  session.status = "error";
  session.lastError = message;
  await addMetaToSession(session, "本机引擎已恢复", "上次运行没有正常结束，已释放输入区。");
  await saveSession(username, session);
  return session;
}

function hasLiveJob(username, sessionId) {
  if (paseoBridge?.hasLiveJob?.(username, sessionId)) return true;
  const job = jobs.get(jobKey(username, sessionId));
  return Boolean(job && job.child && job.child.exitCode === null && !job.child.killed && !job.closed);
}

function normalizeSession(session, username) {
  return {
    id: session.id,
    title: session.title || "新对话",
    createdAt: session.createdAt || nowIso(),
    updatedAt: session.updatedAt || nowIso(),
    status: session.status || "idle",
    mode: cleanMode(session.mode, "plan"),
    model: session.model || "",
    claudeSessionId: session.claudeSessionId || session.id,
    claudeSessionStarted: Boolean(session.claudeSessionStarted || hasCompletedClaudeTurn(session)),
    paseoAgentId: session.paseoAgentId || null,
    cwd: session.cwd || userDir(username),
    messages: Array.isArray(session.messages) ? session.messages : [],
    usage: session.usage || null,
    lastError: session.lastError || null,
    archivedAt: session.archivedAt || null,
  };
}

function projectSession(session) {
  const turnCount = sessionTurnCount(session);
  return {
    id: session.id,
    title: session.title || "新对话",
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    status: session.status || "idle",
    mode: session.mode || "plan",
    model: session.model || "",
    archivedAt: session.archivedAt || null,
    lastError: session.lastError || "",
    turnCount,
    preview: sessionPreview(session),
  };
}

function sessionPreview(session) {
  const messages = session.messages || [];
  const last = [...messages].reverse().find(isPreviewableItem);
  const preview = last ? summarizeTimelineItem(last) : "";
  if (shouldUseLatestUserPreview(preview)) return latestUserPreview(messages) || preview;
  return preview;
}

function sessionTurnCount(session) {
  return (session.messages || []).filter((item) => item?.type === "user").length;
}

function shouldUseLatestUserPreview(value = "") {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return true;
  return (
    text.length <= 8 ||
    /额度不足|未连接|没有找到本机助手|回复没有完成|这次回复没有完成|已停止生成|已取消本次请求|Localengine|APIError|InsufficientBalance/i.test(
      text,
    )
  );
}

function latestUserPreview(messages = []) {
  const latestUser = [...messages].reverse().find((item) => item?.type === "user" && item.text);
  return latestUser ? summarizeUserPrompt(latestUser.text) : "";
}

function summarizeUserPrompt(value = "") {
  const text = naturalSummary(value)
    .replace(/^第?[一二三四五六七八九十\d]+轮[：:]\s*/u, "")
    .replace(/^第?[一二三四五六七八九十\d]+问[：:]\s*/u, "")
    .replace(/^请(?:你)?/, "")
    .trim();
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function isPreviewableItem(item) {
  if (item?.type === "assistant" && item.status === "canceled") return false;
  return item && item.type !== "meta" && item.type !== "thinking";
}

function hasCompletedClaudeTurn(session) {
  return Array.isArray(session?.messages)
    ? session.messages.some(
        (item) =>
          item &&
          item.type === "assistant" &&
          (item.status === "done" || item.status === "error" || item.status === "canceled"),
      )
    : false;
}

function summarizeTimelineItem(item) {
  if (item.type === "user") return naturalSummary(item.text || "");
  if (item.type === "assistant") {
    return naturalSummary(item.status === "error" ? userFacingRuntimeMessage(item.text || "") : item.text || "");
  }
  if (item.type === "tool") {
    const text = item.summary || item.displayName || item.name || "完成了一项操作";
    return naturalSummary(text);
  }
  if (item.type === "todo") {
    const active = (item.items || []).find((entry) => !entry.completed);
    return active ? active.text : "任务已完成";
  }
  if (item.type === "error") return userFacingRuntimeMessage(item.message || "这次回复没有完成。");
  return item.label || item.type || "";
}

function naturalSummary(value) {
  const text = String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\/Users\/[^\s，。；、)）]+/g, "本机工作区")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function userFacingRuntimeMessage(value) {
  const message = String(value || "").trim();
  if (!message) return "这次回复没有完成，请稍后再试。";
  if (/exited with code 143|SIGTERM|SIGKILL|Stopped by user/i.test(message)) return "已取消本次请求";
  if (/API Error:\s*402|Insufficient Balance/i.test(message)) return "本机助手额度不足，请检查 Claude 账号额度后重试。";
  if (/executable was not found|ENOENT/i.test(message)) return "没有找到本机助手，请在设置里检查连接。";
  return message.length > 220 ? `${message.slice(0, 220)}...` : message;
}

async function createSession(username, input = {}) {
  await ensureUserFolders(username);
  const id = makeId();
  const settings = await readSettings(username);
  const session = normalizeSession(
    {
      id,
      title: cleanString(input.title, "新对话") || "新对话",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "idle",
      mode: cleanMode(input.mode, settings.defaultMode),
      model: cleanString(input.model, settings.defaultModel),
      claudeSessionId: id,
      cwd: userDir(username),
      messages: [],
    },
    username,
  );
  await saveSession(username, session);
  return session;
}

function clientKey(username, sessionId) {
  return `${username}:${sessionId}`;
}

function broadcast(username, sessionId, event, payload) {
  const clients = sseClients.get(clientKey(username, sessionId));
  if (!clients) return;
  const text = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(text);
  }
}

function addSseClient(username, sessionId, res) {
  const key = clientKey(username, sessionId);
  let clients = sseClients.get(key);
  if (!clients) {
    clients = new Set();
    sseClients.set(key, clients);
  }
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(key);
  });
}

function jobKey(username, sessionId) {
  return `${username}:${sessionId}`;
}

async function runClaudeTurn(username, sessionId, input) {
  const key = jobKey(username, sessionId);
  if (jobs.has(key)) {
    const error = new Error("This session is already running.");
    error.status = 409;
    throw error;
  }

  let session = await readSession(username, sessionId);
  if (!session) {
    const error = new Error("Session not found.");
    error.status = 404;
    throw error;
  }
  session = await recoverOrphanedSession(username, session);

  const text = cleanString(input.text, "");
  if (!text) {
    const error = new Error("Message cannot be empty.");
    error.status = 400;
    throw error;
  }

  const settings = await readSettings(username);
  const mode = cleanMode(input.mode, session.mode || settings.defaultMode);
  const model = cleanString(input.model, session.model || settings.defaultModel);
  session.mode = mode;
  session.model = model;
  session.status = "running";
  session.lastError = null;

  const existingTurns = sessionTurnCount(session);
  if (session.title === "New chat" || session.title === "新对话") {
    session.title = titleFromText(text);
  } else if (shouldRefineAutoTitle(session.title, text, existingTurns)) {
    session.title = titleFromText(text);
  }

  const userMessage = {
    id: makeId(),
    type: "user",
    text,
    createdAt: nowIso(),
  };
  const assistantMessage = {
    id: makeId(),
    type: "assistant",
    text: "",
    status: "streaming",
    startedAt: userMessage.createdAt,
    createdAt: nowIso(),
  };
  const runMeta = {
    id: makeId(),
    type: "meta",
    label: "智果本机引擎已启动",
    detail: `paseo/claude mode=${mode}${model ? ` model=${model}` : ""}`,
    createdAt: nowIso(),
  };
  session.messages.push(userMessage, assistantMessage, runMeta);
  await saveSession(username, session);

  if (!paseoBridge) {
    const error = new Error("Paseo runtime is not ready.");
    error.status = 503;
    throw error;
  }

  await paseoBridge.runTurn({
    username,
    sessionId,
    session,
    assistantId: assistantMessage.id,
    text,
    mode,
    model,
    settings,
    persist: async (nextSession) => saveSession(username, nextSession),
  });

  return session;
}

async function guardPostToolIdle(job) {
  if (!job || job.closed || job.userStopped || job.postToolIdleTimeout) return;
  if (Date.now() - Number(job.lastOutputAt || 0) < POST_TOOL_IDLE_TIMEOUT_MS) return;
  const session = await readSession(job.username, job.sessionId).catch(() => null);
  if (!session || session.status !== "running") return;
  const latestUserIndex = findLastIndex(session.messages || [], (item) => item?.type === "user");
  const latestItems = latestUserIndex >= 0 ? session.messages.slice(latestUserIndex + 1) : session.messages || [];
  const assistant = session.messages.find((item) => item.id === job.assistantId);
  const completedTool = latestItems.some(
    (item) =>
      item?.type === "tool" &&
      (item.status === "done" || item.status === "completed" || item.status === "error" || item.status === "failed"),
  );
  const runningTool = latestItems.some((item) => item?.type === "tool" && (item.status === "running" || item.status === "streaming"));
  if (!assistant || assistant.status !== "streaming" || !completedTool || runningTool) return;
  job.postToolIdleTimeout = true;
  await appendMeta(job.username, job.sessionId, "工具结果已返回", "本机助手长时间没有继续输出，已自动结束本轮。");
  job.child.kill("SIGTERM");
  job.forceKillTimer = setTimeout(() => {
    if (!job.closed) job.child.kill("SIGKILL");
  }, 5000);
  job.forceKillTimer.unref?.();
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
}

function queueClaudeLine(job, line) {
  job.lineQueue = job.lineQueue
    .then(() => ingestClaudeLine(job.username, job.sessionId, job.assistantId, line))
    .catch((error) => appendMeta(job.username, job.sessionId, "本机引擎事件异常", error.message || String(error)));
}

async function settleJobLineQueue(job) {
  let timedOut = false;
  await Promise.race([
    job.lineQueue,
    new Promise((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, 5000).unref(),
    ),
  ]);
  if (timedOut) {
    await appendMeta(job.username, job.sessionId, "本机引擎事件异常", "输出解析超时，已释放输入区。");
  }
}

function buildClaudeArgs({ session, settings, text, mode, model, resumeClaudeSession }) {
  const args = [
    "-p",
    text,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    mode,
  ];
  if (resumeClaudeSession) {
    args.push("--resume", session.claudeSessionId);
  } else {
    args.push("--session-id", session.claudeSessionId || session.id);
  }
  const resolvedModel =
    model ||
    readClaudeHarnessEnv().ANTHROPIC_DEFAULT_SONNET_MODEL ||
    readClaudeHarnessEnv().ANTHROPIC_DEFAULT_OPUS_MODEL ||
    "";
  if (resolvedModel) args.push("--model", resolvedModel);
  if (settings.maxTurns) args.push("--max-turns", settings.maxTurns);
  if (settings.appendSystemPrompt) {
    args.push("--append-system-prompt", settings.appendSystemPrompt);
  }
  return args;
}

function titleFromText(text) {
  const compact = titleSeedFromText(text)
    .replace(/[。！？!?，,；;：:]+$/g, "")
    .trim();
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact || "新对话";
}

function titleSeedFromText(text) {
  const compact = String(text || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const namedTask = compact.match(/^([^：:]{2,18})[：:]\s*(.+)$/);
  if (namedTask?.[1] && startsWithTaskCue(namedTask[2])) {
    const label = namedTask[1].trim();
    const rest = namedTask[2].trim();
    if (!isLowSignalTitleLabel(label)) return label;
    return titleIntentFromText(rest) || titleToolIntentFromText(rest) || rest;
  }
  const toolIntent = titleToolIntentFromText(compact);
  if (toolIntent) return toolIntent;
  const intent = titleIntentFromText(compact);
  if (intent) return intent;
  return compact;
}

function titleToolIntentFromText(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/sleep\s+\d+/i.test(text)) return "运行计时任务";
  if (/请用\s*Bash/i.test(text) && /pwd|当前目录/.test(text)) return "查看当前目录";

  const writeFile = titleFileMatch(text, [
    /(?:Write\s*工具.*?创建文件|写入文件|创建文件)\s+([A-Za-z0-9._/-]+)/i,
  ]);
  if (writeFile) return `创建文件 ${shortTitleFile(writeFile)}`;

  const readFile = titleFileMatch(text, [
    /(?:Read\s*工具读取|读取文件|读取)\s+([A-Za-z0-9._/-]+)/i,
  ]);
  if (readFile) return `读取文件 ${shortTitleFile(readFile)}`;

  const editFile = titleFileMatch(text, [
    /(?:Edit\s*工具把|修改文件|把)\s+([A-Za-z0-9._/-]+)/i,
  ]);
  if (editFile) return `修改文件 ${shortTitleFile(editFile)}`;

  if (/请用\s*Bash|Bash\s*运行/i.test(text)) return "运行本机命令";
  if (/Markdown/i.test(text) && /回复|输出|代码块|列表|标题/.test(text)) return "生成 Markdown 内容";
  return "";
}

function titleFileMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const value = match?.[1]?.replace(/[。！？!?，,；;：:]+$/g, "").trim();
    if (value) return value;
  }
  return "";
}

function shortTitleFile(value = "") {
  const fileName = path.basename(String(value || "").trim());
  return fileName.length > 18 ? `${fileName.slice(0, 18)}...` : fileName;
}

function startsWithTaskCue(value = "") {
  return /^(请|只|帮|用|给|上一轮|不要|第一|第二|第三|第\d+)/.test(String(value).trim());
}

function isLowSignalTitleLabel(value = "") {
  return /^(第?[一二三四五六七八九十\d]+轮|第?[一二三四五六七八九十\d]+步|第?[一二三四五六七八九十\d]+问|第?[一二三四五六七八九十\d]+个问题)$/u.test(
    String(value).trim(),
  );
}

function titleIntentFromText(value = "") {
  const text = String(value || "").trim();
  if (/(上一轮|上轮|前面|刚才)/.test(text) && /(要求|回复|回答|记得|记住|哪|什么)/.test(text)) {
    return "上下文记忆测试";
  }
  const reply = text.match(/(?:请)?只?回复(?:[一二三四五六七八九十\d]+个字|两个字|一句话)?[：:]\s*([^，。；;,.!?！？\s]+)/u);
  if (reply?.[1]) {
    if (/两个字|[二2]个字/.test(text)) return "两字回复测试";
    if (/一句话/.test(text)) return "一句话回复测试";
    return "简短回复测试";
  }
  return "";
}

function shouldRefineAutoTitle(currentTitle = "", text = "", existingTurns = 0) {
  if (existingTurns < 1) return false;
  const title = String(currentTitle || "").trim();
  if (!/^(回复.+|简短回复测试|两字回复测试|一句话回复测试)$/u.test(title)) return false;
  return titleFromText(text) === "上下文记忆测试";
}

async function ingestClaudeLine(username, sessionId, assistantId, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    await appendMeta(username, sessionId, "本机引擎输出", line.slice(0, 2000));
    return;
  }

  const session = await readSession(username, sessionId);
  if (!session) return;
  if (session.status !== "running") return;
  if (event.session_id || event.sessionId) {
    session.claudeSessionId = event.session_id || event.sessionId;
  }

  const assistant = session.messages.find((item) => item.id === assistantId);
  if (assistant && event.type === "assistant") {
    const parts = extractContentParts(event.message || event);
    for (const part of parts) {
      if (part.kind === "text") {
        mergeAssistantText(assistant, part.text);
      } else if (part.kind === "tool") {
        upsertTool(session, part);
      } else if (part.kind === "thinking") {
        upsertThinking(session, assistantId, part.text);
      }
    }
  } else if (assistant && event.type === "stream_event") {
    applyStreamEvent(session, assistant, event.event || {});
  } else if (event.type === "user") {
    const parts = extractContentParts(event.message || event);
    for (const part of parts) {
      if (part.kind === "tool_result") {
        await completeTool(session, part);
      }
    }
  } else if (event.type === "system") {
    if (event.subtype === "init") {
      await addMetaToSession(session, "智果本机引擎已初始化", event.cwd || event.model || "");
    }
  } else if (event.type === "result") {
    if (event.session_id) session.claudeSessionId = event.session_id;
    session.claudeSessionStarted = true;
    session.usage = {
      ...(session.usage || {}),
      durationMs: event.duration_ms || event.durationMs || null,
      costUsd: event.total_cost_usd || event.totalCostUsd || null,
      turns: event.num_turns || event.numTurns || null,
      subtype: event.subtype || null,
    };
    if (assistant && !assistant.text && event.result) assistant.text = String(event.result);
  } else {
    const label = event.type ? `本机引擎 ${event.type}` : "本机引擎事件";
    await addMetaToSession(session, label, compactJson(event));
  }

  await saveSession(username, session);
}

function applyStreamEvent(session, assistant, streamEvent) {
  if (!streamEvent || typeof streamEvent !== "object") return;
  if (streamEvent.type === "message_start") {
    const message = streamEvent.message || {};
    if (message.model) assistant.model = String(message.model);
    if (message.usage) session.usage = normalizeUsage(message.usage, session.usage);
    return;
  }
  if (streamEvent.type === "content_block_start") {
    const block = streamEvent.content_block || {};
    if (block.type === "text" && block.text) mergeAssistantText(assistant, String(block.text));
    if (block.type === "tool_use") {
      upsertTool(session, {
        id: block.id || `block-${streamEvent.index ?? makeId()}`,
        name: block.name || "tool",
        input: block.input || null,
      });
    }
    return;
  }
  if (streamEvent.type === "content_block_delta") {
    const delta = streamEvent.delta || {};
    if (delta.type === "text_delta" && delta.text) {
      appendAssistantDelta(assistant, String(delta.text));
    }
    return;
  }
  if (streamEvent.type === "message_delta" && streamEvent.usage) {
    session.usage = normalizeUsage(streamEvent.usage, session.usage);
  }
}

function normalizeUsage(raw, previous = null) {
  if (!raw || typeof raw !== "object") return previous;
  const next = { ...(previous || {}) };
  const input = raw.input_tokens ?? raw.inputTokens;
  const cached = raw.cache_read_input_tokens ?? raw.cachedInputTokens;
  const output = raw.output_tokens ?? raw.outputTokens;
  if (Number.isFinite(input)) next.inputTokens = input;
  if (Number.isFinite(cached)) next.cachedInputTokens = cached;
  if (Number.isFinite(output)) next.outputTokens = output;
  if (raw.service_tier) next.serviceTier = raw.service_tier;
  return next;
}

function appendAssistantDelta(assistant, text) {
  if (!text) return;
  assistant.text = `${assistant.text || ""}${text}`;
}

function extractContentParts(message) {
  const content = Array.isArray(message.content)
    ? message.content
    : Array.isArray(message.message?.content)
      ? message.message.content
      : [];
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && item.text) {
      parts.push({ kind: "text", text: String(item.text) });
    } else if (item.type === "tool_use") {
      parts.push({
        kind: "tool",
        id: item.id || makeId(),
        name: item.name || "tool",
        input: item.input || null,
      });
    } else if (item.type === "tool_result") {
      parts.push({
        kind: "tool_result",
        id: item.tool_use_id || item.id || "",
        output: item.content || item.text || item,
        isError: Boolean(item.is_error),
      });
    }
  }
  if (typeof message.result === "string") {
    parts.push({ kind: "text", text: message.result });
  }
  return parts;
}

function mergeAssistantText(assistant, text) {
  if (!text) return;
  const current = assistant.text || "";
  if (!current) {
    assistant.text = text;
    return;
  }
  if (text.startsWith(current)) {
    assistant.text = text;
    return;
  }
  if (current.includes(text)) return;
  assistant.text = `${current}${current.endsWith("\n") ? "" : "\n"}${text}`;
}

function upsertThinking(session, parentId, text) {
  const id = `thinking-${parentId}`;
  let item = session.messages.find((entry) => entry.id === id);
  if (!item) {
    item = {
      id,
      type: "thinking",
      text: "",
      status: "streaming",
      createdAt: nowIso(),
    };
    session.messages.push(item);
  }
  mergeAssistantText(item, text);
}

function upsertTool(session, part) {
  const todoItems = extractTodoItems(part.input);
  if (todoItems) {
    upsertTodo(session, todoItems);
    return;
  }
  const detail = buildToolDetail(part.name, part.input, part.output);
  const display = buildToolDisplay(part.name, detail, part.input, "running");
  let item = session.messages.find((entry) => entry.type === "tool" && entry.toolUseId === part.id);
  if (!item) {
    const emptyAssistant = takeTrailingEmptyAssistant(session);
    item = {
      id: makeId(),
      type: "tool",
      toolUseId: part.id,
      name: part.name,
      displayName: display.displayName,
      summary: display.summary,
      input: part.input,
      output: null,
      detail,
      status: "running",
      createdAt: nowIso(),
    };
    session.messages.push(item);
    if (emptyAssistant) session.messages.push(emptyAssistant);
  } else {
    item.name = part.name || item.name;
    item.input = part.input || item.input;
    item.detail = buildToolDetail(item.name, item.input, item.output);
    if (item.status !== "done" && item.status !== "error") item.status = "running";
    const nextDisplay = buildToolDisplay(item.name, item.detail, item.input, item.status);
    item.displayName = nextDisplay.displayName;
    item.summary = nextDisplay.summary;
  }
}

function takeTrailingEmptyAssistant(session) {
  const index = session.messages.findIndex(
    (entry) => entry.type === "assistant" && entry.status === "streaming" && !entry.text,
  );
  if (index < 0) return null;
  const [assistant] = session.messages.splice(index, 1);
  return assistant || null;
}

async function completeTool(session, part) {
  const item = session.messages.find((entry) => entry.type === "tool" && entry.toolUseId === part.id);
  if (!item) {
    const detail = buildToolDetail("tool", null, part.output);
    const status = toolCompletionStatus("tool", detail, part);
    const display = buildToolDisplay("tool", detail, null, status);
    const nextItem = {
      id: makeId(),
      type: "tool",
      toolUseId: part.id,
      name: "tool",
      displayName: display.displayName,
      summary: display.summary,
      input: null,
      output: part.output,
      detail,
      status,
      createdAt: nowIso(),
      completedAt: nowIso(),
    };
    await applyToolVerification(session, nextItem);
    session.messages.push(nextItem);
    return;
  }
  item.output = part.output;
  item.detail = buildToolDetail(item.name, item.input, item.output);
  item.status = toolCompletionStatus(item.name, item.detail, part);
  await applyToolVerification(session, item);
  const display = buildToolDisplay(item.name, item.detail, item.input, item.status);
  item.displayName = display.displayName;
  item.summary = display.summary;
  item.completedAt = nowIso();
}

async function applyToolVerification(session, item) {
  const detail = item?.detail;
  if (!detail || !["write", "edit", "read"].includes(detail.type)) return;
  detail.verification = await verifyFileTool(session, detail);
  if (detail.verification.status !== "verified") {
    item.status = "error";
  }
}

async function verifyFileTool(session, detail) {
  const checkedAt = nowIso();
  const rawPath = String(detail.filePath || "").trim();
  if (!rawPath) {
    return {
      status: "missing-path",
      label: "未确认文件路径",
      checkedAt,
    };
  }

  const workspace = path.resolve(session.cwd || userDir(session.username || ""));
  const resolvedPath = path.resolve(workspace, rawPath);
  const expected = expectedFileBasenamesFromLatestUser(session);
  const basename = path.basename(resolvedPath);
  if (expected.length === 1 && basename !== expected[0]) {
    return {
      status: "path-mismatch",
      label: `目标文件偏离请求：应为 ${expected[0]}`,
      expectedBasename: expected[0],
      actualBasename: basename,
      checkedAt,
    };
  }
  if (!isPathInside(workspace, resolvedPath)) {
    return {
      status: "outside-workspace",
      label: "文件不在当前工作区",
      checkedAt,
    };
  }

  let content = "";
  try {
    content = await fsp.readFile(resolvedPath, "utf8");
  } catch (error) {
    return {
      status: "missing",
      label: "未在工作区找到这个文件",
      checkedAt,
    };
  }

  if (detail.type === "write") {
    const expectedContent = String(detail.content || "").trim();
    if (expectedContent && !content.includes(expectedContent)) {
      return {
        status: "content-mismatch",
        label: "文件内容未通过核验",
        checkedAt,
      };
    }
  }
  if (detail.type === "edit") {
    const nextText = String(detail.newString || "").trim();
    if (nextText && !content.includes(nextText)) {
      return {
        status: "content-mismatch",
        label: "修改内容未通过核验",
        checkedAt,
      };
    }
  }

  return {
    status: "verified",
    label: detail.type === "read" ? "已核验文件存在" : detail.type === "edit" ? "已核验修改结果" : "已核验写入结果",
    checkedAt,
  };
}

function expectedFileBasenamesFromLatestUser(session) {
  const user = [...(session.messages || [])].reverse().find((item) => item?.type === "user" && item.text);
  return extractMentionedFileBasenames(user?.text || "");
}

function extractMentionedFileBasenames(text) {
  const matches = new Set();
  const pattern =
    /(?<![\w.-])([A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:txt|md|markdown|json|ya?ml|js|jsx|ts|tsx|css|html|py|sh|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|sql|csv|log|env|toml|lock))(?![\w.-])/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    matches.add(path.basename(match[1]));
  }
  return [...matches];
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function upsertTodo(session, items) {
  const last = [...session.messages].reverse().find((entry) => entry.type === "todo");
  if (last) {
    last.items = items;
    last.updatedAt = nowIso();
    return;
  }
  session.messages.push({
    id: makeId(),
    type: "todo",
    items,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

function extractTodoItems(input) {
  if (!input || typeof input !== "object") return null;
  const raw = Array.isArray(input.todos) ? input.todos : Array.isArray(input.items) ? input.items : null;
  if (!raw) return null;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const text = item.content || item.text || item.task || "";
      if (!String(text).trim()) return null;
      const status = String(item.status || "").toLowerCase();
      return {
        text: String(text).trim(),
        completed: Boolean(item.completed) || status === "completed" || status === "done",
      };
    })
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function buildToolDisplay(name, detail, input, status = "") {
  const lower = String(name || "").toLowerCase();
  if (detail.type === "plan") {
    return { displayName: "准备计划", summary: detail.confirmation ? "等待确认后执行" : "执行前计划已生成" };
  }
  const completed = status === "done" || status === "completed";
  if (detail.type === "shell")
    return { displayName: shellToolTitle(detail.command || "", completed ? "done" : "running"), summary: shellToolSummary(detail.command || "") };
  if (detail.type === "read") return { displayName: completed ? "已读取文件" : "正在读取文件", summary: fileReadSummary(detail) };
  if (detail.type === "write") return { displayName: completed ? "已写入文件" : "正在写入文件", summary: fileChangeSummary(detail, "write") };
  if (detail.type === "edit") return { displayName: completed ? "已修改文件" : "正在修改文件", summary: fileChangeSummary(detail, "edit") };
  if (detail.type === "search") return { displayName: completed ? "已搜索内容" : "正在搜索内容", summary: detail.query };
  if (detail.type === "fetch") return { displayName: completed ? "已获取网页" : "正在获取网页", summary: detail.url };
  if (lower.includes("todo")) return { displayName: "任务清单", summary: "" };
  return { displayName: humanizeToolName(name || "Tool"), summary: summarizeUnknownToolInput(input) };
}

function shellToolTitle(command = "", status = "") {
  const normalized = normalizeCommand(command);
  const running = status === "running" || status === "streaming";
  const done = status === "done" || status === "completed";
  if (/^pwd\s*$/.test(normalized)) return running ? "正在查看工作区" : done ? "已查看工作区" : "查看工作区";
  if (/^(ls|find)\b/.test(normalized)) return running ? "正在查看文件列表" : done ? "已查看文件列表" : "查看文件列表";
  if (/^(rg|grep)\b/.test(normalized)) return running ? "正在搜索内容" : done ? "已搜索内容" : "搜索内容";
  if (/\bsleep\s+\d+/.test(normalized)) return running ? "长任务处理中" : done ? "长任务已完成" : "长任务处理";
  if (running) return "正在运行本机命令";
  if (done) return "已运行本机命令";
  return "运行本机命令";
}

function shellToolSummary(command = "") {
  const normalized = normalizeCommand(command);
  if (/^pwd\s*$/.test(normalized)) return "当前工作区";
  if (/^(ls|find)\b/.test(normalized)) return "查看文件和文件夹";
  if (/^(rg|grep)\b/.test(normalized)) return "搜索工作区内容";
  if (/\bsleep\s+\d+/.test(normalized)) return "后台长任务";
  return command;
}

function normalizeCommand(command = "") {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function fileChangeSummary(detail, type) {
  const file = shortenPath(detail.filePath || "");
  const change = fileChangeLabel(detail, type);
  const verification = detail.verification?.label || "";
  return [file, change, verification].filter(Boolean).join(" · ");
}

function fileReadSummary(detail) {
  const file = shortenPath(detail.filePath || "");
  const verification = detail.verification?.label || "";
  return [file, verification].filter(Boolean).join(" · ");
}

function fileChangeLabel(detail, type) {
  if (type === "write") {
    const lines = countTextLines(detail.content);
    return lines > 0 ? `新建 ${lines} 行` : "已写入";
  }
  if (type === "edit") {
    const oldLines = countTextLines(detail.oldString);
    const newLines = countTextLines(detail.newString);
    if (oldLines > 0 || newLines > 0) {
      return oldLines === newLines
        ? `替换 ${newLines || oldLines} 行`
        : `替换 ${oldLines || 0} 行为 ${newLines || 0} 行`;
    }
    return detail.unifiedDiff ? "已生成变更" : "已修改";
  }
  return "";
}

function countTextLines(value) {
  const text = String(value || "");
  if (!text) return 0;
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

function shortenPath(value) {
  const text = String(value || "");
  if (text.length <= 42) return text;
  const parts = text.split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : `${text.slice(0, 18)}...${text.slice(-14)}`;
}

function buildToolDetail(name, input, output) {
  const lower = String(name || "").toLowerCase();
  if (isPlanApprovalTool(lower)) {
    return {
      type: "plan",
      filePath: readFirstString(input, ["planFilePath", "plan_file_path", "file_path", "filePath"]) || "",
      content: readFirstString(input, ["plan", "content", "text"]) || extractText(output),
      output: extractText(output),
      confirmation: true,
    };
  }
  if (isShellTool(lower)) {
    return {
      type: "shell",
      command: readFirstString(input, ["command", "cmd"]) || stringifyCompact(input),
      cwd: readFirstString(input, ["cwd", "directory"]) || "",
      output: extractText(output),
      exitCode: readNumber(output, ["exitCode", "exit_code"]),
    };
  }
  if (isReadTool(lower)) {
    return {
      type: "read",
      filePath: readFirstString(input, ["file_path", "filePath", "path"]) || "",
      content: extractText(output),
      offset: readNumber(input, ["offset"]),
      limit: readNumber(input, ["limit"]),
    };
  }
  if (isWriteTool(lower)) {
    const filePath = readFirstString(input, ["file_path", "filePath", "path"]) || "";
    const content = readFirstString(input, ["content", "text"]) || extractText(output);
    if (isClaudePlanPath(filePath)) {
      return {
        type: "plan",
        filePath,
        content,
        output: extractText(output),
        confirmation: false,
      };
    }
    return {
      type: "write",
      filePath,
      content,
    };
  }
  if (isEditTool(lower)) {
    return {
      type: "edit",
      filePath: readFirstString(input, ["file_path", "filePath", "path"]) || "",
      oldString: readFirstString(input, ["old_string", "oldString"]),
      newString: readFirstString(input, ["new_string", "newString"]),
      unifiedDiff: extractDiffText(output) || readFirstString(input, ["patch", "diff"]),
    };
  }
  if (isSearchTool(lower)) {
    return {
      type: "search",
      query: readFirstString(input, ["query", "pattern", "glob", "path"]) || stringifyCompact(input),
      content: extractText(output),
      filePaths: extractFilePaths(output),
    };
  }
  if (isFetchTool(lower)) {
    return {
      type: "fetch",
      url: readFirstString(input, ["url"]) || "",
      prompt: readFirstString(input, ["prompt"]),
      result: extractText(output),
    };
  }
  return {
    type: "unknown",
    input: input ?? null,
    output: output ?? null,
  };
}

function isShellTool(lower) {
  return ["bash", "shell", "exec_command"].includes(lower);
}

function isReadTool(lower) {
  return ["read", "read_file", "view_file"].includes(lower);
}

function isWriteTool(lower) {
  return ["write", "write_file", "create_file"].includes(lower);
}

function isPlanApprovalTool(lower) {
  return ["exitplanmode", "exit_plan_mode", "exit-plan-mode"].includes(lower);
}

function isClaudePlanPath(value) {
  return /(^|\/)\.claude\/plans\/[^/]+\.md$/i.test(String(value || ""));
}

function toolCompletionStatus(name, detail, part) {
  if (part.isError && !(detail?.type === "plan" || isPlanApprovalTool(String(name || "").toLowerCase()))) return "error";
  return "done";
}

function isEditTool(lower) {
  return ["edit", "multiedit", "multi_edit", "apply_patch", "apply_diff", "str_replace_editor"].includes(lower);
}

function isSearchTool(lower) {
  return ["websearch", "web_search", "search", "grep", "glob"].includes(lower);
}

function isFetchTool(lower) {
  return ["webfetch", "web_fetch", "webfetchtool", "web_fetch_tool"].includes(lower);
}

function humanizeToolName(name) {
  const trimmed = String(name || "Tool").trim();
  if (!trimmed) return "Tool";
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function summarizeUnknownToolInput(input) {
  if (!input || typeof input !== "object") return "";
  return readFirstString(input, ["description", "prompt", "query", "path", "file_path", "filePath"]) || "";
}

function readFirstString(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (Array.isArray(candidate) && candidate.every((part) => typeof part === "string")) {
      return candidate.join(" ").trim();
    }
  }
  return "";
}

function readNumber(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const candidate = value[key];
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function extractText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    return (
      readFirstString(value, [
        "output",
        "text",
        "content",
        "result",
        "aggregated_output",
        "aggregatedOutput",
      ]) || stringifyCompact(value)
    );
  }
  return String(value);
}

function extractDiffText(value) {
  if (!value || typeof value !== "object") return "";
  return readFirstString(value, ["diff", "unifiedDiff", "patch"]);
}

function extractFilePaths(value) {
  if (!value || typeof value !== "object") return [];
  const paths = value.filePaths || value.filenames || value.files;
  return Array.isArray(paths) ? paths.filter((item) => typeof item === "string") : [];
}

function stringifyCompact(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function appendMeta(username, sessionId, label, detail) {
  const session = await readSession(username, sessionId);
  if (!session) return;
  await addMetaToSession(session, label, detail);
  await saveSession(username, session);
}

async function addMetaToSession(session, label, detail) {
  const last = session.messages[session.messages.length - 1];
  if (last && last.type === "meta" && last.label === label && last.detail === detail) return;
  session.messages.push({
    id: makeId(),
    type: "meta",
    label,
    detail: String(detail || ""),
    createdAt: nowIso(),
  });
}

function compactJson(value) {
  try {
    return JSON.stringify(value).slice(0, 3000);
  } catch {
    return String(value).slice(0, 3000);
  }
}

async function finishClaudeTurn(username, sessionId, assistantId, result) {
  const key = jobKey(username, sessionId);
  const job = jobs.get(key);
  if (job?.watchdog) clearInterval(job.watchdog);
  if (job?.forceKillTimer) clearTimeout(job.forceKillTimer);
  jobs.delete(key);
  const session = await readSession(username, sessionId);
  if (!session) return;
  const stoppedByUser = Boolean(result.stoppedByUser);
  const assistant = session.messages.find((item) => item.id === assistantId);
  const softCompleted = shouldTreatNonZeroExitAsCompleted(result, assistant);
  const completedOk = Boolean(result.ok || softCompleted);
  const resultMessage =
    !completedOk && !stoppedByUser && assistantTextLooksLikeRuntimeError(assistant?.text)
      ? userFacingRuntimeMessage(assistant.text)
      : result.message;
  if (assistant) {
    assistant.status = stoppedByUser ? "canceled" : completedOk ? "done" : "error";
    assistant.completedAt = nowIso();
    assistant.durationMs = Math.max(
      0,
      new Date(assistant.completedAt).getTime() - new Date(assistant.startedAt || assistant.createdAt).getTime(),
    );
    if (session.usage) assistant.usage = session.usage;
    if (!assistant.text && resultMessage) {
      assistant.text = resultMessage;
    }
  }
  for (const item of session.messages) {
    if (item.type === "tool" && item.status === "running") {
      item.status = stoppedByUser ? "canceled" : completedOk ? "done" : "error";
    }
    if (item.type === "thinking" && item.status === "streaming") item.status = "done";
  }
  session.status = completedOk || stoppedByUser ? "idle" : "error";
  if (completedOk && session.claudeSessionId) session.claudeSessionStarted = true;
  session.lastError = completedOk || stoppedByUser ? null : resultMessage;
  if (!completedOk && !stoppedByUser && resultMessage) {
    session.messages.push({
      id: makeId(),
      type: "error",
      message: resultMessage,
      createdAt: nowIso(),
    });
  }
  const latestStored = await readStoredSession(username, sessionId);
  if (latestStored) {
    session.title = latestStored.title || session.title;
    session.mode = latestStored.mode || session.mode;
    session.model = latestStored.model || session.model;
    session.archivedAt = latestStored.archivedAt || session.archivedAt || null;
  }
  await saveSession(username, session);
  broadcast(username, sessionId, "done", { ok: completedOk, message: softCompleted ? "" : resultMessage });
}

function shouldTreatNonZeroExitAsCompleted(result, assistant) {
  if (!result || result.ok || result.stoppedByUser) return false;
  const text = String(assistant?.text || "").trim();
  if (!text || assistantTextLooksLikeRuntimeError(text)) return false;
  return /^Local engine exited with code \d+(?: \([^)]+\))?\.$/i.test(String(result.message || "").trim());
}

function assistantTextLooksLikeRuntimeError(text) {
  return /^(API Error|Error|Local engine exited)\b/i.test(text) || /Insufficient Balance|rate limit|unauthorized/i.test(text);
}

async function stopClaudeTurn(username, sessionId) {
  if (paseoBridge) {
    return paseoBridge.stopTurn(username, sessionId);
  }
  const key = jobKey(username, sessionId);
  const job = jobs.get(key);
  if (!job) return false;
  job.userStopped = true;
  job.child.kill("SIGTERM");
  setTimeout(() => {
    if (jobs.has(key)) job.child.kill("SIGKILL");
  }, 2500).unref();
  await finishClaudeTurn(username, sessionId, job.assistantId, {
    ok: false,
    stoppedByUser: true,
    message: "已取消本次请求",
  });
  return true;
}

async function detectClaude(username, settingsOverride = null) {
  const settings = settingsOverride || (await readSettings(username));
  if (paseoBridge) {
    return paseoBridge.detectClaude(settings);
  }
  const command = settings.claudePath || "claude";
  const resolved = resolveCommand(command);
  if (!resolved) {
    return { available: false, command, resolvedPath: null, version: null };
  }
  const version = await probeVersion(resolved).catch(() => null);
  return { available: true, command, resolvedPath: resolved, version };
}

function resolveCommand(command) {
  if (!command) return null;
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command) ? command : null;
  }
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(process.env.HOME || "", ".local/bin"),
    path.join(process.env.HOME || "", ".npm-global/bin"),
    ...fnmBinaryDirs(),
  ];
  const paths = [...String(process.env.PATH || "").split(path.delimiter), ...extra].filter(Boolean);
  for (const dir of paths) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function fnmBinaryDirs() {
  const home = process.env.HOME || "";
  const dirs = [];
  const defaultAlias = path.join(home, ".local/share/fnm/aliases/default/bin");
  if (fs.existsSync(defaultAlias)) dirs.push(defaultAlias);

  const multishellRoot = path.join(home, ".local/state/fnm_multishells");
  try {
    const entries = fs
      .readdirSync(multishellRoot)
      .map((entry) => path.join(multishellRoot, entry, "bin"))
      .filter((entry) => fs.existsSync(entry))
      .sort((a, b) => {
        const aStat = fs.statSync(path.dirname(a));
        const bStat = fs.statSync(path.dirname(b));
        return bStat.mtimeMs - aStat.mtimeMs;
      });
    dirs.push(...entries);
  } catch {
    // fnm is optional.
  }
  return dirs;
}

function executableForCommand(command) {
  return resolveCommand(command) || command;
}

let cachedClaudeHarnessEnv = null;

function readClaudeHarnessEnv() {
  if (cachedClaudeHarnessEnv) return cachedClaudeHarnessEnv;
  try {
    const file = path.join(os.homedir(), ".claude", "settings.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    cachedClaudeHarnessEnv =
      parsed?.env && typeof parsed.env === "object" && !Array.isArray(parsed.env) ? parsed.env : {};
  } catch {
    cachedClaudeHarnessEnv = {};
  }
  return cachedClaudeHarnessEnv;
}

function envForExecutable(executable) {
  const dir = executable.includes("/") || executable.includes("\\") ? path.dirname(executable) : "";
  const pathParts = [
    dir,
    ...fnmBinaryDirs(),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || "",
  ].filter(Boolean);
  const harness = readClaudeHarnessEnv();
  const env = {
    ...process.env,
    PATH: pathParts.join(path.delimiter),
    FORCE_COLOR: "0",
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: "0",
  };
  const harnessKeys = [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "API_TIMEOUT_MS",
  ];
  for (const key of harnessKeys) {
    const value = harness[key];
    if (value != null && value !== "") env[key] = String(value);
  }
  return env;
}

function probeVersion(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error("timeout"));
      }
    }, 2500);
    child.stdout.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(out.trim().split("\n")[0] || null);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Invalid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

function sendError(res, error) {
  sendJson(res, error.status || 500, { error: error.message || "Internal server error." });
}

async function routeApi(req, res, url) {
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (pathname === "/api/health" && method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "zhiguo",
      timestamp: nowIso(),
      publicUrl: process.env.ZHIGUO_PUBLIC_URL || null,
    });
  }

  if (pathname === "/api/me" && method === "GET") {
    const username = await readAuthCookie(req);
    if (!username) return sendJson(res, 200, { user: null });
    await ensureUserFolders(username);
    return sendJson(res, 200, { user: publicUser(username) });
  }

  if (pathname === "/api/register" && method === "POST") {
    const body = await readBody(req);
    const username = safeUsername(body.username);
    const password = String(body.password || "");
    if (!username) {
      return sendJson(res, 400, {
        error: "Username must start with a letter and use 3-32 letters, numbers, _, or -.",
      });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: "Password must be at least 6 characters." });
    }
    const store = await readUsers();
    if (store.users[username]) return sendJson(res, 409, { error: "Username already exists." });
    const passwordRecord = hashPassword(password);
    store.users[username] = {
      username,
      password: passwordRecord,
      createdAt: nowIso(),
      homeDir: userDir(username),
    };
    await writeUsers(store);
    await ensureUserFolders(username);
    await writeSettings(username, {});
    setCookie(res, await createAuthCookie(username));
    return sendJson(res, 201, { user: publicUser(username) });
  }

  if (pathname === "/api/login" && method === "POST") {
    const body = await readBody(req);
    const username = safeUsername(body.username);
    const password = String(body.password || "");
    const store = await readUsers();
    const record = username ? store.users[username] : null;
    if (!record || !verifyPassword(password, record.password)) {
      return sendJson(res, 401, { error: "Invalid username or password." });
    }
    await ensureUserFolders(username);
    setCookie(res, await createAuthCookie(username));
    return sendJson(res, 200, { user: publicUser(username) });
  }

  if (pathname === "/api/logout" && method === "POST") {
    clearCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  const username = await readAuthCookie(req);
  if (!username) return sendJson(res, 401, { error: "Unauthorized." });
  await ensureUserFolders(username);

  if (pathname === "/api/config" && method === "GET") {
    const settings = await readSettings(username);
    const claude = await detectClaude(username);
    return sendJson(res, 200, {
      settings,
      claude,
      user: publicUser(username),
      modes: [
        { id: "plan", label: "计划", detail: "先给出方案" },
        { id: "default", label: "询问", detail: "执行前确认" },
        { id: "auto", label: "自动", detail: "自动判断权限" },
        { id: "acceptEdits", label: "接受编辑", detail: "自动接受文件修改" },
        { id: "bypassPermissions", label: "完全自动", detail: "不弹出工具确认" },
      ],
    });
  }

  if (pathname === "/api/config" && method === "PATCH") {
    const settings = await writeSettings(username, await readBody(req));
    const claude = await detectClaude(username);
    return sendJson(res, 200, { settings, claude });
  }

  if (pathname === "/api/config/check" && method === "POST") {
    const settings = mergeSettingsPatch(await readSettings(username), await readBody(req));
    const claude = await detectClaude(username, settings);
    return sendJson(res, 200, { settings, claude });
  }

  if (pathname === "/api/sessions" && method === "GET") {
    return sendJson(res, 200, {
      sessions: await listSessions(username, { archived: url.searchParams.get("archived") === "1" }),
    });
  }

  if (pathname === "/api/sessions" && method === "POST") {
    return sendJson(res, 201, { session: await createSession(username, await readBody(req)) });
  }

  const match = pathname.match(/^\/api\/sessions\/([0-9a-f-]+)(?:\/([^/]+))?$/i);
  if (match) {
    const sessionId = match[1];
    const action = match[2] || "";

    if (!action && method === "GET") {
      const session = await recoverOrphanedSession(username, await readSession(username, sessionId));
      if (!session) return sendJson(res, 404, { error: "Session not found." });
      return sendJson(res, 200, { session });
    }

    if (!action && method === "PATCH") {
      const session = await readSession(username, sessionId);
      if (!session) return sendJson(res, 404, { error: "Session not found." });
      if (session.status === "running") {
        return sendJson(res, 409, { error: "当前回复结束后再重命名这个会话。" });
      }
      const body = await readBody(req);
      if (typeof body.title === "string") session.title = body.title.trim() || session.title;
      if (typeof body.mode === "string") session.mode = cleanMode(body.mode, session.mode);
      if (typeof body.model === "string") session.model = body.model.trim();
      await saveSession(username, session);
      return sendJson(res, 200, { session });
    }

    if (!action && method === "DELETE") {
      await stopClaudeTurn(username, sessionId);
      const session = await readSession(username, sessionId);
      if (!session) return sendJson(res, 404, { error: "Session not found." });
      session.archivedAt = nowIso();
      await writeJsonAtomic(sessionPath(username, sessionId), session);
      broadcast(username, sessionId, "deleted", { id: sessionId });
      return sendJson(res, 200, { ok: true });
    }

    if (action === "restore" && method === "POST") {
      const session = await readStoredSession(username, sessionId);
      if (!session) return sendJson(res, 404, { error: "Session not found." });
      session.archivedAt = null;
      await saveSession(username, session);
      return sendJson(res, 200, { session });
    }

    if (action === "messages" && method === "POST") {
      const session = await runClaudeTurn(username, sessionId, await readBody(req));
      return sendJson(res, 202, { session });
    }

    if (action === "stop" && method === "POST") {
      const stopped = await stopClaudeTurn(username, sessionId);
      return sendJson(res, 200, { stopped });
    }

    if (action === "events" && method === "GET") {
      const session = await recoverOrphanedSession(username, await readSession(username, sessionId));
      if (!session) return sendJson(res, 404, { error: "Session not found." });
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: session\ndata: ${JSON.stringify(session)}\n\n`);
      addSseClient(username, sessionId, res);
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
      res.on("close", () => clearInterval(keepAlive));
      return;
    }
  }

  sendJson(res, 404, { error: "Not found." });
}

function publicUser(username) {
  return {
    username,
    homeDir: userDir(username),
    sessionsDir: sessionsDir(username),
  };
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    const fallback = path.join(PUBLIC_DIR, "index.html");
    return sendFile(res, fallback, "text/html; charset=utf-8");
  }
  if (stat.isDirectory()) {
    return sendFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  }
  return sendFile(res, file, contentType(file));
}

async function sendFile(res, file, type) {
  try {
    const content = await fsp.readFile(file);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function initPaseoCore() {
  const { startPaseoRuntime } = await import("./server/paseo-runtime.mjs");
  const { createPaseoBridge } = await import("./server/paseo-bridge.mjs");
  paseoRuntime = await startPaseoRuntime({
    paseoHome: PASEO_HOME,
    listen: PASEO_LISTEN,
  });
  paseoBridge = createPaseoBridge(paseoRuntime, {
    onDone: (username, sessionId, result) => {
      broadcast(username, sessionId, "done", result);
    },
  });
  await paseoBridge.connect();
}

async function main() {
  await ensureBaseDirs();
  await initPaseoCore();
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    })().catch((error) => {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`Zhiguo app listening on http://${HOST}:${PORT}`);
    console.log(`User info root: ${USERINFO_ROOT}`);
    console.log(`User folders: ${USERS_ROOT}`);
    console.log(`Paseo home: ${PASEO_HOME}`);
    console.log(`Paseo listen: ${PASEO_LISTEN}`);
  });

  const shutdown = async () => {
    if (paseoBridge) await paseoBridge.close().catch(() => undefined);
    if (paseoRuntime) {
      const { stopPaseoRuntime } = await import("./server/paseo-runtime.mjs");
      await stopPaseoRuntime(paseoRuntime).catch(() => undefined);
    }
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
