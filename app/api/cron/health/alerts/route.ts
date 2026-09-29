import { NextRequest } from "next/server";
import { GET as readHealth } from "../route";
import { emailConfigForClinic, isEmailProviderRejected, sendEmail } from "@/lib/email";
import { createServiceClient } from "@/lib/supabase";
import { cronAllowedClinics } from "@/lib/cron-allowlist";
import { fail } from "@/lib/http";
import { CRON_JOB_EXPECTATIONS, type CronRunState } from "@/lib/cron-operations-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlertJob = (typeof CRON_JOB_EXPECTATIONS)[number]["job"];
type AlertTransition = "incident" | "recovery";
type AlertDelivery = {
  id: string;
  incident_id: string;
  mode: "global" | "scoped";
  job: AlertJob;
  transition: AlertTransition;
  observed_state: CronRunState;
  attempts: number;
};

const jobLabels: Record<AlertJob, string> = Object.fromEntries(
  CRON_JOB_EXPECTATIONS.map(({ job, label }) => [job, label]),
) as Record<AlertJob, string>;
const stateLabels: Record<CronRunState, string> = {
  healthy: "已恢復", failed: "執行失敗", stale: "逾時未執行",
  missing: "沒有執行紀錄", invalid_time: "執行時間異常",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function alertConfiguration() {
  const clinicId = process.env.CRON_ALERT_CLINIC_ID ?? "";
  const to = process.env.CRON_ALERT_TO_EMAIL ?? "";
  if (process.env.CRON_ALERT_ENABLED !== "1" || !uuid.test(clinicId) || !email.test(to)) return null;
  return { clinicId, to };
}

function alertContent(row: AlertDelivery) {
  const job = jobLabels[row.job];
  const state = stateLabels[row.observed_state];
  const transition = row.transition === "incident" ? "故障" : "恢復";
  const subject = `排程${transition}：${job}`;
  const html = `<div style="font-family:sans-serif"><h2>${subject}</h2><p>範圍：${row.mode === "global" ? "全域" : "指定品牌"}</p><p>狀態：${state}</p><p>事件編號：${row.incident_id}</p><p>請至系統管理的排程健康頁檢查；本信不含顧客或品牌資料。</p></div>`;
  return { subject, html };
}

/** Called only by the separate health monitor. All observations are recomputed server-side. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const config = alertConfiguration();
  if (!config) return fail("排程告警渠道尚未設定", 503);

  try {
    const healthResponse = await readHealth(request);
    if (healthResponse.status !== 200 && healthResponse.status !== 503) return fail("排程健康暫時無法確認", 503);
    const health: unknown = await healthResponse.json();
    if (!health || typeof health !== "object" || !("jobs" in health) || !Array.isArray(health.jobs) ||
        health.jobs.length !== CRON_JOB_EXPECTATIONS.length) return fail("排程健康暫時無法確認", 503);

    const mode = cronAllowedClinics() ? "scoped" : "global";
    const service = createServiceClient();
    for (const expected of CRON_JOB_EXPECTATIONS) {
      const match = health.jobs.find((row: unknown) => row && typeof row === "object" &&
        "job" in row && row.job === expected.job && "state" in row &&
        typeof row.state === "string" && row.state in stateLabels);
      if (!match || typeof match.state !== "string") return fail("排程健康暫時無法確認", 503);
      const { error } = await service.rpc("record_cron_alert_observation", {
        p_mode: mode, p_job: expected.job, p_state: match.state,
      });
      if (error) return fail("排程告警狀態暫時無法寫入", 503);
    }

    const emailConfig = await emailConfigForClinic(config.clinicId, service);
    if (!emailConfig) return fail("排程告警寄件者尚未設定", 503);
    let delivered = 0;
    for (let index = 0; index < CRON_JOB_EXPECTATIONS.length * 2; index++) {
      const { data, error } = await service.rpc("claim_cron_alert_delivery");
      if (error) return fail("排程告警佇列暫時無法讀取", 503);
      const row = (Array.isArray(data) ? data[0] : null) as AlertDelivery | null;
      if (!row) break;
      const content = alertContent(row);
      try {
        await sendEmail(emailConfig, config.to, content.subject, content.html, {
          idempotencyKey: `cron-alert-${row.id}`,
          signal: AbortSignal.timeout(8_000),
        });
      } catch (sendError) {
        // A network timeout may have been accepted by the provider. Keep the same
        // idempotency key and lease rather than creating a second alert.
        if (isEmailProviderRejected(sendError)) {
          const { data: finished, error: finishError } = await service.rpc("finish_cron_alert_delivery", {
            p_id: row.id, p_attempts: row.attempts, p_sent: false, p_error_code: "provider_rejected",
          });
          if (finishError || finished !== true) return fail("排程告警拒收狀態暫時無法確認", 503);
        }
        return fail("排程告警尚未送達", 503);
      }
      const { data: finished, error: finishError } = await service.rpc("finish_cron_alert_delivery", {
        p_id: row.id, p_attempts: row.attempts, p_sent: true, p_error_code: null,
      });
      if (finishError || finished !== true) return fail("排程告警送達狀態暫時無法確認", 503);
      delivered++;
    }
    return Response.json({ ok: true, observed: CRON_JOB_EXPECTATIONS.length, delivered }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return fail("排程告警暫時無法執行", 503);
  }
}
