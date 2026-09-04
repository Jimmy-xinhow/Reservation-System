import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { lineAccessTokenForDestination, pushMessages } from "@/lib/line";
import { recordCrmInteraction } from "@/lib/crm-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Followup { id: string; clinic_id: string; patient_id: string; channel: "line" | "email"; purpose: "service" | "marketing"; subject: string | null; body: string; }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const service = createServiceClient();
  const { data, error } = await service.rpc("claim_due_scheduled_followups", { p_limit: 100 });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const summary = { claimed: 0, sent: 0, failed: 0 };
  for (const followup of (data ?? []) as Followup[]) {
    summary.claimed += 1;
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
        const token = lineAccessTokenForDestination(clinic?.line_destination ?? undefined);
        await pushMessages(patient.line_user_id, [{ type: "text", text: followup.body }], token);
      } else {
        const config = emailConfigForClinic(followup.clinic_id);
        if (!patient.email || !settings?.email_enabled || !config) throw new Error("顧客或品牌尚未完成 Email 設定");
        await sendEmail(config, patient.email, followup.subject || `${clinic?.name ?? "品牌"} 回訪關懷`, `<div style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(followup.body)}</div>`);
      }
      await service.rpc("finish_scheduled_followup", { p_followup_id: followup.id, p_status: "sent", p_error: null });
      await recordCrmInteraction(service, { clinicId: followup.clinic_id, patientId: followup.patient_id, kind: "message", channel: followup.channel, title: followup.subject || "指定日期回訪", body: followup.body });
      summary.sent += 1;
    } catch (sendError) {
      await service.rpc("finish_scheduled_followup", { p_followup_id: followup.id, p_status: "failed", p_error: sendError instanceof Error ? sendError.message : "發送失敗" });
      summary.failed += 1;
    }
  }
  return Response.json({ ok: summary.failed === 0, ...summary });
}
