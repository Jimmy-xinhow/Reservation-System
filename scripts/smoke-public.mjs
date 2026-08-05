const baseUrl = (process.env.SMOKE_BASE_URL || process.env.APP_URL || "").replace(/\/$/, "");

if (!baseUrl) {
  console.error("[smoke] 請設定 SMOKE_BASE_URL 或 APP_URL");
  process.exit(1);
}

const publicRoutes = ["/", "/register", "/register/pay", "/book/browser", "/embed/register"];
const cronRoutes = ["/api/cron/reminders", "/api/cron/registration", "/api/cron/marketing"];

async function fetchWithTimeout(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${baseUrl}${path}`, { redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

let failed = false;

for (const path of publicRoutes) {
  try {
    const response = await fetchWithTimeout(path);
    const body = await response.text();
    if (response.status !== 200 || body.includes("Application error")) {
      failed = true;
      console.error(`[FAIL] ${path} HTTP ${response.status}`);
      continue;
    }
    console.log(`[PASS] ${path} HTTP 200`);
  } catch (error) {
    failed = true;
    console.error(`[FAIL] ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const path of cronRoutes) {
  try {
    const response = await fetchWithTimeout(path);
    if (response.status !== 401) {
      failed = true;
      console.error(`[FAIL] ${path} expected HTTP 401, got ${response.status}`);
      continue;
    }
    console.log(`[PASS] ${path} unauthenticated HTTP 401`);
  } catch (error) {
    failed = true;
    console.error(`[FAIL] ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exit(1);
console.log("Public smoke passed.");
