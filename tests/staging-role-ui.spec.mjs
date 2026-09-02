import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScript = path.join(root, "scripts", "staging-role-fixture.mjs");
const baseUrl = (process.env.STAGING_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");

let fixture;

function runFixture(mode) {
  const result = spawnSync(process.execPath, [fixtureScript, mode], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`staging role fixture ${mode} failed: ${(result.stderr || "unknown error").slice(0, 800)}`);
  }
  return result.stdout.trim();
}

async function login(page, identity, entry) {
  const account = fixture.users[identity];
  await page.goto(`${baseUrl}/admin/login`);
  if (entry === "platform") await page.getByRole("button", { name: "系統管理後台" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("密碼").fill(account.password);
  await page.getByRole("button", { name: entry === "platform" ? "登入系統管理後台" : "登入品牌營運後台" }).click();
}

async function expectNoHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!baseUrl) throw new Error("Missing STAGING_BASE_URL or PUBLIC_APP_URL");
  if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") {
    throw new Error("Role UI audit is only allowed in staging");
  }
  const output = runFixture("setup");
  fixture = JSON.parse(output.split(/\r?\n/).at(-1));
});

test.afterAll(() => {
  runFixture("cleanup");
});

test("系統管理者可進入系統人員頁", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "system-admin", "platform");
  await expect(page).toHaveURL(/\/admin\/platform(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "系統管理控制台" })).toBeVisible();
  await page.goto(`${baseUrl}/admin/platform/admins`);
  await expect(page.getByRole("heading", { name: "系統人員與權限" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("系統員工只能進入獲授權的系統總覽", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "system-employee", "platform");
  await expect(page).toHaveURL(/\/admin\/platform(?:\?|$)/);
  await page.goto(`${baseUrl}/admin/platform/admins`);
  await expect(page).toHaveURL(/\/admin\/platform\?notice=permission/);
  await expect(page.getByRole("heading", { name: "系統管理控制台" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("品牌管理者可進入品牌人員頁", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "brand-admin", "brand");
  await expect(page).toHaveURL(/\/admin\/dashboard(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await page.goto(`${baseUrl}/admin/users`);
  await expect(page.getByRole("heading", { name: "品牌人員與權限" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("品牌員工無法進入品牌人員頁", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "brand-employee", "brand");
  await expect(page).toHaveURL(/\/admin\/dashboard(?:\?|$)/);
  await page.goto(`${baseUrl}/admin/users`);
  await expect(page).toHaveURL(/\/admin\/dashboard\?notice=permission/);
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
