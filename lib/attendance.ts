import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AttendanceEventType = "clock_in" | "clock_out";

export function attendanceTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function recordLineAttendance(
  service: SupabaseClient,
  input: { clinicId: string; lineUserId?: string; eventType: AttendanceEventType; lineEventId?: string },
): Promise<{ ok: boolean; message: string; occurredAt?: string }> {
  if (!input.lineUserId) return { ok: false, message: "LINE 無法辨識您的帳號，請改用一對一聊天室後再試。" };
  const [{ data: settings, error: settingsError }, { data: staff, error: staffError }] = await Promise.all([
    service.from("attendance_settings").select("line_enabled").eq("clinic_id", input.clinicId).maybeSingle(),
    service.from("attendance_staff").select("user_id, display_name, active").eq("clinic_id", input.clinicId).eq("line_user_id", input.lineUserId).maybeSingle(),
  ]);
  if (settingsError || staffError) return { ok: false, message: "打卡設定暫時無法讀取，請聯絡管理者。" };
  if (settings?.line_enabled !== true) return { ok: false, message: "此品牌目前沒有開放 LINE 打卡。" };
  if (!staff?.user_id || staff.active !== true) return { ok: false, message: "這個 LINE 帳號尚未綁定在職員工，請聯絡管理者完成綁定。" };
  const occurredAt = new Date().toISOString();
  const { error } = await service.from("attendance_events").insert({
    clinic_id: input.clinicId,
    user_id: staff.user_id,
    event_type: input.eventType,
    method: "line",
    occurred_at: occurredAt,
    line_event_id: input.lineEventId || null,
  });
  if (error?.code === "23505" && input.lineEventId) return { ok: true, message: "這一則打卡訊息已經記錄，不會因 LINE 重送而重複計算。", occurredAt };
  if (error) return { ok: false, message: "打卡寫入失敗，請稍後再試或改用後台按鈕。" };
  const time = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(occurredAt));
  return { ok: true, message: `${staff.display_name || "員工"} ${input.eventType === "clock_in" ? "上班" : "下班"}打卡成功\n${time}\n本次紀錄已新增，不會覆蓋先前紀錄。`, occurredAt };
}
