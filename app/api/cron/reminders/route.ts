import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getClinicSettings } from "@/lib/http";
import { lineAccessTokenForDestination, pushMessages, type LineMessage } from "@/lib/line";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { formatDateTime, formatDateSession } from "@/lib/slots";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApptRow {
  id: string;
  start_at: string;
  queue_number: number | null;
  doctors: { name: string } | null;
  patients: { name: string; line_user_id: string | null; email: string | null } | null;
}

/**
 * GET /api/cron/reminders
 * 「預約前 N 小時」邏輯:撈進入提醒視窗、status=booked、尚無 line reminder_log 的預約,
 * 有 line_user_id 就發 Flex,成功後寫 reminder_logs(unique 防重複)。
 * 因每次執行都掃整個視窗,當天才新增的預約也會被涵蓋。
 */
export async function GET(req: NextRequest) {
  // CRON_SECRET 驗證(Vercel Cron 會帶 Authorization: Bearer <CRON_SECRET>)
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const svc = createServiceClient();
    const { data: clinics, error: clinicError } = await svc.from("clinics").select("id").eq("active", true);
    if (clinicError) throw new Error(clinicError.message);
    const summary = { line: 0, lineFailed: 0, email: 0, emailFailed: 0, scanned: 0 };
    const errors: string[] = [];
    for (const clinic of clinics ?? []) {
      try {
        const result = await runReminderClinic(svc, clinic.id as string);
        summary.line += result.line;
        summary.lineFailed += result.lineFailed;
        summary.email += result.email;
        summary.emailFailed += result.emailFailed;
        summary.scanned += result.scanned;
      } catch (error) {
        errors.push(`${clinic.id}: ${error instanceof Error ? error.message : "執行失敗"}`);
      }
    }
    return Response.json({ ok: errors.length === 0, ...summary, errors });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "提醒排程失敗" },
      { status: 500 },
    );
  }
}

async function runReminderClinic(svc: SupabaseClient, clinicId: string): Promise<{ line: number; lineFailed: number; email: number; emailFailed: number; scanned: number }> {
  const settings = await getClinicSettings(svc, clinicId);
  if (!settings) throw new Error("查無品牌設定");
  const { data: clinic, error: clinicError } = await svc
    .from("clinics")
    .select("name, line_destination")
    .eq("id", clinicId)
    .maybeSingle();
  if (clinicError) throw new Error(clinicError.message);
  const hours = Number(process.env.REMINDER_HOURS_BEFORE ?? 24) || 24;
  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600 * 1000);
  const { data: appts, error } = await svc.from("appointments").select("id, start_at, queue_number, doctors(name), patients(name, line_user_id, email)").eq("clinic_id", clinicId).in("status", ["booked", "confirmed"]).gt("start_at", now.toISOString()).lte("start_at", until.toISOString());
  if (error) throw new Error(error.message);
  const rows = (appts ?? []) as unknown as ApptRow[];
  let lineAccessToken: string | null = null;
  let lineAccessError: string | null = null;
  if (rows.some((appointment) => Boolean(appointment.patients?.line_user_id))) {
    try {
      lineAccessToken = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
    } catch (error) {
      lineAccessError = error instanceof Error ? error.message : "LINE access token unavailable";
    }
  }
  let line = 0;
  let lineFailed = 0;
  for (const appointment of rows) {
    if (!appointment.patients?.line_user_id) continue;
    const claim = await claimReminder(svc, appointment.id, "line");
    if (!claim) continue;
    if (!lineAccessToken) {
      await finishReminder(svc, claim, "failed", lineAccessError ?? "LINE access token unavailable").catch(() => undefined);
      lineFailed += 1;
      continue;
    }
    try {
      await pushMessages(appointment.patients.line_user_id, [buildReminderFlex(appointment, settings.booking_mode)], lineAccessToken);
      await finishReminder(svc, claim, "sent");
      line += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "LINE reminder failed";
      console.error("Reminder LINE delivery failed", { clinicId, appointmentId: appointment.id, error: message });
      await finishReminder(svc, claim, "failed", message).catch(() => undefined);
      lineFailed += 1;
    }
  }
  let email = 0;
  let emailFailed = 0;
  const emailConfig = emailConfigForClinic(clinicId);
  if (settings.email_enabled && emailConfig) {
    for (const appointment of rows) {
      const to = appointment.patients?.email;
      if (!to) continue;
      const claim = await claimReminder(svc, appointment.id, "email");
      if (!claim) continue;
      try {
        await sendEmail(emailConfig, to, "預約提醒", buildReminderHtml(appointment, settings.booking_mode, clinic?.name as string | null));
        await finishReminder(svc, claim, "sent");
        email += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Email reminder failed";
        console.error("Reminder Email delivery failed", { clinicId, appointmentId: appointment.id, error: message });
        await finishReminder(svc, claim, "failed", message).catch(() => undefined);
        emailFailed += 1;
      }
    }
  }
  return { line, lineFailed, email, emailFailed, scanned: rows.length };
}

async function claimReminder(
  svc: SupabaseClient,
  appointmentId: string,
  channel: "line" | "email",
): Promise<string | null> {
  const { data, error } = await svc.rpc("claim_reminder", {
    p_appointment_id: appointmentId,
    p_channel: channel,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

async function finishReminder(
  svc: SupabaseClient,
  claimId: string,
  result: "sent" | "failed",
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await svc.from("reminder_logs").update({ result, error: errorMessage }).eq("id", claimId);
  if (error) throw new Error(error.message);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function buildReminderFlex(a: ApptRow, mode: "time" | "number"): LineMessage {
  const doctor = a.doctors?.name ?? "服務提供者";
  const patient = a.patients?.name ?? "";
  const when =
    mode === "time"
      ? formatDateTime(a.start_at)
      : `${formatDateSession(a.start_at)} 第 ${a.queue_number ?? "?"} 號`;
  const altText = `預約提醒:${when} ${doctor}`;

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "預約提醒", weight: "bold", size: "lg", color: "#1d4ed8" },
          { type: "text", text: when, wrap: true, size: "md", weight: "bold" },
          { type: "text", text: `服務提供者:${doctor}`, size: "sm", color: "#555555" },
          ...(patient ? [{ type: "text", text: `顧客:${patient}`, size: "sm", color: "#555555" }] : []),
          { type: "text", text: "無法前來請點下方取消。", size: "sm", color: "#888888", margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "secondary",
            action: { type: "postback", label: "無法前來 · 取消預約", data: `action=cancel&id=${a.id}`, displayText: "取消預約" },
          },
        ],
      },
    },
  };
}

function buildReminderHtml(a: ApptRow, mode: "time" | "number", clinicName: string | null): string {
  const safe: ApptRow = {
    ...a,
    doctors: a.doctors ? { name: escapeHtml(a.doctors.name) } : null,
    patients: a.patients
      ? { ...a.patients, name: escapeHtml(a.patients.name) }
      : null,
  };
  return buildReminderHtmlUnsafe(safe, mode, clinicName);
}

function buildReminderHtmlUnsafe(a: ApptRow, mode: "time" | "number", clinicName: string | null): string {
  const doctor = a.doctors?.name ?? "服務提供者";
  const patient = a.patients?.name ?? "";
  const when =
    mode === "time"
      ? formatDateTime(a.start_at)
      : `${formatDateSession(a.start_at)} 第 ${a.queue_number ?? "?"} 號`;
  const displayName = escapeHtml(clinicName?.trim() || "預約與報名平台");
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:16px">
      <h2 style="color:#1d4ed8;margin:0 0 12px">預約提醒</h2>
      <p style="font-size:18px;font-weight:bold;margin:0 0 8px">${when}</p>
      <p style="color:#555;margin:0 0 4px">服務提供者:${doctor}</p>
      ${patient ? `<p style="color:#555;margin:0 0 4px">顧客:${patient}</p>` : ""}
      <p style="color:#888;margin:12px 0 0;font-size:14px">
        無法前來請務必提前取消。累計三次未提前取消而未出席,將暫停一個月線上預約資格。
      </p>
      <p style="color:#aaa;margin:16px 0 0;font-size:12px">${displayName}</p>
    </div>`;
}
