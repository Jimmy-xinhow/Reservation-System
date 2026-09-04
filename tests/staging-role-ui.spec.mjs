import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScript = path.join(root, "scripts", "staging-role-fixture.mjs");
const baseUrl = (process.env.STAGING_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");

let fixture;

const denseBrandWorkspaces = [
  ["/admin/checkout", "結帳中心"],
  ["/admin/customer-value", "顧客資產與訂閱"],
  ["/admin/followups", "指定日期回訪"],
  ["/admin/documents", "同意書與電子簽署"],
  ["/admin/beauty/supply", "採購與盤點"],
  ["/admin/fitness", "教室與會籍營運"],
  ["/admin/course-content", "課程內容與學習驗收"],
];

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
  await expect(page).toHaveURL(entry === "platform" ? /\/admin\/platform(?:\?|$)/ : /\/admin\/dashboard(?:\?|$)/);
}

async function expectNoHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;

    function isContainedByOverflowBoundary(element, rect) {
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (!["auto", "scroll", "hidden", "clip"].includes(overflowX)) continue;
        const boundary = ancestor.getBoundingClientRect();
        if (rect.left < boundary.left - 0.5 || rect.right > boundary.right + 0.5) return true;
      }
      return false;
    }

    return [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        if (isContainedByOverflowBoundary(element, rect)) return null;
        return {
          element: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
        };
      })
      .filter((item) => item && (item.left < -0.5 || item.right > viewportWidth + 0.5))
      .slice(0, 12);
  })).toEqual([]);
}

async function expectDenseWorkspaceLayout(page, { paired = false } = {}) {
  await expectNoHorizontalOverflow(page);
  const headingSize = await page.locator("h1").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(headingSize).toBeGreaterThanOrEqual(24);
  expect(headingSize).toBeLessThanOrEqual(28);
  await expect(page.locator(".admin-shell")).toHaveCSS("font-size", "14px");
  const helperText = page.locator(".admin-shell .text-xs").first();
  if (await helperText.count()) await expect(helperText).toHaveCSS("font-size", "12px");
  if (!paired) return;
  const workspace = page.locator(".admin-workbench-grid, .admin-workbench-grid-wide").first();
  if (await workspace.count()) {
    const columnCount = await workspace.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columnCount).toBeGreaterThanOrEqual(2);
  }
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

test("品牌管理者的新增營運頁在桌機採緊湊多欄排版", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "brand-admin", "brand");
  for (const [pathname, heading] of denseBrandWorkspaces) {
    await page.goto(`${baseUrl}${pathname}`);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expectDenseWorkspaceLayout(page, { paired: true });
  }
});

test("品牌管理者的新增營運頁在手機不產生頁面橫向溢位", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "brand-admin", "brand");
  for (const [pathname, heading] of denseBrandWorkspaces) {
    await page.goto(`${baseUrl}${pathname}`);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expectDenseWorkspaceLayout(page);
  }
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
