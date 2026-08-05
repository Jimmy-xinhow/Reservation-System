// Railway cron：每次同時觸發提醒與 CRM Lite 行銷自動化。
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("[cron] 缺少 CRON_SECRET");
  process.exit(1);
}

const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const reminderTarget =
  process.env.CRON_TARGET_URL || (appUrl ? `${appUrl}/api/cron/reminders` : null);
const marketingTarget =
  process.env.CRON_MARKETING_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/marketing` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/marketing"));

if (!reminderTarget || !marketingTarget) {
  console.error("[cron] 缺少 APP_URL 或 CRON_TARGET_URL");
  process.exit(1);
}

const registrationTarget =
  process.env.CRON_REGISTRATION_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/registration` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/registration"));

const targets = [
  ["reminders", reminderTarget],
  ["marketing", marketingTarget],
  ["registration", registrationTarget],
];

let failed = false;
for (const [label, target] of targets) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) {
      console.error(`[${label}] HTTP ${res.status}: ${body}`);
      failed = true;
    } else {
      console.log(`[${label}] ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error(`[${label}] request failed: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  } finally {
    clearTimeout(timeout);
  }
}

process.exit(failed ? 1 : 0);
