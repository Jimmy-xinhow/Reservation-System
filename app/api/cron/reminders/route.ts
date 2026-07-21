import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { getClinicSettings } from "@/lib/http";
import { pushMessages, type LineMessage } from "@/lib/line";
import { sendEmail } from "@/lib/email";
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
 * 「看診前 N 小時」邏輯:撈進入提醒視窗、status=booked、尚無 line reminder_log 的約診,
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
    if (!CLINIC_ID) return Response.json({ ok: false, error: "未設定 NEXT_PUBLIC_CLINIC_ID" }, { status: 500 });
    const svc = createServiceClient();
    const settings = await getClinicSettings(svc, CLINIC_ID);
    if (!settings) return Response.json({ ok: false, error: "查無診所設定" }, { status: 500 });

    const hours = Number(process.env.REMINDER_HOURS_BEFORE ?? 24) || 24;
    const now = new Date();
    const until = new Date(now.getTime() + hours * 3600 * 1000);

    const { data: appts, error } = await svc
      .from("appointments")
      .select("id, start_at, queue_number, doctors(name), patients(name, line_user_id, email)")
      .eq("clinic_id", CLINIC_ID)
      .in("status", ["booked", "confirmed"])
      .gt("start_at", now.toISOString())
      .lte("start_at", until.toISOString());
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    const rows = (appts ?? []) as unknown as ApptRow[];
    if (rows.length === 0) return Response.json({ ok: true, line: 0, email: 0 });

    // 已發過的提醒紀錄(依管道)
    // ── LINE 推播(會計入額度)──
    let lineSent = 0;
    let lineFailed = 0;
    for (const a of rows) {
      if (!a.patients?.line_user_id) continue;
      const claim = await claimReminder(svc, a.id, "line");
      if (!claim) continue;
      const flex = buildReminderFlex(a, settings.booking_mode);
      try {
        await pushMessages(a.patients.line_user_id, [flex]);
        await finishReminder(svc, claim, "sent");
        lineSent += 1;
      } catch {
        await finishReminder(svc, claim, "failed").catch(() => undefined);
        lineFailed += 1;
      }
    }

    // ── Email 提醒(後台自行設定;clinic_settings.email_enabled + resend_api_key + email_from)──
    let emailSent = 0;
    let emailFailed = 0;
    const emailOn = settings.email_enabled && !!settings.resend_api_key && !!settings.email_from;
    if (emailOn) {
      const cfg = { apiKey: settings.resend_api_key!, from: settings.email_from! };
      for (const a of rows) {
        const to = a.patients?.email;
        if (!to) continue;
        const claim = await claimReminder(svc, a.id, "email");
        if (!claim) continue;
        try {
          await sendEmail(cfg, to, "慈愛中醫診所 看診提醒", buildReminderHtml(a, settings.booking_mode));
          await finishReminder(svc, claim, "sent");
          emailSent += 1;
        } catch {
          await finishReminder(svc, claim, "failed").catch(() => undefined);
          emailFailed += 1;
        }
      }
    }

    return Response.json({
      ok: true,
      line: lineSent,
      lineFailed,
      email: emailSent,
      emailFailed,
      scanned: rows.length,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "提醒排程失敗" },
      { status: 500 },
    );
  }
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
): Promise<void> {
  const { error } = await svc.from("reminder_logs").update({ result }).eq("id", claimId);
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
  const doctor = a.doctors?.name ?? "醫師";
  const patient = a.patients?.name ?? "";
  const when =
    mode === "time"
      ? formatDateTime(a.start_at)
      : `${formatDateSession(a.start_at)} 第 ${a.queue_number ?? "?"} 號`;
  const altText = `看診提醒:${when} ${doctor}`;

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
          { type: "text", text: "看診提醒", weight: "bold", size: "lg", color: "#1d4ed8" },
          { type: "text", text: when, wrap: true, size: "md", weight: "bold" },
          { type: "text", text: `醫師:${doctor}`, size: "sm", color: "#555555" },
          ...(patient ? [{ type: "text", text: `就診者:${patient}`, size: "sm", color: "#555555" }] : []),
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

function buildReminderHtml(a: ApptRow, mode: "time" | "number"): string {
  const safe: ApptRow = {
    ...a,
    doctors: a.doctors ? { name: escapeHtml(a.doctors.name) } : null,
    patients: a.patients
      ? { ...a.patients, name: escapeHtml(a.patients.name) }
      : null,
  };
  return buildReminderHtmlUnsafe(safe, mode);
}

function buildReminderHtmlUnsafe(a: ApptRow, mode: "time" | "number"): string {
  const doctor = a.doctors?.name ?? "醫師";
  const patient = a.patients?.name ?? "";
  const when =
    mode === "time"
      ? formatDateTime(a.start_at)
      : `${formatDateSession(a.start_at)} 第 ${a.queue_number ?? "?"} 號`;
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:16px">
      <h2 style="color:#1d4ed8;margin:0 0 12px">看診提醒</h2>
      <p style="font-size:18px;font-weight:bold;margin:0 0 8px">${when}</p>
      <p style="color:#555;margin:0 0 4px">醫師:${doctor}</p>
      ${patient ? `<p style="color:#555;margin:0 0 4px">就診者:${patient}</p>` : ""}
      <p style="color:#888;margin:12px 0 0;font-size:14px">
        無法前來請務必提前取消。累計三次未提前取消而未到,將暫停一個月線上預約資格。
      </p>
      <p style="color:#aaa;margin:16px 0 0;font-size:12px">慈愛中醫診所</p>
    </div>`;
}
