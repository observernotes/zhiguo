"use strict";

// 体验 E2E 已暂停，避免自动评审反复调用真实 Claude Code。
console.log("[experience-e2e] 已暂停。恢复时删掉本段并还原 package.json 的 test:experience 脚本。");
process.exit(0);

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is required. Run `npm install` first, then `npm run test:experience`.");
  process.exit(1);
}

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const BASE_URL = process.env.BASE_URL || "http://localhost:3300/?v=experience-smoke";
const PASSWORD = process.env.TEST_PASSWORD || `test_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const USERNAME = process.env.TEST_USERNAME || `ux_${Date.now()}`;
const HEADLESS = process.env.HEADLESS !== "0";
const SKIP_CLAUDE = process.env.SKIP_CLAUDE === "1";

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
          document.querySelector("#stop-button, .turn-footer.running, .assistant-block.streaming"),
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
  await page.waitForTimeout(400);
  record(name, true);
}

async function hasActiveQuotaIssue(page) {
  return page.evaluate(() => {
    const text = document.body.textContent || "";
    return /额度不足|账号需处理|Claude 账号仍需处理|Insufficient Balance/i.test(text);
  });
}

async function send(page, text) {
  await page.locator("#composer-input").fill(text);
  await page.locator("#composer-form button[type='submit']").click();
}

async function register(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /创建新账号/ }).click();
  await page.waitForSelector("#confirmPassword", { timeout: 5000 });
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByRole("textbox", { name: "密码", exact: true }).fill(PASSWORD);
  await page.getByRole("textbox", { name: "确认密码" }).fill(PASSWORD);
  await page.getByRole("button", { name: /创建并进入/ }).click();
  await page.waitForSelector(".composer", { timeout: 30000 });
  record("注册并进入工作台", true);
}

async function smokeUi(page) {
  record("对话输入区可见", await page.locator(".composer").isVisible());
  record("设置入口可见", await page.locator("#settings-button").isVisible());
  await page.locator("#settings-button").click();
  await page.waitForSelector("#settings-form", { timeout: 5000 });
  const settingsText = await page.locator("#settings-form").innerText();
  record("设置页可打开", settingsText.length > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function smokeShortReply(page) {
  if (SKIP_CLAUDE) {
    record("短回复（跳过真实 Claude）", true, "SKIP_CLAUDE=1");
    return;
  }
  if (await hasActiveQuotaIssue(page)) {
    record("短回复（跳过：额度不足）", true, "quota blocked");
    return;
  }
  await send(page, "请只回复两个字：收到");
  await waitIdle(page, "短回复完成", 90000);
  const body = await page.locator("body").innerText();
  record("助手有回复", /收到|ok|OK/i.test(body));
}

async function smokeMobile(context) {
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const hasAuth = await mobile.locator("#auth-form").isVisible().catch(() => false);
  const hasComposer = await mobile.locator(".composer").isVisible().catch(() => false);
  record("移动端页面可加载", hasAuth || hasComposer);
  await mobile.close();
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

  await register(page);
  await smokeUi(page);
  await smokeShortReply(page);
  await smokeMobile(context);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "experience-smoke-final.png"), fullPage: false });
  await browser.close();

  const failed = checks.filter((item) => !item.ok);
  const report = {
    baseUrl: BASE_URL,
    username: USERNAME,
    mode: "smoke",
    dialogs,
    total: checks.length,
    failed: failed.length,
    checks,
    finishedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(ARTIFACTS_DIR, "experience-e2e-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nSmoke done: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) {
    console.error(JSON.stringify({ failed, dialogs }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
