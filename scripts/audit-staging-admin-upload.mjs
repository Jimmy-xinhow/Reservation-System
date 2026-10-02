// Isolated staging-only route audit. Creates no customer, payment, LINE, or email data.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

const appOrigin = "https://reservation-system-staging-staging.up.railway.app";
const projectRef = "ongjsegewpnbkqugrpom";
const projectUrl = `https://${projectRef}.supabase.co`;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== projectUrl ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("此稽核只允許指定 staging Web 與 Supabase 專案");
}

const service = createClient(projectUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";
const expectedImage = Buffer.from(imageBase64, "base64");
const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `qa-upload-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString("base64url")}Aa1!`;
const slug = `qa-upload-${suffix}`;
const created = { userId: null, clinicId: null };
const checks = [];
let browser;

async function must(label, query) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.code ?? result.error.status ?? "unknown"}`);
  return result.data;
}

async function submitImage(page) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const form = new FormData();
    form.append("file", new File([bytes], "qa-upload.png", { type: "image/png" }));
    const response = await fetch("/api/admin/upload", { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  }, imageBase64);
}

async function cleanup() {
  const errors = [];
  if (created.clinicId) {
    const listed = await service.storage.from("line-media").list(created.clinicId, { limit: 100 });
    if (listed.error) errors.push(`storage-list:${listed.error.statusCode ?? "unknown"}`);
    else {
      const paths = (listed.data ?? []).filter((item) => /^[a-f0-9]{32}\.png$/.test(item.name))
        .map((item) => `${created.clinicId}/${item.name}`);
      if (paths.length) {
        const removed = await service.storage.from("line-media").remove(paths);
        if (removed.error) errors.push(`storage-remove:${removed.error.statusCode ?? "unknown"}`);
      }
    }
    for (const table of ["clinic_members", "attendance_settings", "clinic_line_channels", "brand_entitlements", "clinic_activation_metrics", "clinic_settings", "clinics"]) {
      const column = table === "clinics" ? "id" : "clinic_id";
      const removed = await service.from(table).delete().eq(column, created.clinicId);
      if (removed.error) errors.push(`${table}:${removed.error.code ?? "unknown"}`);
    }
  }
  if (created.userId) {
    const removed = await service.auth.admin.deleteUser(created.userId);
    if (removed.error) errors.push(`auth:${removed.error.status ?? "unknown"}`);
  }
  if (errors.length) throw new Error(`隔離資料清理失敗：${errors.join(",")}`);
  if (created.clinicId) {
    const result = await service.from("clinics").select("id", { count: "exact", head: true }).eq("id", created.clinicId);
    if (result.error || result.count !== 0) throw new Error("隔離品牌仍有殘留");
    const listed = await service.storage.from("line-media").list(created.clinicId, { limit: 100 });
    if (listed.error || (listed.data ?? []).length !== 0) throw new Error("隔離圖片仍有殘留");
  }
  if (created.userId) {
    const result = await service.auth.admin.getUserById(created.userId);
    if (!result.error || result.data?.user) throw new Error("隔離 Auth 帳號仍有殘留");
  }
}

let workError;
try {
  const response = await fetch(`${appOrigin}/admin/login`, { redirect: "manual" });
  if (response.status !== 200) throw new Error("staging 後台登入入口不可用");
  checks.push("staging_login_reachable");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${appOrigin}/admin/login`, { waitUntil: "domcontentloaded" });
  const denied = await submitImage(page);
  if (denied.status !== 401 || denied.body?.ok !== false) throw new Error("未登入上傳未被拒絕");
  checks.push("anonymous_upload_denied");

  const user = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error("無法建立隔離 Auth 帳號");
  created.userId = user.data.user.id;
  const clinic = await must("建立隔離品牌", service.from("clinics").insert({
    name: `QA Upload ${suffix}`, slug, active: true,
  }).select("id").single());
  created.clinicId = clinic.id;
  await must("關閉隔離品牌通知", service.from("clinic_settings").update({
    line_channel_enabled: false, email_enabled: false, crm_automation_enabled: false,
  }).eq("clinic_id", clinic.id));
  await must("建立隔離品牌管理者", service.from("clinic_members").insert({
    clinic_id: clinic.id, user_id: created.userId, role: "admin", access_type: "brand_admin",
    permissions: ["brand.manage", "operations.manage"],
  }));

  await page.locator("#admin-email").fill(email);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "進入品牌營運" }).click();
  await page.waitForURL("**/admin/dashboard", { timeout: 45000 });
  checks.push("brand_admin_logged_in");

  const bookedShortcut = page.locator('a[href*="status=booked"]').first();
  const bookedHref = await bookedShortcut.getAttribute("href");
  if (!/^\/admin\?date=\d{4}-\d{2}-\d{2}&status=booked$/.test(bookedHref ?? "")) {
    throw new Error("工作台待確認預約沒有指向當日預約篩選");
  }
  await bookedShortcut.click();
  await page.waitForURL("**/admin?date=*&status=booked", { timeout: 45000 });
  checks.push("dashboard_booked_shortcut");

  const uploaded = await submitImage(page);
  if (uploaded.status !== 200 || uploaded.body?.ok !== true || typeof uploaded.body?.url !== "string") {
    throw new Error(`已登入圖片上傳失敗：HTTP ${uploaded.status}`);
  }
  const url = new URL(uploaded.body.url);
  const expectedPrefix = `/storage/v1/object/public/line-media/${clinic.id}/`;
  if (url.origin !== projectUrl || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error("上傳回傳網址不屬於隔離品牌的公開圖片路徑");
  }
  const objectName = url.pathname.slice(expectedPrefix.length);
  if (!/^[a-f0-9]{32}\.png$/.test(objectName)) throw new Error("上傳物件名稱不符預期");
  const publicResponse = await fetch(url);
  if (!publicResponse.ok || !Buffer.from(await publicResponse.arrayBuffer()).equals(expectedImage)) {
    throw new Error("已登入上傳後無法從公開網址讀回原圖片");
  }
  checks.push("authenticated_upload_and_public_read");
} catch (error) {
  workError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  try { await cleanup(); checks.push("exact_cleanup_zero_residual"); }
  catch (error) { workError = workError ? new AggregateError([workError, error], "驗收及清理均有失敗") : error; }
}

if (workError) throw workError;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), projectRef, appOrigin, checks }));
