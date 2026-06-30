import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { getClinicSettings } from "@/lib/http";
import { pushMessages, type LineMessage } from "@/lib/line";
import { formatDateTime, formatDateSession } from "@/lib/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApptRow {
  id: string;
  start_at: string;
  queue_number: number | null;
  doctors: { name: string } | null;
  patients: { name: string; line_user_id: string | null } | null;
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
  const qSecret = req.nextUrl.searchParams.get("secret");
  if (!secret || (auth !== `Bearer ${secret}` && qSecret !== secret)) {
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
      .select("id, start_at, queue_number, doctors(name), patients(name, line_user_id)")
      .eq("clinic_id", CLINIC_ID)
      .eq("status", "booked")
      .gt("start_at", now.toISOString())
      .lte("start_at", until.toISOString());
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    const rows = (appts ?? []) as unknown as ApptRow[];
    const candidates = rows.filter((a) => a.patients?.line_user_id);
    if (candidates.length === 0) {
      return Response.json({ ok: true, sent: 0, skipped: 0 });
    }

    // 已發過 line 提醒的 appointment_id
    const { data: logs } = await svc
      .from("reminder_logs")
      .select("appointment_id")
      .eq("channel", "line")
      .in(
        "appointment_id",
        candidates.map((a) => a.id),
      );
    const sentSet = new Set((logs ?? []).map((l) => l.appointment_id as string));

    let sent = 0;
    let failed = 0;
    for (const a of candidates) {
      if (sentSet.has(a.id)) continue;
      const lineUserId = a.patients!.line_user_id!;
      const flex = buildReminderFlex(a, settings.booking_mode);
      try {
        await pushMessages(lineUserId, [flex]);
        const { error: logErr } = await svc
          .from("reminder_logs")
          .insert({ appointment_id: a.id, channel: "line", result: "sent" });
        // unique 衝突(並行重複)忽略
        if (!logErr) sent += 1;
      } catch {
        failed += 1; // 不寫 log,下次 cron 會重試
      }
    }

    return Response.json({ ok: true, sent, failed, scanned: candidates.length });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "提醒排程失敗" },
      { status: 500 },
    );
  }
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
          { type: "text", text: "請確認是否赴診。", size: "sm", color: "#888888", margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#16a34a",
            action: { type: "postback", label: "確認赴診", data: `action=confirm&id=${a.id}`, displayText: "確認赴診" },
          },
          {
            type: "button",
            style: "secondary",
            action: { type: "postback", label: "取消", data: `action=cancel&id=${a.id}`, displayText: "取消預約" },
          },
        ],
      },
    },
  };
}
