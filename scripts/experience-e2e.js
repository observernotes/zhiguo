"use strict";

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error("Playwright is required. Run `npm install` first, then `npm run test:experience`.");
  process.exit(1);
}

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const BASE_URL = process.env.BASE_URL || "http://localhost:3300/?v=experience";
const PASSWORD = process.env.TEST_PASSWORD || `test_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const USERNAME = process.env.TEST_USERNAME || `ux_${Date.now()}`;
const HEADLESS = process.env.HEADLESS !== "0";

const checks = [];
const dialogs = [];

function record(name, ok, detail = "") {
  const item = { name, ok: Boolean(ok), detail };
  checks.push(item);
  console.log(`${item.ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function waitIdle(page, name, timeout = 120000) {
  await page.waitForTimeout(250);
  await page
    .waitForFunction(
      () =>
        Boolean(
          document.querySelector(
            "#stop-button, .turn-footer.running, .assistant-block.streaming",
          ),
        ),
      undefined,
      { timeout: 10000 },
    )
    .catch(() => {});
  await page.waitForFunction(
    () => {
      const input = document.querySelector("#composer-input");
      const running = document.querySelector("#stop-button, .turn-footer.running, .assistant-block.streaming");
      return input && !input.disabled && !running;
    },
    undefined,
    { timeout },
  );
  await page.waitForTimeout(900);
  record(name, true);
}

async function send(page, text) {
  await page.locator("#composer-input").fill(text);
  await page.locator("#composer-form button[type='submit']").click();
}

async function createSessionViaApi(page, title) {
  return page.evaluate(async (sessionTitle) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: sessionTitle }),
    });
    if (!res.ok) throw new Error(`create session failed: ${res.status}`);
    return res.json();
  }, title);
}

async function currentWorkspaceRoot(page) {
  return page.evaluate(async () => {
    const res = await fetch("/api/me");
    if (!res.ok) return "";
    const data = await res.json();
    return data.user?.homeDir || "";
  });
}

async function mobileAuthVisualFlow(context) {
  const mobile = await context.newPage();
  mobile.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("#auth-form", { timeout: 10000 });
  const loginGeometry = await mobile.evaluate(() => {
    const card = document.querySelector(".auth-card");
    const submit = document.querySelector("#auth-form button[type='submit']");
    const username = document.querySelector("#username");
    const password = document.querySelector("#password");
    const switcher = document.querySelector("#switch-auth");
    const cardRect = card?.getBoundingClientRect();
    const submitRect = submit?.getBoundingClientRect();
    const usernameRect = username?.getBoundingClientRect();
    const passwordRect = password?.getBoundingClientRect();
    const switchRect = switcher?.getBoundingClientRect();
    return {
      cardBottom: cardRect ? Math.round(innerHeight - cardRect.bottom) : null,
      cardWidth: cardRect ? Math.round(cardRect.width) : null,
      submitHeight: Math.round(submitRect?.height || 0),
      usernameHeight: Math.round(usernameRect?.height || 0),
      passwordHeight: Math.round(passwordRect?.height || 0),
      switchBottomGap: Math.round(innerHeight - (switchRect?.bottom || 0)),
      bodyScrollY: Math.round(window.scrollY),
    };
  });
  record(
    "移动端登录主操作达到触控规格",
    loginGeometry.submitHeight >= 48 &&
      loginGeometry.usernameHeight >= 48 &&
      loginGeometry.passwordHeight >= 46 &&
      loginGeometry.cardBottom === 0 &&
      loginGeometry.cardWidth === 390 &&
      loginGeometry.switchBottomGap >= 16 &&
      loginGeometry.bodyScrollY === 0,
    JSON.stringify(loginGeometry),
  );
  await mobile.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-mobile-auth-login.png"), fullPage: false });
  await mobile.getByRole("button", { name: /创建新账号/ }).click();
  await mobile.waitForSelector("#confirmPassword", { timeout: 5000 });
  const registerGeometry = await mobile.evaluate(() => {
    const card = document.querySelector(".auth-card");
    const submit = document.querySelector("#auth-form button[type='submit']");
    const confirm = document.querySelector("#confirmPassword");
    const switcher = document.querySelector("#switch-auth");
    const cardRect = card?.getBoundingClientRect();
    const submitRect = submit?.getBoundingClientRect();
    const confirmRect = confirm?.getBoundingClientRect();
    const switchRect = switcher?.getBoundingClientRect();
    return {
      cardBottom: cardRect ? Math.round(innerHeight - cardRect.bottom) : null,
      cardWidth: cardRect ? Math.round(cardRect.width) : null,
      submitHeight: Math.round(submitRect?.height || 0),
      confirmHeight: Math.round(confirmRect?.height || 0),
      switchBottomGap: Math.round(innerHeight - (switchRect?.bottom || 0)),
      bodyScrollY: Math.round(window.scrollY),
    };
  });
  record(
    "移动端注册主操作达到触控规格",
    registerGeometry.submitHeight >= 48 &&
      registerGeometry.confirmHeight >= 48 &&
      registerGeometry.cardBottom === 0 &&
      registerGeometry.cardWidth === 390 &&
      registerGeometry.switchBottomGap >= 16 &&
      registerGeometry.bodyScrollY === 0,
    JSON.stringify(registerGeometry),
  );
  await mobile.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-mobile-auth-register.png"), fullPage: false });
  await mobile.close();
}

async function register(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByLabel("用户名").fill(`missing_${Date.now()}`);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#password").focus();
  await page.locator("#toggle-password").click();
  await page.waitForFunction(
    () => document.querySelector("#password")?.type === "text" && document.activeElement?.id === "password",
    undefined,
    { timeout: 5000 },
  );
  const passwordToggle = await page.locator("#toggle-password").evaluate((button) => ({
    title: button.getAttribute("title"),
    label: button.getAttribute("aria-label"),
    tooltip: button.getAttribute("data-tooltip"),
    text: button.textContent.trim(),
    hasIcon: Boolean(button.querySelector("svg")),
    activeId: document.activeElement?.id || "",
    type: document.querySelector("#password")?.type || "",
  }));
  record(
    "密码显示切换使用图标化产品控件",
    passwordToggle.title === null &&
      passwordToggle.label === "隐藏密码" &&
      passwordToggle.tooltip === "隐藏密码" &&
      passwordToggle.text === "" &&
      passwordToggle.hasIcon,
  );
  record("密码显示切换后保留输入焦点", passwordToggle.activeId === "password" && passwordToggle.type === "text");
  await page.locator("#toggle-password").click();
  await page.waitForFunction(() => document.querySelector("#password")?.type === "password", undefined, {
    timeout: 5000,
  });
  await page.locator("#toggle-password").click();
  await page.waitForFunction(() => document.querySelector("#password")?.type === "text", undefined, {
    timeout: 5000,
  });
  await page.getByRole("button", { name: /创建新账号/ }).click();
  await page.waitForSelector("#confirmPassword", { timeout: 5000 });
  const fastAuthUsername = `fast_${Date.now()}`;
  await page.locator("#username").fill(fastAuthUsername);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirmPassword").fill(PASSWORD);
  const fastAuthValues = await page.evaluate(() => ({
    activeId: document.activeElement?.id || "",
    username: document.querySelector("#username")?.value || "",
    password: document.querySelector("#password")?.value || "",
    confirmPassword: document.querySelector("#confirmPassword")?.value || "",
  }));
  record(
    "切换注册后快速输入不会串入错误字段",
    fastAuthValues.username === fastAuthUsername &&
      fastAuthValues.password === PASSWORD &&
      fastAuthValues.confirmPassword === PASSWORD &&
      fastAuthValues.activeId === "confirmPassword",
    JSON.stringify(fastAuthValues),
  );
  await page.evaluate(() => {
    ["username", "password", "confirmPassword"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    document.getElementById("username")?.focus();
  });
  await page.waitForFunction(() => document.activeElement?.id === "username", undefined, { timeout: 5000 });
  const registerSwitchState = await page.evaluate(() => ({
    activeId: document.activeElement?.id || "",
    passwordType: document.querySelector("#password")?.type || "",
    toggleLabel: document.querySelector("#toggle-password")?.getAttribute("aria-label") || "",
    passwordValue: document.querySelector("#password")?.value || "",
  }));
  record(
    "切换注册重置密码可见状态并聚焦用户名",
    registerSwitchState.activeId === "username" &&
      registerSwitchState.passwordType === "password" &&
      registerSwitchState.toggleLabel === "显示密码" &&
      registerSwitchState.passwordValue === "",
  );
  await page.getByRole("button", { name: /已有账号/ }).click();
  await page.waitForFunction(
    () => !document.querySelector("#confirmPassword") && document.activeElement?.id === "username",
    undefined,
    { timeout: 5000 },
  );
  const loginSwitchState = await page.evaluate(() => ({
    activeId: document.activeElement?.id || "",
    passwordType: document.querySelector("#password")?.type || "",
    toggleLabel: document.querySelector("#toggle-password")?.getAttribute("aria-label") || "",
  }));
  record(
    "切回登录保持密码隐藏并聚焦用户名",
    loginSwitchState.activeId === "username" &&
      loginSwitchState.passwordType === "password" &&
      loginSwitchState.toggleLabel === "显示密码",
  );
  await page.locator("#username").fill(`missing_${Date.now()}`);
  await page.locator("#password").fill(PASSWORD);
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "POST" && url.endsWith("/api/login") && !window.__authLoginDelayed) {
        window.__authLoginDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.getByRole("button", { name: /^继续$/ }).click();
  await page.waitForSelector("#auth-form[aria-busy='true']", { timeout: 5000 });
  const loginBusy = await page.evaluate(() => ({
    progress: document.querySelector(".auth-progress")?.textContent || "",
    usernameDisabled: Boolean(document.querySelector("#username")?.disabled),
    passwordDisabled: Boolean(document.querySelector("#password")?.disabled),
    switchDisabled: Boolean(document.querySelector("#switch-auth")?.disabled),
    submit: document.querySelector("#auth-form button[type='submit']")?.textContent || "",
  }));
  record(
    "登录请求展示精致加载态",
    loginBusy.progress.includes("正在同步本机会话") &&
      loginBusy.progress.includes("马上回到最近的对话") &&
      loginBusy.usernameDisabled &&
      loginBusy.passwordDisabled &&
      loginBusy.switchDisabled &&
      loginBusy.submit.includes("登录中"),
    JSON.stringify(loginBusy),
  );
  await page.waitForSelector(".auth-error", { timeout: 10000 });
  const errorText = await page.locator(".auth-error").innerText();
  record("登录错误使用产品内提示", errorText.includes("账号或密码不正确") && dialogs.length === 0);
  await page.getByRole("button", { name: /创建新账号/ }).click();
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByRole("textbox", { name: "密码", exact: true }).fill("123");
  await page.getByRole("textbox", { name: "确认密码" }).fill("123");
  await page.getByRole("button", { name: /创建并进入/ }).click();
  await page.waitForSelector(".auth-error", { timeout: 10000 });
  record("弱密码使用产品内校验", (await page.locator(".auth-error").innerText()).includes("密码至少需要 6 位"));
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByRole("textbox", { name: "密码", exact: true }).fill(PASSWORD);
  await page.getByRole("textbox", { name: "确认密码" }).fill(PASSWORD);
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "POST" && url.endsWith("/api/register") && !window.__authRegisterDelayed) {
        window.__authRegisterDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.getByRole("button", { name: /创建并进入/ }).click();
  await page.waitForSelector("#auth-form[aria-busy='true']", { timeout: 5000 });
  const registerBusy = await page.evaluate(() => ({
    progress: document.querySelector(".auth-progress")?.textContent || "",
    usernameDisabled: Boolean(document.querySelector("#username")?.disabled),
    passwordDisabled: Boolean(document.querySelector("#password")?.disabled),
    confirmDisabled: Boolean(document.querySelector("#confirmPassword")?.disabled),
    submit: document.querySelector("#auth-form button[type='submit']")?.textContent || "",
  }));
  record(
    "注册请求展示工作区创建加载态",
    registerBusy.progress.includes("正在创建本机工作区") &&
      registerBusy.progress.includes("账号文件夹会自动准备好") &&
      registerBusy.usernameDisabled &&
      registerBusy.passwordDisabled &&
      registerBusy.confirmDisabled &&
      registerBusy.submit.includes("创建中"),
    JSON.stringify(registerBusy),
  );
  await page.waitForSelector(".composer", { timeout: 15000 });
  const workspaceRoot = await currentWorkspaceRoot(page);
  const userFolder = workspaceRoot ? await fs.stat(workspaceRoot).catch(() => null) : null;
  record(
    "账号创建同名工作区文件夹",
    Boolean(userFolder?.isDirectory() && path.basename(workspaceRoot) === USERNAME),
    workspaceRoot,
  );
  const welcomeStatus = await page.locator(".welcome-status").innerText();
  record(
    "空状态展示本机状态和工作区",
    /已就绪/.test(welcomeStatus) &&
      welcomeStatus.includes("工作区") &&
      welcomeStatus.includes("会话保存在本机"),
  );
}

async function setAutoMode(page) {
  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form");
  const closedText = await page.locator("#settings-form").innerText();
  record("设置默认不暴露本机引擎路径", !closedText.includes("Claude 路径") && !closedText.includes("本机引擎路径"));
  await page.getByText("全自动").click();
  const modeVisual = await page.evaluate(() => ({
    selectedText: document.querySelector(".mode-card.selected")?.innerText || "",
    checkedValue: document.querySelector("input[name='defaultMode']:checked")?.value || "",
  }));
  record(
    "默认权限切换有即时选中反馈",
    modeVisual.selectedText.includes("全自动") && modeVisual.checkedValue === "bypassPermissions",
  );
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "PATCH" && url.endsWith("/api/config") && !window.__settingsPatchDelayed) {
        window.__settingsPatchDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.getByRole("button", { name: /保存设置/ }).click();
  await page.waitForSelector("#settings-form[aria-busy='true']", { timeout: 5000 });
  const settingsBusy = await page.evaluate(() => ({
    progress: document.querySelector(".settings-progress")?.textContent || "",
    advancedDisabled: Boolean(document.querySelector("#advanced-toggle")?.disabled),
    closeDisabled: Boolean(document.querySelector("#close-settings")?.disabled),
    logoutDisabled: Boolean(document.querySelector("#logout-button")?.disabled),
    submit: document.querySelector("#settings-form button[type='submit']")?.textContent || "",
    selectedText: document.querySelector(".mode-card.selected")?.innerText || "",
  }));
  record(
    "设置保存展示检查本机助手加载态",
    settingsBusy.progress.includes("正在保存设置") &&
      settingsBusy.progress.includes("正在检查本机助手状态") &&
      settingsBusy.advancedDisabled &&
      settingsBusy.closeDisabled &&
      settingsBusy.logoutDisabled &&
      settingsBusy.submit.includes("保存中") &&
      settingsBusy.selectedText.includes("全自动"),
    JSON.stringify(settingsBusy),
  );
  await page.waitForSelector("#settings-form", { state: "detached", timeout: 10000 });
  record("设置保存全自动模式", true);
  await page.waitForTimeout(400);
  record("设置保存有产品内反馈", (await page.locator("body").innerText()).includes("设置已保存"));
}

async function quickPromptFlow(page) {
  await page.locator(".quick-prompt").first().click();
  await page.waitForTimeout(600);
  const value = await page.locator("#composer-input").inputValue();
  const focused = await page.locator("#composer-input").evaluate((input) => document.activeElement === input);
  const bodyText = await page.locator("body").innerText();
  record("快捷任务可填入并聚焦输入框", value.includes("帮我分析这个目录里已有文件") && focused);
  record("快捷任务使用产品内反馈", bodyText.includes("已填入，可编辑后发送") && dialogs.length === 0);
  await page.locator("#new-chat-button").click();
  await page.waitForTimeout(300);
  record("新对话可清空快捷任务草稿", (await page.locator("#composer-input").inputValue()) === "");
}

async function attachmentFeedbackFlow(page) {
  const attachment = page.locator("#attachment-button");
  await attachment.click();
  await page.waitForTimeout(500);
  const title = await attachment.getAttribute("title");
  record(
    "附件入口使用产品内反馈",
    (await page.locator("body").innerText()).includes("附件能力正在打磨中") && dialogs.length === 0,
  );
  record("附件入口不依赖浏览器原生提示", title === null && !(await attachment.isDisabled()));
}

async function iconTooltipFlow(page) {
  const result = await page.evaluate(() => {
    const selectors = [
      "#settings-button",
      "#conversation-menu-button",
      "#attachment-button",
      "#mobile-menu-button",
    ];
    const nodes = selectors.map((selector) => document.querySelector(selector));
    return {
      noNativeTitle: nodes.every((node) => node && !node.hasAttribute("title")),
      ariaLabels: nodes.every((node) => node && Boolean(node.getAttribute("aria-label"))),
      productTooltips: nodes.every((node) => node && Boolean(node.getAttribute("data-tooltip"))),
    };
  });
  record("高频图标入口不使用原生 title", result.noNativeTitle);
  record("高频图标入口保留可访问名称", result.ariaLabels && result.productTooltips);
}

async function overlayDismissalFlow(page) {
  await page.locator("#conversation-menu-button").click();
  await page.waitForSelector(".topbar-menu", { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".topbar-menu", { state: "detached", timeout: 5000 });
  record("Escape 可关闭会话菜单", true);

  await page.locator("#conversation-menu-button").click();
  await page.waitForSelector(".topbar-menu", { timeout: 5000 });
  await page.locator("#chat-region").click({ position: { x: 24, y: 24 } });
  await page.waitForSelector(".topbar-menu", { state: "detached", timeout: 5000 });
  record("点击菜单外区域可关闭会话菜单", true);

  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form", { timeout: 5000 });
  const settingsFocusAudit = await page.evaluate(() => ({
    mainInert: document.querySelector(".main")?.hasAttribute("inert") || false,
    sidebarInert: document.querySelector(".sidebar")?.hasAttribute("inert") || false,
    modalRole: document.querySelector("#settings-form")?.getAttribute("role") || "",
    modalAria: document.querySelector("#settings-form")?.getAttribute("aria-modal") || "",
  }));
  const settingsFocusPath = [];
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    settingsFocusPath.push(
      await page.evaluate(() => {
        const node = document.activeElement;
        return {
          id: node?.id || "",
          className: typeof node?.className === "string" ? node.className : "",
          inBackground: Boolean(node?.closest?.(".main, .sidebar, .mobile-drawer")),
          inModal: Boolean(node?.closest?.("#settings-form")),
        };
      }),
    );
  }
  record(
    "设置弹层打开时背景不进入键盘焦点",
    settingsFocusAudit.mainInert &&
      settingsFocusAudit.sidebarInert &&
      settingsFocusAudit.modalRole === "dialog" &&
      settingsFocusAudit.modalAria === "true" &&
      !settingsFocusPath.some((entry) => entry.inBackground) &&
      settingsFocusPath.every((entry) => entry.inModal),
    JSON.stringify({ ...settingsFocusAudit, focusPath: settingsFocusPath }),
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settings-form", { state: "detached", timeout: 5000 });
  record("Escape 可关闭设置弹层", true);
  await page.waitForTimeout(650);
  record(
    "关闭设置后焦点回到设置入口",
    (await page.evaluate(() => document.activeElement?.id || "")) === "settings-button",
  );
}

async function staleRunRecoveryFlow(page) {
  const { session } = await createSessionViaApi(page, "断线恢复验证");
  const workspaceRoot = await currentWorkspaceRoot(page);
  const sessionFile = path.join(workspaceRoot, "sessions", `${session.id}.json`);
  const stored = JSON.parse(await fs.readFile(sessionFile, "utf8"));
  const timestamp = new Date().toISOString();
  stored.status = "running";
  stored.lastError = null;
  stored.messages.push(
    {
      id: "stale-user",
      type: "user",
      text: "模拟一个没有正常结束的本机任务",
      createdAt: timestamp,
    },
    {
      id: "stale-assistant",
      type: "assistant",
      text: "",
      status: "streaming",
      startedAt: timestamp,
      createdAt: timestamp,
    },
  );
  await fs.writeFile(sessionFile, `${JSON.stringify(stored, null, 2)}\n`);
  const recovered = await page.evaluate(async (sessionId) => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    return res.json();
  }, session.id);
  record(
    "孤儿运行会话会自动释放",
    recovered.session?.status === "error" &&
      recovered.session?.lastError?.includes("本机助手连接已中断") &&
      recovered.session?.messages?.some((item) => item.label === "本机引擎已恢复"),
    JSON.stringify({ status: recovered.session?.status, lastError: recovered.session?.lastError }),
  );
}

async function keyboardComposerFlow(page) {
  const input = page.locator("#composer-input");
  const submit = page.locator("#composer-form button[type='submit']");
  await input.fill("");
  record("空输入时发送按钮不可用", await submit.isDisabled());
  const disabledSendVisual = await submit.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      color: style.color,
      opacity: style.opacity,
      boxShadow: style.boxShadow,
      cursor: style.cursor,
    };
  });
  record(
    "空输入发送按钮呈现灰色禁用态",
    disabledSendVisual.background === "rgb(232, 237, 243)" &&
      disabledSendVisual.color === "rgb(139, 149, 163)" &&
      disabledSendVisual.opacity === "1" &&
      disabledSendVisual.boxShadow === "none" &&
      disabledSendVisual.cursor === "default",
    JSON.stringify(disabledSendVisual),
  );
  await input.press("Enter");
  await page.waitForSelector(".composer-error", { timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.id === "composer-input", undefined, { timeout: 5000 });
  const emptyFeedback = await page.evaluate(() => ({
    error: document.querySelector(".composer-error")?.textContent || "",
    activeId: document.activeElement?.id || "",
  }));
  record(
    "空输入回车使用产品内提示",
    emptyFeedback.error.includes("请输入内容后再发送") && emptyFeedback.activeId === "composer-input",
  );
  await input.fill("第一行");
  await page.waitForTimeout(150);
  record("输入内容后发送按钮恢复可用", !(await submit.isDisabled()) && !(await page.locator(".composer-error").count()));
  await input.press("Shift+Enter");
  await input.type("第二行");
  record("Shift Enter 可在输入框换行", (await input.inputValue()).includes("第一行\n第二行"));

  await input.fill("zheng zai shu ru");
  const compositionResult = await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "zheng" }));
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    const allowed = element.dispatchEvent(event);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "正在输入" }));
    return { allowed, canceled: event.defaultPrevented, value: element.value };
  });
  await page.waitForTimeout(300);
  record(
    "中文输入法确认不会误发送",
    compositionResult.allowed &&
      !compositionResult.canceled &&
      compositionResult.value.includes("zheng zai shu ru") &&
      (await page.locator(".stream-user").count()) === 0,
  );

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "POST" && /\/api\/sessions\/[^/]+\/messages$/.test(url) && !window.__messagePostDelayed) {
        window.__messagePostDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await input.fill("键盘发送测试：请只回复两个字：键盘");
  await input.press("Enter");
  await page.waitForSelector(".assistant-wait-card", { timeout: 10000 });
  const sendWaiting = await page.evaluate(() => ({
    waitText: document.querySelector(".assistant-wait-card")?.textContent || "",
    hasStop: Boolean(document.querySelector("#stop-button")),
    inputDisabled: Boolean(document.querySelector("#composer-input")?.disabled),
    sendText: document.querySelector("#composer-form button[type='submit']")?.textContent || "",
    cardHeight: document.querySelector(".assistant-wait-card")?.getBoundingClientRect().height || 0,
  }));
  record(
    "发送后展示本机队列等待态",
    sendWaiting.waitText.includes("正在唤起") &&
      sendWaiting.waitText.includes("本机任务已进入队列") &&
      sendWaiting.hasStop &&
      sendWaiting.inputDisabled &&
      sendWaiting.sendText.includes("运行中") &&
      sendWaiting.cardHeight >= 54,
    JSON.stringify(sendWaiting),
  );
  await waitIdle(page, "Enter 快捷键真实回复完成");
  record("Enter 快捷键可发送真实消息", (await page.locator("body").innerText()).includes("键盘"));
  const generatedTitle = await page.evaluate(() => ({
    topbar: document.querySelector(".topbar-title h1")?.textContent || "",
    sidebar: document.querySelector(".session-row.active .session-title")?.textContent || "",
  }));
  record(
    "会话标题自动去除指令壳",
    generatedTitle.topbar === "键盘发送测试" &&
      generatedTitle.sidebar === "键盘发送测试" &&
      !generatedTitle.topbar.includes("请只回复"),
    JSON.stringify(generatedTitle),
  );
}

async function disconnectedRecoveryFlow(page) {
  const original = await page.evaluate(async () => {
    const res = await fetch("/api/config");
    return res.json();
  });
  const originalPath = original.settings?.claudePath || "claude";

  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form");
  await page.locator("#advanced-toggle").click();
  await page.locator("#claudePath").fill(`/tmp/codebao-missing-claude-${Date.now()}`);
  await page.getByRole("button", { name: /保存设置/ }).click();
  await page.waitForSelector("#settings-form", { state: "detached", timeout: 10000 });
  await page.waitForTimeout(500);
  const disconnectedText = await page.locator("body").innerText();
  record("Claude 断连显示产品提示", disconnectedText.includes("本机助手未连接") && disconnectedText.includes("检查设置"));
  record("Claude 断连时输入区禁用", await page.locator("#composer-input").isDisabled());

  await page.locator("#composer-settings-button").click();
  await page.waitForSelector("#settings-form");
  const recoveryFormText = await page.locator("#settings-form").innerText();
  record(
    "断连提示可打开设置",
    recoveryFormText.includes("本机助手未连接") && recoveryFormText.includes("路径"),
  );
  await page.locator("#claudePath").fill(originalPath);
  await page.getByRole("button", { name: /保存设置/ }).click();
  await page.waitForSelector("#settings-form", { state: "detached", timeout: 10000 });
  await page.waitForTimeout(800);
  record("本机引擎路径恢复后可继续输入", !(await page.locator("#composer-input").isDisabled()));
}

async function conversationFlow(page) {
  await send(page, "第一轮：请只回复两个字：收到");
  await waitIdle(page, "首轮真实回复完成");
  record("首轮内容可见", (await page.locator("body").innerText()).includes("收到"));
  const copyTitle = await page.locator("[data-copy-id]").first().getAttribute("title");
  const copyLabel = await page.locator("[data-copy-id]").first().getAttribute("aria-label");
  const copyTooltip = await page.locator("[data-copy-id]").first().getAttribute("data-tooltip");
  record("复制入口不使用原生 title", copyTitle === null && copyLabel === "复制");
  record("复制入口不使用遮挡式悬浮提示", copyTooltip === null);
  await page.locator("[data-copy-id]").first().click({ force: true });
  await page.waitForTimeout(500);
  record("复制反馈使用产品内 toast", (await page.locator("body").innerText()).includes("已复制") && dialogs.length === 0);

  await send(page, "第二轮：上一轮我要求你回复哪两个字？只回答那两个字。");
  await waitIdle(page, "第二轮上下文回复完成");
  record("多轮上下文保持", (await page.locator("body").innerText()).includes("收到"));

  await send(page, "请用 Bash 只运行 pwd，然后用一句中文说明当前目录。不要修改任何文件。");
  await waitIdle(page, "工具调用回复完成");
  const toolText = await page.locator("body").innerText();
  record("工具调用中文化展示", toolText.includes("执行命令") && !toolText.includes("Shell pwd"));
  await page.getByRole("button", { name: /执行命令/ }).first().click();
  await page.waitForTimeout(900);
  const expandedToolText = await page.locator(".tool-badge.expanded").innerText();
  const workspaceRoot = await currentWorkspaceRoot(page);
  record("工具详情可展开", expandedToolText.includes("执行结果"));
  record(
    "工具详情折叠本机路径",
    expandedToolText.includes("本机工作区") && !expandedToolText.includes(workspaceRoot),
  );
  await page.evaluate(() => {
    window.__copiedTexts = [];
    if (document.execCommand) {
      const originalExecCommand = document.execCommand.bind(document);
      document.execCommand = (command) => {
        if (String(command).toLowerCase() === "copy") {
          window.__copiedTexts.push(document.activeElement?.value || String(window.getSelection?.() || ""));
          return true;
        }
        return originalExecCommand(command);
      };
    }
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__copiedTexts.push(String(text || ""));
          },
          readText: async () => (window.__copiedTexts || []).at(-1) || "",
        },
      });
    } catch {
      window.__clipboardPatchFailed = true;
    }
  });
  await page.locator(".assistant-block").last().locator("[data-copy-id]").click({ force: true });
  await page.waitForFunction(() => (window.__copiedTexts || []).length > 0, undefined, { timeout: 3000 }).catch(() => {});
  const copiedAssistant = await page.evaluate(async () => {
    const captured = (window.__copiedTexts || []).at(-1) || "";
    if (captured) return captured;
    return navigator.clipboard?.readText ? navigator.clipboard.readText().catch(() => "") : "";
  });
  record(
    "复制助手回复不泄漏本机路径",
    copiedAssistant.includes("本机工作区") && !copiedAssistant.includes(workspaceRoot),
    copiedAssistant,
  );
  await page
    .waitForFunction(
      () => {
        const tool = document.querySelector(".tool-badge.expanded");
        const composer = document.querySelector(".composer");
        const next = tool?.nextElementSibling;
        if (!tool || !composer) return false;
        const toolRect = tool.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const nextRect = next?.getBoundingClientRect();
        return toolRect.bottom <= composerRect.top - 16 && (!nextRect || nextRect.top <= composerRect.top - 84);
      },
      undefined,
      { timeout: 2500 },
    )
    .catch(() => {});
  const geometry = await page.evaluate(() => {
    const tool = document.querySelector(".tool-badge.expanded");
    const composer = document.querySelector(".composer");
    const next = tool?.nextElementSibling;
    if (!tool || !composer) return null;
    const toolRect = tool.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const nextRect = next?.getBoundingClientRect();
    return {
      toolClear: toolRect.bottom <= composerRect.top - 16,
      nextClear: !nextRect || nextRect.top <= composerRect.top - 84,
      toolBottom: Math.round(toolRect.bottom),
      nextTop: nextRect ? Math.round(nextRect.top) : null,
      composerTop: Math.round(composerRect.top),
      scrollTop: Math.round(document.querySelector("#chat-region")?.scrollTop || 0),
      bodyScrollY: Math.round(window.scrollY),
    };
  });
  record(
    "工具展开内容不被输入框遮挡",
    Boolean(geometry?.toolClear && geometry?.nextClear && geometry?.bodyScrollY === 0),
    JSON.stringify(geometry),
  );
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-desktop-tool.png"), fullPage: false });
}

async function markdownFlow(page) {
  await page.locator("#new-chat-button").click();
  await page.waitForTimeout(400);
  await send(
    page,
    "请不要调用工具。请用 Markdown 回复：一个二级标题“体验检查”，三个无序列表项，以及一个 javascript 代码块，代码块内容是 console.log('Zhiguo ok')。",
  );
  await waitIdle(page, "Markdown 回复完成");
  record("Markdown 标题可渲染", (await page.locator(".markdown-heading").count()) > 0);
  record("Markdown 列表可渲染", (await page.locator(".markdown-list li").count()) >= 3);
  record("Markdown 代码块可渲染", (await page.locator(".markdown-code").count()) > 0);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-markdown.png"), fullPage: false });
}

async function longScrollFlow(page) {
  await page.locator("#new-chat-button").click();
  await page.waitForTimeout(400);
  await send(
    page,
    "请不要调用工具。请用 Markdown 回复：一个二级标题“长内容验证”，然后输出 38 个有序列表项，每项都写一句不同的中文短句，最后附一个 javascript 代码块，代码块里放一行很长的 console.log 字符串。",
  );
  await waitIdle(page, "长 Markdown 回复完成", 180000);
  const longGeometry = await page.evaluate(() => {
    const region = document.querySelector("#chat-region");
    if (!region) return null;
    region.scrollTop = 0;
    region.dispatchEvent(new Event("scroll"));
    const button = document.querySelector("#scroll-bottom-button");
    return {
      scrollable: region.scrollHeight > region.clientHeight + 360,
      top: region.scrollTop,
      buttonVisible: button?.classList.contains("visible"),
      buttonText: button?.textContent || "",
      buttonLabel: button?.getAttribute("aria-label") || "",
      buttonHidden: button?.getAttribute("aria-hidden") || "",
      buttonTabIndex: button?.getAttribute("tabindex") || "",
    };
  });
  record("长回复产生可阅读滚动区", Boolean(longGeometry?.scrollable));
  record("离开底部时显示回到底部入口", Boolean(longGeometry?.buttonVisible));
  record(
    "回到底部入口文案与行为一致",
    longGeometry?.buttonText.includes("回到底部") &&
      longGeometry?.buttonLabel === "回到底部" &&
      longGeometry?.buttonHidden === "false" &&
      longGeometry?.buttonTabIndex === "0",
    JSON.stringify(longGeometry),
  );
  await page.locator("#scroll-bottom-button").click();
  await page.waitForTimeout(500);
  const bottomState = await page.evaluate(() => {
    const region = document.querySelector("#chat-region");
    const button = document.querySelector("#scroll-bottom-button");
    if (!region) return null;
    return {
      nearBottom: region.scrollHeight - region.scrollTop - region.clientHeight < 160,
      hidden: !button?.classList.contains("visible"),
      ariaHidden: button?.getAttribute("aria-hidden") || "",
      tabIndex: button?.getAttribute("tabindex") || "",
    };
  });
  record("回到底部入口可恢复到底部", Boolean(bottomState?.nearBottom && bottomState?.hidden));
  record(
    "隐藏的回到底部入口不进入键盘焦点",
    bottomState?.hidden && bottomState?.ariaHidden === "true" && bottomState?.tabIndex === "-1",
    JSON.stringify(bottomState),
  );
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-long-markdown.png"), fullPage: false });
}

async function fileToolFlow(page) {
  await page.locator("#new-chat-button").click();
  await page.waitForTimeout(400);
  const fileName = `matrix-note-${Date.now()}.txt`;
  const workspaceRoot = await currentWorkspaceRoot(page);
  const filePath = path.join(workspaceRoot, fileName);
  await send(
    page,
    `请使用 Write 工具在当前工作区创建文件 ${fileName}，文件内容必须包含这行文字：Zhiguo matrix ok。完成后只用一句中文说明已创建，不要创建其他文件。`,
  );
  await waitIdle(page, "真实文件写入任务完成", 180000);
  const afterWrite = await page.locator("body").innerText();
  record("文件写入工具中文展示", /写入文件|修改文件/.test(afterWrite));
  record(
    "文件工具路径折叠为工作区视图",
    afterWrite.includes("本机工作区") && !afterWrite.includes(workspaceRoot),
  );
  const writeSummary = await page.evaluate(() => {
    const badge = [...document.querySelectorAll(".tool-badge")]
      .reverse()
      .find((entry) => entry.textContent.includes("写入文件"));
    return badge?.querySelector(".tool-badge-summary")?.textContent?.trim() || "";
  });
  record(
    "文件写入工具展示变更摘要",
    writeSummary.includes("本机工作区") && /新建|已写入/.test(writeSummary),
    writeSummary,
  );
  const written = await fs.readFile(filePath, "utf8").catch(() => "");
  record("真实文件写入成功", written.includes("Zhiguo matrix ok"));

  await send(page, `请使用 Read 工具读取 ${fileName}，然后只回复“文件内容已确认”。`);
  await waitIdle(page, "真实文件读取任务完成", 180000);
  const afterRead = await page.locator("body").innerText();
  record("文件读取工具中文展示", afterRead.includes("读取文件"));
  record("文件读取结果可见", afterRead.includes("文件内容已确认") || afterRead.includes("Zhiguo matrix ok"));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-file-tools.png"), fullPage: false });
  return { fileName, filePath };
}

async function editSearchFlow(page, file) {
  await send(
    page,
    `请使用 Edit 工具把 ${file.fileName} 里的 "Zhiguo matrix ok" 替换成 "Zhiguo matrix edited"，然后使用 Grep 工具搜索 "matrix edited" 确认结果。完成后只回复“修改已确认”。`,
  );
  await waitIdle(page, "真实文件修改和搜索任务完成", 180000);
  const bodyText = await page.locator("body").innerText();
  record("文件修改工具中文展示", bodyText.includes("修改文件"));
  record("搜索工具中文展示", bodyText.includes("搜索内容"));
  const editSummary = await page.evaluate(() => {
    const badge = [...document.querySelectorAll(".tool-badge")]
      .reverse()
      .find((entry) => entry.textContent.includes("修改文件"));
    return badge?.querySelector(".tool-badge-summary")?.textContent?.trim() || "";
  });
  record(
    "文件修改工具展示变更摘要",
    editSummary.includes("本机工作区") && /替换|已生成变更|已修改/.test(editSummary),
    editSummary,
  );
  const edited = await fs.readFile(file.filePath, "utf8").catch(() => "");
  record("真实文件修改成功", edited.includes("Zhiguo matrix edited"));
}

async function longToolOutputFlow(page) {
  await page.locator("#new-chat-button").click();
  await page.waitForTimeout(400);
  await send(
    page,
    "请用 Bash 运行：for i in {1..80}; do echo codebao-long-output-$i; done。不要修改文件，完成后只用一句中文说明输出已生成。",
  );
  await waitIdle(page, "长工具输出任务完成", 180000);
  const bodyText = await page.locator("body").innerText();
  record("长工具输出中文化展示", bodyText.includes("执行命令"));
  await page.getByRole("button", { name: /执行命令/ }).first().click();
  await page.waitForTimeout(700);
  const toolScroll = await page.evaluate(() => {
    const pre = document.querySelector(".tool-badge.expanded .tool-detail pre");
    if (!pre) return null;
    return {
      scrollable: pre.scrollHeight > pre.clientHeight,
      containsLastLine: pre.innerText.includes("codebao-long-output-80"),
    };
  });
  record("长工具输出详情内部可滚动", Boolean(toolScroll?.scrollable));
  record("长工具输出内容完整保留", Boolean(toolScroll?.containsLastLine));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-long-tool.png"), fullPage: false });
}

async function historyDepthFlow(page) {
  for (let index = 1; index <= 10; index += 1) {
    await createSessionViaApi(page, `长历史验证 ${String(index).padStart(2, "0")}`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".composer", { timeout: 15000 });
  const visibleRows = await page.locator(".sidebar .session-row").count();
  record("长历史列表可承载多会话", visibleRows >= 10, `rows=${visibleRows}`);
  await page.locator("#session-search").click();
  await page.keyboard.type("长历史验证 10", { delay: 15 });
  await page.waitForTimeout(300);
  const searchFocus = await page.evaluate(() => ({
    value: document.querySelector("#session-search")?.value || "",
    activeId: document.activeElement?.id || "",
  }));
  record(
    "会话搜索逐字输入不丢焦",
    searchFocus.value === "长历史验证 10" && searchFocus.activeId === "session-search",
  );
  const filteredText = await page.locator(".session-list").first().innerText();
  record("长历史列表搜索仍可定位", filteredText.includes("长历史验证 10"));
  await page.locator("#session-search").fill("");
  await page.locator("#conversation-menu-button").click();
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/sessions") && !window.__refreshDelayed) {
        window.__refreshDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.getByRole("button", { name: /^刷新$/ }).click();
  await page.waitForSelector("#refresh-button:disabled", { timeout: 5000 });
  record("刷新会话列表有处理中反馈", (await page.locator(".topbar-menu").innerText()).includes("刷新中"));
  await page.waitForSelector(".topbar-menu", { state: "detached", timeout: 10000 });
  record("刷新完成使用产品内反馈", (await page.locator("body").innerText()).includes("已刷新"));
  const targetRow = page.locator(".sidebar .session-row").filter({ hasText: "长历史验证 01" });
  const targetId = await targetRow.getAttribute("data-session-id");
  await page.evaluate((id) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (id && method === "GET" && url.endsWith(`/api/sessions/${id}`)) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  }, targetId);
  await targetRow.click();
  await page.waitForSelector(`.session-row[data-session-id="${targetId}"].opening`, { timeout: 5000 });
  record("切换会话有打开中反馈", (await targetRow.innerText()).includes("正在打开"));
  await page.waitForSelector(`.session-row[data-session-id="${targetId}"].active`, { timeout: 10000 });
}

async function managementFlow(page) {
  await page.locator("#new-chat-button").click();
  await page.waitForTimeout(400);
  await send(page, "请用 Bash 运行 `sleep 20; echo done`，不要修改文件。");
  await page.waitForSelector("#stop-button", { timeout: 20000 });
  await page.locator("#new-chat-button").click();
  await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  const runningNewChatGuard = await page.evaluate(() => ({
    hasStop: Boolean(document.querySelector("#stop-button")),
    title: document.querySelector(".topbar-title h1")?.textContent || "",
    sheet: document.querySelector(".sheet-panel")?.textContent || "",
  }));
  record(
    "运行中新建显示停止并新建确认",
    runningNewChatGuard.hasStop &&
      runningNewChatGuard.title === "运行计时任务" &&
      runningNewChatGuard.sheet.includes("停止并新建对话") &&
      runningNewChatGuard.sheet.includes("当前回复会先停止") &&
      runningNewChatGuard.sheet.includes("停止并新建"),
  );
  await page.getByRole("button", { name: "继续等待" }).click();
  await page.waitForSelector(".sheet-panel", { state: "detached", timeout: 5000 });
  const switchTargetId = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".sidebar .session-row")];
    const target = rows.find((row) => !row.classList.contains("active"));
    return target?.dataset.sessionId || "";
  });
  if (switchTargetId) {
    await page.locator(`.sidebar .session-row[data-session-id="${switchTargetId}"]`).click();
    await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  }
  const runningSwitchGuard = await page.evaluate(() => ({
    hasStop: Boolean(document.querySelector("#stop-button")),
    title: document.querySelector(".topbar-title h1")?.textContent || "",
    sheet: document.querySelector(".sheet-panel")?.textContent || "",
  }));
  record(
    "运行中切换显示停止并切换确认",
    Boolean(switchTargetId) &&
      runningSwitchGuard.hasStop &&
      runningSwitchGuard.title === "运行计时任务" &&
      runningSwitchGuard.sheet.includes("停止并切换会话") &&
      runningSwitchGuard.sheet.includes("当前回复会先停止") &&
      runningSwitchGuard.sheet.includes("停止并切换"),
  );
  await page.getByRole("button", { name: "继续等待" }).click();
  await page.waitForSelector(".sheet-panel", { state: "detached", timeout: 5000 });
  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form", { timeout: 5000 });
  await page.locator("#logout-button").click();
  await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  const runningLogoutGuard = await page.evaluate(() => ({
    hasSettings: Boolean(document.querySelector("#settings-form")),
    hasAuth: Boolean(document.querySelector("#auth-form")),
    sheet: document.querySelector(".sheet-panel")?.textContent || "",
  }));
  record(
    "运行中退出显示停止并退出确认",
    runningLogoutGuard.hasSettings &&
      !runningLogoutGuard.hasAuth &&
      runningLogoutGuard.sheet.includes("停止并退出登录") &&
      runningLogoutGuard.sheet.includes("当前回复会先停止") &&
      runningLogoutGuard.sheet.includes("停止并退出"),
  );
  await page.getByRole("button", { name: "继续等待" }).click();
  await page.waitForSelector(".sheet-panel", { state: "detached", timeout: 5000 });
  await page.locator("#close-settings").click();
  await page.waitForSelector("#settings-form", { state: "detached", timeout: 5000 });
  await page.locator("#conversation-menu-button").click();
  await page.getByText("归档会话").click();
  await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  const runningArchiveText = await page.locator(".sheet-panel").innerText();
  record(
    "运行中归档明确提示会停止回复",
    runningArchiveText.includes("停止并归档这个会话") &&
      runningArchiveText.includes("当前回复会先停止") &&
      runningArchiveText.includes("停止并归档"),
  );
  await page.getByRole("button", { name: "取消" }).click();
  await page.waitForSelector(".sheet-panel", { state: "detached", timeout: 5000 });
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "POST" && /\/api\/sessions\/[^/]+\/stop$/.test(url) && !window.__stopDelayed) {
        window.__stopDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.locator("#stop-button").click();
  await page.waitForSelector("#stop-button:disabled", { timeout: 5000 });
  const stopBusy = await page.locator("#stop-button").evaluate((button) => ({
    disabled: button.disabled,
    label: button.getAttribute("aria-label") || "",
    tooltip: button.getAttribute("data-tooltip") || "",
  }));
  record("停止处理中有反馈", stopBusy.disabled && stopBusy.label.includes("停止中") && stopBusy.tooltip.includes("停止中"));
  await page.waitForTimeout(4000);
  const stoppedText = await page.locator("body").innerText();
  record("停止生成用户态文案", stoppedText.includes("已停止生成"));
  record("停止生成不泄漏退出码", !/exited with code|Stopped by user|SIGTERM|SIGKILL/i.test(stoppedText));
  const recoveryCard = await page.evaluate(() => {
    const card = document.querySelector(".turn-recovery-card");
    const buttons = [...(card?.querySelectorAll("button") || [])].map((button) => button.textContent.trim());
    const rect = card?.getBoundingClientRect();
    const style = card ? getComputedStyle(card) : null;
    return {
      text: card?.textContent || "",
      buttons,
      visible: Boolean(rect && rect.width > 240 && rect.height >= 54),
      radius: Number.parseFloat(style?.borderRadius || "0"),
      display: style?.display || "",
    };
  });
  record(
    "停止后恢复条说明上下文保留",
    recoveryCard.text.includes("已停止生成") && recoveryCard.text.includes("本次上下文仍保留"),
    JSON.stringify(recoveryCard),
  );
  record(
    "停止后恢复操作集中在同一恢复条",
    recoveryCard.visible &&
      recoveryCard.radius >= 14 &&
      recoveryCard.buttons.includes("继续生成") &&
      recoveryCard.buttons.includes("编辑上一条"),
    JSON.stringify(recoveryCard),
  );
  record("停止后提供继续入口", stoppedText.includes("继续生成") && stoppedText.includes("编辑上一条"));
  await page.getByRole("button", { name: "编辑上一条" }).click();
  record("停止后可回填上一条消息", (await page.locator("#composer-input").inputValue()).includes("sleep 20"));
  await page.locator("#composer-input").fill("");

  await page.locator("#conversation-menu-button").click();
  await page.getByText("重命名").click();
  await page.waitForSelector("#rename-sheet-input");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#rename-sheet-input", { state: "detached", timeout: 5000 });
  record("Escape 可关闭重命名弹层", true);
  await page.waitForTimeout(650);
  record(
    "关闭重命名后焦点回到会话选项",
    (await page.evaluate(() => document.activeElement?.id || "")) === "conversation-menu-button",
  );
  await page.locator("#conversation-menu-button").click();
  await page.getByText("重命名").click();
  await page.waitForSelector("#rename-sheet-input");
  await page.locator("#rename-sheet-input").fill("   ");
  await page.getByRole("button", { name: /^保存$/ }).click();
  await page.waitForSelector(".sheet-error", { timeout: 5000 });
  record(
    "重命名空标题使用弹层内提示",
    (await page.locator(".sheet-error").innerText()).includes("请输入会话名称") && dialogs.length === 0,
  );
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "PATCH" && /\/api\/sessions\//.test(url) && !window.__renamePatchDelayed) {
        window.__renamePatchDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.locator("#rename-sheet-input").fill("体验验证会话");
  await page.getByRole("button", { name: /^保存$/ }).click();
  await page.waitForSelector("#rename-sheet-form", { timeout: 5000 });
  record("重命名保存中有反馈", (await page.locator("#rename-sheet-form").innerText()).includes("保存中"));
  await page.waitForTimeout(900);
  record("重命名使用产品内弹层", dialogs.length === 0 && (await page.locator("body").innerText()).includes("体验验证会话"));
  await page.locator("#session-search").fill("体验验证");
  await page.waitForTimeout(300);
  record("会话搜索可过滤结果", (await page.locator(".session-list").first().innerText()).includes("体验验证会话"));
  await page.locator("#session-search").fill("不会存在的会话关键词");
  await page.waitForTimeout(300);
  record("会话搜索有精致空态", (await page.locator(".session-list").first().innerText()).includes("没有找到相关会话"));
  await page.getByText("清空搜索").first().click();
  await page.waitForTimeout(300);
  record("会话搜索可一键清空", (await page.locator("#session-search").inputValue()) === "");

  await page.locator("#conversation-menu-button").click();
  await page.getByText("归档会话").click();
  await page.waitForSelector(".sheet-panel");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "DELETE" && /\/api\/sessions\//.test(url) && !window.__archiveDeleteDelayed) {
        window.__archiveDeleteDelayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalFetch(input, init);
    };
  });
  await page.getByRole("button", { name: /^归档$/ }).click();
  await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  record("归档处理中有反馈", (await page.locator(".sheet-panel").innerText()).includes("归档中"));
  await page.waitForTimeout(1200);
  record("归档使用产品内确认", dialogs.length === 0 && (await page.locator("body").innerText()).includes("已归档"));
  await page.getByRole("button", { name: "撤销" }).click();
  await page.waitForTimeout(1000);
  record("归档后可撤销恢复", (await page.locator("body").innerText()).includes("已恢复"));

  await send(page, "请用 Bash 运行 `sleep 20; echo confirm-new-chat`，不要修改文件。");
  await page.waitForSelector("#stop-button", { timeout: 20000 });
  await page.locator("#new-chat-button").click();
  await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  await page.getByRole("button", { name: /^停止并新建$/ }).click();
  await page.waitForSelector(".sheet-panel", { state: "detached", timeout: 10000 });
  await page.waitForTimeout(800);
  const confirmedNewChat = await page.evaluate(() => ({
    hasStop: Boolean(document.querySelector("#stop-button")),
    title: document.querySelector(".topbar-title h1")?.textContent || "",
    composer: document.querySelector("#composer-input")?.value || "",
    toast: document.querySelector(".toast")?.textContent || "",
    welcome: document.querySelector(".welcome")?.textContent || "",
  }));
  record(
    "运行中可停止并新建对话",
    !confirmedNewChat.hasStop &&
      confirmedNewChat.title === "新对话" &&
      confirmedNewChat.composer === "" &&
      confirmedNewChat.toast.includes("已停止，已新建对话") &&
      confirmedNewChat.welcome.includes("你好，我是"),
    JSON.stringify(confirmedNewChat),
  );

  await send(page, "请用 Bash 运行 `sleep 20; echo confirm-switch-session`，不要修改文件。");
  await page.waitForSelector("#stop-button", { timeout: 20000 });
  const switchConfirmTarget = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".sidebar .session-row")];
    const target = rows.find((row) => !row.classList.contains("active"));
    return {
      id: target?.dataset.sessionId || "",
      title: target?.querySelector(".session-title")?.textContent || "",
    };
  });
  if (switchConfirmTarget.id) {
    await page.locator(`.sidebar .session-row[data-session-id="${switchConfirmTarget.id}"]`).click();
    await page.waitForSelector(".sheet-panel", { timeout: 5000 });
    await page.getByRole("button", { name: /^停止并切换$/ }).click();
    await page.waitForSelector(".sheet-panel", { state: "detached", timeout: 10000 });
    await page.waitForSelector(`.session-row[data-session-id="${switchConfirmTarget.id}"].active`, { timeout: 10000 });
  }
  const confirmedSwitch = await page.evaluate((targetTitle) => ({
    hasStop: Boolean(document.querySelector("#stop-button")),
    title: document.querySelector(".topbar-title h1")?.textContent || "",
    toast: document.querySelector(".toast")?.textContent || "",
    activeTitle: document.querySelector(".session-row.active .session-title")?.textContent || "",
    targetTitle,
  }), switchConfirmTarget.title);
  record(
    "运行中可停止并切换会话",
    Boolean(switchConfirmTarget.id) &&
      !confirmedSwitch.hasStop &&
      confirmedSwitch.title === switchConfirmTarget.title &&
      confirmedSwitch.activeTitle === switchConfirmTarget.title &&
      confirmedSwitch.toast.includes("已停止，已切换会话"),
    JSON.stringify(confirmedSwitch),
  );
}

async function settingsAndMobileFlow(context, page) {
  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form");
  await page.locator("#advanced-toggle").click();
  await page.waitForTimeout(300);
  const advancedText = await page.locator("#settings-form").innerText();
  record("高级设置按需展开", advancedText.includes("路径") && advancedText.includes("连接详情"));
  await page.locator("#close-settings").click();

  const mobile = await context.newPage();
  mobile.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector(".composer", { timeout: 15000 });
  record("移动端隐藏桌面侧栏", await mobile.locator(".sidebar").evaluate((el) => getComputedStyle(el).display === "none"));
  const closedDrawerFocusAudit = await mobile.evaluate(() => {
    const drawer = document.querySelector(".mobile-drawer");
    return {
      inert: drawer?.hasAttribute("inert") || false,
      ariaHidden: drawer?.getAttribute("aria-hidden") || "",
    };
  });
  const closedDrawerFocusPath = [];
  for (let index = 0; index < 10; index += 1) {
    await mobile.keyboard.press("Tab");
    closedDrawerFocusPath.push(
      await mobile.evaluate(() => {
        const node = document.activeElement;
        return {
          id: node?.id || "",
          className: typeof node?.className === "string" ? node.className : "",
          inClosedDrawer: Boolean(node?.closest?.(".mobile-drawer:not(.open)")),
        };
      }),
    );
  }
  const closedDrawerFocused = closedDrawerFocusPath.some((entry) => entry.inClosedDrawer);
  record(
    "移动端关闭抽屉不进入键盘焦点",
    closedDrawerFocusAudit.inert && closedDrawerFocusAudit.ariaHidden === "true" && !closedDrawerFocused,
    JSON.stringify({ ...closedDrawerFocusAudit, closedDrawerFocused, focusPath: closedDrawerFocusPath }),
  );
  await mobile.locator("#mobile-menu-button").click();
  await mobile.waitForTimeout(600);
  record("移动端历史底部 sheet 可打开", await mobile.locator(".mobile-drawer.open").isVisible());
  const mobileDrawerGeometry = await mobile.evaluate(() => {
    const panel = document.querySelector(".mobile-drawer-panel");
    const handle = document.querySelector(".mobile-drawer-handle");
    const panelRect = panel?.getBoundingClientRect();
    const handleRect = handle?.getBoundingClientRect();
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      panelBottom: panelRect ? Math.round(innerHeight - panelRect.bottom) : null,
      panelLeft: panelRect ? Math.round(panelRect.left) : null,
      panelWidth: panelRect ? Math.round(panelRect.width) : null,
      viewportWidth: innerWidth,
      topRadius: panelStyle?.borderTopLeftRadius || "",
      handleWidth: handleRect?.width || 0,
      handleHeight: handleRect?.height || 0,
      handleVisible:
        Boolean(handleRect) &&
        handleRect.width >= 36 &&
        handleRect.height >= 4 &&
        handleRect.top >= (panelRect?.top || 0),
    };
  });
  record(
    "移动端历史使用底部 sheet 形态",
    mobileDrawerGeometry.panelBottom === 0 &&
      mobileDrawerGeometry.panelLeft === 0 &&
      mobileDrawerGeometry.panelWidth === mobileDrawerGeometry.viewportWidth &&
      mobileDrawerGeometry.topRadius !== "0px" &&
      mobileDrawerGeometry.handleVisible,
    JSON.stringify(mobileDrawerGeometry),
  );
  await mobile.locator("#mobile-session-search").click();
  await mobile.keyboard.type("体验", { delay: 20 });
  await mobile.waitForTimeout(300);
  const mobileSearchFocus = await mobile.evaluate(() => ({
    value: document.querySelector("#mobile-session-search")?.value || "",
    activeId: document.activeElement?.id || "",
  }));
  record(
    "移动端会话搜索逐字输入不丢焦",
    mobileSearchFocus.value === "体验" && mobileSearchFocus.activeId === "mobile-session-search",
  );
  await mobile.locator("#mobile-session-search").fill("");
  await mobile.locator("#mobile-drawer-close").click();
  await mobile.waitForTimeout(300);
  await mobile.locator("#conversation-menu-button").click();
  await mobile.waitForSelector(".sheet-panel.action-sheet", { timeout: 5000 });
  record("移动端会话操作使用底部 sheet", await mobile.locator(".sheet-panel.action-sheet").isVisible());
  const mobileActionVisual = await mobile.evaluate(() => {
    const archive = document.querySelector('[data-sheet-action="archive"]');
    const cancel = document.querySelector('[data-sheet-action="close"]');
    const panel = document.querySelector(".sheet-panel.action-sheet");
    const panelRect = panel?.getBoundingClientRect();
    const archiveStyle = archive ? getComputedStyle(archive) : null;
    const cancelStyle = cancel ? getComputedStyle(cancel) : null;
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      archiveClass: archive?.className || "",
      archiveColor: archiveStyle?.color || "",
      archiveBackground: archiveStyle?.backgroundColor || "",
      cancelClass: cancel?.className || "",
      cancelBorderTop: cancelStyle?.borderTopColor || "",
      cancelMarginTop: cancelStyle?.marginTop || "",
      panelLeft: panelRect ? Math.round(panelRect.left) : null,
      panelRightGap: panelRect ? Math.round(innerWidth - panelRect.right) : null,
      panelBottomGap: panelRect ? Math.round(innerHeight - panelRect.bottom) : null,
      panelBottomRadius: panelStyle?.borderBottomLeftRadius || "",
      panelOverflowY: panelStyle?.overflowY || "",
    };
  });
  record(
    "移动端归档动作使用危险视觉层级",
    mobileActionVisual.archiveClass.includes("sheet-danger-action") &&
      mobileActionVisual.archiveColor === "rgb(189, 59, 53)" &&
      mobileActionVisual.archiveBackground === "rgb(255, 245, 244)" &&
      mobileActionVisual.cancelClass.includes("sheet-cancel-action") &&
      mobileActionVisual.cancelBorderTop === "rgb(237, 241, 246)" &&
      mobileActionVisual.cancelMarginTop === "6px",
    JSON.stringify(mobileActionVisual),
  );
  record(
    "移动端操作 sheet 保留安全底距",
    mobileActionVisual.panelLeft === 12 &&
      mobileActionVisual.panelRightGap === 12 &&
      mobileActionVisual.panelBottomGap >= 10 &&
      mobileActionVisual.panelBottomGap <= 24 &&
      mobileActionVisual.panelBottomRadius !== "0px" &&
      mobileActionVisual.panelOverflowY === "auto",
    JSON.stringify(mobileActionVisual),
  );
  await mobile.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-mobile-sheet.png"), fullPage: false });
  await mobile.getByRole("button", { name: /^取消$/ }).click();
  await mobile.waitForSelector(".sheet-panel.action-sheet", { state: "detached", timeout: 5000 });
  await mobile.locator("#mobile-menu-button").click();
  await mobile.locator("#mobile-new-chat-button").click();
  const mobileWelcomeStatus = await mobile.locator(".welcome-status").innerText();
  record(
    "移动端空状态保留本机状态",
    /已就绪/.test(mobileWelcomeStatus) && mobileWelcomeStatus.includes("会话保存在本机"),
  );
  await mobile.locator("#attachment-button").click();
  await mobile.waitForTimeout(500);
  record("移动端附件入口使用产品内反馈", (await mobile.locator("body").innerText()).includes("附件能力正在打磨中"));
  await mobile.locator(".quick-prompt").first().click();
  await mobile.waitForTimeout(600);
  record(
    "移动端快捷任务可填入输入框",
    (await mobile.locator("#composer-input").inputValue()).includes("帮我分析这个目录里已有文件"),
  );
  await send(mobile, "移动端真实任务：请只回复两个字：收到");
  await waitIdle(mobile, "移动端真实回复完成", 180000);
  const mobileText = await mobile.locator("body").innerText();
  record("移动端真实对话可用", mobileText.includes("收到"));
  const mobileChrome = await mobile.evaluate(() => {
    const title = document.querySelector(".topbar-title h1");
    const topbar = document.querySelector(".topbar");
    const left = document.querySelector(".topbar-left");
    const actions = document.querySelector(".topbar-actions");
    const composer = document.querySelector(".composer");
    const textarea = document.querySelector("#composer-input");
    const inner = document.querySelector(".chat-inner");
    const messageAction = document.querySelector(".message-action");
    const titleRect = title?.getBoundingClientRect();
    const leftRect = left?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    const messageActionRect = messageAction?.getBoundingClientRect();
    const style = title ? getComputedStyle(title) : null;
    return {
      titleText: title?.textContent || "",
      titleHeight: titleRect?.height || 0,
      topbarHeight: topbar?.getBoundingClientRect().height || 0,
      whiteSpace: style?.whiteSpace || "",
      lineClamp: style?.webkitLineClamp || "",
      titleClear:
        Boolean(titleRect && leftRect && actionsRect) &&
        titleRect.left >= leftRect.right - 1 &&
        titleRect.right <= actionsRect.left + 1,
      composerHeight: composer?.getBoundingClientRect().height || 0,
      textareaHeight: textarea?.getBoundingClientRect().height || 0,
      chatPaddingBottom: Number.parseFloat(getComputedStyle(inner).paddingBottom || "0"),
      messageActionWidth: messageActionRect?.width || 0,
      messageActionHeight: messageActionRect?.height || 0,
    };
  });
  record(
    "移动端长标题两行紧凑展示",
    mobileChrome.titleText === "移动端真实任务" &&
      !mobileChrome.titleText.includes("请只回复") &&
      mobileChrome.whiteSpace === "normal" &&
      mobileChrome.lineClamp === "2" &&
      mobileChrome.titleHeight >= 18 &&
      mobileChrome.titleHeight <= 40 &&
      mobileChrome.titleClear,
    JSON.stringify(mobileChrome),
  );
  record(
    "移动端输入区压缩留出阅读空间",
    mobileChrome.composerHeight <= 110 &&
      mobileChrome.textareaHeight <= 60 &&
      mobileChrome.chatPaddingBottom <= 180,
    JSON.stringify(mobileChrome),
  );
  record(
    "移动端消息复制控件不撑高对话",
    mobileChrome.messageActionWidth <= 34 && mobileChrome.messageActionHeight <= 34,
    JSON.stringify(mobileChrome),
  );
  const mobileGeometry = await mobile.evaluate(() => {
    const composer = document.querySelector(".composer");
    const chat = document.querySelector(".chat-region");
    const composerRect = composer?.getBoundingClientRect();
    const chatRect = chat?.getBoundingClientRect();
    return Boolean(composerRect && chatRect && composerRect.top > chatRect.top + 240 && composerRect.bottom <= innerHeight);
  });
  record("移动端输入区固定且不遮挡主布局", mobileGeometry);
  await mobile.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-mobile-chat.png"), fullPage: false });
  await mobile.close();
}

async function reloginPersistenceFlow(page) {
  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form");
  await page.locator("#logout-button").click();
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  record("退出登录回到产品登录页", (await page.locator("body").innerText()).includes("继续你的对话"));
  await page.getByRole("button", { name: /创建新账号/ }).click();
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByRole("textbox", { name: "密码", exact: true }).fill(PASSWORD);
  await page.getByRole("textbox", { name: "确认密码" }).fill(PASSWORD);
  await page.getByRole("button", { name: /创建并进入/ }).click();
  await page.waitForSelector(".auth-error", { timeout: 10000 });
  record("重复用户名使用产品内提示", (await page.locator(".auth-error").innerText()).includes("用户名已经被使用"));
  await page.getByRole("button", { name: /已有账号/ }).click();
  await page.waitForFunction(
    () => !document.querySelector("#confirmPassword") && document.activeElement?.id === "username",
    undefined,
    { timeout: 5000 },
  );
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByRole("textbox", { name: "密码", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^继续$/ }).click();
  await page.waitForFunction(
    () => Boolean(document.querySelector(".composer") || document.querySelector(".auth-error")),
    undefined,
    { timeout: 30000 },
  );
  const reloginState = await page.evaluate(() => ({
    hasComposer: Boolean(document.querySelector(".composer")),
    authError: document.querySelector(".auth-error")?.textContent || "",
  }));
  record("重新登录进入工作台", reloginState.hasComposer && !reloginState.authError, JSON.stringify(reloginState));
  if (!reloginState.hasComposer) return;
  await page.locator("#session-search").fill("体验验证");
  await page.waitForTimeout(500);
  record("重新登录后历史会话仍保留", (await page.locator(".session-list").first().innerText()).includes("体验验证会话"));

  await page.locator("#session-search").fill("");
  await send(page, "请用 Bash 运行 `sleep 20; echo confirm-logout`，不要修改文件。");
  await page.waitForSelector("#stop-button", { timeout: 20000 });
  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form", { timeout: 5000 });
  await page.locator("#logout-button").click();
  await page.waitForSelector(".sheet-panel", { timeout: 5000 });
  await page.getByRole("button", { name: /^停止并退出$/ }).click();
  await page.waitForSelector("#auth-form", { timeout: 15000 });
  const stoppedLogout = await page.evaluate(() => ({
    hasAuth: Boolean(document.querySelector("#auth-form")),
    hasSettings: Boolean(document.querySelector("#settings-form")),
    hasSheet: Boolean(document.querySelector(".sheet-panel")),
    body: document.body.textContent || "",
  }));
  record(
    "运行中可停止并退出登录",
    stoppedLogout.hasAuth &&
      !stoppedLogout.hasSettings &&
      !stoppedLogout.hasSheet &&
      stoppedLogout.body.includes("继续你的对话"),
    JSON.stringify(stoppedLogout),
  );
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByRole("textbox", { name: "密码", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^继续$/ }).click();
  await page.waitForSelector(".composer", { timeout: 30000 });
  await page.locator("#session-search").fill("体验验证");
  await page.waitForTimeout(500);
  record("停止退出后可重新登录并保留历史", (await page.locator(".session-list").first().innerText()).includes("体验验证会话"));
}

async function main() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await mobileAuthVisualFlow(context);
  await register(page);
  record("注册进入工作台", await page.locator(".composer").isVisible());
  await attachmentFeedbackFlow(page);
  await iconTooltipFlow(page);
  await overlayDismissalFlow(page);
  await staleRunRecoveryFlow(page);
  await quickPromptFlow(page);
  await keyboardComposerFlow(page);
  await setAutoMode(page);
  await disconnectedRecoveryFlow(page);
  await conversationFlow(page);
  await markdownFlow(page);
  await longScrollFlow(page);
  const file = await fileToolFlow(page);
  await editSearchFlow(page, file);
  await longToolOutputFlow(page);
  await historyDepthFlow(page);
  await managementFlow(page);
  await settingsAndMobileFlow(context, page);
  await reloginPersistenceFlow(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-desktop-final.png"), fullPage: false });
  await browser.close();

  const failed = checks.filter((item) => !item.ok);
  const report = {
    baseUrl: BASE_URL,
    username: USERNAME,
    dialogs,
    total: checks.length,
    failed: failed.length,
    checks,
    finishedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(ARTIFACTS_DIR, "experience-e2e-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failed.length > 0 || dialogs.length > 0) {
    console.error(JSON.stringify({ failed, dialogs }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
