"use strict";

const state = {
  user: null,
  sessions: [],
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
  passwordVisible: false,
  settingsOpen: false,
  settingsAdvanced: false,
  settingsBusy: false,
  pendingSettings: null,
  settingsError: "",
  logoutBusy: false,
  sessionMenuOpen: false,
  refreshBusy: false,
  mobileDrawerOpen: false,
  openingSessionId: "",
  sheet: null,
  sheetBusy: false,
  composerError: null,
  composerDraft: "",
  pendingMessage: "",
  forceScrollBottom: true,
  showScrollButton: false,
  focusToolId: null,
  toast: null,
  stderr: "",
  sessionQuery: "",
  expandedToolIds: new Set(),
  composerComposing: false,
  returnFocusSelector: "",
};

const app = document.getElementById("app");
const BRAND_NAME = "智果";
const BRAND_ASSET = "/assets/zhiguo-mascot.png";

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
  const [config, sessions] = await Promise.all([api.get("/api/config"), api.get("/api/sessions")]);
  state.config = config;
  state.sessions = sessions.sessions || [];
  if (!state.activeSession && state.sessions.length > 0) {
    await openSession(state.sessions[0].id, { renderAfter: false });
  }
}

function render() {
  if (state.loading) {
    app.innerHTML = renderBootSplash();
    return;
  }
  if (!state.user) {
    renderAuth();
    return;
  }
  renderShell();
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
}

function trapOverlayFocus(event) {
  if (!state.settingsOpen && !state.sheet) return false;
  const root = document.querySelector("#settings-form, .sheet-panel");
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
    <main class="boot-shell">
      <div class="boot-card">
        <img class="boot-mascot" src="${BRAND_ASSET}" alt="" />
        <div class="boot-copy">
          <h1>${BRAND_NAME}</h1>
          <p>正在连接本机助手</p>
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
  app.innerHTML = `
    <main class="auth-shell">
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
        <div class="field">
          <label for="username">用户名</label>
          <input id="username" name="username" autocomplete="username" placeholder="输入用户名" ${busyAttr} value="${escapeAttr(
            state.authForm.username,
          )}" />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <div class="password-field">
            <input id="password" name="password" type="${passwordType}" autocomplete="${
              isLogin ? "current-password" : "new-password"
            }" ${busyAttr} value="${escapeAttr(state.authForm.password)}" placeholder="输入密码" />
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
            : `<div class="field">
                <label for="confirmPassword">确认密码</label>
	                <input id="confirmPassword" name="confirmPassword" type="${passwordType}" autocomplete="new-password" ${busyAttr} value="${escapeAttr(
	                  state.authForm.confirmPassword,
	                )}" placeholder="再次输入密码" />
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
    state.authForm.password = "";
    state.authForm.confirmPassword = "";
    state.passwordVisible = false;
    renderAuth();
    document.getElementById("username")?.focus({ preventScroll: true });
  });
  document.getElementById("toggle-password")?.addEventListener("click", () => {
    const activeId = document.activeElement?.id;
    const focusId = activeId === "confirmPassword" ? "confirmPassword" : "password";
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
      state.authError = validation;
      renderAuth();
      return;
    }
    state.authBusy = true;
    state.authError = "";
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
      state.authForm.password = "";
      state.authForm.confirmPassword = "";
      state.authError = userFacingError(err.message);
      renderAuth();
    }
  });
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
  document.getElementById("confirmPassword")?.addEventListener("input", (event) => {
    state.authForm.confirmPassword = event.currentTarget.value;
    clearAuthErrorInline();
  });
}

function clearAuthErrorInline() {
  if (!state.authError) return;
  state.authError = "";
  document.querySelector(".auth-error")?.remove();
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
    return "用户名需以字母开头，长度 3-32 位，可包含数字、下划线或短横线。";
  }
  if (password.length < 6) return "密码至少需要 6 位。";
  if (!isLogin && password !== state.authForm.confirmPassword) return "两次输入的密码不一致。";
  return "";
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
  const groups = groupSessions(filterSessions(state.sessions));
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
  const groups = groupSessions(filterSessions(state.sessions));
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
  return `<div class="empty-list"><strong>还没有会话</strong><span>新建一条对话开始</span></div>`;
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
  const active = state.activeSession?.id === session.id;
  const opening = state.openingSessionId === session.id;
  return `
    <button class="session-row ${active ? "active" : ""} ${opening ? "opening" : ""}" data-session-id="${session.id}" ${
      opening ? "disabled" : ""
    }>
      <div>
        <p class="session-title">${escapeHtml(session.title)}</p>
        <p class="session-preview">${escapeHtml(opening ? "正在打开..." : session.preview || "准备开始")}</p>
      </div>
      ${opening ? `<span class="status-dot opening"></span>` : session.status === "running" ? `<span class="status-dot running"></span>` : ""}
    </button>
  `;
}

function renderTopbar() {
  const session = state.activeSession;
  const title = session?.title || "新对话";
  return `
    <header class="topbar">
      <div class="topbar-left">
        <button class="icon-button mobile-menu-button" id="mobile-menu-button" aria-label="会话列表" data-tooltip="会话列表">${icon("menu")}</button>
      </div>
      <div class="topbar-title">
        <h1>${escapeHtml(title)}</h1>
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
                      ? `<button type="button" id="rename-button">${icon("edit")}<span>重命名</span></button>
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
    bypassPermissions: ["全自动", "适合受信任任务"],
  };
  return modes
    .map((mode) => {
      const [title, detail] = labels[mode.id] || [mode.label || mode.id, mode.detail || ""];
      return `
        <label class="mode-card ${mode.id === selected ? "selected" : ""}">
          <input type="radio" name="defaultMode" value="${escapeAttr(mode.id)}" ${
            mode.id === selected ? "checked" : ""
          } ${disabled ? "disabled" : ""} />
          <span>${escapeHtml(title)}</span>
          <small>${escapeHtml(detail)}</small>
        </label>
      `;
    })
    .join("");
}

function renderWelcome() {
  return `
    <div class="welcome">
      <img class="welcome-mascot" src="${BRAND_ASSET}" alt="" />
      <h2>你好，我是 <span>${BRAND_NAME}</span></h2>
      <p>你的本机智能助手，随时为你答疑解惑</p>
      ${renderWelcomeStatus()}
      <div class="quick-row">
        ${[
          { icon: "file", title: "看一下项目", detail: "梳理现状", prompt: "帮我分析这个目录里已有文件" },
          { icon: "list", title: "先做计划", detail: "拆出步骤", prompt: "先规划一个登录系统实现方案" },
          { icon: "wrench", title: "修复问题", detail: "定位原因", prompt: "检查当前工作区有什么可以改进" },
          { icon: "code", title: "整理文档", detail: "沉淀说明", prompt: "为这个项目创建一个 README" },
        ]
          .map(
            (item) => `<button class="feature-card quick-prompt" data-prompt="${escapeAttr(item.prompt)}">
              <span>${icon(item.icon)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.detail)}</small>
            </button>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderWelcomeStatus() {
  const connected = Boolean(state.config?.claude?.available);
  const workspace = state.user?.homeDir ? shortenPath(state.user.homeDir) : "工作区已准备";
  return `
    <div class="welcome-status" aria-label="当前工作状态">
      <span class="${connected ? "ready" : "warning"}">
        ${icon(connected ? "check" : "wrench")}
        <strong>${connected ? `${BRAND_NAME} 已就绪` : "本机助手未连接"}</strong>
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
        ${visibleItems.map(renderTimelineItem).join("")}
        ${renderTurnFooter(turn, session, isLatest)}
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

function renderTimelineItem(item) {
  if (item.type === "user") {
    return renderUserBubble(item);
  }
  if (item.type === "assistant") {
    const assistantText =
      item.status === "error" || item.status === "canceled" ? userFacingError(item.text) : item.text;
    const waiting = item.status === "streaming" && !assistantText;
    return `
      <article class="assistant-block ${item.status === "streaming" ? "streaming" : ""}">
        <div class="assistant-label">
          <span class="assistant-icon"><img src="${BRAND_ASSET}" alt="" /></span>
          <span>${BRAND_NAME}</span>
        </div>
        <div class="assistant-markdown ${waiting ? "waiting" : assistantText ? "" : "empty"}">${
          waiting ? renderAssistantWaiting() : assistantText ? renderMarkdownLite(assistantText) : "正在组织回复..."
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
    return `<article class="activity-line error">${icon("wrench")}<span>${escapeHtml(userFacingError(item.message))}</span></article>`;
  }
  if (item.type === "meta") {
    return "";
  }
  return `<article class="activity-line">${escapeHtml(formatValue(item))}</article>`;
}

function renderAssistantWaiting() {
  return `
    <div class="assistant-wait-card" role="status" aria-live="polite">
      <span class="assistant-wait-orbit" aria-hidden="true"><i></i></span>
      <div>
        <strong>正在唤起智果本机引擎</strong>
        <span>本机任务已进入队列，${BRAND_NAME} 正在准备回复。</span>
      </div>
    </div>
  `;
}

function renderToolBadge(item) {
  const id = item.id || item.toolUseId;
  const expanded = state.expandedToolIds.has(id);
  const detail = item.detail || { type: "unknown", input: item.input ?? null, output: item.output ?? null };
  const display = toolDisplay(item, detail);
  const canExpand = hasToolDetails(item, detail);
  return `
    <article class="tool-badge ${item.status || ""} ${expanded ? "expanded" : ""}">
      <button class="tool-badge-toggle" data-tool-id="${escapeAttr(id)}" ${canExpand ? "" : "disabled"}>
        <span class="tool-badge-icon">${toolIcon(item.name || display.displayName)}</span>
        <span class="tool-badge-label ${item.status === "running" ? "shimmer-text" : ""}">${escapeHtml(
          display.displayName,
        )}</span>
        ${display.summary ? `<span class="tool-badge-summary">${escapeHtml(display.summary)}</span>` : ""}
        <span class="tool-badge-status">${toolStatusLabel(item.status)}</span>
        ${canExpand ? `<span class="tool-badge-chevron">${icon("chevronRight")}</span>` : ""}
      </button>
      ${expanded && canExpand ? `<div class="tool-detail">${renderToolDetail(detail, item)}</div>` : ""}
    </article>
  `;
}

function renderMessageActions(id) {
  if (!id) return "";
  return `
    <div class="message-actions">
      <button type="button" class="message-action" data-copy-id="${escapeAttr(id)}" aria-label="复制">${icon("copy")}</button>
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
    return `
      <div class="turn-footer running">
        <span class="pulse-dot"></span>
        <span>${BRAND_NAME} 正在回复</span>
        <span>${formatElapsed(startedAt)}</span>
      </div>
    `;
  }
  if (!assistant || assistant.status === "streaming") return "";
  if (assistant.status === "canceled") {
    return `
      <div class="turn-recovery-card" aria-live="polite">
        <div class="turn-recovery-copy">
          <strong>已停止生成</strong>
          <span>本次上下文仍保留，可以继续生成或编辑上一条。</span>
        </div>
        <div class="turn-recovery-actions">
          <button type="button" class="recovery-primary" data-recovery-action="continue" data-recovery-user-id="${escapeAttr(
            turn.user?.id || "",
          )}">继续生成</button>
          <button type="button" data-recovery-action="edit" data-recovery-user-id="${escapeAttr(
            turn.user?.id || "",
          )}">编辑上一条</button>
        </div>
      </div>
    `;
  }
  const label = assistant.status === "error" ? "回复中断" : "";
  if (!label) return "";
  return `
    <div class="turn-footer">
      <span>${label}</span>
    </div>
  `;
}

function toolDisplay(item, detail) {
  const fallback = toolFallbackDisplay(item, detail);
  const summary = fileToolSummary(detail) || item.summary || fallback.summary || "";
  if (item.displayName || item.summary) {
    return {
      displayName: localizeToolName(item.displayName || fallback.displayName || item.name),
      summary: displaySummary(summary),
    };
  }
  return fallback;
}

function toolFallbackDisplay(item, detail) {
  if (detail.type === "shell") return { displayName: "执行命令", summary: detail.command || "" };
  if (detail.type === "read") return { displayName: "读取文件", summary: displayPath(detail.filePath || "") };
  if (detail.type === "write") return { displayName: "写入文件", summary: fileToolSummary(detail, "write") };
  if (detail.type === "edit") return { displayName: "修改文件", summary: fileToolSummary(detail, "edit") };
  if (detail.type === "search") return { displayName: "搜索内容", summary: displaySummary(detail.query || "") };
  if (detail.type === "fetch") return { displayName: "获取网页", summary: displaySummary(detail.url || "") };
  return { displayName: localizeToolName(item.name || "Tool"), summary: "" };
}

function localizeToolName(name) {
  const raw = String(name || "");
  if (/执行命令|读取文件|写入文件|修改文件|搜索内容|获取网页|任务清单/.test(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower === "shell" || lower.includes("bash")) return "执行命令";
  if (lower === "read" || lower.includes("read")) return "读取文件";
  if (lower === "write" || lower.includes("write")) return "写入文件";
  if (lower === "edit" || lower.includes("edit")) return "修改文件";
  if (lower === "search" || lower.includes("grep") || lower.includes("glob")) return "搜索内容";
  if (lower === "fetch" || lower.includes("webfetch")) return "获取网页";
  if (lower.includes("task") || lower.includes("todo")) return "任务清单";
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
    return `<div class="tool-detail-loading"><span class="pulse-dot"></span> 正在等待结果</div>`;
  }
  if (detail.type === "shell") {
    return `${renderDetailSection("执行内容", detail.command)}${renderDetailSection("执行结果", detail.output, "pre")}`;
  }
  if (detail.type === "read") {
    return `${renderDetailSection("文件", detail.filePath)}${renderDetailSection("内容", detail.content, "pre")}`;
  }
  if (detail.type === "write") {
    return `${renderFileToolSummary(detail, "write")}${renderDetailSection("文件", detail.filePath)}${renderDetailSection(
      "内容",
      detail.content,
      "pre",
    )}`;
  }
  if (detail.type === "edit") {
    return `${renderFileToolSummary(detail, "edit")}${renderDetailSection("文件", detail.filePath)}${renderDetailSection(
      "变更",
      detail.unifiedDiff || diffStrings(detail.oldString, detail.newString),
      "pre",
    )}`;
  }
  if (detail.type === "search") {
    return `${renderDetailSection("搜索词", detail.query)}${renderDetailSection("结果", detail.content, "pre")}`;
  }
  if (detail.type === "fetch") {
    return `${renderDetailSection("链接", detail.url)}${renderDetailSection("结果", detail.result, "pre")}`;
  }
  return `${renderDetailSection("输入", item.input, "pre")}${renderDetailSection("输出", item.output, "pre")}`;
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
          <input class="sheet-input" id="rename-sheet-input" value="${escapeAttr(sheet.value || "")}" maxlength="48" ${
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
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭" ${busy ? "disabled" : ""}></button>
        <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="停止并退出登录">
          <div class="sheet-handle"></div>
          <h3>停止并退出登录？</h3>
          <p>当前回复会先停止，所有会话仍会保存在本机；下次登录后可以继续查看。</p>
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
  if (sheet.type === "sessionActions") {
    return `
      <div class="sheet-layer">
        <button type="button" class="sheet-backdrop" id="sheet-backdrop" aria-label="关闭"></button>
        <div class="sheet-panel action-sheet" role="dialog" aria-modal="true" aria-label="会话操作">
          <div class="sheet-handle"></div>
          <button type="button" data-sheet-action="rename">${icon("edit")}<span>重命名</span></button>
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
  state.sheet = { type: "sessionActions" };
  state.sessionMenuOpen = false;
  render();
}

function openSettings(options = {}) {
  rememberReturnFocus(options.returnFocus || "#settings-button");
  state.settingsOpen = true;
  state.settingsError = "";
  state.settingsBusy = false;
  state.logoutBusy = false;
  state.sessionMenuOpen = false;
  state.settingsAdvanced = options.advanced === true;
  if (options.closeSheet) state.sheet = null;
  if (options.closeMobile) state.mobileDrawerOpen = false;
  render();
}

function closeSettings() {
  if (state.settingsBusy || state.logoutBusy) return;
  state.settingsOpen = false;
  state.settingsError = "";
  render();
  restoreReturnFocus("#settings-button");
}

function openRenameSheet(options = {}) {
  if (!state.activeSession) return;
  rememberReturnFocus(options.returnFocus || "#conversation-menu-button");
  state.sheet = { type: "rename", value: state.activeSession.title || "" };
  state.sheetBusy = false;
  state.sessionMenuOpen = false;
  render();
  requestAnimationFrame(() => {
    const input = document.getElementById("rename-sheet-input");
    input?.focus();
    input?.select();
  });
}

async function submitRenameSheet(event) {
  event.preventDefault();
  if (state.sheetBusy) return;
  const input = document.getElementById("rename-sheet-input");
  const title = input?.value.trim();
  if (!title) {
    state.sheet = { ...(state.sheet || {}), type: "rename", value: input?.value || "", error: "请输入会话名称" };
    render();
    requestAnimationFrame(() => document.getElementById("rename-sheet-input")?.focus());
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
  state.sheetBusy = false;
  state.sheet = null;
  render();
  restoreReturnFocus("#conversation-menu-button");
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
  }
}

function renderDetailSection(label, value, mode = "text") {
  if (value === null || value === undefined || value === "") return "";
  const content = displaySafeText(typeof value === "string" ? value : formatValue(value));
  return `
    <section class="tool-detail-section">
      <h4>${escapeHtml(label)}</h4>
      ${mode === "pre" ? `<pre>${escapeHtml(content)}</pre>` : `<p>${escapeHtml(content)}</p>`}
    </section>
  `;
}

function renderFileToolSummary(detail, type) {
  const summary = fileChangeLabel(detail, type);
  return summary ? renderDetailSection("摘要", summary) : "";
}

function fileToolSummary(detail, type = detail?.type) {
  if (!detail || (type !== "write" && type !== "edit")) return "";
  const file = displayPath(detail.filePath || "");
  const change = fileChangeLabel(detail, type);
  return [file, change].filter(Boolean).join(" · ");
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
  const sessionRunning = state.activeSession?.status === "running";
  const composerEmpty = !state.composerDraft.trim();
  const sendDisabled = disabled || sessionRunning || composerEmpty;
  const placeholder = disabled
    ? "本机助手暂未连接，请先检查设置"
    : `发消息给 ${BRAND_NAME}`;
  return `
    <div class="composer-wrap">
      ${
        disabled
          ? `<div class="connection-inline">
              <span>${icon("wrench")}</span>
              <div>
                <strong>本机助手未连接</strong>
                <p>检查本机引擎路径后即可继续对话。</p>
              </div>
              <button type="button" id="composer-settings-button">检查设置</button>
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
            <button type="button" class="tool-button attachment-button" id="attachment-button" aria-label="添加附件" data-tooltip="添加附件">${icon("paperclip")}</button>
          </div>
          <button class="primary-button send-button" type="submit" ${sendDisabled ? "disabled" : ""} aria-disabled="${
            sendDisabled ? "true" : "false"
          }">
            ${sessionRunning ? "运行中" : `发送 ${icon("arrowUp")}`}
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderScrollButton() {
  const hasMessages = Boolean(state.activeSession?.messages?.length);
  const visible = Boolean(hasMessages && state.showScrollButton);
  return `
    <button type="button" class="scroll-bottom ${visible ? "visible" : ""}" id="scroll-bottom-button" aria-hidden="${
      visible ? "false" : "true"
    }" aria-label="回到底部" tabindex="${visible ? "0" : "-1"}">
      ${icon("arrowDown")}<span>回到底部</span>
    </button>
  `;
}

function renderSettingsModal() {
  const settings = state.pendingSettings || state.config?.settings || {};
  const claude = state.config?.claude || {};
  const connected = Boolean(claude.available);
  const busy = state.settingsBusy || state.logoutBusy;
  const disabled = busy ? "disabled" : "";
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <form class="modal ${busy ? "busy" : ""}" id="settings-form" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-busy="${busy ? "true" : "false"}">
        <div class="modal-header">
          <h2 id="settings-title">设置</h2>
          <button type="button" class="icon-button" id="close-settings" aria-label="关闭" data-tooltip="关闭" ${disabled}>${icon("x")}</button>
        </div>
        <div class="modal-body">
          <section class="settings-card connection-card ${connected ? "ok" : "warn"}">
            <div class="settings-card-icon">${icon(connected ? "check" : "wrench")}</div>
            <div>
              <h3>${connected ? "本机助手已连接" : "本机助手未连接"}</h3>
              <p>${connected ? "可以继续发起对话和执行本机任务。" : "检查高级设置里的本机引擎路径后再试。"}</p>
            </div>
          </section>
          <section class="settings-card">
            <h3>账号</h3>
            <div class="settings-list">
              <div><span>当前账号</span><strong>${escapeHtml(state.user.username)}</strong></div>
              <div><span>工作区</span><strong>${escapeHtml(shortenPath(state.user.homeDir))}</strong></div>
            </div>
          </section>
          <section class="settings-card">
            <h3>默认权限</h3>
            <div class="mode-card-list">
              ${renderModeCards(settings.defaultMode || "plan", busy)}
            </div>
          </section>
          <button type="button" class="advanced-toggle" id="advanced-toggle" ${disabled}>
            <span>高级设置</span>
            <em>${state.settingsAdvanced ? "收起" : "展开"}</em>
          </button>
          <div class="advanced-settings ${state.settingsAdvanced ? "open" : ""}">
            <div class="field">
              <label for="claudePath">本机引擎路径</label>
              <input id="claudePath" name="claudePath" value="${escapeAttr(settings.claudePath || "claude")}" ${disabled} />
            </div>
            <div class="field">
              <label for="defaultModel">默认模型，可留空</label>
              <input id="defaultModel" name="defaultModel" value="${escapeAttr(settings.defaultModel || "")}" placeholder="可选，留空使用默认模型" ${disabled} />
            </div>
            <div class="field">
              <label for="maxTurns">单次最大步骤数，可留空</label>
              <input id="maxTurns" name="maxTurns" value="${escapeAttr(settings.maxTurns || "")}" placeholder="例如 8" ${disabled} />
            </div>
            <div class="field">
              <label for="appendSystemPrompt">追加系统提示</label>
              <textarea id="appendSystemPrompt" name="appendSystemPrompt" ${disabled}>${escapeHtml(
                settings.appendSystemPrompt || "",
              )}</textarea>
            </div>
            <div class="settings-meta">
              <span>连接详情</span>
              <strong>${escapeHtml(connected ? `${claude.resolvedPath} ${claude.version || ""}` : "未找到")}</strong>
            </div>
          </div>
          <div id="settings-error" class="inline-error settings-error" aria-live="polite">${
            state.settingsError
              ? `${icon("wrench")}<span>${escapeHtml(state.settingsError)}</span>`
              : ""
          }</div>
          ${
            state.settingsBusy
              ? `<div class="settings-progress" role="status" aria-live="polite">
                  <span class="auth-progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  <strong>正在保存设置</strong>
                  <em>正在检查本机助手状态，完成后会自动回到对话。</em>
                </div>`
              : ""
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="ghost-button" id="logout-button" ${busy ? "disabled" : ""}>
            ${state.logoutBusy ? `<span class="button-spinner subtle"></span>退出中` : "退出登录"}
          </button>
          <button type="submit" class="primary-button" ${busy ? "disabled" : ""}>
            ${state.settingsBusy ? `<span class="button-spinner"></span>保存中` : "保存设置"}
          </button>
        </div>
      </form>
    </div>
  `;
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
    openSettings({ closeMobile: true, returnFocus: "#mobile-menu-button" });
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
  document.getElementById("session-search")?.addEventListener("input", handleSessionSearchInput);
  document.getElementById("mobile-session-search")?.addEventListener("input", handleSessionSearchInput);
  document.querySelectorAll("[data-toast-action]").forEach((button) => {
    button.addEventListener("click", () => handleToastAction(button.dataset.toastAction));
  });
  bindSessionListEvents();
  document.querySelectorAll(".quick-prompt").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!state.config?.claude?.available || state.activeSession?.status === "running") return;
      await ensureActiveSession();
      state.composerDraft = button.dataset.prompt || "";
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
      await copyText(copyTextForItem(item));
      restoreCapturedChatScroll(scrollSnapshot);
      expandedToolIds.forEach((id) => {
        requestAnimationFrame(() => keepExpandedToolVisible(id));
        window.setTimeout(() => keepExpandedToolVisible(id), 160);
      });
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
    resizeComposer(composerInput);
    syncComposerSendState(composerInput);
  });
  composerInput?.addEventListener("input", () => {
    state.composerDraft = composerInput.value;
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
  document.getElementById("attachment-button")?.addEventListener("click", () => {
    showToast("附件能力正在打磨中");
  });
  document.querySelectorAll("[data-sheet-action]").forEach((button) => {
    button.addEventListener("click", () => handleSheetAction(button.dataset.sheetAction));
  });
  document.getElementById("sheet-backdrop")?.addEventListener("click", closeSheet);
  document.getElementById("rename-sheet-form")?.addEventListener("submit", submitRenameSheet);
  bindSettingsEvents();
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function handleSessionSearchInput(event) {
  state.sessionQuery = event.currentTarget.value;
  syncSessionSearchInputs(event.currentTarget.id);
  refreshSessionLists();
}

function syncSessionSearchInputs(sourceId = "") {
  ["session-search", "mobile-session-search"].forEach((id) => {
    if (id === sourceId) return;
    const input = document.getElementById(id);
    if (input && input.value !== state.sessionQuery) input.value = state.sessionQuery;
  });
}

function refreshSessionLists() {
  const html = renderSessionList(groupSessions(filterSessions(state.sessions)));
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
  const item = findTimelineItem(userId);
  if (action === "edit" && item?.text) {
    fillComposerDraft(item.text);
    return;
  }
  fillComposerDraft("请基于刚才已经完成的内容继续。");
}

function fillComposerDraft(text) {
  state.composerDraft = text;
  state.composerError = null;
  render();
  requestAnimationFrame(() => {
    const input = document.getElementById("composer-input");
    if (!input) return;
    input.focus();
    resizeComposer(input);
  });
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
    input.addEventListener("change", syncModeCardSelection);
  });
  document.getElementById("advanced-toggle")?.addEventListener("click", () => {
    if (state.settingsBusy || state.logoutBusy) return;
    state.settingsAdvanced = !state.settingsAdvanced;
    render();
  });
  document.getElementById("close-settings")?.addEventListener("click", closeSettings);
  document.getElementById("modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") {
      closeSettings();
    }
  });
  document.getElementById("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.settingsBusy || state.logoutBusy) return;
    const form = new FormData(event.currentTarget);
    const nextSettings = Object.fromEntries(form.entries());
    state.settingsBusy = true;
    state.pendingSettings = { ...(state.config?.settings || {}), ...nextSettings };
    state.settingsError = "";
    render();
    try {
      const result = await api.patch("/api/config", nextSettings);
      state.config = { ...state.config, ...result };
      state.pendingSettings = null;
      state.settingsBusy = false;
      state.settingsOpen = false;
      showToast("设置已保存");
    } catch (err) {
      state.settingsBusy = false;
      state.pendingSettings = null;
      state.settingsError = userFacingError(err.message);
      render();
    }
  });
  document.getElementById("logout-button")?.addEventListener("click", async () => {
    if (state.settingsBusy || state.logoutBusy) return;
    if (state.activeSession?.status === "running") {
      state.settingsError = "";
      state.sheetBusy = false;
      state.sheet = { type: "confirmLogout", error: "" };
      render();
      return;
    }
    await logoutUser();
  });
}

function syncModeCardSelection() {
  document.querySelectorAll(".mode-card").forEach((card) => {
    const input = card.querySelector("input[name='defaultMode']");
    card.classList.toggle("selected", Boolean(input?.checked));
  });
}

async function newChat() {
  if (state.activeSession?.status === "running") {
    state.sessionMenuOpen = false;
    state.mobileDrawerOpen = false;
    state.sheetBusy = false;
    state.sheet = { type: "confirmNewChat", error: "" };
    render();
    return state.activeSession;
  }
  startDraftSession();
  return state.activeSession;
}

function startDraftSession() {
  closeEvents();
  const settings = state.config?.settings || {};
  state.composerDraft = "";
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
  state.sessionMenuOpen = false;
  state.mobileDrawerOpen = false;
  state.forceScrollBottom = true;
  render();
}

async function stopAndStartNewChat() {
  if (!state.activeSession || state.sheetBusy) return;
  const sessionId = state.activeSession.id;
  state.sheetBusy = true;
  state.sheet = { ...(state.sheet || {}), type: "confirmNewChat", error: "" };
  render();
  try {
    if (state.activeSession.status === "running" && !state.activeSession.draft) {
      await api.post(`/api/sessions/${sessionId}/stop`);
      await refreshSessions();
    }
    startDraftSession();
    showToast("已停止，已新建对话");
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
    if (state.activeSession.status === "running" && !state.activeSession.draft) {
      await api.post(`/api/sessions/${sessionId}/stop`);
      await refreshSessions();
    }
    state.sheet = null;
    state.sheetBusy = false;
    await openSession(targetId, { skipRunningGuard: true });
    showToast("已停止，已切换会话");
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
    if (state.activeSession.status === "running" && !state.activeSession.draft) {
      await api.post(`/api/sessions/${sessionId}/stop`);
    }
    await logoutUser({ renderStart: false });
  } catch (err) {
    state.sheetBusy = false;
    state.logoutBusy = false;
    state.sheet = { ...(state.sheet || {}), type: "confirmLogout", error: userFacingError(err.message) };
    render();
  }
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
    if (state.sheet?.type === "confirmLogout") {
      state.sheet = { ...(state.sheet || {}), type: "confirmLogout", error: userFacingError(err.message) };
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
  state.config = null;
  state.pendingSettings = null;
  state.composerDraft = "";
  state.stopBusy = false;
  state.sheetBusy = false;
  state.sheet = null;
  state.settingsOpen = false;
  state.sessionMenuOpen = false;
  state.mobileDrawerOpen = false;
  state.logoutBusy = false;
  state.authMode = "login";
  state.authError = "";
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
  state.stopBusy = false;
  state.openingSessionId = id;
  state.sessionMenuOpen = false;
  if (options.renderAfter !== false) render();
  try {
    const result = await api.get(`/api/sessions/${id}`);
    state.activeSession = result.session;
    state.stderr = "";
    state.composerDraft = "";
    state.mobileDrawerOpen = false;
    state.forceScrollBottom = true;
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
    void refreshSessions();
  });
  source.addEventListener("deleted", () => {
    state.activeSession = null;
    state.stopBusy = false;
    state.forceScrollBottom = true;
    void loadAuthedState().then(render);
  });
  state.eventSource = source;
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
  const settings = state.config?.settings || {};
  let previousSession = null;
  try {
    await ensureActiveSession();
    let session = state.activeSession;
    if (!session || session.draft) {
      const created = await api.post("/api/sessions", {
        title: titleFromText(text),
        mode: session?.mode || settings.defaultMode,
        model: session?.model || settings.defaultModel,
      });
      session = created.session;
      state.activeSession = session;
      connectEvents(session.id);
      await refreshSessions();
    }
    const mode = session.mode || settings.defaultMode || "plan";
    const model = session.model || settings.defaultModel || "";
    previousSession = {
      ...session,
      messages: [...(session.messages || [])],
      status: session.status,
    };
    input.value = "";
    state.composerDraft = "";
    state.sending = true;
    state.stopBusy = false;
    state.composerError = null;
    state.pendingMessage = text;
    state.forceScrollBottom = true;
    const now = new Date().toISOString();
    state.activeSession = {
      ...session,
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
    syncSessionSummary(state.activeSession);
    render();
    await api.post(`/api/sessions/${session.id}/messages`, { text, mode, model });
    await refreshSessions();
  } catch (err) {
    state.sending = false;
    input.value = text;
    state.composerDraft = text;
    if (previousSession) state.activeSession = previousSession;
    state.composerError = userFacingError(err.message);
    showToast(state.composerError);
    render();
  }
}

async function refreshSessions() {
  const result = await api.get("/api/sessions");
  state.sessions = result.sessions || [];
}

function syncSessionSummary(session) {
  const index = state.sessions.findIndex((entry) => entry.id === session.id);
  const last = [...(session.messages || [])].reverse().find(isPreviewableItem);
  const summary = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    mode: session.mode,
    model: session.model,
    preview: last ? previewFor(last) : "",
  };
  if (index >= 0) state.sessions[index] = summary;
  else state.sessions.unshift(summary);
  state.sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function isPreviewableItem(item) {
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
  const compact = naturalPreview(text).replace(/\s+/g, " ").trim();
  const namedTask = compact.match(/^([^：:]{2,18})[：:]\s*(?:请|只|帮|用|给|上一轮|不要|第一|第二|第三)/);
  if (namedTask?.[1]) return namedTask[1].trim();
  if (/请用\s*Bash/i.test(compact) && /pwd|当前目录/.test(compact)) return "查看当前目录";
  if (/sleep\s+\d+/.test(compact)) return "运行计时任务";
  return compact;
}

function userFacingError(message = "") {
  const text = String(message || "");
  if (/Invalid username or password/i.test(text)) return "账号或密码不正确，请重新输入。";
  if (/Username already exists/i.test(text)) return "这个用户名已经被使用，请换一个。";
  if (/Password must be at least/i.test(text)) return "密码至少需要 6 位。";
  if (/Username must start/i.test(text)) return "用户名需以字母开头，长度 3-32 位。";
  if (/Unauthorized/i.test(text)) return "登录已失效，请重新登录。";
  if (/not found|ENOENT|Claude Code executable|Local engine executable/i.test(text))
    return "未找到本机助手，请在设置里检查本机引擎路径。";
  if (/Session not found/i.test(text)) return "这个会话暂时无法打开，请刷新后重试。";
  if (/already running/i.test(text)) return `${BRAND_NAME} 正在回复，请稍后再发送。`;
  if (/Stopped by user|code 143|SIGTERM/i.test(text)) return "已停止生成。";
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
    showToast("已停止生成");
  } catch (err) {
    state.stopBusy = false;
    showToast(userFacingError(err.message));
  }
}

async function renameActiveSession() {
  if (!state.activeSession) return;
  state.sessionMenuOpen = false;
  openRenameSheet({ returnFocus: "#conversation-menu-button" });
}

async function deleteActiveSession() {
  if (!state.activeSession) return;
  state.sessionMenuOpen = false;
  state.sheetBusy = false;
  state.sheet = { type: "confirmArchive" };
  render();
}

async function archiveActiveSession() {
  if (!state.activeSession || state.sheetBusy) return;
  const archived = {
    id: state.activeSession.id,
    title: state.activeSession.title || "这个会话",
  };
  state.sheet = { ...(state.sheet || {}), type: "confirmArchive", error: "" };
  state.sheetBusy = true;
  render();
  try {
    await api.delete(`/api/sessions/${state.activeSession.id}`);
    closeEvents();
    state.activeSession = null;
    state.sheet = null;
    state.sheetBusy = false;
    state.forceScrollBottom = true;
    await loadAuthedState();
    showToast({
      message: "已归档",
      actionLabel: "撤销",
      action: "undoArchive",
      payload: archived,
    });
    render();
  } catch (err) {
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
    state.activeSession = result.session;
    state.sheet = null;
    state.sessionMenuOpen = false;
    state.mobileDrawerOpen = false;
    state.forceScrollBottom = true;
    syncSessionSummary(result.session);
    connectEvents(result.session.id);
    await refreshSessions();
    showToast("已恢复");
  } catch (err) {
    showToast(userFacingError(err.message));
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
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制");
  } catch {
    selectCopyBuffer(text);
    showToast("已选中");
  }
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

function resizeComposer(input) {
  const minHeight = isMobileViewport() ? 42 : 58;
  const maxHeight = isMobileViewport() ? 132 : 180;
  input.style.height = "auto";
  input.style.height = `${Math.min(maxHeight, Math.max(minHeight, input.scrollHeight))}px`;
}

function updateScrollButtonVisibility() {
  const region = document.getElementById("chat-region");
  const button = document.getElementById("scroll-bottom-button");
  if (!region || !button || !state.activeSession?.messages?.length) return;
  const visible = !isChatNearBottom();
  state.showScrollButton = visible;
  applyScrollButtonVisibility(button, visible);
}

function applyScrollButtonVisibility(button, visible) {
  if (!button) return;
  button.classList.toggle("visible", visible);
  button.setAttribute("aria-hidden", visible ? "false" : "true");
  button.setAttribute("tabindex", visible ? "0" : "-1");
}

function renderStatusText(status) {
  if (status === "running" || status === "streaming") return "运行中";
  if (status === "error") return "异常";
  if (status === "done") return "已完成";
  return status || "空闲";
}

function toolIcon(name = "") {
  const lower = name.toLowerCase();
  if (lower.includes("read")) return icon("file");
  if (lower.includes("write") || lower.includes("edit")) return icon("edit");
  if (lower.includes("bash") || lower.includes("shell")) return icon("terminalSmall");
  if (lower.includes("search") || lower.includes("grep")) return icon("search");
  if (lower.includes("task") || lower.includes("todo")) return icon("list");
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
    const language = match[1] ? `<div class="code-language">${escapeHtml(match[1])}</div>` : "";
    parts.push(`<pre class="markdown-code">${language}<code>${escapeHtml(match[2] || "")}</code></pre>`);
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

function toolStatusLabel(status) {
  if (status === "running" || status === "streaming") return "进行中";
  if (status === "error" || status === "failed") return "失败";
  if (status === "done" || status === "completed") return "已完成";
  if (status === "canceled") return "已取消";
  return status || "";
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
  requestAnimationFrame(() => {
    const region = document.getElementById("chat-region");
    if (!region) return;
    region.scrollTop = region.scrollHeight;
    updateScrollButtonVisibility();
    window.setTimeout(updateScrollButtonVisibility, 80);
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
  const selector = `[data-tool-id="${CSS.escape(id)}"]`;
  const card = document.querySelector(selector)?.closest(".tool-badge");
  if (!region || !composer || !card) return;
  const adjust = () => {
    let cardRect = card.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    let nextRect = card.nextElementSibling?.getBoundingClientRect();
    const maxScrollTop = Math.max(0, region.scrollHeight - region.clientHeight);
    const safeToolBottom = composerRect.top - 24;
    const safeNextTop = composerRect.top - 120;
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
    }
  };
  adjust();
  requestAnimationFrame(adjust);
  if (attempt < 6) {
    window.setTimeout(() => keepExpandedToolVisible(id, attempt + 1), attempt < 2 ? 80 : 140);
  }
}
