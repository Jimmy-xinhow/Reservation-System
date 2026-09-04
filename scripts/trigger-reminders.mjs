// Railway cron：依序觸發提醒、行銷、指定回訪、報名／付款逾時與 Rich Menu 排程。
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
const followupTarget =
  process.env.CRON_FOLLOWUP_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/followups` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/followups"));

const registrationTarget =
  process.env.CRON_REGISTRATION_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/registration` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/registration"));
const richMenuTarget =
  process.env.CRON_RICHMENU_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/richmenu` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/richmenu"));
const subscriptionFreezeTarget =
  process.env.CRON_SUBSCRIPTION_FREEZE_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/subscription-freezes` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/subscription-freezes"));

if (!reminderTarget || !marketingTarget || !followupTarget || !registrationTarget || !richMenuTarget || !subscriptionFreezeTarget) {
  console.error("[cron] 缺少 APP_URL 或 Cron endpoint URL");
  process.exit(1);
}

const targets = [
  ["reminders", reminderTarget],
  ["marketing", marketingTarget],
  ["followups", followupTarget],
  ["registration", registrationTarget],
  ["richmenu", richMenuTarget],
  ["subscription-freezes", subscriptionFreezeTarget],
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
