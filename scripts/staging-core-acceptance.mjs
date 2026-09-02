import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? "";
if (environmentName.toLowerCase() !== "staging") {
  throw new Error(`僅允許 staging；目前環境為 ${environmentName || "unknown"}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
const baseUrl = (
  process.env.STAGING_BASE_URL ??
  process.env.PUBLIC_APP_URL ??
  (railwayPublicDomain ? `https://${railwayPublicDomain}` : "")
).replace(/\/$/, "");
if (!baseUrl) throw new Error("缺少 STAGING_BASE_URL、PUBLIC_APP_URL 或 RAILWAY_PUBLIC_DOMAIN");

const gates = [
  { name: "公開頁面與 Cron 未授權邊界", script: "smoke-public.mjs", env: { SMOKE_BASE_URL: baseUrl } },
  { name: "RLS、角色與跨品牌安全", script: "staging-security-audit.mjs" },
  { name: "預約、候補與資源容量", script: "staging-booking-audit.mjs" },
  { name: "活動、票券、會員與付款狀態", script: "staging-commerce-audit.mjs" },
  { name: "提醒、自動化與通知佇列", script: "staging-notification-audit.mjs" },
  { name: "瀏覽器身分與跨品牌操作", script: "staging-browser-identity-audit.mjs" },
];

console.log(`[staging gate] target=${baseUrl}`);
for (const gate of gates) {
  console.log(`\n[staging gate] START ${gate.name}`);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", gate.script)], {
    cwd: root,
    env: { ...process.env, ...gate.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[staging gate] FAIL ${gate.name}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[staging gate] PASS ${gate.name}`);
}

console.log(`\nStaging core acceptance passed (${gates.length}/${gates.length} gates).`);
