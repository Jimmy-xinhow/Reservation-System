import { fail } from "@/lib/http";
import { deliveryError } from "@/lib/delivery-error";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";
import { recordCrmInteraction } from "@/lib/crm-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Followup { id: string; clinic_id: string; patient_id: string; channel: "line" | "email"; purpose: "service" | "marketing"; subject: string | null; body: string; }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

interface FollowupScope { clinicId: string; followupIds: string[]; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, error: "請指定品牌與回訪紀錄" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["clinic_id", "followup_ids"].includes(key)) ||
    typeof input.clinic_id !== "string" || !uuid.test(input.clinic_id) ||
    !Array.isArray(input.followup_ids) || input.followup_ids.length < 1 || input.followup_ids.length > 100 ||
    input.followup_ids.some(id => typeof id !== "string" || !uuid.test(id)) ||
    new Set(input.followup_ids.map(id => String(id).toLowerCase())).size !== input.followup_ids.length) {
    return Response.json({ ok: false, error: "請指定品牌與 1 至 100 筆不重複的回訪紀錄" }, { status: 400 });
  }
  return runFollowups(req, { clinicId: input.clinic_id, followupIds: input.followup_ids as string[] });
}

export async function GET(req: NextRequest) { return runFollowups(req); }

async function runFollowups(req: NextRequest, scope?: FollowupScope) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  try {
    const service = createServiceClient();
    const { data, error } = scope
      ? await service.rpc("claim_scheduled_followups_for_clinic", { p_clinic_id: scope.clinicId, p_followup_ids: scope.followupIds })
      : await service.rpc("claim_due_scheduled_followups", { p_limit: 100 });
    if (error) return fail(error.message, 500);
    const summary = { claimed: 0, sent: 0, failed: 0, unconfirmed: 0, crm_failed: 0, status_write_failed: 0 };
    for (const followup of (data ?? []) as Followup[]) {
      summary.claimed += 1;
      let delivered = false;
      let deliveryAttempted = false;
      let persisted = false;
      try {
        const [{ data: patient, error: patientError }, { data: clinic, error: clinicError }, { data: settings, error: settingsError }] = await Promise.all([
          service.from("patients").select("name, line_user_id, email, marketing_opt_in, active").eq("id", followup.patient_id).eq("clinic_id", followup.clinic_id).maybeSingle(),
          service.from("clinics").select("name, line_destination").eq("id", followup.clinic_id).maybeSingle(),
          service.from("clinic_settings").select("email_enabled").eq("clinic_id", followup.clinic_id).maybeSingle(),
        ]);
        if (patientError || clinicError || settingsError) throw new Error(patientError?.message ?? clinicError?.message ?? settingsError?.message ?? "讀取回訪資料失敗");
        if (!patient?.active) throw new Error("顧客已停用");
        if (followup.purpose === "marketing" && !patient.marketing_opt_in) throw new Error("顧客未同意行銷");
        if (followup.channel === "line") {
          if (!patient.line_user_id) throw new Error("顧客沒有 LINE 身分");
          const token = await lineAccessTokenForDestination(clinic?.line_destination ?? undefined);
          deliveryAttempted = true;
          await pushMessages(patient.line_user_id, [{ type: "text", text: followup.body }], token);
        } else {
          const config = await emailConfigForClinic(followup.clinic_id);
          if (!patient.email || !settings?.email_enabled || !config) throw new Error("顧客或品牌尚未完成 Email 設定");
          deliveryAttempted = true;
          await sendEmail(config, patient.email, followup.subject || `${clinic?.name ?? "品牌"} 回訪關懷`, `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(followup.body)}</div>`);
        }
        delivered = true;
        const { error: finishError } = await service.rpc("finish_scheduled_followup", { p_followup_id: followup.id, p_status: "sent", p_error: null });
        if (finishError) throw new Error(finishError.message);
        persisted = true;
        summary.sent += 1;
        await recordCrmInteraction(service, { clinicId: followup.clinic_id, patientId: followup.patient_id, kind: "message", channel: followup.channel, title: followup.subject || "指定日期回訪", body: followup.body });
      } catch (sendError) {
        if (persisted) {
          // Delivery is already committed. A timeline failure must not enable resend.
          summary.crm_failed += 1;
        } else if (deliveryAttempted) {
          // Provider acceptance or a lost DB acknowledgement can be ambiguous.
          // Transport errors can also hide provider acceptance. Keep processing/sent
          // for investigation instead of making an uncertain delivery retryable.
          summary.unconfirmed += 1;
        } else {
          summary.failed += 1;
          try {
            const { error: finishError } = await service.rpc("finish_scheduled_followup", { p_followup_id: followup.id, p_status: "failed", p_error: deliveryError(sendError) });
            if (finishError) throw new Error(finishError.message);
          } catch (finishError) {
            summary.status_write_failed += 1;
            console.error("Followup failure status write failed", { followupId: followup.id, clinicId: followup.clinic_id, category: deliveryError(finishError) });
          }
        }
        console.error("Followup processing failed", { followupId: followup.id, clinicId: followup.clinic_id, stage: persisted ? "crm" : delivered ? "confirmation" : "delivery", category: deliveryError(sendError) });
      }
    }
    return Response.json({ ok: summary.failed === 0 && summary.unconfirmed === 0 && summary.crm_failed === 0 && summary.status_write_failed === 0, ...summary });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "排程執行失敗", 500);
  }
}
