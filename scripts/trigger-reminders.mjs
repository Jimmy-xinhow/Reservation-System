import { randomUUID } from 'node:crypto';
// Railway cron：七類工作逐一執行；部分失敗也回非零，不自動重送不確定結果。
const secret = process.env.CRON_SECRET;
function configFailure(status) {
  console.error(JSON.stringify({ event: "cron_config", status, at: new Date().toISOString() }));
  process.exit(1);
}
if (!secret) {
  configFailure("missing_secret");
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

const membershipTarget = process.env.CRON_MEMBERSHIP_TARGET_URL ||
  (appUrl ? `${appUrl}/api/cron/membership` : reminderTarget?.replace(/\/api\/cron\/reminders\/?$/, "/api/cron/membership"));

const allTargets = [
  ["reminders", reminderTarget],
  ["marketing", marketingTarget],
  ["membership", membershipTarget],
  ["followups", followupTarget],
  ["registration", registrationTarget],
  ["richmenu", richMenuTarget],
  ["subscription-freezes", subscriptionFreezeTarget],
];

// Select work at process start so delayed platform starts do not miss a clock-minute match.
// This selects job types only; each endpoint retains its existing tenant scope.
const rawArgs = process.argv.slice(2);
const scoped = rawArgs.includes("--scoped");
const args = rawArgs.filter(arg => arg !== "--scoped");
const selected = args.length === 1 && args[0].startsWith("--jobs=")
  ? args[0].slice(7).split(",") : null;
if (rawArgs.filter(arg => arg === "--scoped").length > 1 || (args.length && (!selected || new Set(selected).size !== selected.length ||
  selected.some(job => !allTargets.some(([label]) => label === job))))) {
  configFailure("invalid_jobs");
}
const targets = allTargets.filter(([label]) => !selected || selected.includes(label));
if (targets.some(([, target]) => !target)) {
  configFailure("missing_target");
}
const healthSetting = process.env.CRON_HEALTH_ENABLED;
if (healthSetting !== undefined && !["0", "1"].includes(healthSetting)) {
  configFailure("invalid_health_setting");
}
const healthEnabled = healthSetting === "1";
if (healthEnabled && !appUrl) configFailure("missing_health_target");
const healthTarget = healthEnabled ? `${appUrl}/api/cron/health` : null;

// Scope configuration is checked in full before any request. No per-job fallback.
const scopeKeys = {
  reminders: ["appointment_ids"], marketing: ["automation_ids", "patient_ids"],
  membership: ["membership_ids"], followups: ["followup_ids"],
  registration: ["registration_ids", "appointment_ids", "membership_payment_ids", "waitlist_ids"],
  richmenu: ["schedule_ids"], "subscription-freezes": ["subscription_ids"],
};
let scopes = null;
const scopeDeadline = Date.parse(process.env.CRON_SCOPE_EXPIRES_AT ?? "");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
if (scoped) {
  try {
    scopes = JSON.parse(process.env.CRON_SCOPES_JSON ?? "");
    if (!object(scopes) || !Number.isFinite(scopeDeadline) || scopeDeadline <= Date.now() ||
      Object.keys(scopes).length !== targets.length || Object.keys(scopes).some(key => !targets.some(([job]) => key === job))) throw new Error();
    for (const [job] of targets) {
      const value = scopes[job], keys = scopeKeys[job];
      if (!object(value) || typeof value.clinic_id !== "string" || !uuid.test(value.clinic_id) ||
        Object.keys(value).length !== keys.length + 1 || Object.keys(value).some(key => !["clinic_id", ...keys].includes(key))) throw new Error();
      for (const key of keys) {
        const ids = value[key];
        if (!Array.isArray(ids) || ids.length > 100 || (job !== "registration" && ids.length === 0) ||
          ids.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) throw new Error();
      }
      if (keys.every(key => value[key].length === 0)) throw new Error();
    }
  } catch {
    configFailure("invalid_or_expired_scope");
  }
} else if (process.env.CRON_SCOPES_JSON !== undefined || process.env.CRON_SCOPE_EXPIRES_AT !== undefined) {
  configFailure("scope_requires_flag");
}
const runId = randomUUID();
const mode = scoped ? "scoped" : "global";

// Only log known aggregate counters, never response bodies, target URLs or exception messages.
const counters = new Set(["scanned", "candidates", "claimed", "sent", "failed", "line", "email", "lineFailed", "emailFailed", "skipped", "duplicate", "processed", "changed", "expired", "expired_appointments", "expired_membership_payments", "expired_waitlist_offers", "released_benefits", "unconfirmed", "crm_failed", "status_write_failed"]);
function unhealthy(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(unhealthy);
  return Object.entries(value).some(([key, item]) =>
    (key === "ok" && item === false) ||
    (["failed", "lineFailed", "emailFailed", "unconfirmed", "crm_failed", "status_write_failed"].includes(key) && typeof item === "number" && item > 0) ||
    (key === "errors" && Array.isArray(item) && item.length > 0) || unhealthy(item));
}
let failed = false;
for (const [label, target] of targets) {
  if (scoped && Date.now() >= scopeDeadline) {
    console.error(JSON.stringify({ event: "cron_config", status: "scope_expired", run_id: runId, at: new Date().toISOString() }));
    failed = true; break;
  }
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let status = "request_failed", httpStatus = null, counts = {};
  try {
    const res = await fetch(target, {
      method: scoped ? "POST" : "GET",
      headers: { Authorization: `Bearer ${secret}`, ...(scoped ? { "Content-Type": "application/json" } : {}) },
      ...(scoped ? { body: JSON.stringify(scopes[label]) } : {}),
      signal: controller.signal,
      redirect: "error",
    });
    httpStatus = res.status;
    if (!res.ok) status = "http_failed";
    else {
      const body = await res.json().catch(() => null);
      if (!body || Array.isArray(body) || typeof body !== "object" || body.ok !== true) status = "invalid_or_failed_result";
      else status = unhealthy(body) ? "partial_failure" : "success";
      if (body && typeof body === "object") counts = Object.fromEntries(Object.entries(body).filter(([key, value]) => counters.has(key) && typeof value === "number" && Number.isFinite(value)));
    }
  } catch {
    status = controller.signal.aborted ? "timeout" : "request_failed";
  } finally {
    clearTimeout(timeout);
  }
  const record = { event: "cron_job", run_id: runId, mode, job: label, status, http_status: httpStatus, duration_ms: Date.now() - started, at: new Date().toISOString(), counts };
  if (status === "success") console.log(JSON.stringify(record));
  else { console.error(JSON.stringify(record)); failed = true; }
  if (healthTarget) {
    const healthController = new AbortController();
    const healthTimeout = setTimeout(() => healthController.abort(), 10_000);
    try {
      const response = await fetch(healthTarget, {
        method: "POST", redirect: "error", signal: healthController.signal,
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: runId, mode, job: label,
          status: status === "success" ? "success" : "failed",
          result_code: status, http_status: httpStatus,
        }),
      });
      const body = await response.json().catch(() => null);
      if (response.status !== 200 || body?.ok !== true) throw new Error("heartbeat rejected");
    } catch {
      console.error(JSON.stringify({ event: "cron_health_write", run_id: runId, mode, job: label, status: "failed", at: new Date().toISOString() }));
      failed = true;
    } finally {
      clearTimeout(healthTimeout);
    }
  }
}
console.log(JSON.stringify({ event: "cron_run", run_id: runId, mode, status: failed ? "failed" : "success", jobs: targets.length, at: new Date().toISOString() }));
process.exit(failed ? 1 : 0);
