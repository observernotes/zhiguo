"use strict";

const state = {
  user: null,
  sessions: [],
  archivedSessions: [],
  activeSession: null,
  config: null,
  eventSource: null,
  authMode: "login",
  authForm: { username: "", password: "", confirmPassword: "" },
  loading: true,
  sending: false,
  stopBusy: false,
  authBusy: false,
  authError: "",
  authErrorField: "",
  authFocusTarget: "username",
  authPasswordFocusTarget: "password",
  passwordVisible: false,
  settingsOpen: false,
  settingsAdvanced: false,
  settingsDiagnosticsOpen: false,
  mobileSettingsPanel: "home",
  settingsBusy: false,
  settingsCheckBusy: false,
  pendingSettings: null,
  settingsError: "",
  settingsNotice: "",
  logoutBusy: false,
  sessionMenuOpen: false,
  refreshBusy: false,
  mobileDrawerOpen: false,
  openingSessionId: "",
  sheet: null,
  sheetBusy: false,
  quotaSendOverride: false,
  pendingQuotaRetry: null,
  composerError: null,
  composerDraft: "",
  pendingMessage: "",
  forceScrollBottom: true,
  showScrollButton: false,
  focusToolId: null,
  copyFeedbackKey: "",
  toast: null,
  stderr: "",
  sessionQuery: "",
  sessionView: "active",
  restoringSessionId: "",
  justArchivedSession: null,
  expandedToolIds: new Set(),
  composerComposing: false,
  returnFocusSelector: "",
  restoreMobileDrawerAfterSettings: false,
};

const app = document.getElementById("app");
const BRAND_NAME = "智果";
const BRAND_ASSET = "/assets/zhiguo-mascot.png";
const LONG_RUNNING_MS = 8000;
const LAST_ACTIVE_SESSION_PREFIX = "code-bao:last-active-session:";
const COMPOSER_DRAFT_PREFIX = "code-bao:composer-draft:";
const NEW_DRAFT_SESSION_ID = "new";
const SETTINGS_COMPARE_FIELDS = {
  claudePath: "claude",
  defaultMode: "plan",
  defaultModel: "",
  maxTurns: "",
  appendSystemPrompt: "",
};
let runningTickTimer = null;
let copyFeedbackTimer = null;

const api = {
  async request(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return data;
  },
  get(path) {
    return this.request(path);
  },
  post(path, body = {}) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  },
  patch(path, body = {}) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  delete(path) {
    return this.request(path, { method: "DELETE" });
  },
};

render();
bindGlobalEvents();

init().catch((error) => {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card"><h1>启动失败</h1><p>${escapeHtml(
    error.message,
  )}</p></div></div>`;
});

async function init() {
  const me = await api.get("/api/me");
  state.user = me.user;
  state.loading = false;
  if (state.user) {
    await loadAuthedState();
  }
  render();
}

async function loadAuthedState() {
  const [config, sessions, archived] = await Promise.all([
    api.get("/api/config"),
    api.get("/api/sessions"),
    api.get("/api/sessions?archived=1"),
  ]);
  state.config = config;
  state.sessions = sessions.sessions || [];
  state.archivedSessions = archived.sessions || [];
  if (!state.activeSession && state.sessions.length > 0) {
    const preferredId = preferredInitialSessionId(state.sessions);
    if (preferredId === NEW_DRAFT_SESSION_ID) startDraftSession({ renderAfter: false });
    else await openSession(preferredId, { renderAfter: false });
  } else if (!state.activeSession && readComposerDraft(NEW_DRAFT_SESSION_ID)) {
    startDraftSession({ renderAfter: false });
  }
}

function preferredInitialSessionId(sessions) {
  const rememberedId = readRememberedSessionId();
  if (rememberedId === NEW_DRAFT_SESSION_ID) return NEW_DRAFT_SESSION_ID;
  if (rememberedId && sessions.some((session) => session.id === rememberedId)) return rememberedId;
  return sessions[0]?.id || "";
}

function sessionMemoryKey(username = state.user?.username) {
  return username ? `${LAST_ACTIVE_SESSION_PREFIX}${username}` : "";
}

function readRememberedSessionId(username = state.user?.username) {
  const key = sessionMemoryKey(username);
  if (!key) return "";
  try {
    return window.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function rememberActiveSession(session = state.activeSession) {
  if (session?.draft) {
    const key = sessionMemoryKey(session.username || state.user?.username);
    if (!key) return;
    try {
      window.localStorage?.setItem(key, NEW_DRAFT_SESSION_ID);
    } catch {
      // Local persistence is a convenience; the server remains the source of truth.
    }
    return;
  }
  if (!session?.id || session.archivedAt) return;
  const key = sessionMemoryKey(session.username || state.user?.username);
  if (!key) return;
  try {
    window.localStorage?.setItem(key, session.id);
  } catch {
    // Local persistence is a convenience; the server remains the source of truth.
  }
}

function forgetRememberedSessionId(sessionId, username = state.user?.username) {
  if (!sessionId) return;
  const key = sessionMemoryKey(username);
  if (!key || readRememberedSessionId(username) !== sessionId) return;
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore storage restrictions.
  }
}

function draftMemoryKey(session = state.activeSession, username = state.user?.username) {
  if (!username) return "";
  const sessionId =
    typeof session === "string" ? session : session?.draft ? NEW_DRAFT_SESSION_ID : session?.id || NEW_DRAFT_SESSION_ID;
  return sessionId ? `${COMPOSER_DRAFT_PREFIX}${username}:${sessionId}` : "";
}

function readComposerDraft(session = state.activeSession) {
  const key = draftMemoryKey(session);
  if (!key) return "";
  try {
    return window.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function rememberComposerDraft(text = state.composerDraft, session = state.activeSession) {
  const key = draftMemoryKey(session);
  if (!key) return;
  try {
    if (String(text || "").trim()) window.localStorage?.setItem(key, String(text));
    else window.localStorage?.removeItem(key);
    const isNewDraft = !session || session === NEW_DRAFT_SESSION_ID || session?.draft;
    const activeKey = sessionMemoryKey(state.user?.username);
    if (isNewDraft && activeKey) window.localStorage?.setItem(activeKey, NEW_DRAFT_SESSION_ID);
  } catch {
    // Draft memory is best-effort only.
  }
}

function clearComposerDraft(session = state.activeSession) {
  const key = draftMemoryKey(session);
  if (!key) return;
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore storage restrictions.
  }
}

function render() {
  if (state.loading) {
    clearRunningTicker();
    app.innerHTML = renderBootSplash();
    return;
  }
  if (!state.user) {
    clearRunningTicker();
    renderAuth();
    return;
  }
  renderShell();
  syncRunningTicker();
}

function bindGlobalEvents() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && trapOverlayFocus(event)) return;
    if (event.key !== "Escape") return;
    if (state.settingsOpen) {
      closeSettings();
      return;
    }
    if (state.sheet) {
      closeSheet();
      return;
    }
    if (state.mobileDrawerOpen) {
      closeMobileDrawer();
      return;
    }
    if (state.sessionMenuOpen && !state.refreshBusy) {
      state.sessionMenuOpen = false;
      render();
    }
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!state.sessionMenuOpen || state.refreshBusy) return;
      if (event.target?.closest?.(".topbar-menu-wrap")) return;
      window.setTimeout(() => {
        if (!state.sessionMenuOpen || state.refreshBusy) return;
        state.sessionMenuOpen = false;
        render();
      }, 0);
    },
    true,
  );
  window.addEventListener("resize", () => {
    updateComposerSafeArea();
    updateScrollButtonVisibility();
  });
}

function syncRunningTicker() {
  const running = Boolean(state.user && state.activeSession?.status === "running");
  if (!running) {
    clearRunningTicker();
    return;
  }
  if (runningTickTimer) return;
  runningTickTimer = window.setInterval(() => {
    if (!state.user || state.activeSession?.status !== "running") {
      clearRunningTicker();
      return;
    }
    if (state.settingsOpen || state.sheet) return;
    render();
  }, 1000);
}

function clearRunningTicker() {
  if (!runningTickTimer) return;
  window.clearInterval(runningTickTimer);
  runningTickTimer = null;
}

function trapOverlayFocus(event) {
  if (!state.settingsOpen && !state.sheet) return false;
  const root = state.sheet ? document.querySelector(".sheet-panel") : document.querySelector("#settings-form, .sheet-panel");
  if (!root) return false;
  const focusables = [...root.querySelectorAll("button, input, textarea, select, a[href], [tabindex]")]
    .filter((node) => !node.disabled && node.getAttribute("tabindex") !== "-1" && node.offsetParent !== null);
  if (focusables.length === 0) return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!root.contains(document.activeElement)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  return true;
}

function rememberReturnFocus(fallbackSelector = "") {
  const active = document.activeElement;
  state.returnFocusSelector = selectorForFocus(active) || fallbackSelector;
}

function restoreReturnFocus(fallbackSelector = "") {
  const preferred = state.returnFocusSelector;
  state.returnFocusSelector = "";
  const restore = () => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement && !active.closest("#settings-form, .sheet-panel")) {
      return;
    }
    const selectors = [preferred, fallbackSelector, "#conversation-menu-button", "#settings-button", "#mobile-menu-button"].filter(Boolean);
    for (const selector of selectors) {
      const target = document.querySelector(selector);
      if (!target || target.disabled || target.closest("[inert]")) continue;
      target.focus({ preventScroll: true });
      return;
    }
  };
  requestAnimationFrame(restore);
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 90);
  window.setTimeout(restore, 240);
  window.setTimeout(restore, 520);
}

function selectorForFocus(node) {
  if (!node || node === document.body || node === document.documentElement) return "";
  if (node.id) return `#${CSS.escape(node.id)}`;
  const sessionId = node.dataset?.sessionId;
  if (sessionId) return `[data-session-id="${CSS.escape(sessionId)}"]`;
  return "";
}

function renderBootSplash() {
  return `
    <main class="boot-shell" role="status" aria-live="polite">
      <div class="boot-card">
        <div class="boot-mascot-wrap">
          <span class="boot-ring" aria-hidden="true"></span>
          <img class="boot-mascot" src="${BRAND_ASSET}" alt="" />
        </div>
        <div class="boot-copy">
          <h1>${BRAND_NAME}</h1>
          <p>正在连接本机助手</p>
        </div>
        <div class="boot-rail" aria-hidden="true">
          <span></span>
        </div>
        <div class="boot-skeleton" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </div>
    </main>
  `;
}

function renderAuth(error = "") {
  const isLogin = state.authMode === "login";
  const message = error || state.authError;
  const passwordType = state.passwordVisible ? "text" : "password";
  const busyAttr = state.authBusy ? "disabled" : "";
  const usernameInvalid = state.authErrorField === "username";
  const passwordInvalid = state.authErrorField === "password";
  const confirmInvalid = state.authErrorField === "confirmPassword";
  app.innerHTML = `
    <main class="auth-shell ${isLogin ? "auth-login" : "auth-register"}">
      <section class="auth-stage" aria-hidden="true">
        <div class="auth-stage-brand">
          <img src="${BRAND_ASSET}" alt="" />
          <strong>${BRAND_NAME}</strong>
          <span><i></i>服务正常</span>
        </div>
        <div class="auth-preview-card">
          <div class="auth-preview-head">
            <strong>最近对话</strong>
            <span>本机保存</span>
          </div>
          <div class="auth-preview-list">
            <div class="auth-preview-row">
              <span>${icon("code")}</span>
              <p>梳理项目结构</p>
              <em>09:30</em>
            </div>
            <div class="auth-preview-row">
              <span>${icon("folder")}</span>
              <p>整理文件说明</p>
              <em>昨天</em>
            </div>
            <div class="auth-preview-row">
              <span>${icon("spark")}</span>
              <p>细化产品想法</p>
              <em>周二</em>
            </div>
          </div>
        </div>
      </section>
      <form class="auth-card ${state.authBusy ? "busy" : ""}" id="auth-form" aria-busy="${
        state.authBusy ? "true" : "false"
      }">
        <div class="auth-brand-row">
          <img class="auth-mark" src="${BRAND_ASSET}" alt="" />
          <span>${BRAND_NAME}</span>
        </div>
        <div class="auth-copy">
          <span class="auth-kicker">${isLogin ? "欢迎回来" : "创建账号"}</span>
          <h1>${isLogin ? "继续你的对话" : "开启本机工作区"}</h1>
          <p>${isLogin ? "登录后继续使用这台机器上的历史会话。" : "账号创建后会自动生成独立的同名文件夹。"}</p>
        </div>
        <div class="field ${usernameInvalid ? "field-error" : ""}">
          <label for="username">用户名</label>
          <input id="username" name="username" autocomplete="username" placeholder="输入用户名" ${busyAttr} value="${escapeAttr(
            state.authForm.username,
          )}" ${usernameInvalid ? 'aria-invalid="true"' : ""} />
        </div>
        <div class="field ${passwordInvalid ? "field-error" : ""}">
          <label for="password">密码</label>
          <div class="password-field">
            <input id="password" name="password" type="${passwordType}" autocomplete="${
              isLogin ? "current-password" : "new-password"
            }" ${busyAttr} value="${escapeAttr(state.authForm.password)}" placeholder="输入密码" ${
              passwordInvalid ? 'aria-invalid="true"' : ""
            } />
            <button type="button" class="field-action password-visibility" id="toggle-password" aria-label="${
              state.passwordVisible ? "隐藏密码" : "显示密码"
            }" data-tooltip="${state.passwordVisible ? "隐藏密码" : "显示密码"}" ${busyAttr}>${
              icon(state.passwordVisible ? "eyeOff" : "eye")
            }</button>
          </div>
        </div>
        ${
          isLogin
            ? ""
            : `<div class="field ${confirmInvalid ? "field-error" : ""}">
                <label for="confirmPassword">确认密码</label>
	                <input id="confirmPassword" name="confirmPassword" type="${passwordType}" autocomplete="new-password" ${busyAttr} value="${escapeAttr(
	                  state.authForm.confirmPassword,
	                )}" placeholder="再次输入密码" ${confirmInvalid ? 'aria-invalid="true"' : ""} />
                <small>用户名需以字母开头，至少 3 位；密码建议不少于 6 位。</small>
              </div>`
        }
        ${
          message
            ? `<div class="inline-error auth-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                message,
              )}</span></div>`
            : ""
        }
        <div class="form-actions">
          <button type="submit" class="primary-button" ${state.authBusy ? "disabled" : ""}>
            ${state.authBusy ? `<span class="button-spinner"></span>${isLogin ? "登录中" : "创建中"}` : isLogin ? "继续" : "创建并进入"}
          </button>
        </div>
        ${
          state.authBusy
            ? `<div class="auth-progress" role="status" aria-live="polite">
                <span class="auth-progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                <strong>${isLogin ? "正在同步本机会话" : "正在创建本机工作区"}</strong>
                <em>${isLogin ? "马上回到最近的对话" : "账号文件夹会自动准备好"}</em>
                <span class="auth-progress-rail" aria-hidden="true"><i></i></span>
              </div>`
            : ""
        }
        <button type="button" class="auth-switch" id="switch-auth" ${busyAttr}>${
          isLogin ? "还没有账号？创建新账号" : "已有账号？去登录"
        }</button>
      </form>
    </main>
  `;
  bindAuthFieldState();
  document.getElementById("switch-auth").addEventListener("click", () => {
    state.authMode = isLogin ? "register" : "login";
    state.authError = "";
    state.authErrorField = "";
    state.authForm.password = "";
    state.authForm.confirmPassword = "";
    state.authPasswordFocusTarget = "password";
    state.passwordVisible = false;
    renderAuth();
    document.getElementById("username")?.focus({ preventScroll: true });
  });
  document.getElementById("toggle-password")?.addEventListener("click", () => {
    const focusId = !isLogin && state.authPasswordFocusTarget === "confirmPassword" ? "confirmPassword" : "password";
    const input = document.getElementById(focusId);
    const selectionStart = input?.selectionStart ?? input?.value?.length ?? 0;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    state.passwordVisible = !state.passwordVisible;
    renderAuth();
    requestAnimationFrame(() => {
      const nextInput = document.getElementById(focusId);
      if (!nextInput) return;
      nextInput.focus();
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    });
  });
  document.getElementById("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.authBusy) return;
    const form = new FormData(event.currentTarget);
    updateAuthFormFrom(form);
    const validation = validateAuthForm(isLogin);
    if (validation) {
      state.authError = validation.message;
      state.authErrorField = validation.field;
      renderAuth();
      focusAuthField(validation.field);
      return;
    }
    state.authBusy = true;
    state.authError = "";
    state.authErrorField = "";
    renderAuth();
    try {
      const result = await api.post(isLogin ? "/api/login" : "/api/register", {
        username: state.authForm.username,
        password: state.authForm.password,
      });
      state.user = result.user;
      state.authBusy = false;
      state.authForm.password = "";
      state.authForm.confirmPassword = "";
      await loadAuthedState();
      render();
    } catch (err) {
      state.authBusy = false;
      state.authError = userFacingError(err.message);
      state.authErrorField = authErrorFieldForMessage(state.authError, isLogin);
      if (shouldClearAuthSecretAfterError(isLogin, state.authErrorField, state.authError)) {
        state.authForm.password = "";
        state.authForm.confirmPassword = "";
      }
      renderAuth();
      focusAuthField(state.authErrorField);
    }
  });
  restoreAuthFocus();
}

function shouldClearAuthSecretAfterError(isLogin, field, message = "") {
  if (isLogin) return true;
  if (field === "username" && /用户名|使用|already/i.test(message)) return false;
  return field === "password";
}

function bindAuthFieldState() {
  document.getElementById("username")?.addEventListener("input", (event) => {
    state.authForm.username = event.currentTarget.value;
    clearAuthErrorInline();
  });
  document.getElementById("password")?.addEventListener("input", (event) => {
    state.authForm.password = event.currentTarget.value;
    clearAuthErrorInline();
  });
  document.getElementById("password")?.addEventListener("focus", () => {
    state.authPasswordFocusTarget = "password";
  });
  document.getElementById("confirmPassword")?.addEventListener("input", (event) => {
    state.authForm.confirmPassword = event.currentTarget.value;
    clearAuthErrorInline();
  });
  document.getElementById("confirmPassword")?.addEventListener("focus", () => {
    state.authPasswordFocusTarget = "confirmPassword";
  });
}

function clearAuthErrorInline() {
  if (!state.authError) return;
  state.authError = "";
  state.authErrorField = "";
  document.querySelector(".auth-error")?.remove();
  document.querySelectorAll(".field-error").forEach((node) => node.classList.remove("field-error"));
  document.querySelectorAll("[aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
}

function updateAuthFormFrom(form) {
  state.authForm.username = String(form.get("username") || "").trim();
  state.authForm.password = String(form.get("password") || "");
  state.authForm.confirmPassword = String(form.get("confirmPassword") || "");
}

function validateAuthForm(isLogin) {
  const username = state.authForm.username.trim();
  const password = state.authForm.password;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(username)) {
    return { field: "username", message: "用户名需以字母开头，长度 3-32 位，可包含数字、下划线或短横线。" };
  }
  if (password.length < 6) return { field: "password", message: "密码至少需要 6 位。" };
  if (!isLogin && password !== state.authForm.confirmPassword)
    return { field: "confirmPassword", message: "两次输入的密码不一致。" };
  return "";
}

function authErrorFieldForMessage(message = "", isLogin = state.authMode === "login") {
  if (/用户名|already|使用/.test(message)) return "username";
  if (/两次输入|确认密码/.test(message)) return "confirmPassword";
  if (/密码|Invalid username or password|不正确/.test(message)) return isLogin ? "password" : "password";
  return isLogin ? "password" : "username";
}

function focusAuthField(field, options = {}) {
  const id = field || "username";
  const shouldSelect = options.select !== false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const input = document.getElementById(id) || document.getElementById("username");
      if (!input) return;
      input.focus({ preventScroll: true });
      if (shouldSelect && typeof input.select === "function") input.select();
    }),
  );
}

function restoreAuthFocus() {
  const target = state.authFocusTarget;
  if (!target) return;
  state.authFocusTarget = "";
  if (isMobileViewport()) return;
  focusAuthField(target, { select: false });
}

function renderShell() {
  const previousRegion = document.getElementById("chat-region");
  const previousSessionId = previousRegion?.dataset.sessionId || "";
  const nextSessionId = state.activeSession?.id || "";
  const sameSession = previousSessionId === nextSessionId;
  const previousScrollTop = previousRegion?.scrollTop || 0;
  const previousScrollHeight = previousRegion?.scrollHeight || 0;
  const wasAwayFromBottom = sameSession && previousRegion ? !isChatNearBottom() : false;
  const shouldStickToBottom = state.forceScrollBottom || !sameSession || !wasAwayFromBottom;
  const overlayOpen = Boolean(state.sheet || state.settingsOpen);
  state.showScrollButton = Boolean(state.activeSession?.messages?.length && sameSession && wasAwayFromBottom && !state.forceScrollBottom);
  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar(overlayOpen)}
      ${renderMobileDrawer(overlayOpen)}
      <main class="main" ${overlayOpen ? "inert" : ""}>
        ${renderTopbar()}
        <section class="chat-region" id="chat-region" data-session-id="${escapeAttr(nextSessionId)}">
          <div class="chat-inner">
            ${state.activeSession ? renderTimeline(state.activeSession) : renderWelcome()}
          </div>
        </section>
        ${renderScrollButton()}
        ${renderComposer()}
      </main>
      ${renderToast(overlayOpen)}
      ${state.sheet ? renderSheet() : ""}
      ${state.settingsOpen ? renderSettingsModal() : ""}
    </div>
  `;
  bindShellEvents();
  updateComposerSafeArea();
  if (shouldStickToBottom) {
    state.showScrollButton = false;
    scrollToBottom();
  } else {
    restoreScroll(previousScrollTop, previousScrollHeight);
  }
  if (state.focusToolId) {
    const id = state.focusToolId;
    state.focusToolId = null;
    requestAnimationFrame(() => requestAnimationFrame(() => keepExpandedToolVisible(id)));
    window.setTimeout(() => keepExpandedToolVisible(id), 80);
  }
  state.forceScrollBottom = false;
}

function renderSidebar(inert = false) {
  const groups = groupSessions(filterSessions(currentSessionCollection()));
  return `
    <aside class="sidebar" ${inert ? "inert" : ""}>
      <div class="brand">
        <div class="brand-lockup">
          <img class="brand-avatar" src="${BRAND_ASSET}" alt="" />
          <div>
            <p class="brand-title">${BRAND_NAME}</p>
            <p class="brand-subtitle">本机智能助手</p>
          </div>
        </div>
      </div>
      <button class="new-chat" id="new-chat-button">${icon("plus")} 新对话</button>
      ${renderSessionViewSwitch()}
      <div class="sidebar-search">
        ${icon("search")}
        <input id="session-search" placeholder="搜索会话" value="${escapeAttr(state.sessionQuery)}" />
      </div>
      <div class="session-list">
        ${renderSessionList(groups)}
      </div>
      <div class="account-panel">
        <div class="account-card">
          <div>
            <span class="account-avatar">${escapeHtml(state.user.username.slice(0, 1).toUpperCase())}</span>
            <p class="account-name">${escapeHtml(state.user.username)}</p>
          </div>
          <button class="icon-button" id="settings-button" aria-label="设置" data-tooltip="设置">${icon("settings")}</button>
        </div>
      </div>
    </aside>
  `;
}

function renderMobileDrawer(inert = false) {
  const groups = groupSessions(filterSessions(currentSessionCollection()));
  const interactive = state.mobileDrawerOpen && !inert;
  return `
    <div class="mobile-drawer ${interactive ? "open" : ""}" aria-hidden="${interactive ? "false" : "true"}" ${
      interactive ? "" : "inert"
    }>
      <button class="mobile-drawer-backdrop" id="mobile-drawer-backdrop" type="button" aria-label="关闭"></button>
      <aside class="mobile-drawer-panel">
        <div class="mobile-drawer-handle" aria-hidden="true"></div>
        <div class="mobile-drawer-head">
          <div class="brand-lockup">
            <img class="brand-avatar" src="${BRAND_ASSET}" alt="" />
            <div>
            <p class="brand-title">${BRAND_NAME}</p>
            <p class="brand-subtitle">会话列表</p>
            </div>
          </div>
          <button class="icon-button" id="mobile-drawer-close" aria-label="关闭" data-tooltip="关闭">${icon("x")}</button>
        </div>
        <button class="new-chat" id="mobile-new-chat-button">${icon("plus")} 新对话</button>
        ${renderSessionViewSwitch()}
        <div class="sidebar-search">
          ${icon("search")}
          <input id="mobile-session-search" placeholder="搜索会话" value="${escapeAttr(state.sessionQuery)}" />
        </div>
        <div class="session-list mobile-session-list">
          ${renderSessionList(groups)}
        </div>
        <div class="account-panel">
          <div class="account-card">
            <div>
              <span class="account-avatar">${escapeHtml(state.user.username.slice(0, 1).toUpperCase())}</span>
              <p class="account-name">${escapeHtml(state.user.username)}</p>
            </div>
            <button class="icon-button" id="mobile-settings-button" aria-label="设置" data-tooltip="设置">${icon("settings")}</button>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function renderSessionViewSwitch() {
  const activeCount = state.sessions.length;
  const archivedCount = state.archivedSessions.length;
  return `
    <div class="session-view-switch" role="tablist" aria-label="会话范围">
      <button type="button" role="tab" data-session-view="active" aria-selected="${
        state.sessionView === "active" ? "true" : "false"
      }" class="${state.sessionView === "active" ? "selected" : ""}">
        <span>最近</span><em>${activeCount}</em>
      </button>
      <button type="button" role="tab" data-session-view="archived" aria-selected="${
        state.sessionView === "archived" ? "true" : "false"
      }" class="${state.sessionView === "archived" ? "selected" : ""}">
        <span>已归档</span><em>${archivedCount}</em>
      </button>
    </div>
  `;
}

function renderSessionList(groups) {
  if (groups.length > 0) return groups.map(renderSessionGroup).join("");
  if (state.sessionQuery.trim()) {
    return `
      <div class="empty-list search-empty">
        <strong>没有找到相关会话</strong>
        <span>换个关键词试试</span>
        <button type="button" data-clear-session-search>清空搜索</button>
      </div>
    `;
  }
  if (state.sessionView === "archived") {
    return `<div class="empty-list archive-empty"><strong>没有归档会话</strong><span>归档后的会话会放在这里</span></div>`;
  }
  return `<div class="empty-list"><strong>还没有会话</strong><span>新建一条对话开始</span></div>`;
}

function currentSessionCollection() {
  return state.sessionView === "archived" ? state.archivedSessions : state.sessions;
}

function filterSessions(sessions) {
  const query = state.sessionQuery.trim().toLowerCase();
  if (!query) return sessions;
  return sessions.filter((session) =>
    `${session.title || ""} ${session.preview || ""}`.toLowerCase().includes(query),
  );
}

function groupSessions(sessions) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  const groups = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "更早", items: [] },
  ];
  for (const session of sessions) {
    const date = new Date(session.updatedAt || session.createdAt || Date.now()).toDateString();
    if (date === today) groups[0].items.push(session);
    else if (date === yesterday) groups[1].items.push(session);
    else groups[2].items.push(session);
  }
  return groups.filter((group) => group.items.length > 0);
}

function renderSessionGroup(group) {
  return `
    <div class="session-group">
      <div class="section-label">${escapeHtml(group.label)}</div>
      ${group.items.map(renderSessionRow).join("")}
    </div>
  `;
}

function renderSessionRow(session) {
  const archived = state.sessionView === "archived" || Boolean(session.archivedAt);
  const turnPill = renderSessionTurnPill(session);
  if (archived) {
    const restoring = state.restoringSessionId === session.id;
    return `
      <div class="session-row archived-row">
        <div>
          <div class="session-heading">
            <p class="session-title">${escapeHtml(session.title)}</p>
            ${turnPill}
          </div>
          <p class="session-preview">${escapeHtml(session.preview || "已归档，可恢复")}</p>
        </div>
        <button type="button" class="restore-session-button" data-restore-session-id="${escapeAttr(session.id)}" ${
          restoring ? "disabled" : ""
        }>${restoring ? `<span class="button-spinner subtle"></span>` : "恢复"}</button>
      </div>
    `;
  }
  const active = state.activeSession?.id === session.id;
  const opening = state.openingSessionId === session.id;
  return `
    <button class="session-row ${active ? "active" : ""} ${opening ? "opening" : ""}" data-session-id="${session.id}" ${
      opening ? "disabled" : ""
    }>
      <div>
        <div class="session-heading">
          <p class="session-title">${escapeHtml(session.title)}</p>
          ${turnPill}
        </div>
        <p class="session-preview">${escapeHtml(opening ? "正在打开..." : session.preview || "准备开始")}</p>
      </div>
      ${
        opening
          ? `<span class="status-dot opening"></span>`
          : session.status === "running"
            ? `<span class="status-dot running"></span>`
            : session.status === "error"
              ? `<span class="status-dot error"></span>`
              : ""
      }
    </button>
  `;
}

function renderSessionTurnPill(session) {
  const count = Number(session?.turnCount || 0);
  if (!Number.isFinite(count) || count <= 1) return "";
  return `<span class="session-turn-pill">${count}轮</span>`;
}

function renderTopbar() {
  const session = state.activeSession;
  const title = session?.title || "新对话";
  const renameBlocked = session?.status === "running";
  return `
    <header class="topbar">
      <div class="topbar-left">
        <button class="icon-button mobile-menu-button" id="mobile-menu-button" aria-label="会话列表" data-tooltip="会话列表">${icon("menu")}</button>
      </div>
      <div class="topbar-title">
        <h1>${escapeHtml(title)}</h1>
        ${renderTopbarContext(session)}
      </div>
      <div class="topbar-actions">
        ${
          session?.status === "running"
            ? `<button class="icon-button quiet-danger ${state.stopBusy ? "busy" : ""}" id="stop-button" aria-label="${
                state.stopBusy ? "停止中" : "停止"
              }" data-tooltip="${state.stopBusy ? "停止中" : "停止"}" ${state.stopBusy ? "disabled" : ""}>${
                state.stopBusy ? `<span class="button-spinner subtle stop-spinner"></span>` : icon("stop")
              }</button>`
            : ""
        }
        <div class="topbar-menu-wrap">
          <button class="icon-button" id="conversation-menu-button" aria-label="会话选项" data-tooltip="会话选项">${icon("more")}</button>
          ${
            state.sessionMenuOpen
              ? `<div class="topbar-menu">
                  ${
                    session
                      ? `<button type="button" id="rename-button" ${
                          renameBlocked ? 'disabled title="当前回复结束后可重命名"' : ""
                        }>${icon("edit")}<span>${renameBlocked ? "回复结束后重命名" : "重命名"}</span></button>
                         <button type="button" id="delete-button">${icon("archive")}<span>归档会话</span></button>`
                      : ""
                  }
                  <button type="button" id="refresh-button" ${state.refreshBusy ? "disabled" : ""}>${
                    state.refreshBusy ? `<span class="button-spinner subtle"></span><span>刷新中</span>` : `${icon("refresh")}<span>刷新</span>`
                  }</button>
                  <button type="button" id="settings-shortcut">${icon("settings")}<span>设置</span></button>
                </div>`
              : ""
          }
        </div>
      </div>
    </header>
  `;
}

function renderTopbarContext(session) {
  const context = topbarContextDetail(session);
  return `
    <p class="topbar-context ${escapeAttr(context.tone)}" aria-label="${escapeAttr(context.text)}">
      <span class="topbar-context-dot" aria-hidden="true"></span>
      <span>${escapeHtml(context.text)}</span>
    </p>
  `;
}

function topbarContextDetail(session) {
  if (!state.config?.claude?.available) return { tone: "warn", text: "本机助手未连接" };
  if (visibleQuotaIssue()) {
    const turnText = session ? topbarTurnText(session) : "Claude 账号";
    return { tone: "quota", text: `${turnText} · 账号需处理` };
  }
  if (!session) return { tone: "ready", text: "本机助手已就绪" };
  const turnText = topbarTurnText(session);
  if (state.stopBusy && session.status === "running") return { tone: "pending", text: `${turnText} · 正在停止` };
  if (session.status === "running") return { tone: "running", text: `${turnText} · 正在回复` };
  if (session.status === "error") return { tone: "warn", text: `${turnText} · 需要处理` };
  const assistant = [...(session.messages || [])].reverse().find((item) => item?.type === "assistant");
  if (assistant?.status === "canceled") return { tone: "muted", text: `${turnText} · 已停止` };
  return { tone: "ready", text: `${turnText} · 本机已保存` };
}

function topbarTurnText(session) {
  const count = Number(session?.turnCount || sessionTurnCount(session));
  if (!Number.isFinite(count) || count <= 0) return "新对话";
  return `${count}轮对话`;
}

function modeLabel(mode) {
  const item = (state.config?.modes || []).find((entry) => entry.id === mode);
  return item?.label || mode || "计划";
}

function renderModeOptions(selected) {
  const modes = state.config?.modes || [];
  return modes
    .map(
      (mode) =>
        `<option value="${escapeAttr(mode.id)}" ${mode.id === selected ? "selected" : ""}>${escapeHtml(
          mode.label,
        )}</option>`,
    )
    .join("");
}

function renderModeCards(selected, disabled = false) {
  const modes = state.config?.modes || [];
  const labels = {
    plan: ["先确认", "执行前会先说明计划"],
    default: ["标准", "需要时询问你"],
    acceptEdits: ["自动编辑", "适合连续修改文件"],
    bypassPermissions: ["完全自动", "适合受信任任务"],
  };
  const riskLabels = {
    acceptEdits: "高风险 · 自动改文件",
    bypassPermissions: "高风险 · 跳过确认",
  };
  return modes
    .map((mode) => {
      const [title, detail] = labels[mode.id] || [mode.label || mode.id, mode.detail || ""];
      const risk = riskLabels[mode.id] || "";
      return `
        <label class="mode-card ${mode.id === selected ? "selected" : ""} ${risk ? "risk-mode" : ""}">
          <input type="radio" name="defaultMode" value="${escapeAttr(mode.id)}" ${
            mode.id === selected ? "checked" : ""
          } ${disabled ? "disabled" : ""} />
          <span>${escapeHtml(title)}${risk ? `<em>${escapeHtml(risk)}</em>` : ""}</span>
          <small>${escapeHtml(detail)}</small>
        </label>
      `;
    })
    .join("");
}

function renderWelcome() {
  const quota = visibleQuotaIssue();
  if (state.justArchivedSession && !state.activeSession && state.sessions.length === 0) return renderArchivedWelcome();
  return `
    <div class="welcome ${quota ? "quota" : ""}">
      <img class="welcome-mascot" src="${BRAND_ASSET}" alt="" />
      <h2>你好，我是 <span>${BRAND_NAME}</span></h2>
      <p>${quota ? "Claude 账号额度需要处理，恢复后可继续使用本机助手" : "你的本机智能助手，随时为你答疑解惑"}</p>
      ${renderWelcomeStatus()}
      ${quota ? renderWelcomeQuotaActions() : renderWelcomeQuickPrompts()}
    </div>
  `;
}

function renderArchivedWelcome() {
  const title = state.justArchivedSession?.title || "刚才的会话";
  return `
    <div class="welcome archived-focus">
      <img class="welcome-mascot" src="${BRAND_ASSET}" alt="" />
      <h2>会话已归档</h2>
      <p>「${escapeHtml(displaySummary(title))}」已移到归档区，历史内容仍保存在本机。</p>
      ${renderWelcomeStatus()}
      <div class="welcome-quota-actions archive-focus-actions">
        <button type="button" class="feature-card quota-action" data-welcome-action="archived">
          <span>${icon("archive")}</span>
          <strong>查看归档会话</strong>
          <small>${state.archivedSessions.length} 个已归档会话</small>
        </button>
        <button type="button" class="feature-card quota-action" data-welcome-action="settings">
          <span>${icon("wrench")}</span>
          <strong>查看 Claude 状态</strong>
          <small>恢复额度后可继续对话</small>
        </button>
      </div>
    </div>
  `;
}

function renderWelcomeQuickPrompts() {
  return `
    <div class="quick-row">
      ${[
        { icon: "file", title: "看一下项目", detail: "梳理现状", prompt: "帮我分析这个目录里已有文件" },
        { icon: "list", title: "先做计划", detail: "拆出步骤", prompt: "先规划一个登录系统实现方案" },
        { icon: "wrench", title: "修复问题", detail: "定位原因", prompt: "检查当前工作区有什么可以改进" },
        { icon: "code", title: "整理文档", detail: "沉淀说明", prompt: "为这个项目创建一个 README" },
      ]
        .map(
          (item) => `<button type="button" class="feature-card quick-prompt" data-prompt="${escapeAttr(item.prompt)}">
            <span>${icon(item.icon)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </button>`,
        )
        .join("")}
    </div>
  `;
}

function renderWelcomeQuotaActions() {
  const archivedCount = state.archivedSessions.length;
  return `
    <div class="welcome-quota-actions">
      <button type="button" class="feature-card quota-action" data-welcome-action="settings">
        <span>${icon("wrench")}</span>
        <strong>查看 Claude 状态</strong>
        <small>确认本机连接与账号额度</small>
      </button>
      ${
        archivedCount
          ? `<button type="button" class="feature-card quota-action" data-welcome-action="archived">
              <span>${icon("archive")}</span>
              <strong>查看归档会话</strong>
              <small>${archivedCount} 个已归档会话</small>
            </button>`
          : ""
      }
    </div>
  `;
}

function renderWelcomeStatus() {
  const connected = Boolean(state.config?.claude?.available);
  const quota = visibleQuotaIssue(connected);
  const workspace = state.user?.homeDir ? displayPath(state.user.homeDir) : "工作区已准备";
  return `
    <div class="welcome-status" aria-label="当前工作状态">
      <span class="${quota || !connected ? "warning" : "ready"}">
        ${icon(quota || !connected ? "wrench" : "check")}
        <strong>${quota ? "Claude 账号需处理" : connected ? `${BRAND_NAME} 已就绪` : "本机助手未连接"}</strong>
      </span>
      <span>
        ${icon("folder")}
        <strong>工作区 ${escapeHtml(workspace)}</strong>
      </span>
      <span>
        ${icon("shield")}
        <strong>会话保存在本机</strong>
      </span>
    </div>
  `;
}

function renderTimeline(session) {
  if (!session.messages || session.messages.length === 0) return renderWelcome();
  const turns = buildTurns(session.messages);
  return `
    <div class="agent-stream">
      <div class="date-divider"><span>今天</span></div>
      ${turns.map((turn, index) => renderTurn(turn, index, turns.length, session)).join("")}
    </div>
  `;
}

function buildTurns(messages) {
  const turns = [];
  let current = null;
  for (const item of messages) {
    if (item.type === "user") {
      current = { user: item, items: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { user: null, items: [] };
      turns.push(current);
    }
    current.items.push(item);
  }
  return turns;
}

function renderTurn(turn, index, count, session) {
  const visibleItems = turn.items.filter(isVisibleTimelineItem);
  const isLatest = index === count - 1;
  return `
    <section class="stream-turn ${isLatest ? "latest" : ""}">
      ${turn.user ? renderUserBubble(turn.user) : ""}
      <div class="turn-body">
        ${visibleItems.map((item, itemIndex) => renderTimelineItem(item, visibleItems, itemIndex)).join("")}
        ${renderTurnFooter(turn, session, isLatest)}
        ${renderContinuationRail(turn, session, isLatest)}
      </div>
    </section>
  `;
}

function renderUserBubble(item) {
  return `
    <article class="stream-user">
      <div class="user-bubble">${escapeHtml(item.text)}</div>
      ${renderMessageActions(item.id)}
    </article>
  `;
}

function isVisibleTimelineItem(item) {
  if (item.type === "thinking") return item.status === "streaming";
  if (item.type !== "meta") return true;
  return false;
}

function renderTimelineItem(item, items = [], itemIndex = 0) {
  if (item.type === "user") {
    return renderUserBubble(item);
  }
  if (item.type === "assistant") {
    if (item.status === "canceled") return "";
    const assistantText =
      item.status === "error" ? userFacingError(item.text) : item.text;
    const waiting = item.status === "streaming" && !assistantText;
    return `
      <article class="assistant-block ${item.status === "streaming" ? "streaming" : ""}">
        <div class="assistant-label">
          <span class="assistant-icon"><img src="${BRAND_ASSET}" alt="" /></span>
          <span>${BRAND_NAME}</span>
        </div>
        <div class="assistant-markdown ${waiting ? "waiting" : assistantText ? "" : "empty"}">${
          waiting ? renderAssistantWaiting(item, { afterTool: hasCompletedToolBefore(items, itemIndex) }) : assistantText ? renderMarkdownLite(assistantText) : "正在组织回复..."
        }</div>
        ${assistantText ? renderMessageActions(item.id) : ""}
      </article>
    `;
  }
  if (item.type === "tool") {
    return renderToolBadge(item);
  }
  if (item.type === "todo") {
    return renderTodoCard(item);
  }
  if (item.type === "thinking") {
    return `
      <article class="tool-badge running thinking-badge">
        <div class="tool-badge-main">
          <span class="tool-badge-icon">${icon("spark")}</span>
          <span class="tool-badge-label shimmer-text">正在思考</span>
        </div>
      </article>
    `;
  }
  if (item.type === "error") {
    const previousAssistantError = [...items.slice(0, itemIndex)]
      .reverse()
      .find((entry) => entry?.type === "assistant" && entry.status === "error");
    if (previousAssistantError && userFacingError(previousAssistantError.text) === userFacingError(item.message)) {
      return "";
    }
    return `<article class="activity-line error">${icon("wrench")}<span>${escapeHtml(userFacingError(item.message))}</span></article>`;
  }
  if (item.type === "meta") {
    return "";
  }
  return `<article class="activity-line">${escapeHtml(formatValue(item))}</article>`;
}

function hasCompletedToolBefore(items, itemIndex) {
  return items
    .slice(0, itemIndex)
    .some((entry) => (entry.type === "tool" && (entry.status === "done" || entry.status === "completed")) || entry.type === "todo");
}

function renderAssistantWaiting(item, options = {}) {
  const elapsed = elapsedMs(item.startedAt || item.createdAt);
  const longRunning = elapsed >= LONG_RUNNING_MS;
  const afterTool = Boolean(options.afterTool);
  const title = afterTool
    ? longRunning
      ? "工具结果已返回，仍在整理"
      : "正在整理工具结果"
    : longRunning
      ? "本机任务仍在运行"
      : `正在唤起${BRAND_NAME}本机引擎`;
  const detail = afterTool
    ? longRunning
      ? `${BRAND_NAME} 已拿到工具输出，正在整理成最终回复。`
      : `工具结果已返回，${BRAND_NAME} 正在组织回复。`
    : longRunning
      ? `${BRAND_NAME} 还没有返回新内容，可以继续等待，或点击右上角停止。`
      : `本机任务已进入队列，${BRAND_NAME} 正在准备回复。`;
  return `
    <div class="assistant-wait-card ${longRunning ? "long-running" : ""} ${afterTool ? "after-tool" : ""}" role="status" aria-live="polite">
      <span class="assistant-wait-orbit" aria-hidden="true"><i></i></span>
      <div>
        <strong>${title}</strong>
        <span>${detail}</span>
        ${longRunning ? `<em>已运行 ${formatDuration(elapsed)}</em>` : ""}
      </div>
    </div>
  `;
}

function renderToolBadge(item) {
  const id = item.id || item.toolUseId;
  const expanded = state.expandedToolIds.has(id);
  const detail = item.detail || { type: "unknown", input: item.input ?? null, output: item.output ?? null };
  const display = toolDisplay(item, detail);
  const sublineText = toolBadgeSubline(item, detail, display);
  const canExpand = hasToolDetails(item, detail);
  const longRunning = isLongRunningItem(item);
  const toolKind = isPlanTool(item, detail) ? "plan" : detail.type || "unknown";
  const toggleLabel = canExpand
    ? `${expanded ? "收起" : "展开"}工具详情：${display.displayName}`
    : display.displayName;
  return `
    <article class="tool-badge tool-${escapeAttr(toolKind)} ${item.status || ""} ${longRunning ? "long-running" : ""} ${expanded ? "expanded" : ""}">
      <button class="tool-badge-toggle" data-tool-id="${escapeAttr(id)}" aria-label="${escapeAttr(toggleLabel)}" ${canExpand ? "" : "disabled"}>
        <span class="tool-badge-icon">${toolIcon(display.displayName || item.name)}</span>
        <span class="tool-badge-copy">
          <span class="tool-badge-mainline">
            <span class="tool-badge-label ${item.status === "running" ? "shimmer-text" : ""}">${escapeHtml(
              display.displayName,
            )}</span>
            ${display.summary ? `<span class="tool-badge-summary">${escapeHtml(display.summary)}</span>` : ""}
          </span>
          ${sublineText ? `<span class="tool-badge-subline">${escapeHtml(sublineText)}</span>` : ""}
        </span>
        <span class="tool-badge-status">${toolStatusLabel(item.status, item)}</span>
        ${canExpand ? `<span class="tool-badge-chevron">${icon("chevronRight")}</span>` : ""}
      </button>
      ${expanded && canExpand ? `<div class="tool-detail">${renderToolDetail(detail, item)}</div>` : ""}
    </article>
  `;
}

function renderMessageActions(id) {
  if (!id) return "";
  const key = copyFeedbackKey("message", id);
  const copied = state.copyFeedbackKey === key;
  return `
    <div class="message-actions">
      <button type="button" class="message-action ${copied ? "copied" : ""}" data-copy-id="${escapeAttr(
        id,
      )}" aria-label="${copied ? "已复制" : "复制"}">${icon(copied ? "check" : "copy")}</button>
    </div>
  `;
}

function renderTodoCard(item) {
  const items = Array.isArray(item.items) ? item.items : [];
  const done = items.filter((entry) => entry.completed).length;
  return `
    <article class="todo-card">
      <div class="todo-head">
        <span>${icon("list")}</span>
        <strong>任务清单</strong>
        <em>${done}/${items.length}</em>
      </div>
      <div class="todo-list">
        ${
          items.length
            ? items
                .map(
                  (entry) => `<div class="todo-row ${entry.completed ? "done" : ""}">
                    <span>${entry.completed ? icon("check") : ""}</span>
                    <p>${escapeHtml(entry.text)}</p>
                  </div>`,
                )
                .join("")
            : `<p class="todo-empty">还没有任务</p>`
        }
      </div>
    </article>
  `;
}

function renderTurnFooter(turn, session, isLatest) {
  const assistant = [...turn.items].reverse().find((item) => item.type === "assistant");
  if (isLatest && session.status === "running") {
    const startedAt = assistant?.startedAt || turn.user?.createdAt || session.updatedAt;
    const longRunning = elapsedMs(startedAt) >= LONG_RUNNING_MS;
    return `
      <div class="turn-footer running ${longRunning ? "long-running" : ""}">
        <span class="pulse-dot"></span>
        <span>${longRunning ? `${BRAND_NAME} 仍在运行` : `${BRAND_NAME} 正在回复`}</span>
        <span>${formatElapsed(startedAt)}</span>
      </div>
    `;
  }
  if (!assistant || assistant.status === "streaming") return "";
  if (assistant.status === "canceled") {
    const emptyCanceled = !String(assistant.text || "").trim() || /已停止生成|已取消本次请求/.test(String(assistant.text || ""));
    return renderRecoveryCard({
      kind: "canceled",
      title: emptyCanceled ? "你已停止本次请求" : "已停止生成",
      activeText: emptyCanceled
        ? "未执行新的工具结果，上下文已保留；建议先编辑上一条再继续。"
        : "本次上下文仍保留，可以继续生成或编辑上一条。",
      staleText: "这次停止已保留在历史中，可以继续处理最新上下文。",
      primaryAction: emptyCanceled ? "edit" : "continue",
      primaryLabel: emptyCanceled ? "编辑上一条" : "继续生成",
      secondaryAction: emptyCanceled ? "retry" : "edit",
      secondaryLabel: emptyCanceled ? "重新发送" : "编辑上一条",
      userId: turn.user?.id || "",
      interactive: isLatest,
    });
  }
  if (assistant.status === "error") {
    const recovery = errorRecoveryCopy(assistant, turn.user?.text || "");
    return renderRecoveryCard({
      kind: recovery.kind,
      title: recovery.title,
      activeText: recovery.activeText,
      staleText: recovery.staleText,
      primaryAction: recovery.kind === "quota" ? "settings" : "retry",
      primaryLabel: recovery.kind === "quota" ? "检查账号状态" : "重新发送",
      secondaryAction: "edit",
      secondaryLabel: recovery.kind === "quota" ? "保留并编辑" : "编辑上一条",
      userId: turn.user?.id || "",
      interactive: isLatest,
    });
  }
  return "";
}

function errorRecoveryCopy(assistant, userText = "") {
  const text = userFacingError(assistant?.text || "");
  if (isQuotaErrorText(text)) {
    if (likelyToolTask(userText)) {
      return {
        kind: "quota",
        title: "工具未开始执行",
        activeText: "Claude 账号额度不足，本次工具调用没有启动；已保留这条任务，先检查账号状态。",
        staleText: "这次工具任务因 Claude 账号额度不足中断，工具没有开始执行。",
      };
    }
    return {
      kind: "quota",
      title: "本机助手额度不足",
      activeText: "上下文已保留；额度恢复前不建议重复发送，先检查账号状态。",
      staleText: "这次额度不足已保留在历史中，可以稍后恢复后继续。",
    };
  }
  return {
    kind: "error",
    title: "回复没有完成",
    activeText: "上下文仍保留，可以重新发送或编辑上一条后再试。",
    staleText: "这次失败已保留在历史中，可以继续处理最新上下文。",
  };
}

function isQuotaErrorText(text = "") {
  return /额度不足|API Error:\s*402|Insufficient Balance/i.test(String(text || ""));
}

function likelyToolTask(text = "") {
  return /(?:Bash|bash|命令|终端|工具|读取|写入|创建文件|修改文件|执行|运行|pwd|ls|cat|rg|grep|npm|node|python|git)/i.test(
    String(text || ""),
  );
}

function renderContinuationRail(turn, session, isLatest) {
  if (!isLatest || session.status === "running" || state.composerDraft.trim()) return "";
  const assistant = [...turn.items].reverse().find((item) => item.type === "assistant");
  if (!assistant || assistant.status !== "done" || !assistant.text?.trim()) return "";
  const prompts = continuationPrompts(turn.user?.text || "", assistant.text);
  if (!prompts.length) return "";
  return `
    <div class="continuation-rail" role="group" aria-label="继续追问">
      ${prompts
        .map(
          (item) => `<button type="button" class="continuation-chip quick-prompt" data-prompt="${escapeAttr(
            item.prompt,
          )}">
            ${icon(item.icon || "spark")}<span>${escapeHtml(item.label)}</span>
          </button>`,
        )
        .join("")}
    </div>
  `;
}

function continuationPrompts(userText = "", assistantText = "") {
  const source = `${userText}\n${assistantText}`;
  if (/代码|项目|目录|文件|报错|错误|修复|实现|测试|部署|命令|工具|git|接口|数据库/i.test(source)) {
    return [
      { icon: "list", label: "列下一步", prompt: "基于刚才的内容，直接列出下一步要做的事项。" },
      { icon: "wrench", label: "继续处理", prompt: "请继续处理刚才这个任务，优先给出可以执行的动作。" },
      { icon: "file", label: "整理结果", prompt: "把刚才的结果整理成简洁的结论和待办。" },
    ];
  }
  if (/计划|方案|步骤|规划|拆解|路线/i.test(source)) {
    return [
      { icon: "list", label: "细化步骤", prompt: "把刚才的方案继续细化成可执行步骤。" },
      { icon: "check", label: "标出优先级", prompt: "给刚才的内容标出优先级和风险点。" },
      { icon: "spark", label: "换个方案", prompt: "再给我一个更简单直接的方案。" },
    ];
  }
  if (assistantText.trim().length <= 24) {
    return [
      { icon: "spark", label: "展开说明", prompt: "请把刚才的回答展开说明一下。" },
      { icon: "file", label: "给个例子", prompt: "请基于刚才的回答给一个具体例子。" },
      { icon: "check", label: "总结三点", prompt: "把刚才的回答总结成三个要点。" },
    ];
  }
  return [
    { icon: "spark", label: "继续展开", prompt: "请继续展开刚才的回答。" },
    { icon: "list", label: "总结重点", prompt: "把刚才的回答总结成重点清单。" },
    { icon: "check", label: "给出行动", prompt: "基于刚才的回答，给出下一步行动建议。" },
  ];
}

function renderRecoveryCard(options) {
  const {
    kind,
    title,
    activeText,
    staleText,
    primaryAction,
    primaryLabel,
    secondaryAction,
    secondaryLabel,
    userId,
    interactive,
  } = options;
  const className = [
    "turn-recovery-card",
    kind === "error" ? "error-recovery" : "",
    kind === "quota" ? "quota-recovery" : "",
    kind === "canceled" ? "canceled-recovery" : "",
    interactive ? "" : "stale-recovery",
  ]
    .filter(Boolean)
    .join(" ");
  const diagnosticAction =
    kind === "quota" && primaryAction !== "settings" && secondaryAction !== "settings"
      ? `<button type="button" class="recovery-diagnostic" data-recovery-action="settings" data-recovery-user-id="${escapeAttr(
          userId,
        )}">查看 Claude 状态</button>`
      : "";
  return `
    <div class="${className}" aria-live="polite">
      <div class="turn-recovery-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(interactive ? activeText : staleText)}</span>
      </div>
      ${
        interactive
          ? `<div class="turn-recovery-actions">
              <button type="button" class="recovery-primary" data-recovery-action="${escapeAttr(primaryAction)}" data-recovery-user-id="${escapeAttr(
                userId,
              )}">${escapeHtml(primaryLabel)}</button>
              <button type="button" data-recovery-action="${escapeAttr(secondaryAction)}" data-recovery-user-id="${escapeAttr(
                userId,
              )}">${escapeHtml(secondaryLabel)}</button>
              ${diagnosticAction}
            </div>`
          : `<div class="turn-recovery-stale">历史记录</div>`
      }
    </div>
  `;
}

function toolDisplay(item, detail) {
  const fallback = toolFallbackDisplay(item, detail);
  if (isPlanTool(item, detail)) return fallback;
  const summary = fileToolSummary(detail) || item.summary || fallback.summary || "";
  if (item.displayName || item.summary) {
    const displayName =
      detail?.type && detail.type !== "unknown"
        ? fallback.displayName
        : localizeToolName(item.displayName || fallback.displayName || item.name);
    return {
      displayName,
      summary: displaySummary(summary),
    };
  }
  return fallback;
}

function toolFallbackDisplay(item, detail) {
  if (isPlanTool(item, detail)) {
    const confirmation = detail.confirmation || String(item?.name || "").toLowerCase().includes("exitplan");
    return { displayName: "准备计划", summary: confirmation ? "等待确认后执行" : "执行前计划已生成" };
  }
  if (detail.type === "shell")
    return { displayName: shellToolTitle(detail.command || "", item.status), summary: shellToolSummary(detail.command || "") };
  if (detail.type === "read") return { displayName: statusPrefix("读取文件", item.status), summary: fileReadSummary(detail) };
  if (detail.type === "write") return { displayName: statusPrefix("写入文件", item.status), summary: fileToolSummary(detail, "write") };
  if (detail.type === "edit") return { displayName: statusPrefix("修改文件", item.status), summary: fileToolSummary(detail, "edit") };
  if (detail.type === "search") return { displayName: statusPrefix("搜索内容", item.status), summary: displaySummary(detail.query || "") };
  if (detail.type === "fetch") return { displayName: statusPrefix("获取网页", item.status), summary: displaySummary(detail.url || "") };
  return { displayName: localizeToolName(item.name || "Tool"), summary: "" };
}

function statusPrefix(label, status = "") {
  if (status === "running" || status === "streaming") return `正在${label}`;
  if (status === "done" || status === "completed") return `已${label}`;
  if (status === "error" || status === "failed") return `${label}失败`;
  if (status === "canceled") return `${label}已停止`;
  return label;
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
  if (status === "canceled") return "本机命令已停止";
  if (status === "error" || status === "failed") return "本机命令失败";
  return "运行本机命令";
}

function shellToolSummary(command = "") {
  const normalized = normalizeCommand(command);
  if (/^pwd\s*$/.test(normalized)) return "当前工作区";
  if (/^(ls|find)\b/.test(normalized)) return "查看文件和文件夹";
  if (/^(rg|grep)\b/.test(normalized)) return "搜索工作区内容";
  if (/\bsleep\s+\d+/.test(normalized)) return "后台长任务";
  return displaySummary(command);
}

function normalizeCommand(command = "") {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function localizeToolName(name) {
  const raw = String(name || "");
  if (/执行命令|读取文件|写入文件|修改文件|搜索内容|获取网页|任务清单|准备计划/.test(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes("exitplan") || lower.includes("plan")) return "准备计划";
  if (lower.includes("task") || lower.includes("todo")) return "任务清单";
  if (lower === "shell" || lower.includes("bash")) return "执行命令";
  if (lower === "read" || lower.includes("read")) return "读取文件";
  if (lower === "write" || lower.includes("write")) return "写入文件";
  if (lower === "edit" || lower.includes("edit")) return "修改文件";
  if (lower === "search" || lower.includes("grep") || lower.includes("glob")) return "搜索内容";
  if (lower === "fetch" || lower.includes("webfetch")) return "获取网页";
  return "工具调用";
}

function displaySummary(value) {
  const text = naturalPreview(value || "");
  return text.length > 52 ? `${text.slice(0, 52)}...` : text;
}

function hasToolDetails(item, detail) {
  if (item.output || item.input || item.error) return true;
  return detail && detail.type !== "unknown";
}

function renderToolDetail(detail, item) {
  if (item.status === "running" && !item.output && !item.error) {
    return `${renderToolInsightGrid(item, detail)}<div class="tool-detail-loading"><span class="pulse-dot"></span> 正在等待结果</div>`;
  }
  if (isPlanTool(item, detail)) {
    return `${renderToolInsightGrid(item, detail)}${renderDetailSection("计划内容", detail.content || detail.output || item.output, "pre")}`;
  }
  if (detail.type === "shell") {
    return `${renderToolInsightGrid(item, detail)}${renderDetailSection("命令", detail.command)}${renderDetailSection("输出", detail.output, "pre")}`;
  }
  if (detail.type === "read") {
    return `${renderToolInsightGrid(item, detail)}${renderFileVerification(detail)}${renderDetailSection("文件", detail.filePath)}${renderDetailSection("内容", detail.content, "pre")}`;
  }
  if (detail.type === "write") {
    return `${renderToolInsightGrid(item, detail)}${renderFileToolSummary(detail, "write")}${renderDetailSection("文件", detail.filePath)}${renderDetailSection(
      "内容",
      detail.content,
      "pre",
    )}`;
  }
  if (detail.type === "edit") {
    return `${renderToolInsightGrid(item, detail)}${renderFileToolSummary(detail, "edit")}${renderDetailSection("文件", detail.filePath)}${renderDetailSection(
      "变更",
      detail.unifiedDiff || diffStrings(detail.oldString, detail.newString),
      "pre",
    )}`;
  }
  if (detail.type === "search") {
    return `${renderToolInsightGrid(item, detail)}${renderDetailSection("搜索词", detail.query)}${renderDetailSection("输出", detail.content, "pre")}`;
  }
  if (detail.type === "fetch") {
    return `${renderToolInsightGrid(item, detail)}${renderDetailSection("链接", detail.url)}${renderDetailSection("输出", detail.result, "pre")}`;
  }
  return `${renderToolInsightGrid(item, detail)}${renderDetailSection("输入", item.input, "pre")}${renderDetailSection("输出", item.output, "pre")}`;
}

function renderToolInsightGrid(item, detail) {
  const display = toolDisplay(item, detail);
  const cells = [
    ["动作", toolActionText(item, detail, display)],
    ["结果", toolResultText(item, detail, display)],
  ].filter(([, value]) => value);
  if (cells.length === 0) return "";
  return `
    <div class="tool-insight-grid">
      ${cells
        .map(
          ([label, value]) => `
            <section class="tool-insight-cell">
              <h4>${escapeHtml(label)}</h4>
              <p>${escapeHtml(displaySafeText(value))}</p>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function toolBadgeSubline(item, detail, display = toolDisplay(item, detail)) {
  const action = toolActionText(item, detail, display);
  const status = item.status || "";
  if (status === "running" || status === "streaming" || status === "error" || status === "failed" || status === "canceled") {
    return action;
  }
  if (detail.type === "unknown" && action && action !== display.summary && action !== display.displayName) return action;
  return "";
}

function toolActionText(item, detail, display = toolDisplay(item, detail)) {
  if (isPlanTool(item, detail)) return detail.confirmation ? "等待用户确认后执行" : "生成执行前计划";
  if (detail.type === "shell") {
    const title = shellToolTitle(detail.command || "", item.status);
    if (/工作区/.test(title)) return "查看当前工作区";
    if (/文件列表/.test(title)) return "查看文件和文件夹";
    if (/搜索/.test(title)) return "搜索工作区内容";
    if (/长任务/.test(title)) return "后台运行任务";
    return "运行本机命令";
  }
  if (detail.type === "read") return `读取 ${displayPath(detail.filePath || "")}`;
  if (detail.type === "write") return `写入 ${displayPath(detail.filePath || "")}`;
  if (detail.type === "edit") return `修改 ${displayPath(detail.filePath || "")}`;
  if (detail.type === "search") return `搜索 ${displaySummary(detail.query || "")}`;
  if (detail.type === "fetch") return `获取 ${displaySummary(detail.url || "")}`;
  return display.summary || display.displayName || "处理本机任务";
}

function toolResultText(item, detail, display = toolDisplay(item, detail)) {
  if (item.status === "running" || item.status === "streaming") return "任务正在进行中";
  if (item.status === "error" || item.status === "failed") return detail.verification?.label || "任务没有完成";
  if (item.status === "canceled") return "任务已停止";
  if (isPlanTool(item, detail)) return detail.confirmation ? "计划等待确认" : "计划已生成";
  if (detail.type === "shell") {
    if (detail.output) return summarizeToolOutput(detail.output);
    return "命令已完成";
  }
  if (detail.type === "write" || detail.type === "edit") return fileChangeLabel(detail, detail.type) || "文件已更新";
  if (detail.type === "read") return "内容已读取";
  if (detail.type === "search") return "搜索已完成";
  if (detail.type === "fetch") return "网页内容已获取";
  return display.summary || "任务已完成";
}

function summarizeToolOutput(value) {
  const text = displaySafeText(String(value || "")).trim();
  if (!text) return "任务已完成";
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length > 8) return `${lines.length} 行结果已生成`;
  return displaySummary(text);
}

function renderSheet() {
  const sheet = state.sheet || {};
  if (sheet.type === "rename") {
    const busy = state.sheetBusy;
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <form class="sheet-panel" id="rename-sheet-form" role="dialog" aria-modal="true" aria-label="重命名会话">
          <div class="sheet-handle"></div>
          <h3>重命名会话</h3>
          <input class="sheet-input" id="rename-sheet-input" value="${escapeAttr(sheet.value || "")}" maxlength="48" autofocus ${
            busy ? "disabled" : ""
          } />
          ${
            sheet.error
              ? `<div class="inline-error sheet-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                  sheet.error,
                )}</span></div>`
              : ""
          }
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>取消</button>
            <button type="submit" class="primary-button" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>保存中` : "保存"
            }</button>
          </div>
        </form>
      </div>
    `;
  }
  if (sheet.type === "confirmArchive") {
    const busy = state.sheetBusy;
    const willStopRunning = state.activeSession?.status === "running";
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${willStopRunning ? "停止并归档这个会话" : "归档这个会话"}">
          <div class="sheet-handle"></div>
          <h3>${willStopRunning ? "停止并归档这个会话？" : "归档这个会话？"}</h3>
          <p>${
            willStopRunning
              ? "当前回复会先停止，然后从当前列表移除；不会删除你的账号工作区。"
              : "归档后会从当前列表移除，不会删除你的账号工作区。"
          }</p>
          ${
            sheet.error
              ? `<div class="inline-error sheet-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                  sheet.error,
                )}</span></div>`
              : ""
          }
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>取消</button>
            <button type="button" class="danger-button" data-sheet-action="confirmArchive" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>${willStopRunning ? "停止并归档中" : "归档中"}` : willStopRunning ? "停止并归档" : "归档"
            }</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmNewChat") {
    const busy = state.sheetBusy;
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="停止并新建对话">
          <div class="sheet-handle"></div>
          <h3>停止并新建对话？</h3>
          <p>当前回复会先停止，本次会话会保留在历史里；新对话会立即打开。</p>
          ${
            sheet.error
              ? `<div class="inline-error sheet-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                  sheet.error,
                )}</span></div>`
              : ""
          }
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>继续等待</button>
            <button type="button" class="primary-button" data-sheet-action="confirmNewChat" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>停止并新建中` : "停止并新建"
            }</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmSwitchSession") {
    const busy = state.sheetBusy;
    const targetTitle = displaySummary(sheet.title || "目标会话");
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="停止并切换会话">
          <div class="sheet-handle"></div>
          <h3>停止并切换会话？</h3>
          <p>当前回复会先停止，然后打开「${escapeHtml(targetTitle)}」；原会话会保留在历史里。</p>
          ${
            sheet.error
              ? `<div class="inline-error sheet-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                  sheet.error,
                )}</span></div>`
              : ""
          }
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>继续等待</button>
            <button type="button" class="primary-button" data-sheet-action="confirmSwitchSession" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>停止并切换中` : "停止并切换"
            }</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmLogout") {
    const busy = state.sheetBusy;
    const unsaved = Boolean(sheet.unsaved);
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="停止并退出登录">
          <div class="sheet-handle"></div>
          <h3>停止并退出登录？</h3>
          <p>${
            unsaved
              ? "当前回复会先停止；未保存的设置修改不会保存，所有会话仍会保存在本机。"
              : "当前回复会先停止，所有会话仍会保存在本机；下次登录后可以继续查看。"
          }</p>
          ${
            sheet.error
              ? `<div class="inline-error sheet-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                  sheet.error,
                )}</span></div>`
              : ""
          }
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>继续等待</button>
            <button type="button" class="danger-button" data-sheet-action="confirmLogout" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>停止并退出中` : "停止并退出"
            }</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmPlainLogout") {
    const busy = state.sheetBusy;
    const unsaved = Boolean(sheet.unsaved);
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel logout-confirm-sheet" role="dialog" aria-modal="true" aria-label="退出登录确认">
          <div class="sheet-handle"></div>
          <h3>退出登录？</h3>
          <p>${
            unsaved
              ? "未保存的设置修改不会保存；会话和账号工作区仍会保存在这台机器上。"
              : "会话和账号工作区仍会保存在这台机器上；下次登录后可以继续查看历史。"
          }</p>
          ${
            sheet.error
              ? `<div class="inline-error sheet-error" aria-live="polite">${icon("wrench")}<span>${escapeHtml(
                  sheet.error,
                )}</span></div>`
              : ""
          }
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>取消</button>
            <button type="button" class="danger-button" data-sheet-action="confirmPlainLogout" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>退出中` : "退出登录"
            }</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmDiscardSettings") {
    const busy = state.sheetBusy;
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="放弃未保存设置">
          <div class="sheet-handle"></div>
          <h3>放弃未保存的设置？</h3>
          <p>你刚才修改的设置还没有保存。放弃后会保留当前会话，但这些设置修改不会生效。</p>
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>继续编辑</button>
            <button type="button" class="danger-button" data-sheet-action="confirmDiscardSettings" ${busy ? "disabled" : ""}>放弃修改</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmQuotaSend") {
    const busy = state.sheetBusy;
    const text = sheet.text || state.composerDraft || "";
    const latestFailure = latestQuotaFailureText();
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel quota-send-sheet" role="dialog" aria-modal="true" aria-label="Claude 账号额度仍需处理">
          <div class="sheet-handle"></div>
          <h3>Claude 账号仍需处理</h3>
          <p>这条消息已保存为草稿。建议先处理额度；如果你刚刚处理过，也可以手动再发送一次。</p>
          <div class="quota-status-card" aria-live="polite">
            <span>${icon("shield")}</span>
            <div>
              <strong>账号额度不足</strong>
              <em>${escapeHtml(latestFailure || "最近一次真实请求没有通过 Claude 账号额度校验。")}</em>
            </div>
          </div>
          <div class="quota-send-preview">
            <span>已保存的消息</span>
            <textarea id="quota-send-input" class="sheet-textarea quota-send-input" rows="3" ${
              busy ? "disabled" : ""
            }>${escapeHtml(text)}</textarea>
            ${
              sheet.error
                ? `<em class="quota-send-error" aria-live="polite">${escapeHtml(sheet.error)}</em>`
                : `<em>可以先留在输入框，处理账号后再发送。</em>`
            }
          </div>
          <div class="sheet-actions quota-send-actions">
            <button type="button" class="primary-button" data-sheet-action="quotaSettings" ${busy ? "disabled" : ""}>查看 Claude 状态</button>
            <button type="button" class="ghost-button" data-sheet-action="editQuotaSend" ${busy ? "disabled" : ""}>保留草稿</button>
            <button type="button" class="ghost-button risky-send" data-sheet-action="confirmQuotaSend" ${busy ? "disabled" : ""}>仍要发送一次</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "archiveFocus") {
    const busy = state.sheetBusy;
    const title = displaySummary(sheet.title || "这个会话");
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel archive-focus-sheet" role="dialog" aria-modal="true" aria-label="会话已归档">
          <div class="sheet-handle"></div>
          <h3>会话已归档</h3>
          <p>「${escapeHtml(title)}」已经从最近会话移到归档区，账号工作区和历史内容都会保留。</p>
          <div class="archive-focus-preview">
            <span>${icon("archive")}</span>
            <div>
              <strong>${escapeHtml(title)}</strong>
              <em>可以立即查看归档区，或撤销恢复到最近会话。</em>
            </div>
          </div>
          <div class="sheet-actions archive-focus-actions">
            <button type="button" class="primary-button" data-sheet-action="viewArchived" ${busy ? "disabled" : ""}>查看归档</button>
            <button type="button" class="ghost-button" data-sheet-action="undoArchivedSheet" ${busy ? "disabled" : ""}>撤销归档</button>
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>稍后再看</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "confirmRiskMode") {
    const busy = state.sheetBusy;
    const mode = sheet.mode || "bypassPermissions";
    const copy = riskModeCopy(mode);
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel risk-mode-sheet" role="dialog" aria-modal="true" aria-label="确认工作方式">
          <div class="sheet-handle"></div>
          <h3>${escapeHtml(copy.title)}</h3>
          <p>${escapeHtml(copy.body)}</p>
          <div class="risk-mode-preview">
            <span>${icon("wrench")}</span>
            <div>
              <strong>${escapeHtml(copy.modeLabel)}</strong>
              <em>${escapeHtml(copy.detail)}</em>
            </div>
          </div>
          <div class="sheet-actions">
            <button type="button" class="ghost-button" data-sheet-action="close" ${busy ? "disabled" : ""}>返回修改</button>
            <button type="button" class="danger-button" data-sheet-action="confirmRiskMode" ${busy ? "disabled" : ""}>${
              busy ? `<span class="button-spinner"></span>保存中` : "确认保存"
            }</button>
          </div>
        </div>
      </div>
    `;
  }
  if (sheet.type === "sessionActions") {
    const session = state.activeSession;
    const running = session?.status === "running";
    const title = displaySummary(session?.title || "新对话");
    const status = running ? "正在回复，结束后可重命名" : topbarTurnText(session || {});
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭"></button>
        <div class="sheet-panel action-sheet" role="dialog" aria-modal="true" aria-label="会话操作">
          <div class="sheet-handle"></div>
          <div class="sheet-session-summary ${running ? "running" : ""}">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(status)}</span>
          </div>
          <button type="button" data-sheet-action="rename" ${running ? 'disabled title="当前回复结束后可重命名"' : ""}>${
            icon("edit")
          }<span>${running ? "回复结束后重命名" : "重命名"}</span></button>
          <button type="button" class="sheet-danger-action" data-sheet-action="archive">${icon("archive")}<span>归档会话</span></button>
          <button type="button" data-sheet-action="settings">${icon("settings")}<span>设置</span></button>
          <button type="button" class="sheet-cancel-action" data-sheet-action="close">${icon("x")}<span>取消</span></button>
        </div>
      </div>
    `;
  }
  return "";
}

function openSessionSheet() {
  rememberReturnFocus("#conversation-menu-button");
  dismissToast();
  state.sheet = { type: "sessionActions" };
  state.sessionMenuOpen = false;
  render();
}

function openSettings(options = {}) {
  rememberReturnFocus(options.returnFocus || "#settings-button");
  dismissToast();
  state.settingsOpen = true;
  state.restoreMobileDrawerAfterSettings = Boolean(options.restoreMobileDrawer);
  state.settingsError = "";
  state.settingsNotice = "";
  state.settingsBusy = false;
  state.settingsCheckBusy = false;
  state.logoutBusy = false;
  state.sessionMenuOpen = false;
  state.settingsDiagnosticsOpen = options.diagnostics === true;
  state.settingsAdvanced = options.advanced === true;
  state.mobileSettingsPanel = options.advanced ? "diagnostics" : options.diagnostics ? "claude" : "home";
  if (options.closeSheet) state.sheet = null;
  if (options.closeMobile) state.mobileDrawerOpen = false;
  render();
}

function closeSettings(options = {}) {
  if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
  if (!options.force && settingsFormDirty()) {
    rememberPendingSettingsFromForm();
    state.sheetBusy = false;
    state.sheet = { type: "confirmDiscardSettings", returnFocus: "#close-settings" };
    render();
    return;
  }
  const restoreMobileDrawer = state.restoreMobileDrawerAfterSettings;
  state.settingsOpen = false;
  state.restoreMobileDrawerAfterSettings = false;
  state.settingsError = "";
  state.settingsNotice = "";
  state.settingsDiagnosticsOpen = false;
  state.mobileSettingsPanel = "home";
  state.pendingSettings = null;
  state.sheet = null;
  state.sheetBusy = false;
  if (restoreMobileDrawer) state.mobileDrawerOpen = true;
  render();
  if (restoreMobileDrawer) {
    requestAnimationFrame(() => {
      document.getElementById("mobile-session-search")?.focus({ preventScroll: true });
    });
    return;
  }
  restoreReturnFocus("#settings-button");
}

function openRenameSheet(options = {}) {
  if (!state.activeSession) return;
  if (state.activeSession.status === "running") {
    showToast("当前回复结束后再重命名");
    return;
  }
  rememberReturnFocus(options.returnFocus || "#conversation-menu-button");
  dismissToast();
  state.sheet = { type: "rename", value: state.activeSession.title || "" };
  state.sheetBusy = false;
  state.sessionMenuOpen = false;
  render();
  focusRenameInput(true);
}

function focusRenameInput(select = false) {
  const initialValue = String(state.sheet?.value || "");
  const focus = () => {
    const input = document.getElementById("rename-sheet-input");
    if (!input || input.disabled) return;
    input.focus({ preventScroll: true });
    if (select && input.value === initialValue) {
      input.select();
      input.setSelectionRange(0, input.value.length);
    }
  };
  focus();
  requestAnimationFrame(() => requestAnimationFrame(focus));
  window.setTimeout(focus, 40);
  window.setTimeout(focus, 160);
  window.setTimeout(focus, 520);
  window.setTimeout(focus, 980);
  window.setTimeout(focus, 1500);
}

async function submitRenameSheet(event) {
  event.preventDefault();
  if (state.sheetBusy) return;
  const input = document.getElementById("rename-sheet-input");
  const title = input?.value.trim();
  if (!title) {
    state.sheet = { ...(state.sheet || {}), type: "rename", value: input?.value || "", error: "请输入会话名称" };
    render();
    focusRenameInput(false);
    return;
  }
  if (!state.activeSession) {
    state.sheet = { ...(state.sheet || {}), type: "rename", value: title, error: "这个会话暂时无法重命名" };
    render();
    return;
  }
  state.sheet = { ...(state.sheet || {}), type: "rename", value: title, error: "" };
  state.sheetBusy = true;
  render();
  try {
    const result = await api.patch(`/api/sessions/${state.activeSession.id}`, { title });
    state.activeSession = result.session;
    syncSessionSummary(result.session);
    state.sheet = null;
    state.sheetBusy = false;
    showToast("已重命名");
    render();
    restoreReturnFocus("#conversation-menu-button");
  } catch (err) {
    state.sheetBusy = false;
    state.sheet = {
      ...(state.sheet || {}),
      type: "rename",
      value: title,
      error: userFacingError(err.message),
    };
    render();
  }
}

function closeSheet() {
  if (state.sheetBusy) return;
  const returnFocus = state.sheet?.returnFocus || "#conversation-menu-button";
  state.sheetBusy = false;
  state.sheet = null;
  render();
  restoreReturnFocus(returnFocus);
}

function handleSheetAction(action) {
  if (action === "close") return closeSheet();
  if (action === "rename") return openRenameSheet({ returnFocus: "#conversation-menu-button" });
  if (action === "archive") {
    state.sheetBusy = false;
    state.sheet = { type: "confirmArchive" };
    render();
    return;
  }
  if (action === "settings") {
    openSettings({ closeSheet: true, returnFocus: "#conversation-menu-button" });
    return;
  }
  if (action === "confirmArchive") {
    void archiveActiveSession();
    return;
  }
  if (action === "confirmNewChat") {
    void stopAndStartNewChat();
    return;
  }
  if (action === "confirmSwitchSession") {
    void stopAndSwitchSession();
    return;
  }
  if (action === "confirmLogout") {
    void stopAndLogout();
    return;
  }
  if (action === "confirmPlainLogout") {
    void confirmPlainLogout();
    return;
  }
  if (action === "confirmDiscardSettings") {
    closeSettings({ force: true });
    return;
  }
  if (action === "quotaSettings") {
    persistQuotaSendDraftFromSheet();
    openSettings({ closeSheet: true, diagnostics: true, returnFocus: "#composer-input" });
    return;
  }
  if (action === "editQuotaSend") {
    editQuotaSend();
    return;
  }
  if (action === "confirmQuotaSend") {
    confirmQuotaSend();
    return;
  }
  if (action === "confirmRiskMode") {
    void confirmRiskModeSettings();
    return;
  }
  if (action === "viewArchived") {
    viewArchivedFromSheet();
    return;
  }
  if (action === "undoArchivedSheet") {
    void undoArchive(state.justArchivedSession || state.sheet?.payload);
    return;
  }
}

function readQuotaSendSheetText() {
  const input = document.getElementById("quota-send-input");
  return String(input?.value ?? state.sheet?.text ?? state.composerDraft ?? "");
}

function persistQuotaSendDraftFromSheet() {
  const text = readQuotaSendSheetText();
  state.composerDraft = text;
  rememberComposerDraft(text);
  if (state.sheet?.type === "confirmQuotaSend") state.sheet = { ...state.sheet, text };
  return text;
}

function editQuotaSend() {
  if (state.sheetBusy) return;
  const text = persistQuotaSendDraftFromSheet();
  state.sheet = null;
  state.sheetBusy = false;
  fillComposerDraft(text, { mobile: true });
}

function confirmQuotaSend() {
  if (state.sheetBusy) return;
  const text = readQuotaSendSheetText().trim();
  if (!text) {
    state.sheet = { ...(state.sheet || {}), type: "confirmQuotaSend", text: "", error: "请输入内容后再发送" };
    render();
    requestAnimationFrame(() => document.getElementById("quota-send-input")?.focus({ preventScroll: true }));
    return;
  }
  state.quotaSendOverride = true;
  state.composerDraft = text;
  rememberComposerDraft(text);
  state.sheet = null;
  render();
  const input = document.getElementById("composer-input");
  if (input) {
    input.value = text;
    resizeComposer(input);
    syncComposerSendState(input);
  }
  document.getElementById("composer-form")?.requestSubmit();
}

function viewArchivedFromSheet() {
  const payload = state.justArchivedSession || state.sheet?.payload || null;
  state.sheet = null;
  state.sheetBusy = false;
  state.sessionView = "archived";
  state.sessionQuery = "";
  if (isMobileViewport()) state.mobileDrawerOpen = true;
  render();
  requestAnimationFrame(() => {
    const selector = payload?.id ? `[data-restore-session-id="${CSS.escape(payload.id)}"]` : "#session-search";
    document.querySelector(selector)?.focus?.({ preventScroll: true });
  });
}

async function confirmRiskModeSettings() {
  if (state.sheetBusy) return;
  const nextSettings = state.sheet?.settings || readSettingsFormValues();
  state.sheetBusy = true;
  state.sheet = { ...(state.sheet || {}), type: "confirmRiskMode", settings: nextSettings };
  render();
  await saveSettings(nextSettings, { confirmedRiskMode: true });
}

function renderDetailSection(label, value, mode = "text") {
  if (value === null || value === undefined || value === "") return "";
  const content = displaySafeText(typeof value === "string" ? value : formatValue(value));
  const className = mode === "pre" ? "tool-detail-section pre-section" : "tool-detail-section";
  return `
    <section class="${className}">
      <h4>${escapeHtml(label)}</h4>
      ${mode === "pre" ? `<pre>${escapeHtml(content)}</pre>` : `<p>${escapeHtml(content)}</p>`}
    </section>
  `;
}

function renderFileToolSummary(detail, type) {
  const summary = fileChangeLabel(detail, type);
  const verification = detail.verification?.label || "";
  return `${summary ? renderDetailSection("摘要", summary) : ""}${renderFileVerification(detail)}`;
}

function renderFileVerification(detail) {
  const verification = detail?.verification?.label || "";
  return verification ? renderDetailSection("核验", verification) : "";
}

function fileReadSummary(detail) {
  const file = displayPath(detail.filePath || "");
  const verification = detail.verification?.label || "";
  return [file, verification].filter(Boolean).join(" · ");
}

function fileToolSummary(detail, type = detail?.type) {
  if (!detail) return "";
  if (type === "read") return fileReadSummary(detail);
  if (type !== "write" && type !== "edit") return "";
  if (isClaudePlanPath(detail.filePath)) return "";
  const file = displayPath(detail.filePath || "");
  const change = fileChangeLabel(detail, type);
  const verification = detail.verification?.label || "";
  return [file, change, verification].filter(Boolean).join(" · ");
}

function isPlanTool(item, detail) {
  const name = String(item?.name || item?.displayName || "").toLowerCase();
  return detail?.type === "plan" || name.includes("exitplan") || isClaudePlanPath(detail?.filePath);
}

function isClaudePlanPath(value) {
  return /(^|\/)\.claude\/plans\/[^/]+\.md$/i.test(String(value || ""));
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

function diffStrings(oldString = "", newString = "") {
  if (!oldString && !newString) return "";
  return `- ${oldString || ""}\n+ ${newString || ""}`;
}

function renderComposer() {
  const disabled = !state.config?.claude?.available;
  const quota = !disabled && activeQuotaIssue();
  const sessionRunning = state.activeSession?.status === "running";
  const composerEmpty = !state.composerDraft.trim();
  const sendDisabled = disabled || sessionRunning || composerEmpty;
  const placeholder = disabled
    ? "本机助手暂未连接，请先检查设置"
    : quota
      ? "Claude 账号需处理，恢复后可继续发送"
    : `发消息给 ${BRAND_NAME}`;
  return `
    <div class="composer-wrap">
      ${
        disabled
          ? `<div class="connection-inline">
              <span>${icon("wrench")}</span>
              <div>
                <strong>本机助手未连接</strong>
                <p>检查本机助手路径后即可继续对话。</p>
              </div>
              <button type="button" id="composer-settings-button">检查设置</button>
            </div>`
          : ""
      }
      ${
        quota
          ? `<div class="connection-inline quota-inline">
              <span>${icon("wrench")}</span>
              <div>
                <strong>Claude 账号待恢复</strong>
                <p>${
                  state.activeSession
                    ? "草稿会自动保留。先检查账号状态，恢复后再发送。"
                    : "最近一次真实请求因额度不足中断，处理后可继续对话。"
                }</p>
              </div>
              <button type="button" id="composer-quota-button">查看状态</button>
            </div>`
          : ""
      }
      ${state.composerError ? `<div class="composer-error">${escapeHtml(state.composerError)}</div>` : ""}
      <form class="composer" id="composer-form">
        <textarea id="composer-input" rows="1" placeholder="${escapeAttr(placeholder)}" ${
          disabled || sessionRunning ? "disabled" : ""
        }>${escapeHtml(state.composerDraft)}</textarea>
        <div class="composer-footer">
          <div class="composer-meta">
            <span class="composer-engine-pill">${icon("terminalSmall")}<span>Claude Code</span></span>
          </div>
          <button class="primary-button send-button ${quota ? "quota-send-button" : ""}" type="submit" ${
            sendDisabled ? "disabled" : ""
          } aria-label="${escapeAttr(sessionRunning ? "运行中" : quota ? "处理 Claude 账号额度" : "发送消息")}" aria-disabled="${
            sendDisabled ? "true" : "false"
          }" data-tooltip="${escapeAttr(sessionRunning ? "运行中" : quota ? "处理 Claude 账号额度" : "发送消息")}">
            ${sessionRunning ? "运行中" : quota ? `处理额度 ${icon("wrench")}` : `发送 ${icon("arrowUp")}`}
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderScrollButton() {
  const hasMessages = Boolean(state.activeSession?.messages?.length);
  const visible = Boolean(hasMessages && state.showScrollButton && !latestTurnHasRecoveryActions(state.activeSession));
  return `
    <button type="button" class="scroll-bottom ${visible ? "visible" : ""}" id="scroll-bottom-button" aria-hidden="${
      visible ? "false" : "true"
    }" aria-label="回到底部" tabindex="${visible ? "0" : "-1"}">
      ${visible ? `${icon("arrowDown")}<span>回到底部</span>` : ""}
    </button>
  `;
}

function latestTurnHasRecoveryActions(session) {
  if (!session?.messages?.length || session.status === "running") return false;
  const latest = buildTurns(session.messages).at(-1);
  const assistant = [...(latest?.items || [])].reverse().find((item) => item.type === "assistant");
  return assistant?.status === "error" || assistant?.status === "canceled";
}

function renderSettingsModal() {
  const settings = state.pendingSettings || state.config?.settings || {};
  const claude = state.config?.claude || {};
  const connected = Boolean(claude.available);
  const connectionState = settingsConnectionState(claude, connected);
  const checking = state.settingsCheckBusy;
  const busy = state.settingsBusy || state.logoutBusy || checking;
  const disabled = busy ? "disabled" : "";
  const saveDirty = settingsChanged(settings);
  const saveDisabled = busy || !saveDirty;
  const avatar = escapeHtml(state.user.username.slice(0, 1).toUpperCase());
  const workspaceLabel = displayPath(state.user.homeDir);
  const connectionDetail = claudeConnectionDetail(claude, connected);
  const settingsNotice = state.settingsNotice || connectionState.notice;
  const props = {
    settings,
    claude,
    connected,
    connectionState,
    checking,
    busy,
    disabled,
    avatar,
    workspaceLabel,
    connectionDetail,
    settingsNotice,
    saveDirty,
    saveDisabled,
  };
  if (isMobileViewport()) return renderMobileSettingsModal(props);
  const sheetBlockingSettings = Boolean(state.sheet);
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <form class="modal settings-modal ${busy ? "busy" : ""} ${
        sheetBlockingSettings ? "sheet-blocked" : ""
      }" id="settings-form" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-busy="${
        busy ? "true" : "false"
      }" ${sheetBlockingSettings ? 'inert aria-hidden="true"' : ""}>
        <div class="mobile-modal-handle" aria-hidden="true"></div>
        <div class="modal-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p class="settings-title-sub">账号、工作方式与本机连接</p>
          </div>
          <button type="button" class="icon-button" id="close-settings" aria-label="关闭" data-tooltip="关闭" ${disabled}>${icon("x")}</button>
        </div>
        <div class="modal-body">
          <section class="settings-overview ${escapeAttr(connectionState.tone)}">
            <span class="settings-avatar">${avatar}</span>
            <div>
              <h3>${escapeHtml(state.user.username)}</h3>
              <p>${escapeHtml(workspaceLabel)}</p>
            </div>
            <div class="settings-connection-actions">
              <strong class="settings-status-pill">${escapeHtml(connectionState.statusText)}</strong>
              <button type="button" class="settings-check-button" id="settings-check-button" ${disabled} aria-label="${
                checking ? "正在检测本机助手" : "检测本机助手连接"
              }">
                ${checking ? `<span class="button-spinner subtle"></span><span>检测中</span>` : `${icon("refresh")}<span>检测连接</span>`}
              </button>
            </div>
            <div id="settings-notice" class="settings-notice" aria-live="polite">${
              settingsNotice
                ? `${icon(connectionState.icon)}<span>${escapeHtml(settingsNotice)}</span>`
                : ""
            }</div>
          </section>
          ${renderClaudeDiagnosticCard(claude, connected, busy)}
          <section class="settings-card">
            <div class="settings-section-head">
              <h3>账号与数据</h3>
              <span>本机</span>
            </div>
            <div class="settings-list">
              <div><span>当前账号</span><strong>${escapeHtml(state.user.username)}</strong></div>
              <div><span>工作区</span><strong>${escapeHtml(workspaceLabel)}</strong></div>
              <div><span>会话</span><strong>保存在这台机器</strong></div>
            </div>
          </section>
          <section class="settings-card">
            <div class="settings-section-head">
              <h3>工作方式</h3>
              <span>${escapeHtml(modeLabel(settings.defaultMode || "plan"))}</span>
            </div>
            <div class="mode-card-list">
              ${renderModeCards(settings.defaultMode || "plan", busy)}
            </div>
          </section>
          <button type="button" class="advanced-toggle" id="advanced-toggle" ${disabled}>
            <span>连接与模型</span>
            <em>${state.settingsAdvanced ? "收起" : "展开"}</em>
          </button>
          <div class="advanced-settings ${state.settingsAdvanced ? "open" : ""}">
            <div class="field">
              <label for="claudePath">本机助手路径</label>
              <input id="claudePath" name="claudePath" value="${escapeAttr(settings.claudePath || "claude")}" ${disabled} />
            </div>
            <div class="field">
              <label for="defaultModel">指定模型，可留空</label>
              <input id="defaultModel" name="defaultModel" value="${escapeAttr(settings.defaultModel || "")}" placeholder="可选，留空使用默认模型" ${disabled} />
            </div>
            <div class="field">
              <label for="maxTurns">单次最大步骤数，可留空</label>
              <input id="maxTurns" name="maxTurns" value="${escapeAttr(settings.maxTurns || "")}" placeholder="例如 8" ${disabled} />
            </div>
            <input type="hidden" id="appendSystemPrompt" name="appendSystemPrompt" value="${escapeAttr(
              settings.appendSystemPrompt || "",
            )}" />
            <div class="settings-meta settings-secret-row">
              <span>开发者指令</span>
              <strong>${settings.appendSystemPrompt ? "已由系统配置" : "未启用"}</strong>
            </div>
            <div class="settings-meta">
              <span>连接详情</span>
              <strong>${escapeHtml(connectionDetail)}</strong>
            </div>
          </div>
          <div id="settings-error" class="inline-error settings-error" aria-live="polite">${
            state.settingsError
              ? `${icon("wrench")}<span>${escapeHtml(state.settingsError)}</span>`
              : ""
          }</div>
          ${
            state.settingsBusy || checking
              ? `<div class="settings-progress" role="status" aria-live="polite">
                  <span class="auth-progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  <strong>${state.settingsBusy ? "正在保存设置" : "正在检测本机助手"}</strong>
                  <em>${
                    state.settingsBusy
                      ? "正在检查本机助手状态，完成后会自动回到对话。"
                      : "会自动更新连接状态，不会保存当前配置。"
                  }</em>
                </div>`
              : ""
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="ghost-button" id="logout-button" ${busy ? "disabled" : ""}>
            ${state.logoutBusy ? `<span class="button-spinner subtle"></span>退出中` : "退出登录"}
          </button>
          <button type="submit" class="primary-button settings-save-button ${saveDirty ? "" : "idle"}" id="settings-save-button" ${
            saveDisabled ? "disabled" : ""
          } aria-disabled="${saveDisabled ? "true" : "false"}">
            ${state.settingsBusy ? `<span class="button-spinner"></span>保存中` : saveDirty ? "保存设置" : "已保存"}
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderMobileSettingsModal(props) {
  const panel = state.mobileSettingsPanel || "home";
  const title = mobileSettingsPanelTitle(panel);
  const riskConfirming = state.sheet?.type === "confirmRiskMode";
  const sheetBlockingSettings = Boolean(state.sheet);
  const body =
    panel === "account"
      ? renderMobileAccountPanel(props)
      : panel === "claude"
        ? renderMobileClaudePanel(props)
        : panel === "mode"
          ? renderMobileModePanel(props)
          : panel === "diagnostics"
            ? renderMobileDiagnosticsPanel(props)
            : renderMobileSettingsHome(props);
  return `
    <div class="modal-backdrop mobile-settings-backdrop" id="modal-backdrop">
      <form class="modal settings-modal mobile-settings-modal ${props.busy ? "busy" : ""} ${
        riskConfirming ? "risk-confirming" : ""
      } ${sheetBlockingSettings ? "sheet-blocked" : ""}" id="settings-form" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-busy="${
        props.busy ? "true" : "false"
      }" ${sheetBlockingSettings ? 'inert aria-hidden="true"' : ""}>
        <div class="mobile-modal-handle" aria-hidden="true"></div>
        <div class="modal-header mobile-settings-header">
          ${
            panel === "home"
              ? `<span class="mobile-settings-header-spacer" aria-hidden="true"></span>`
              : `<button type="button" class="icon-button mobile-settings-back" data-mobile-settings-panel="home" aria-label="返回" data-tooltip="返回" ${props.disabled}>${icon("chevronRight")}</button>`
          }
          <div>
            <h2 id="settings-title">${escapeHtml(title)}</h2>
            <p class="settings-title-sub">${panel === "home" ? "账号、Claude 与工作偏好" : mobileSettingsPanelSubtitle(panel)}</p>
          </div>
          <button type="button" class="icon-button" id="close-settings" aria-label="关闭" data-tooltip="关闭" ${props.disabled}>${icon("x")}</button>
        </div>
        <div class="modal-body mobile-settings-body">
          ${body}
          ${renderMobileSettingsFeedback(props)}
        </div>
        <div class="modal-footer mobile-settings-footer">
          <button type="button" class="ghost-button" id="logout-button" ${props.busy ? "disabled" : ""}>
            ${state.logoutBusy ? `<span class="button-spinner subtle"></span>退出中` : "退出登录"}
          </button>
          <button type="submit" class="primary-button settings-save-button ${props.saveDirty ? "" : "idle"}" id="settings-save-button" ${
            props.saveDisabled ? "disabled" : ""
          } aria-disabled="${props.saveDisabled ? "true" : "false"}">
            ${state.settingsBusy ? `<span class="button-spinner"></span>保存中` : props.saveDirty ? "保存" : "已保存"}
          </button>
        </div>
      </form>
    </div>
  `;
}

function mobileSettingsPanelTitle(panel) {
  const titles = {
    home: "设置",
    account: "账号与数据",
    claude: "Claude 状态",
    mode: "工作方式",
    diagnostics: "连接诊断",
  };
  return titles[panel] || titles.home;
}

function mobileSettingsPanelSubtitle(panel) {
  const subtitles = {
    account: "查看账号、工作区与本机保存",
    claude: "区分本机安装与账号状态",
    mode: "选择默认回复与工具执行方式",
    diagnostics: "仅在需要排查时使用",
  };
  return subtitles[panel] || "";
}

function renderMobileSettingsHome(props) {
  const { settings, claude, connected, connectionState, workspaceLabel, settingsNotice, checking, disabled } = props;
  const quota = visibleQuotaIssue(connected);
  return `
    ${renderSettingsHiddenFields(settings)}
    <section class="mobile-settings-identity ${escapeAttr(connectionState.tone)}">
      <span class="settings-avatar">${props.avatar}</span>
      <div>
        <strong>${escapeHtml(state.user.username)}</strong>
        <em>${escapeHtml(workspaceLabel)}</em>
      </div>
      <span>${escapeHtml(connectionState.statusText)}</span>
    </section>
    ${
      settingsNotice
        ? `<div class="mobile-settings-notice ${escapeAttr(connectionState.tone)}">${icon(connectionState.icon)}<span>${escapeHtml(
            settingsNotice,
          )}</span></div>`
        : ""
    }
    <div class="mobile-settings-home-actions ${quota ? "quota" : ""}">
      <button type="button" class="settings-check-button" id="settings-check-button" ${disabled}>
        ${checking ? `<span class="button-spinner subtle"></span><span>检测中</span>` : `${icon("refresh")}<span>${quota ? "重新检测账号" : "检测 Claude"}</span>`}
      </button>
      <button type="button" class="ghost-button mobile-secondary-action" data-mobile-settings-panel="claude" ${disabled}>
        ${icon(quota ? "wrench" : "shield")}<span>${quota ? "处理额度" : "查看状态"}</span>
      </button>
    </div>
    <div class="mobile-settings-menu">
      ${renderMobileSettingsEntry({
        panel: "account",
        iconName: "user",
        title: "账号与数据",
        detail: "账号信息、工作区与本机会话",
        badge: "本机保存",
      })}
      ${renderMobileSettingsEntry({
        panel: "claude",
        iconName: quota || !connected ? "wrench" : "shield",
        title: "Claude 状态",
        detail: connected
          ? quota
            ? "Claude Code 已安装 · 账号额度需处理"
            : "Claude Code 已安装 · 账号待验证"
          : "未检测到 Claude Code",
        badge: quota ? "额度需处理" : connected ? "可连接" : "未连接",
        tone: quota ? "quota" : connected ? "ok" : "warn",
      })}
      ${renderMobileSettingsEntry({
        panel: "mode",
        iconName: "sliders",
        title: "工作方式",
        detail: "默认使用「" + modeLabel(settings.defaultMode || "plan") + "」",
        badge: modeLabel(settings.defaultMode || "plan"),
      })}
      ${renderMobileSettingsEntry({
        panel: "diagnostics",
        iconName: "terminalSmall",
        title: "连接诊断",
        detail: "路径、模型和诊断信息",
        badge: "高级",
      })}
    </div>
  `;
}

function renderMobileSettingsEntry({ panel, iconName, title, detail, badge, tone = "", extra = "" }) {
  return `
    <button type="button" class="mobile-settings-entry ${escapeAttr(tone)}" data-mobile-settings-panel="${escapeAttr(panel)}">
      <span class="mobile-settings-entry-icon">${icon(iconName)}</span>
      <span class="mobile-settings-entry-copy">
        <strong>${escapeHtml(title)}</strong>
        <em>${escapeHtml(detail)}</em>
        ${extra || ""}
      </span>
      ${badge ? `<small>${escapeHtml(badge)}</small>` : ""}
      <span class="mobile-settings-entry-chevron">${icon("chevronRight")}</span>
    </button>
  `;
}

function renderMobileAccountPanel({ settings, workspaceLabel }) {
  return `
    ${renderSettingsHiddenFields(settings)}
    <section class="mobile-settings-card">
      <div class="mobile-account-hero">
        <span class="settings-avatar">${escapeHtml(state.user.username.slice(0, 1).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(state.user.username)}</strong>
          <em>当前登录账号</em>
        </div>
      </div>
      <div class="settings-list mobile-detail-list">
        <div><span>工作区</span><strong>${escapeHtml(workspaceLabel)}</strong></div>
        <div><span>会话</span><strong>保存在这台机器</strong></div>
        <div><span>数据位置</span><strong>账号独立文件夹</strong></div>
      </div>
    </section>
  `;
}

function renderMobileClaudePanel({ settings, claude, connected, connectionState, checking, disabled, settingsNotice }) {
  const quota = visibleQuotaIssue(connected);
  return `
    ${renderSettingsHiddenFields(settings)}
    <section class="mobile-settings-card mobile-claude-panel ${escapeAttr(connectionState.tone)}">
      <div class="mobile-panel-head">
        <span>${icon(quota || !connected ? "wrench" : "shield")}</span>
        <div>
          <strong>${quota ? "账号额度需处理" : connected ? "Claude Code 已安装" : "未找到 Claude Code"}</strong>
          <em>${quota ? "处理后可回到对话重新发送" : connected ? "账号额度会在真实请求时验证" : "检查本机命令路径后再使用"}</em>
        </div>
      </div>
      ${renderMobileClaudeRows(claude, connected, false)}
      ${
        settingsNotice
          ? `<div class="mobile-settings-notice ${escapeAttr(connectionState.tone)}">${icon(connectionState.icon)}<span>${escapeHtml(
              settingsNotice,
            )}</span></div>`
          : ""
      }
      <div class="mobile-panel-actions">
        <button type="button" class="settings-check-button" id="settings-check-button" ${disabled}>
          ${checking ? `<span class="button-spinner subtle"></span><span>检测中</span>` : `${icon("refresh")}<span>重新检测</span>`}
        </button>
        <button type="button" class="ghost-button mobile-secondary-action" data-mobile-settings-panel="diagnostics" ${disabled}>
          ${icon("terminalSmall")}<span>查看诊断</span>
        </button>
      </div>
    </section>
  `;
}

function renderMobileClaudeRows(claude, connected, compact = false) {
  const quota = visibleQuotaIssue(connected);
  const version = String(claude?.version || "").trim();
  const accountClass = !connected ? "muted" : quota ? "quota" : "muted";
  const accountTitle = !connected
    ? compact
      ? "账号未验证"
      : "账号状态未验证"
    : compact
      ? quota
        ? "额度需处理"
        : "账号待验证"
      : quota
        ? "账号额度需处理"
        : "账号状态待验证";
  const accountDetail = !connected
    ? "先连接 Claude Code 后验证账号"
    : quota
      ? "最近一次真实请求返回额度不足"
      : "发送真实消息时确认账号额度";
  const accountSmall = !connected ? "待连接" : quota ? "去处理" : "待验证";
  return `
    <div class="mobile-claude-rows ${compact ? "compact" : ""}">
      <div class="${connected ? "ok" : "warn"}">
        <span></span>
        <strong>${compact ? (connected ? "本机已安装" : "本机未连接") : `Claude Code ${connected ? "已安装" : "未连接"}`}</strong>
        ${compact ? "" : `<em>${escapeHtml(connected ? version || "已检测到本机命令" : "设置路径后重新检测")}</em>`}
        <small>${connected ? "正常" : "处理"}</small>
      </div>
      <div class="${accountClass}">
        <span></span>
        <strong>${escapeHtml(accountTitle)}</strong>
        ${compact ? "" : `<em>${escapeHtml(accountDetail)}</em>`}
        <small>${escapeHtml(accountSmall)}</small>
      </div>
    </div>
  `;
}

function renderMobileModePanel({ settings, busy }) {
  return `
    ${renderSettingsHiddenFields(settings, { skipDefaultMode: true })}
    <section class="mobile-settings-card">
      <div class="mobile-panel-head">
        <span>${icon("sliders")}</span>
        <div>
          <strong>默认工作方式</strong>
          <em>影响新对话中 Claude Code 的工具执行风格</em>
        </div>
      </div>
      <div class="mode-card-list mobile-mode-card-list">
        ${renderModeCards(settings.defaultMode || "plan", busy)}
      </div>
    </section>
  `;
}

function renderMobileDiagnosticsPanel({ settings, claude, connected, checking, disabled, connectionDetail }) {
  const version = String(claude?.version || "").trim() || "Claude Code";
  const quota = visibleQuotaIssue(connected);
  const recentFailure = quota ? latestQuotaFailureText() : "";
  return `
    ${renderSettingsHiddenFields(settings, { skipAdvanced: true })}
    <section class="mobile-settings-card mobile-diagnostics-card">
      <div class="mobile-panel-head">
        <span>${icon("terminalSmall")}</span>
        <div>
          <strong>连接诊断</strong>
          <em>这些选项只在排查本机连接时需要</em>
        </div>
      </div>
      <div class="field">
        <label for="claudePath">本机助手路径</label>
        <input id="claudePath" name="claudePath" value="${escapeAttr(settings.claudePath || "claude")}" ${disabled} />
      </div>
      <div class="field">
        <label for="defaultModel">指定模型，可留空</label>
        <input id="defaultModel" name="defaultModel" value="${escapeAttr(settings.defaultModel || "")}" placeholder="可选，留空使用默认模型" ${disabled} />
      </div>
      <div class="field">
        <label for="maxTurns">单次最大步骤数，可留空</label>
        <input id="maxTurns" name="maxTurns" value="${escapeAttr(settings.maxTurns || "")}" placeholder="例如 8" ${disabled} />
      </div>
      <input type="hidden" id="appendSystemPrompt" name="appendSystemPrompt" value="${escapeAttr(
        settings.appendSystemPrompt || "",
      )}" />
      <div class="diagnostic-list mobile-diagnostic-list">
        <div><span>Claude Code</span><strong>${escapeHtml(connected ? version : "未找到")}</strong></div>
        <div><span>账号状态</span><strong>${escapeHtml(visibleQuotaIssue(connected) ? "额度不足" : connected ? "发送消息时验证" : "未连接")}</strong></div>
        <div><span>连接详情</span><strong>${escapeHtml(connectionDetail)}</strong></div>
        ${recentFailure ? `<div class="diagnostic-failure"><span>最近失败</span><strong>${escapeHtml(recentFailure)}</strong></div>` : ""}
      </div>
      <div class="mobile-panel-actions">
        <button type="button" class="settings-check-button" id="settings-check-button" ${disabled}>
          ${checking ? `<span class="button-spinner subtle"></span><span>检测中</span>` : `${icon("refresh")}<span>检测连接</span>`}
        </button>
        <button type="button" class="diagnostic-copy-button" id="copy-diagnostics-button" ${disabled}>
          ${icon("copy")}<span>复制诊断</span>
        </button>
      </div>
    </section>
  `;
}

function renderSettingsHiddenFields(settings, options = {}) {
  const skipDefaultMode = options.skipDefaultMode === true;
  const skipAdvanced = options.skipAdvanced === true;
  return `
    ${skipDefaultMode ? "" : `<input type="hidden" name="defaultMode" value="${escapeAttr(settings.defaultMode || "plan")}" />`}
    ${
      skipAdvanced
        ? ""
        : `<input type="hidden" name="claudePath" value="${escapeAttr(settings.claudePath || "claude")}" />
           <input type="hidden" name="defaultModel" value="${escapeAttr(settings.defaultModel || "")}" />
           <input type="hidden" name="maxTurns" value="${escapeAttr(settings.maxTurns || "")}" />
           <input type="hidden" name="appendSystemPrompt" value="${escapeAttr(settings.appendSystemPrompt || "")}" />`
    }
  `;
}

function normalizedSettingsForCompare(value = {}) {
  return Object.fromEntries(
    Object.entries(SETTINGS_COMPARE_FIELDS).map(([key, fallback]) => {
      const next = String(value?.[key] ?? "").trim();
      return [key, next || fallback];
    }),
  );
}

function settingsChanged(nextSettings = {}) {
  const current = normalizedSettingsForCompare(state.config?.settings || {});
  const next = normalizedSettingsForCompare(nextSettings);
  return Object.keys(SETTINGS_COMPARE_FIELDS).some((key) => current[key] !== next[key]);
}

function settingsFormDirty() {
  const form = document.getElementById("settings-form");
  if (!form) return false;
  return settingsChanged(Object.fromEntries(new FormData(form).entries()));
}

function settingsSaveLabel(dirty) {
  return isMobileViewport() ? (dirty ? "保存" : "已保存") : dirty ? "保存设置" : "已保存";
}

function updateSettingsSaveState() {
  if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
  const button = document.getElementById("settings-save-button");
  if (!button) return;
  const dirty = settingsFormDirty();
  button.disabled = !dirty;
  button.setAttribute("aria-disabled", dirty ? "false" : "true");
  button.classList.toggle("idle", !dirty);
  button.textContent = settingsSaveLabel(dirty);
}

function renderMobileSettingsFeedback({ checking }) {
  return `
    <div id="settings-error" class="inline-error settings-error" aria-live="polite">${
      state.settingsError ? `${icon("wrench")}<span>${escapeHtml(state.settingsError)}</span>` : ""
    }</div>
    ${
      state.settingsBusy || checking
        ? `<div class="settings-progress" role="status" aria-live="polite">
            <span class="auth-progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <strong>${state.settingsBusy ? "正在保存设置" : "正在检测 Claude Code"}</strong>
            <em>${state.settingsBusy ? "保存后会回到对话。" : "检测完成后会更新当前状态。"}</em>
          </div>`
        : ""
    }
  `;
}

function settingsConnectionState(claude, connected) {
  if (!connected) {
    return {
      tone: "warn",
      statusText: "本机助手未连接",
      notice: "",
      icon: "wrench",
    };
  }
  if (visibleQuotaIssue(connected)) {
    return {
      tone: "quota",
      statusText: "账号需处理",
      notice: "Claude Code 已安装，但最近一次请求因账号额度不足中断。",
      icon: "wrench",
    };
  }
  return {
    tone: "ok",
    statusText: "本机助手在线",
    notice: "",
    icon: "check",
  };
}

function activeQuotaIssue() {
  return Boolean(quotaIssueSourceSession());
}

function visibleQuotaIssue(connected = Boolean(state.config?.claude?.available)) {
  return Boolean(connected && activeQuotaIssue());
}

function quotaIssueSourceSession() {
  const session = state.activeSession;
  if (sessionHasQuotaIssue(session)) return session;
  // 只根据当前会话判断额度问题，避免历史 DeepSeek 402 误伤全局 UI。
  return null;
}

function sessionHasQuotaIssue(session) {
  if (!session || session.status !== "error") return false;
  if (isQuotaErrorText(session.lastError) || isQuotaErrorText(session.preview)) return true;
  const latestErrorItem = [...(session.messages || [])]
    .reverse()
    .find((item) => item?.type === "assistant" || item?.type === "error");
  return isQuotaErrorText(latestErrorItem?.text || latestErrorItem?.message || "");
}

function claudeConnectionDetail(claude, connected) {
  if (!connected) return "未找到本机助手";
  const version = String(claude?.version || "").trim();
  if (visibleQuotaIssue(connected)) return version ? `${version} · 账号额度不足` : "Claude Code · 账号额度不足";
  return version ? `${version} · 已连接` : "Claude Code · 已连接";
}

function renderClaudeDiagnosticCard(claude, connected, busy = false) {
  const quota = visibleQuotaIssue(connected);
  const version = String(claude?.version || "").trim() || "Claude Code";
  const accountState = quota ? "额度不足" : connected ? "待真实请求验证" : "未连接";
  const recentFailure = quota ? latestQuotaFailureText() : "";
  const expanded = state.settingsDiagnosticsOpen;
  const statusLabel = quota ? "需要处理" : connected ? "本机可用" : "未连接";
  const summaryTitle = quota ? "账号额度需要处理" : connected ? "Claude Code 已连接" : "未找到 Claude Code";
  const summaryText = quota
    ? "最近一次请求因账号额度不足中断，恢复后可继续使用。"
    : connected
      ? "连接正常，账号额度会在真实请求时验证。"
      : "检查本机 Claude Code 路径后再使用。";
  const disabled = busy ? "disabled" : "";
  return `
    <section class="settings-card claude-diagnostic-card ${quota ? "quota" : ""} ${expanded ? "expanded" : ""}">
      <div class="settings-section-head">
        <h3>Claude 状态</h3>
        <span>${escapeHtml(statusLabel)}</span>
      </div>
      <div class="diagnostic-summary">
        <span class="diagnostic-summary-icon">${icon(quota || !connected ? "wrench" : "check")}</span>
        <div>
          <strong>${escapeHtml(summaryTitle)}</strong>
          <em>${escapeHtml(summaryText)}</em>
        </div>
      </div>
      <div class="diagnostic-actions">
        <button type="button" class="diagnostic-toggle-button" id="diagnostic-toggle-button" aria-expanded="${expanded ? "true" : "false"}" ${disabled}>
          <span>${expanded ? "收起诊断" : "查看诊断"}</span>${icon("chevron")}
        </button>
        ${
          expanded
            ? `<button type="button" class="diagnostic-copy-button" id="copy-diagnostics-button" ${disabled}>${icon("copy")}<span>复制诊断</span></button>`
            : ""
        }
      </div>
      ${
        expanded
          ? `<div class="diagnostic-list">
              <div><span>Claude Code</span><strong>${escapeHtml(connected ? version : "未找到")}</strong></div>
              <div><span>账号状态</span><strong>${escapeHtml(accountState)}</strong></div>
              <div><span>工具执行</span><strong>${escapeHtml(!connected ? "本机连接后可用" : quota ? "额度恢复前不会启动" : "由 Claude 请求触发")}</strong></div>
              ${
                recentFailure
                  ? `<div class="diagnostic-failure"><span>最近失败</span><strong>${escapeHtml(recentFailure)}</strong></div>`
                  : ""
              }
            </div>`
          : ""
      }
    </section>
  `;
}

function latestQuotaFailureText() {
  const session = quotaIssueSourceSession();
  if (!session) return "";
  const latestErrorItem = [...(session.messages || [])]
    .reverse()
    .find((item) => item?.type === "assistant" || item?.type === "error");
  return userFacingError(session.lastError || latestErrorItem?.text || latestErrorItem?.message || "");
}

function bindShellEvents() {
  document.getElementById("new-chat-button")?.addEventListener("click", newChat);
  document.getElementById("mobile-new-chat-button")?.addEventListener("click", newChat);
  document.getElementById("mobile-menu-button")?.addEventListener("click", () => {
    state.mobileDrawerOpen = true;
    render();
  });
  document.getElementById("mobile-drawer-backdrop")?.addEventListener("click", closeMobileDrawer);
  document.getElementById("mobile-drawer-close")?.addEventListener("click", closeMobileDrawer);
  document.getElementById("mobile-settings-button")?.addEventListener("click", () => {
    openSettings({ closeMobile: true, restoreMobileDrawer: true, returnFocus: "#mobile-session-search" });
  });
  document.getElementById("conversation-menu-button")?.addEventListener("click", () => {
    if (isMobileViewport()) {
      openSessionSheet();
    } else {
      if (state.refreshBusy) return;
      state.sessionMenuOpen = !state.sessionMenuOpen;
      render();
    }
  });
  document.getElementById("refresh-button")?.addEventListener("click", refreshAuthedState);
  document.getElementById("settings-button")?.addEventListener("click", () => {
    openSettings({ returnFocus: "#settings-button" });
  });
  document.getElementById("settings-shortcut")?.addEventListener("click", () => {
    openSettings({ returnFocus: "#conversation-menu-button" });
  });
  document.getElementById("composer-settings-button")?.addEventListener("click", () => {
    openSettings({ advanced: true, returnFocus: "#composer-settings-button" });
  });
  document.getElementById("composer-quota-button")?.addEventListener("click", () => {
    openSettings({ diagnostics: true, returnFocus: "#composer-quota-button" });
  });
  document.querySelectorAll("[data-welcome-action]").forEach((button) => {
    button.addEventListener("click", () => handleWelcomeAction(button.dataset.welcomeAction));
  });
  document.getElementById("session-search")?.addEventListener("input", handleSessionSearchInput);
  document.getElementById("mobile-session-search")?.addEventListener("input", handleSessionSearchInput);
  document.querySelectorAll("[data-session-view]").forEach((button) => {
    button.addEventListener("click", () => switchSessionView(button.dataset.sessionView));
  });
  document.querySelectorAll("[data-toast-action]").forEach((button) => {
    button.addEventListener("click", () => handleToastAction(button.dataset.toastAction));
  });
  bindSessionListEvents();
  document.querySelectorAll(".quick-prompt").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.config?.claude?.available || state.activeSession?.status === "running") return;
      await ensureActiveSession();
      state.composerDraft = button.dataset.prompt || "";
      rememberComposerDraft();
      render();
      const input = document.getElementById("composer-input");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        resizeComposer(input);
      }
      showToast("已填入，可编辑后发送");
      requestAnimationFrame(() => {
        const focusedInput = document.getElementById("composer-input");
        if (!focusedInput) return;
        focusedInput.focus();
        focusedInput.setSelectionRange(focusedInput.value.length, focusedInput.value.length);
      });
    });
  });
  document.querySelectorAll(".tool-badge-toggle[data-tool-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.toolId;
      if (!id) return;
      const keepBottom = isChatNearBottom();
      if (state.expandedToolIds.has(id)) state.expandedToolIds.delete(id);
      else state.expandedToolIds.add(id);
      state.forceScrollBottom = keepBottom;
      state.focusToolId = id;
      render();
      requestAnimationFrame(() => keepExpandedToolVisible(id));
      window.setTimeout(() => keepExpandedToolVisible(id), 80);
    });
  });
  document.querySelectorAll("[data-copy-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findTimelineItem(button.dataset.copyId);
      if (!item?.text) return;
      const scrollSnapshot = captureChatScroll();
      const expandedToolIds = [...state.expandedToolIds];
      const copied = await copyText(copyTextForItem(item));
      if (copied) setCopyFeedback(copyFeedbackKey("message", item.id));
      restoreCapturedChatScroll(scrollSnapshot);
      expandedToolIds.forEach((id) => {
        requestAnimationFrame(() => keepExpandedToolVisible(id));
        window.setTimeout(() => keepExpandedToolVisible(id), 160);
      });
    });
  });
  document.querySelectorAll("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest(".markdown-code-block")?.querySelector("code")?.innerText || "";
      if (!code) return;
      const scrollSnapshot = captureChatScroll();
      const copied = await copyText(code);
      if (copied) setCopyFeedback(button.dataset.copyCode || copyFeedbackKey("code", code));
      restoreCapturedChatScroll(scrollSnapshot);
    });
  });
  document.querySelectorAll("[data-recovery-action]").forEach((button) => {
    button.addEventListener("click", () =>
      handleRecoveryAction(button.dataset.recoveryAction, button.dataset.recoveryUserId),
    );
  });
  document.getElementById("composer-form")?.addEventListener("submit", sendComposer);
  document.getElementById("scroll-bottom-button")?.addEventListener("click", () => {
    state.showScrollButton = false;
    applyScrollButtonVisibility(document.getElementById("scroll-bottom-button"), false);
    scrollToBottom();
    window.setTimeout(updateScrollButtonVisibility, 80);
  });
  document.getElementById("chat-region")?.addEventListener("scroll", updateScrollButtonVisibility, { passive: true });
  const composerInput = document.getElementById("composer-input");
  composerInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.isComposing || state.composerComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!composerInput.value.trim()) {
        showComposerEmptyFeedback(composerInput);
        return;
      }
      document.getElementById("composer-form").requestSubmit();
    }
  });
  composerInput?.addEventListener("compositionstart", () => {
    state.composerComposing = true;
  });
  composerInput?.addEventListener("compositionend", () => {
    state.composerComposing = false;
    state.composerDraft = composerInput.value;
    rememberComposerDraft();
    resizeComposer(composerInput);
    syncComposerSendState(composerInput);
  });
  composerInput?.addEventListener("input", () => {
    state.composerDraft = composerInput.value;
    rememberComposerDraft();
    if (state.composerError && composerInput.value.trim()) {
      state.composerError = null;
      document.querySelector(".composer-error")?.remove();
    }
    resizeComposer(composerInput);
    syncComposerSendState(composerInput);
  });
  if (composerInput) {
    resizeComposer(composerInput);
    syncComposerSendState(composerInput);
  }
  document.getElementById("stop-button")?.addEventListener("click", stopActiveSession);
  document.getElementById("rename-button")?.addEventListener("click", renameActiveSession);
  document.getElementById("delete-button")?.addEventListener("click", deleteActiveSession);
  document.querySelectorAll("[data-sheet-action]").forEach((button) => {
    button.addEventListener("click", () => handleSheetAction(button.dataset.sheetAction));
  });
  document.getElementById("sheet-backdrop")?.addEventListener("click", closeSheet);
  document.getElementById("rename-sheet-form")?.addEventListener("submit", submitRenameSheet);
  bindSettingsEvents();
}

function handleWelcomeAction(action) {
  if (action === "settings") {
    openSettings({ diagnostics: true, returnFocus: "[data-welcome-action='settings']" });
    return;
  }
  if (action === "archived") {
    state.sessionView = "archived";
    state.sessionQuery = "";
    if (isMobileViewport()) state.mobileDrawerOpen = true;
    render();
  }
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function handleSessionSearchInput(event) {
  state.sessionQuery = event.currentTarget.value;
  syncSessionSearchInputs(event.currentTarget.id);
  refreshSessionLists();
}

function switchSessionView(view) {
  if (view !== "active" && view !== "archived") return;
  if (state.sessionView === view) return;
  state.sessionView = view;
  state.sessionQuery = "";
  state.sessionMenuOpen = false;
  render();
}

function syncSessionSearchInputs(sourceId = "") {
  ["session-search", "mobile-session-search"].forEach((id) => {
    if (id === sourceId) return;
    const input = document.getElementById(id);
    if (input && input.value !== state.sessionQuery) input.value = state.sessionQuery;
  });
}

function refreshSessionLists() {
  const html = renderSessionList(groupSessions(filterSessions(currentSessionCollection())));
  document.querySelectorAll(".session-list").forEach((list) => {
    list.innerHTML = html;
  });
  bindSessionListEvents();
}

function bindSessionListEvents() {
  document.querySelectorAll("[data-clear-session-search]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.closest(".mobile-session-list") ? "mobile-session-search" : "session-search";
      state.sessionQuery = "";
      syncSessionSearchInputs();
      refreshSessionLists();
      requestAnimationFrame(() => document.getElementById(targetId)?.focus());
    });
  });
  document.querySelectorAll("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => openSession(button.dataset.sessionId));
  });
  document.querySelectorAll("[data-restore-session-id]").forEach((button) => {
    button.addEventListener("click", () => restoreArchivedSession(button.dataset.restoreSessionId));
  });
}

function closeMobileDrawer() {
  state.mobileDrawerOpen = false;
  render();
}

function handleToastAction(action) {
  if (!action || !state.toast) return;
  const payload = typeof state.toast === "object" ? state.toast.payload : null;
  state.toast = null;
  window.clearTimeout(showToast.timer);
  if (action === "undoArchive") {
    void undoArchive(payload);
    return;
  }
  render();
}

function handleRecoveryAction(action, userId) {
  if (!action) return;
  if (action === "settings") {
    openSettings({ diagnostics: true, returnFocus: "#composer-input" });
    return;
  }
  const item = findTimelineItem(userId);
  if (action === "edit" && item?.text) {
    fillComposerDraft(item.text);
    return;
  }
  if (action === "retry" && item?.text) {
    fillComposerDraft(item.text, { autoSubmit: true });
    return;
  }
  fillComposerDraft("请基于刚才已经完成的内容继续。", { autoSubmit: action === "continue" });
}

function fillComposerDraft(text, options = {}) {
  state.composerDraft = text;
  state.composerError = null;
  dismissToast();
  rememberComposerDraft(text);
  render();
  const restoreDraftFocus = () => {
    const input = document.getElementById("composer-input");
    if (!input) return;
    input.value = text;
    resizeComposer(input);
    syncComposerSendState(input);
    if (options.autoSubmit) {
      document.getElementById("composer-form")?.requestSubmit();
      return;
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  requestAnimationFrame(() => requestAnimationFrame(restoreDraftFocus));
  window.setTimeout(restoreDraftFocus, 80);
}

function syncComposerSendState(input = document.getElementById("composer-input")) {
  const button = document.querySelector("#composer-form button[type='submit']");
  if (!button) return;
  const locked = !state.config?.claude?.available || state.activeSession?.status === "running";
  const empty = !String(input?.value || "").trim();
  button.disabled = locked || empty;
  button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
}

function showComposerEmptyFeedback(input = document.getElementById("composer-input")) {
  state.composerError = "请输入内容后再发送。";
  render();
  const refocus = () => {
    const nextInput = document.getElementById("composer-input");
    if (!nextInput) return;
    nextInput.focus();
    nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
    syncComposerSendState(nextInput);
  };
  requestAnimationFrame(() => requestAnimationFrame(refocus));
  window.setTimeout(refocus, 80);
}

function bindSettingsEvents() {
  document.querySelectorAll("input[name='defaultMode']").forEach((input) => {
    input.addEventListener("change", () => {
      syncModeCardSelection();
      updateSettingsSaveState();
    });
  });
  document.getElementById("advanced-toggle")?.addEventListener("click", () => {
    if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
    rememberPendingSettingsFromForm();
    state.settingsAdvanced = !state.settingsAdvanced;
    render();
  });
  document.querySelectorAll("[data-mobile-settings-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
      rememberPendingSettingsFromForm();
      const panel = button.dataset.mobileSettingsPanel || "home";
      state.mobileSettingsPanel = panel;
      if (panel === "diagnostics") state.settingsDiagnosticsOpen = true;
      render();
    });
  });
  document.getElementById("close-settings")?.addEventListener("click", closeSettings);
  document.getElementById("settings-check-button")?.addEventListener("click", checkClaudeConnection);
  document.getElementById("diagnostic-toggle-button")?.addEventListener("click", () => {
    if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
    rememberPendingSettingsFromForm();
    state.settingsDiagnosticsOpen = !state.settingsDiagnosticsOpen;
    render();
  });
  document.getElementById("copy-diagnostics-button")?.addEventListener("click", () => {
    void copyText(claudeDiagnosticText());
  });
  document.getElementById("modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") {
      closeSettings();
    }
  });
  document.getElementById("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
    const form = new FormData(event.currentTarget);
    const nextSettings = Object.fromEntries(form.entries());
    if (!settingsChanged(nextSettings)) return;
    if (needsRiskModeConfirm(nextSettings)) {
      state.pendingSettings = { ...(state.config?.settings || {}), ...nextSettings };
      state.sheetBusy = false;
      state.sheet = { type: "confirmRiskMode", mode: nextSettings.defaultMode, settings: nextSettings };
      render();
      return;
    }
    await saveSettings(nextSettings);
  });
  document.getElementById("settings-form")?.addEventListener("input", updateSettingsSaveState);
  document.getElementById("settings-form")?.addEventListener("change", updateSettingsSaveState);
  document.getElementById("logout-button")?.addEventListener("click", async () => {
    if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
    const hasUnsavedSettings = settingsFormDirty();
    if (hasUnsavedSettings) rememberPendingSettingsFromForm();
    const activeSession = await reconcileActiveSessionIfRunning();
    if (activeSession?.status === "running") {
      state.settingsError = "";
      state.sheetBusy = false;
      state.sheet = { type: "confirmLogout", error: "", unsaved: hasUnsavedSettings, returnFocus: "#logout-button" };
      render();
      return;
    }
    state.settingsError = "";
    state.sheetBusy = false;
    state.sheet = { type: "confirmPlainLogout", error: "", unsaved: hasUnsavedSettings, returnFocus: "#logout-button" };
    render();
  });
}

function readSettingsFormValues() {
  const form = document.getElementById("settings-form");
  if (!form) return { ...(state.config?.settings || {}) };
  return Object.fromEntries(new FormData(form).entries());
}

function rememberPendingSettingsFromForm() {
  const form = document.getElementById("settings-form");
  if (!form || state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
  state.pendingSettings = {
    ...(state.pendingSettings || state.config?.settings || {}),
    ...Object.fromEntries(new FormData(form).entries()),
  };
}

async function saveSettings(nextSettings, options = {}) {
  if (!options.confirmedRiskMode && needsRiskModeConfirm(nextSettings)) {
    state.pendingSettings = { ...(state.config?.settings || {}), ...nextSettings };
    state.sheetBusy = false;
    state.sheet = { type: "confirmRiskMode", mode: nextSettings.defaultMode, settings: nextSettings };
    render();
    return;
  }
  state.settingsBusy = true;
  state.pendingSettings = { ...(state.config?.settings || {}), ...nextSettings };
  state.settingsError = "";
  state.settingsNotice = "";
  if (state.sheet?.type === "confirmRiskMode") {
    state.sheetBusy = true;
    state.sheet = { ...state.sheet, settings: nextSettings };
  }
  render();
  try {
    const result = await api.patch("/api/config", nextSettings);
    state.config = { ...state.config, ...result };
    state.pendingSettings = null;
    state.settingsBusy = false;
    state.sheetBusy = false;
    state.sheet = null;
    state.settingsOpen = false;
    state.restoreMobileDrawerAfterSettings = false;
    showToast("设置已保存");
    restoreReturnFocus("#settings-button");
  } catch (err) {
    state.settingsBusy = false;
    state.sheetBusy = false;
    state.sheet = null;
    state.pendingSettings = null;
    state.settingsError = userFacingError(err.message);
    render();
  }
}

function needsRiskModeConfirm(nextSettings = {}) {
  const nextMode = String(nextSettings.defaultMode || "");
  const currentMode = String((state.config?.settings || {}).defaultMode || "plan");
  return isRiskMode(nextMode) && nextMode !== currentMode;
}

function isRiskMode(mode = "") {
  return mode === "acceptEdits" || mode === "bypassPermissions";
}

function riskModeCopy(mode = "") {
  if (mode === "bypassPermissions") {
    return {
      title: "确认开启完全自动？",
      modeLabel: "完全自动",
      body: "这个模式会跳过工具确认，之后的新会话会默认使用它；只适合你完全信任的任务。",
      detail: "Claude Code 可以连续执行命令和文件修改，请确认当前账号和工作区风险可控。",
    };
  }
  return {
    title: "确认开启自动编辑？",
    modeLabel: "自动编辑",
    body: "这个模式会自动接受文件修改，之后的新会话会默认使用它；更适合连续改代码时使用。",
    detail: "Claude Code 可以直接写入和修改文件，请确认你已经理解影响范围。",
  };
}

function claudeDiagnosticText() {
  const claude = state.config?.claude || {};
  const connected = Boolean(claude.available);
  const quota = visibleQuotaIssue(connected);
  const settings = state.pendingSettings || state.config?.settings || {};
  return [
    `${BRAND_NAME} Claude 诊断`,
    `账号：${state.user?.username || ""}`,
    `Claude Code：${connected ? String(claude.version || "已连接").trim() : "未找到"}`,
    `路径：${settings.claudePath || claude.command || "claude"}`,
    `账号状态：${quota ? "最近请求额度不足" : connected ? "本机可连接，账号需真实请求验证" : "本机助手未连接"}`,
    `最近失败：${quota ? latestQuotaFailureText() || "无" : "无"}`,
  ].join("\n");
}

async function checkClaudeConnection() {
  if (state.settingsBusy || state.logoutBusy || state.settingsCheckBusy) return;
  const nextSettings = readSettingsFormValues();
  state.settingsCheckBusy = true;
  state.pendingSettings = { ...(state.config?.settings || {}), ...nextSettings };
  state.settingsError = "";
  state.settingsNotice = "";
  render();
  try {
    const result = await api.post("/api/config/check", nextSettings);
    state.config = { ...state.config, claude: result.claude };
    state.pendingSettings = result.settings || state.pendingSettings;
    state.settingsCheckBusy = false;
    state.settingsNotice = settingsCheckNotice(result.claude);
    render();
  } catch (err) {
    state.settingsCheckBusy = false;
    state.pendingSettings = { ...(state.config?.settings || {}), ...nextSettings };
    state.settingsError = userFacingError(err.message);
    state.settingsNotice = "";
    render();
  }
}

function settingsCheckNotice(claude) {
  const available = Boolean(claude?.available);
  if (!available) return "未找到本机助手";
  if (visibleQuotaIssue(available)) return "本机助手可连接，但最近失败仍是 Claude 账号额度不足。";
  return available ? "本机助手已连接" : "未找到本机助手";
}

function syncModeCardSelection() {
  document.querySelectorAll(".mode-card").forEach((card) => {
    const input = card.querySelector("input[name='defaultMode']");
    card.classList.toggle("selected", Boolean(input?.checked));
  });
}

async function newChat() {
  const activeSession = await reconcileActiveSessionIfRunning();
  if (activeSession?.status === "running") {
    state.sessionMenuOpen = false;
    state.mobileDrawerOpen = false;
    state.sheetBusy = false;
    state.sheet = { type: "confirmNewChat", error: "" };
    render();
    return state.activeSession;
  }
  startDraftSession({ clearDraft: true });
  return state.activeSession;
}

async function reconcileActiveSessionIfRunning() {
  const session = state.activeSession;
  if (!session || session.draft || session.status !== "running") return session;
  try {
    const result = await api.get(`/api/sessions/${session.id}`);
    state.activeSession = result.session;
    syncSessionSummary(result.session);
    return result.session;
  } catch {
    return session;
  }
}

function startDraftSession(options = {}) {
  closeEvents();
  const settings = state.config?.settings || {};
  if (options.clearDraft) clearComposerDraft(NEW_DRAFT_SESSION_ID);
  state.justArchivedSession = null;
  state.sessionView = "active";
  state.sessionQuery = "";
  state.stopBusy = false;
  state.sheetBusy = false;
  state.sheet = null;
  state.activeSession = {
    id: `draft-${Date.now()}`,
    title: "新对话",
    status: "idle",
    mode: settings.defaultMode,
    model: settings.defaultModel,
    cwd: state.user.homeDir,
    messages: [],
    draft: true,
  };
  state.composerDraft = options.clearDraft ? "" : readComposerDraft(state.activeSession);
  state.sessionMenuOpen = false;
  state.mobileDrawerOpen = false;
  state.forceScrollBottom = true;
  rememberActiveSession(state.activeSession);
  if (options.renderAfter !== false) render();
}

async function stopAndStartNewChat() {
  if (!state.activeSession || state.sheetBusy) return;
  const sessionId = state.activeSession.id;
  state.sheetBusy = true;
  state.sheet = { ...(state.sheet || {}), type: "confirmNewChat", error: "" };
  render();
  try {
    const stopped = await stopActiveSessionIfStillRunning(sessionId);
    startDraftSession();
    showToast(stopped ? "已停止，已新建对话" : "已新建对话");
  } catch (err) {
    state.sheetBusy = false;
    state.sheet = { ...(state.sheet || {}), type: "confirmNewChat", error: userFacingError(err.message) };
    render();
  }
}

async function stopAndSwitchSession() {
  const targetId = state.sheet?.targetId;
  if (!state.activeSession || !targetId || state.sheetBusy) return;
  const sessionId = state.activeSession.id;
  state.sheetBusy = true;
  state.sheet = { ...(state.sheet || {}), type: "confirmSwitchSession", error: "" };
  render();
  try {
    const stopped = await stopActiveSessionIfStillRunning(sessionId);
    state.sheet = null;
    state.sheetBusy = false;
    await openSession(targetId, { skipRunningGuard: true });
    showToast(stopped ? "已停止，已切换会话" : "已切换会话");
  } catch (err) {
    state.sheetBusy = false;
    state.sheet = { ...(state.sheet || {}), type: "confirmSwitchSession", error: userFacingError(err.message) };
    render();
  }
}

async function stopAndLogout() {
  if (!state.activeSession || state.sheetBusy) return;
  const sessionId = state.activeSession.id;
  state.sheetBusy = true;
  state.logoutBusy = true;
  state.sheet = { ...(state.sheet || {}), type: "confirmLogout", error: "" };
  render();
  try {
    await stopActiveSessionIfStillRunning(sessionId);
    await logoutUser({ renderStart: false });
  } catch (err) {
    state.sheetBusy = false;
    state.logoutBusy = false;
    state.sheet = { ...(state.sheet || {}), type: "confirmLogout", error: userFacingError(err.message) };
    render();
  }
}

async function stopActiveSessionIfStillRunning(sessionId) {
  const latest = await reconcileActiveSessionIfRunning();
  if (!latest || latest.id !== sessionId || latest.draft || latest.status !== "running") {
    await refreshSessions().catch(() => {});
    return false;
  }
  await api.post(`/api/sessions/${sessionId}/stop`);
  await refreshSessions();
  return true;
}

async function confirmPlainLogout() {
  if (state.sheetBusy || state.logoutBusy) return;
  state.sheetBusy = true;
  state.logoutBusy = true;
  state.sheet = { ...(state.sheet || {}), type: "confirmPlainLogout", error: "", returnFocus: "#logout-button" };
  render();
  await logoutUser({ renderStart: false });
}

async function logoutUser(options = {}) {
  if (options.renderStart !== false) {
    state.logoutBusy = true;
    state.settingsError = "";
    render();
  }
  try {
    closeEvents();
    await api.post("/api/logout");
    applyLoggedOutState();
    render();
  } catch (err) {
    state.logoutBusy = false;
    state.sheetBusy = false;
    if (state.sheet?.type === "confirmLogout" || state.sheet?.type === "confirmPlainLogout") {
      state.sheet = { ...(state.sheet || {}), error: userFacingError(err.message) };
    } else {
      state.settingsError = userFacingError(err.message);
    }
    render();
  }
}

function applyLoggedOutState() {
  state.user = null;
  state.activeSession = null;
  state.sessions = [];
  state.archivedSessions = [];
  state.config = null;
  state.pendingSettings = null;
  state.composerDraft = "";
  state.stopBusy = false;
  state.sheetBusy = false;
  state.sheet = null;
  state.settingsOpen = false;
  state.settingsCheckBusy = false;
  state.settingsNotice = "";
  state.sessionMenuOpen = false;
  state.mobileDrawerOpen = false;
  state.restoreMobileDrawerAfterSettings = false;
  state.sessionView = "active";
  state.restoringSessionId = "";
  state.justArchivedSession = null;
  state.logoutBusy = false;
  state.mobileSettingsPanel = "home";
  state.authMode = "login";
  state.authError = "";
  state.authErrorField = "";
  state.authFocusTarget = "username";
  state.authPasswordFocusTarget = "password";
  state.passwordVisible = false;
  state.authForm.username = "";
  state.authForm.password = "";
  state.authForm.confirmPassword = "";
}

async function refreshAuthedState() {
  if (state.refreshBusy) return;
  state.refreshBusy = true;
  state.sessionMenuOpen = true;
  render();
  try {
    await loadAuthedState();
    showToast("已刷新");
  } catch (err) {
    showToast(userFacingError(err.message));
  } finally {
    state.refreshBusy = false;
    state.sessionMenuOpen = false;
    render();
  }
}

async function ensureActiveSession() {
  if (state.activeSession) return state.activeSession;
  await newChat();
  return state.activeSession;
}

async function openSession(id, options = {}) {
  if (!id || state.openingSessionId === id) return;
  if (state.activeSession?.status === "running" && !options.skipRunningGuard) {
    await reconcileActiveSessionIfRunning();
  }
  if (state.activeSession?.id === id && !state.activeSession?.draft) {
    state.mobileDrawerOpen = false;
    state.sessionMenuOpen = false;
    render();
    return;
  }
  if (state.activeSession?.status === "running" && !options.skipRunningGuard) {
    const target = state.sessions.find((session) => session.id === id);
    state.mobileDrawerOpen = false;
    state.sessionMenuOpen = false;
    state.sheetBusy = false;
    state.sheet = { type: "confirmSwitchSession", targetId: id, title: target?.title || "目标会话", error: "" };
    render();
    return;
  }
  closeEvents();
  state.justArchivedSession = null;
  state.stopBusy = false;
  state.openingSessionId = id;
  state.sessionMenuOpen = false;
  if (options.renderAfter !== false) render();
  try {
    const result = await api.get(`/api/sessions/${id}`);
    state.activeSession = result.session;
    state.stderr = "";
    state.composerDraft = readComposerDraft(result.session);
    state.mobileDrawerOpen = false;
    state.forceScrollBottom = true;
    rememberActiveSession(result.session);
    connectEvents(id);
  } catch (err) {
    showToast(userFacingError(err.message));
  } finally {
    state.openingSessionId = "";
    if (options.renderAfter !== false) render();
  }
}

function connectEvents(id) {
  closeEvents();
  const source = new EventSource(`/api/sessions/${id}/events`);
  source.addEventListener("session", (event) => {
    state.activeSession = JSON.parse(event.data);
    if (state.activeSession?.status !== "running") state.stopBusy = false;
    syncSessionSummary(state.activeSession);
    rememberActiveSession(state.activeSession);
    render();
  });
  source.addEventListener("stderr", (event) => {
    state.stderr = JSON.parse(event.data).text || "";
    render();
  });
  source.addEventListener("done", () => {
    state.sending = false;
    state.stopBusy = false;
    state.stderr = "";
    void refreshFinishedSession(id);
  });
  source.addEventListener("deleted", () => {
    forgetRememberedSessionId(id);
    state.activeSession = null;
    state.stopBusy = false;
    state.forceScrollBottom = true;
    void loadAuthedState().then(render);
  });
  state.eventSource = source;
}

async function refreshFinishedSession(id) {
  try {
    const result = await api.get(`/api/sessions/${id}`);
    if (state.activeSession?.id === id) {
      state.activeSession = result.session;
      state.forceScrollBottom = true;
      syncSessionSummary(result.session);
      rememberActiveSession(result.session);
      maybeShowQuotaRetryFeedback(result.session);
      render();
    }
  } catch {
    // The session may have been archived while the stream was closing.
  } finally {
    await refreshSessions().catch(() => {});
    if (state.activeSession?.id === id) {
      state.forceScrollBottom = true;
      render();
      focusComposerWhenIdle();
    }
  }
}

function maybeShowQuotaRetryFeedback(session) {
  const retry = state.pendingQuotaRetry;
  if (!retry || retry.sessionId !== session?.id) return;
  const turnCount = sessionTurnCount(session);
  if (turnCount < Number(retry.expectedTurns || 0)) return;
  state.pendingQuotaRetry = null;
  const latestAssistant = latestAssistantForSession(session);
  if (latestAssistant?.status === "canceled") {
    showToast("已停止，本轮上下文已保留");
    return;
  }
  if (sessionHasQuotaIssue(session)) {
    showToast("Claude 账号仍未恢复，已保留本次记录");
  } else if (session?.status === "idle" && latestAssistant?.status === "done" && String(latestAssistant.text || "").trim()) {
    showToast("Claude 账号已恢复");
  } else if (session?.status === "error" || latestAssistant?.status === "error") {
    showToast("本次重试没有完成，已保留记录");
  }
}

function latestAssistantForSession(session) {
  return [...(session?.messages || [])].reverse().find((item) => item?.type === "assistant") || null;
}

function closeEvents() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

async function sendComposer(event) {
  event.preventDefault();
  const input = document.getElementById("composer-input");
  const text = input?.value.trim() || "";
  if (!text) {
    showComposerEmptyFeedback(input);
    return;
  }
  if (state.sending) return;
  const quotaOverride = state.quotaSendOverride;
  state.quotaSendOverride = false;
  if (activeQuotaIssue() && !quotaOverride) {
    state.composerDraft = text;
    rememberComposerDraft(text);
    state.composerError = null;
    state.sheetBusy = false;
    state.sheet = { type: "confirmQuotaSend", text };
    render();
    return;
  }
  const settings = state.config?.settings || {};
  let previousSession = null;
  try {
    await ensureActiveSession();
    let session = state.activeSession;
    if (!session || session.draft) {
      const draftSession = session;
      const created = await api.post("/api/sessions", {
        title: titleFromText(text),
        mode: session?.mode || settings.defaultMode,
        model: session?.model || settings.defaultModel,
      });
      clearComposerDraft(draftSession);
      session = created.session;
      state.activeSession = session;
      rememberActiveSession(session);
      connectEvents(session.id);
      await refreshSessions();
    }
    const mode = session.mode || settings.defaultMode || "plan";
    const model = session.model || settings.defaultModel || "";
    if (quotaOverride) {
      state.pendingQuotaRetry = {
        sessionId: session.id,
        expectedTurns: sessionTurnCount(session) + 1,
      };
    }
    previousSession = {
      ...session,
      messages: [...(session.messages || [])],
      status: session.status,
    };
    input.value = "";
    state.composerDraft = "";
    clearComposerDraft(session);
    state.sending = true;
    state.stopBusy = false;
    state.composerError = null;
    state.pendingMessage = text;
    state.forceScrollBottom = true;
    const now = new Date().toISOString();
    state.activeSession = {
      ...session,
      title: shouldRefineAutoTitle(session.title, text, sessionTurnCount(session)) ? titleFromText(text) : session.title,
      status: "running",
      messages: [
        ...(session.messages || []),
        { id: `optimistic-user-${Date.now()}`, type: "user", text, createdAt: now },
        {
          id: `optimistic-assistant-${Date.now()}`,
          type: "assistant",
          text: "",
          status: "streaming",
          startedAt: now,
          createdAt: now,
        },
      ],
    };
    rememberActiveSession(state.activeSession);
    syncSessionSummary(state.activeSession);
    render();
    await api.post(`/api/sessions/${session.id}/messages`, { text, mode, model });
    await refreshSessions();
  } catch (err) {
    state.sending = false;
    if (quotaOverride) state.pendingQuotaRetry = null;
    input.value = text;
    state.composerDraft = text;
    if (previousSession) state.activeSession = previousSession;
    rememberComposerDraft(text, previousSession || state.activeSession);
    state.composerError = userFacingError(err.message);
    showToast(state.composerError);
    render();
    focusComposerWhenIdle();
  }
}

function focusComposerWhenIdle(options = {}) {
  if (!options.mobile && isMobileViewport()) return;
  const focus = () => {
    if (state.settingsOpen || state.sheet || state.mobileDrawerOpen) return;
    const input = document.getElementById("composer-input");
    if (!input || input.disabled) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement && active !== input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    syncComposerSendState(input);
  };
  requestAnimationFrame(() => requestAnimationFrame(focus));
  window.setTimeout(focus, 80);
}

async function refreshSessions() {
  const [active, archived] = await Promise.all([api.get("/api/sessions"), api.get("/api/sessions?archived=1")]);
  state.sessions = active.sessions || [];
  state.archivedSessions = archived.sessions || [];
}

function syncSessionSummary(session) {
  state.archivedSessions = state.archivedSessions.filter((entry) => entry.id !== session.id);
  const index = state.sessions.findIndex((entry) => entry.id === session.id);
  const summary = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    mode: session.mode,
    model: session.model,
    archivedAt: session.archivedAt || null,
    turnCount: sessionTurnCount(session),
    preview: previewForSession(session),
  };
  if (index >= 0) state.sessions[index] = summary;
  else state.sessions.unshift(summary);
  state.sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function previewForSession(session) {
  const messages = session.messages || [];
  const last = [...messages].reverse().find(isPreviewableItem);
  const preview = last ? previewFor(last) : "";
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
  const text = naturalPreview(value)
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

function previewFor(item) {
  if (item.type === "user" || item.type === "assistant") return naturalPreview(item.text || "");
  if (item.type === "tool") return item.summary ? naturalPreview(item.summary) : `${item.displayName || "完成了一项操作"}`;
  if (item.type === "todo") {
    const active = (item.items || []).find((entry) => !entry.completed);
    return active ? active.text : "任务已完成";
  }
  if (item.type === "error") return userFacingError(item.message || "");
  return item.label || item.type || "";
}

function naturalPreview(text) {
  const value = displaySafeText(text || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > 42 ? `${value.slice(0, 42)}...` : value;
}

function displayPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const workspace = workspacePath();
  if (workspace && text === workspace) return "本机工作区";
  if (workspace && text.startsWith(`${workspace}/`)) {
    return `本机工作区/${text.slice(workspace.length + 1)}`;
  }
  if (/^\/Users\//.test(text)) return "本机路径";
  return shortenPath(text);
}

function displaySafeText(value) {
  let text = String(value || "");
  const workspace = workspacePath();
  if (workspace) text = text.replaceAll(workspace, "本机工作区");
  return text.replace(/\/Users\/[^\s，。；、)）\]}>"]+/g, "本机路径");
}

function workspacePath() {
  return String(state.user?.homeDir || "").replace(/\/+$/g, "");
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
  return titleToolIntentFromText(compact) || titleIntentFromText(compact) || naturalPreview(compact);
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
  const fileName = String(value || "")
    .trim()
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
  return fileName && fileName.length > 18 ? `${fileName.slice(0, 18)}...` : fileName || "";
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

function userFacingError(message = "") {
  const text = String(message || "");
  if (/Invalid username or password/i.test(text)) return "账号或密码不正确，请重新输入。";
  if (/Username already exists/i.test(text)) return "这个用户名已经被使用，请换一个。";
  if (/Password must be at least/i.test(text)) return "密码至少需要 6 位。";
  if (/Username must start/i.test(text)) return "用户名需以字母开头，长度 3-32 位。";
  if (/Unauthorized/i.test(text)) return "登录已失效，请重新登录。";
  if (/API Error:\s*402|Insufficient Balance/i.test(text)) return "本机助手额度不足，请检查 Claude 账号额度后重试。";
  if (/not found|ENOENT|Claude Code executable|Local engine executable/i.test(text))
    return "未找到本机助手，请在设置里检查本机助手路径。";
  if (/Session not found/i.test(text)) return "这个会话暂时无法打开，请刷新后重试。";
  if (/already running/i.test(text)) return `${BRAND_NAME} 正在回复，请稍后再发送。`;
  if (/Stopped by user|code 143|SIGTERM/i.test(text)) return "已取消本次请求。";
  if (/NetworkError|Failed to fetch/i.test(text)) return "连接中断，请稍后重试。";
  if (/Message cannot be empty/i.test(text)) return "请输入内容后再发送。";
  return text.length > 160 ? `${text.slice(0, 160)}...` : text || "操作失败，请稍后重试。";
}

function shortenPath(value) {
  const text = String(value || "");
  if (text.length <= 36) return text;
  const parts = text.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : `${text.slice(0, 16)}...${text.slice(-14)}`;
}

async function updateActiveSessionPrefs() {
  if (!state.activeSession) return;
  const mode = document.getElementById("mode-select")?.value || state.activeSession.mode;
  const model = document.getElementById("model-input")?.value || "";
  const result = await api.patch(`/api/sessions/${state.activeSession.id}`, { mode, model });
  state.activeSession = result.session;
  syncSessionSummary(result.session);
  render();
}

async function stopActiveSession() {
  if (!state.activeSession || state.stopBusy) return;
  state.sessionMenuOpen = false;
  state.stopBusy = true;
  render();
  try {
    await api.post(`/api/sessions/${state.activeSession.id}/stop`);
    showToast("已停止");
  } catch (err) {
    state.stopBusy = false;
    showToast(userFacingError(err.message));
  }
}

async function renameActiveSession() {
  if (!state.activeSession) return;
  if (state.activeSession.status === "running") {
    state.sessionMenuOpen = false;
    showToast("当前回复结束后再重命名");
    render();
    return;
  }
  state.sessionMenuOpen = false;
  openRenameSheet({ returnFocus: "#conversation-menu-button" });
}

async function deleteActiveSession() {
  if (!state.activeSession) return;
  await reconcileActiveSessionIfRunning();
  state.sessionMenuOpen = false;
  state.sheetBusy = false;
  state.sheet = { type: "confirmArchive" };
  render();
}

async function archiveActiveSession() {
  if (!state.activeSession || state.sheetBusy) return;
  await reconcileActiveSessionIfRunning();
  if (!state.activeSession) return;
  const archived = {
    id: state.activeSession.id,
    title: state.activeSession.title || "这个会话",
  };
  state.sheet = { ...(state.sheet || {}), type: "confirmArchive", error: "" };
  state.sheetBusy = true;
  render();
  try {
    closeEvents();
    forgetRememberedSessionId(state.activeSession.id);
    clearComposerDraft(state.activeSession);
    await api.delete(`/api/sessions/${state.activeSession.id}`);
    state.activeSession = null;
    state.justArchivedSession = archived;
    state.sheet = null;
    state.sheetBusy = false;
    state.forceScrollBottom = true;
    await loadAuthedState();
    state.sheet = { type: "archiveFocus", title: archived.title, payload: archived };
    render();
  } catch (err) {
    if (state.activeSession?.id && !state.eventSource) connectEvents(state.activeSession.id);
    state.sheetBusy = false;
    state.sheet = {
      ...(state.sheet || {}),
      type: "confirmArchive",
      error: userFacingError(err.message),
    };
    render();
  }
}

async function undoArchive(payload) {
  if (!payload?.id) return;
  try {
    const result = await api.post(`/api/sessions/${payload.id}/restore`);
    state.sessionView = "active";
    state.sessionQuery = "";
    state.justArchivedSession = null;
    state.activeSession = result.session;
    state.sheet = null;
    state.sessionMenuOpen = false;
    state.mobileDrawerOpen = false;
    state.forceScrollBottom = true;
    syncSessionSummary(result.session);
    rememberActiveSession(result.session);
    connectEvents(result.session.id);
    await refreshSessions();
    showToast("已恢复");
  } catch (err) {
    showToast(userFacingError(err.message));
  }
}

async function restoreArchivedSession(id) {
  if (!id || state.restoringSessionId) return;
  state.restoringSessionId = id;
  render();
  try {
    const result = await api.post(`/api/sessions/${id}/restore`);
    state.sessionView = "active";
    state.sessionQuery = "";
    state.justArchivedSession = null;
    state.activeSession = result.session;
    state.sheet = null;
    state.sessionMenuOpen = false;
    state.mobileDrawerOpen = false;
    state.restoringSessionId = "";
    state.forceScrollBottom = true;
    syncSessionSummary(result.session);
    rememberActiveSession(result.session);
    connectEvents(result.session.id);
    await refreshSessions();
    showToast("已恢复");
    render();
  } catch (err) {
    state.restoringSessionId = "";
    showToast(userFacingError(err.message));
    render();
  }
}

function findTimelineItem(id) {
  if (!id || !state.activeSession?.messages) return null;
  return state.activeSession.messages.find((item) => item.id === id) || null;
}

function copyTextForItem(item) {
  if (item.type !== "assistant") return item.text || "";
  const text = item.status === "error" || item.status === "canceled" ? userFacingError(item.text) : item.text;
  return displaySafeText(text || "");
}

async function copyText(text) {
  if (copyTextFallback(text)) {
    showToast("已复制");
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制");
    return true;
  } catch {
    selectCopyBuffer(text);
    showToast("已选中");
    return false;
  }
}

function copyFeedbackKey(type, value) {
  return `${type}:${stableHash(String(value || ""))}`;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function setCopyFeedback(key) {
  if (!key) return;
  state.copyFeedbackKey = key;
  window.clearTimeout(copyFeedbackTimer);
  render();
  copyFeedbackTimer = window.setTimeout(() => {
    if (state.copyFeedbackKey !== key) return;
    state.copyFeedbackKey = "";
    render();
  }, 1400);
}

function copyTextFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function selectCopyBuffer(text) {
  const old = document.querySelector("[data-copy-buffer]");
  old?.remove();
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.dataset.copyBuffer = "true";
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "0";
  textarea.style.bottom = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  window.setTimeout(() => textarea.remove(), 1500);
}

function renderToast(inert = false) {
  if (!state.toast) return "";
  const toast = typeof state.toast === "object" ? state.toast : { message: String(state.toast) };
  const action =
    toast.action && toast.actionLabel
      ? `<button type="button" data-toast-action="${escapeAttr(toast.action)}">${escapeHtml(toast.actionLabel)}</button>`
      : "";
  return `
    <div class="toast ${action ? "actionable" : ""}" role="status" aria-live="polite" ${inert ? "inert" : ""}>
      <span>${escapeHtml(toast.message || "")}</span>
      ${action}
    </div>
  `;
}

function showToast(message, options = {}) {
  const toast =
    message && typeof message === "object"
      ? message
      : { message: String(message || ""), ...options };
  state.toast = {
    message: toast.message || "",
    actionLabel: toast.actionLabel || "",
    action: toast.action || "",
    payload: toast.payload || null,
  };
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, state.toast.action ? 5200 : 1500);
}

function dismissToast(renderNow = false) {
  if (!state.toast) return;
  state.toast = null;
  window.clearTimeout(showToast.timer);
  if (renderNow) render();
}

function resizeComposer(input) {
  const minHeight = isMobileViewport() ? 42 : 58;
  const maxHeight = isMobileViewport() ? 132 : 180;
  input.style.height = "auto";
  input.style.height = `${Math.min(maxHeight, Math.max(minHeight, input.scrollHeight))}px`;
  updateComposerSafeArea();
}

function updateComposerSafeArea() {
  const wrap = document.querySelector(".composer-wrap");
  const mobile = isMobileViewport();
  const minPadding = mobile ? 174 : 340;
  const minScrollOffset = mobile ? 128 : 198;
  if (!wrap) {
    document.documentElement.style.setProperty("--composer-safe-bottom", `${minPadding}px`);
    document.documentElement.style.setProperty("--scroll-bottom-offset", `${minScrollOffset}px`);
    return;
  }
  const height = Math.ceil(wrap.getBoundingClientRect().height);
  const safeBottom = Math.max(minPadding, height + (mobile ? 18 : 60));
  const scrollOffset = Math.max(minScrollOffset, height + (mobile ? 18 : 32));
  document.documentElement.style.setProperty("--composer-safe-bottom", `${safeBottom}px`);
  document.documentElement.style.setProperty("--scroll-bottom-offset", `${scrollOffset}px`);
}

function updateScrollButtonVisibility() {
  const region = document.getElementById("chat-region");
  const button = document.getElementById("scroll-bottom-button");
  if (!region || !button || !state.activeSession?.messages?.length) return;
  const visible = !isChatNearBottom() && !scrollButtonWouldCoverReadingContent();
  state.showScrollButton = visible;
  applyScrollButtonVisibility(button, visible);
}

function applyScrollButtonVisibility(button, visible) {
  if (!button) return;
  button.classList.toggle("visible", visible);
  button.setAttribute("aria-hidden", visible ? "false" : "true");
  button.setAttribute("tabindex", visible ? "0" : "-1");
  button.innerHTML = visible ? `${icon("arrowDown")}<span>回到底部</span>` : "";
}

function scrollButtonWouldCoverReadingContent() {
  if (!isMobileViewport()) return false;
  const composer = document.querySelector(".composer");
  if (!composer) return false;
  const composerRect = composer.getBoundingClientRect();
  const zone = {
    left: window.innerWidth - 72,
    right: window.innerWidth - 10,
    top: composerRect.top - 70,
    bottom: composerRect.top - 8,
  };
  return [...document.querySelectorAll(".markdown-code-block")].some((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left < zone.right && rect.right > zone.left && rect.top < zone.bottom && rect.bottom > zone.top;
  });
}

function renderStatusText(status) {
  if (status === "running" || status === "streaming") return "运行中";
  if (status === "error") return "异常";
  if (status === "done") return "已完成";
  return status || "空闲";
}

function toolIcon(name = "") {
  const lower = name.toLowerCase();
  if (lower.includes("计划") || lower.includes("plan")) return icon("list");
  if (lower.includes("task") || lower.includes("todo")) return icon("list");
  if (lower.includes("命令") || lower.includes("工作区") || lower.includes("长任务") || lower.includes("bash") || lower.includes("shell")) return icon("terminalSmall");
  if (lower.includes("读取") || lower.includes("read")) return icon("file");
  if (lower.includes("写入") || lower.includes("修改") || lower.includes("write") || lower.includes("edit")) return icon("edit");
  if (lower.includes("搜索") || lower.includes("search") || lower.includes("grep")) return icon("search");
  if (lower.includes("fetch")) return icon("link");
  return icon("spark");
}

function formatValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function renderMarkdownLite(text) {
  const safeText = displaySafeText(text);
  const parts = [];
  const pattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(safeText)) !== null) {
    if (match.index > lastIndex) parts.push(renderMarkdownText(safeText.slice(lastIndex, match.index)));
    const language = match[1] ? match[1] : "代码";
    const code = match[2] || "";
    const key = copyFeedbackKey("code", code);
    const copied = state.copyFeedbackKey === key;
    parts.push(`
      <div class="markdown-code-block">
        <div class="markdown-code-head">
          <span class="code-language">${escapeHtml(language)}</span>
          <button type="button" class="code-copy-button ${copied ? "copied" : ""}" data-copy-code="${escapeAttr(
            key,
          )}" aria-label="${copied ? "已复制代码" : "复制代码"}">${icon(copied ? "check" : "copy")}<span>${
            copied ? "已复制" : "复制"
          }</span></button>
        </div>
        <pre class="markdown-code"><code>${escapeHtml(code)}</code></pre>
      </div>
    `);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < safeText.length) parts.push(renderMarkdownText(safeText.slice(lastIndex)));
  return parts.join("");
}

function renderMarkdownText(text) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/).filter((block) => block.length > 0);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^#{1,4}\s+/.test(trimmed)) {
        const level = Math.min(4, trimmed.match(/^#+/)?.[0].length || 3);
        return `<h${level} class="markdown-heading">${renderInlineMarkdown(trimmed.replace(/^#{1,4}\s+/, ""))}</h${level}>`;
      }
      if (/^[-*]\s+/m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter((line) => /^[-*]\s+/.test(line.trim()))
          .map((line) => `<li>${renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul class="markdown-list">${items}</ul>`;
      }
      if (/^\d+\.\s+/m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter((line) => /^\d+\.\s+/.test(line.trim()))
          .map((line) => `<li>${renderInlineMarkdown(line.trim().replace(/^\d+\.\s+/, ""))}</li>`)
          .join("");
        return `<ol class="markdown-list">${items}</ol>`;
      }
      return `<p>${renderInlineMarkdown(trimmed).replaceAll("\n", "<br />")}</p>`;
    })
    .join("");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function humanizeToolName(name) {
  return String(name || "Tool")
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function toolStatusLabel(status, item = null) {
  if (status === "running" || status === "streaming") {
    if (item && isLongRunningItem(item)) {
      return `仍在运行 ${formatDuration(elapsedMs(item.startedAt || item.createdAt))}`;
    }
    return "进行中";
  }
  if (status === "error" || status === "failed") return "失败";
  if (status === "done" || status === "completed") return "已完成";
  if (status === "canceled") return "已取消";
  return status || "";
}

function isLongRunningItem(item) {
  if (!item || (item.status !== "running" && item.status !== "streaming")) return false;
  return elapsedMs(item.startedAt || item.createdAt) >= LONG_RUNNING_MS;
}

function elapsedMs(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Date.now() - start);
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

function formatElapsed(startedAt) {
  if (!startedAt) return "";
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return formatDuration(elapsed);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function icon(name) {
  const icons = {
    bot: '<svg viewBox="0 0 24 24"><path d="M7 9.5h10a3 3 0 0 1 3 3v3A3.5 3.5 0 0 1 16.5 19h-9A3.5 3.5 0 0 1 4 15.5v-3a3 3 0 0 1 3-3Z"/><path d="M8.5 14h.01M15.5 14h.01M9 17h6M12 6v3.5"/><path d="M10 5.5h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.08.1a2 2 0 0 1-3.84 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.1-.08a2 2 0 0 1 0-3.84L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.08-.1a2 2 0 0 1 3.84 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.36.47.7.6 1l.1.08a2 2 0 0 1 0 3.84L20 14a1.7 1.7 0 0 0-.6 1Z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z"/><path d="M9 12l2 2 4-5"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M13 2 9.7 9.7 2 13l7.7 3.3L13 24l3.3-7.7L24 13l-7.7-3.3L13 2Z"/></svg>',
    terminal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="4"/><path d="m8 10 3 2-3 2M13 15h3"/></svg>',
    terminalSmall: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 3 2-3 2M12 15h5"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v6h5M9 13h6M9 17h6"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
    wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0 5 5L11 20a2 2 0 0 1-3-3l8.7-8.7Z"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    paperclip: '<svg viewBox="0 0 24 24"><path d="m21 12-8.5 8.5a6 6 0 0 1-8.5-8.5L13 3a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8L15 6.8"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 13.4 13.4"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.5 17.5 0 0 1-3.1 4.1"/><path d="M6.5 6.8C3.6 8.7 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4-.8"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.2-1.2"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    archive: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M6 7v13h12V7"/><path d="M9 11h6"/><path d="M5 4h14v3H5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  };
  return icons[name] || icons.spark;
}

function isChatNearBottom() {
  const region = document.getElementById("chat-region");
  if (!region) return true;
  return region.scrollHeight - region.scrollTop - region.clientHeight < 140;
}

function scrollToBottom() {
  const apply = () => {
    const region = document.getElementById("chat-region");
    if (!region) return;
    region.scrollTop = region.scrollHeight;
    updateScrollButtonVisibility();
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
    window.setTimeout(apply, 80);
  });
}

function restoreScroll(previousScrollTop, previousScrollHeight) {
  requestAnimationFrame(() => {
    const region = document.getElementById("chat-region");
    if (!region) return;
    const heightDelta = region.scrollHeight - previousScrollHeight;
    region.scrollTop = Math.max(0, previousScrollTop + heightDelta);
  });
}

function captureChatScroll() {
  const region = document.getElementById("chat-region");
  if (!region) return null;
  return {
    sessionId: region.dataset.sessionId || "",
    scrollTop: region.scrollTop,
    scrollHeight: region.scrollHeight,
  };
}

function restoreCapturedChatScroll(snapshot) {
  if (!snapshot) return;
  const restore = () => {
    const region = document.getElementById("chat-region");
    if (!region || region.dataset.sessionId !== snapshot.sessionId) return;
    const heightDelta = region.scrollHeight - snapshot.scrollHeight;
    region.scrollTop = Math.max(0, snapshot.scrollTop + heightDelta);
    updateScrollButtonVisibility();
  };
  requestAnimationFrame(restore);
  window.setTimeout(restore, 80);
}

function keepExpandedToolVisible(id, attempt = 0) {
  const region = document.getElementById("chat-region");
  const composer = document.querySelector(".composer");
  const topbar = document.querySelector(".topbar");
  const selector = `[data-tool-id="${CSS.escape(id)}"]`;
  const card = document.querySelector(selector)?.closest(".tool-badge");
  if (!region || !composer || !card) return;
  const adjust = () => {
    let cardRect = card.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const topbarRect = topbar?.getBoundingClientRect();
    let nextRect = card.nextElementSibling?.getBoundingClientRect();
    const maxScrollTop = Math.max(0, region.scrollHeight - region.clientHeight);
    const mobile = isMobileViewport();
    const safeTop = (topbarRect?.bottom || region.getBoundingClientRect().top) + (mobile ? 12 : 16);
    const safeToolBottom = composerRect.top - (mobile ? 124 : 24);
    const safeNextTop = composerRect.top - (mobile ? 168 : 120);
    let delta = Math.max(0, cardRect.bottom - safeToolBottom);
    if (nextRect) {
      delta = Math.max(delta, nextRect.top - safeNextTop);
    }
    if (delta > 0 && maxScrollTop > 0) {
      card.scrollIntoView({ block: "center", inline: "nearest" });
      cardRect = card.getBoundingClientRect();
      nextRect = card.nextElementSibling?.getBoundingClientRect();
      delta = Math.max(0, cardRect.bottom - safeToolBottom);
      if (nextRect) {
        delta = Math.max(delta, nextRect.top - safeNextTop);
      }
    }
    if (delta > 0) {
      region.scrollTop = Math.min(maxScrollTop, region.scrollTop + Math.ceil(delta + 16));
      updateScrollButtonVisibility();
      cardRect = card.getBoundingClientRect();
    }
    if (cardRect.top < safeTop) {
      region.scrollTop = Math.max(0, region.scrollTop - Math.ceil(safeTop - cardRect.top + 8));
      updateScrollButtonVisibility();
    }
  };
  adjust();
  requestAnimationFrame(adjust);
  if (attempt < 6) {
    window.setTimeout(() => keepExpandedToolVisible(id, attempt + 1), attempt < 2 ? 80 : 140);
  }
}
