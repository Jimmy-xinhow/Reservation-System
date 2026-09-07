"use server";

import { revalidatePath } from "next/cache";
import { requireBrandAdmin, requireMember } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { attendanceTokenHash, type AttendanceEventType } from "@/lib/attendance";

function value(fd: FormData, key: string): string { return (fd.get(key) ?? "").toString().trim(); }
function eventType(fd: FormData): AttendanceEventType {
  const input = value(fd, "event_type");
  if (input !== "clock_in" && input !== "clock_out") throw new Error("打卡類型不正確");
  return input;
}

async function record(clinicId: string, userId: string, type: AttendanceEventType, method: "button" | "qr") {
  const { error } = await createServiceClient().from("attendance_events").insert({ clinic_id: clinicId, user_id: userId, event_type: type, method });
  if (error) throw new Error(`打卡失敗：${error.message}`);
  revalidatePath("/admin/handoff");
  revalidatePath("/admin/dashboard");
}

export async function recordButtonAttendanceAction(fd: FormData): Promise<void> {
  const member = await requireMember();
  const service = createServiceClient();
  const { data, error } = await service.from("attendance_settings").select("click_enabled").eq("clinic_id", member.clinicId).maybeSingle();
  if (error || data?.click_enabled !== true) throw new Error("此品牌目前沒有開放按鈕打卡");
  await record(member.clinicId, member.user.id, eventType(fd), "button");
}

export async function recordQrAttendanceAction(fd: FormData): Promise<void> {
  const member = await requireMember();
  const token = value(fd, "qr_token");
  if (!/^[A-Za-z0-9_-]{24,48}$/.test(token)) throw new Error("QR 打卡碼格式不正確");
  const service = createServiceClient();
  const [{ data: settings, error: settingsError }, { data: validToken, error: tokenError }] = await Promise.all([
    service.from("attendance_settings").select("qr_enabled").eq("clinic_id", member.clinicId).maybeSingle(),
    service.from("attendance_qr_tokens").select("id").eq("clinic_id", member.clinicId).eq("token_hash", attendanceTokenHash(token)).gte("expires_at", new Date().toISOString()).maybeSingle(),
  ]);
  if (settingsError || tokenError || settings?.qr_enabled !== true || !validToken) throw new Error("QR 打卡碼已失效，請掃描管理者目前顯示的最新 QR Code");
  await record(member.clinicId, member.user.id, eventType(fd), "qr");
}

export async function saveAttendanceSettingsAction(fd: FormData): Promise<void> {
  const member = await requireBrandAdmin();
  const seconds = Number(value(fd, "qr_refresh_seconds"));
  if (![30, 60, 300, 600, 1800].includes(seconds)) throw new Error("QR 更新時間不正確");
  const { error } = await createServiceClient().from("attendance_settings").upsert({
    clinic_id: member.clinicId,
    click_enabled: fd.get("click_enabled") === "on",
    qr_enabled: fd.get("qr_enabled") === "on",
    line_enabled: fd.get("line_enabled") === "on",
    qr_refresh_seconds: seconds,
    updated_by: member.user.id,
  }, { onConflict: "clinic_id" });
  if (error) throw new Error(`儲存打卡設定失敗：${error.message}`);
  revalidatePath("/admin/handoff");
  revalidatePath("/admin/dashboard");
}

export async function saveAttendanceStaffAction(fd: FormData): Promise<void> {
  const member = await requireBrandAdmin();
  const userId = value(fd, "user_id");
  const displayName = value(fd, "display_name");
  const lineUserId = value(fd, "line_user_id");
  if (!userId) throw new Error("缺少員工帳號");
  if (displayName.length > 80) throw new Error("員工顯示名稱不可超過 80 字");
  if (lineUserId && !/^U[a-fA-F0-9]{20,79}$/.test(lineUserId)) throw new Error("LINE User ID 格式不正確，應為 U 開頭的識別碼");
  const service = createServiceClient();
  const { data: clinicMember, error: memberError } = await service.from("clinic_members").select("user_id").eq("clinic_id", member.clinicId).eq("user_id", userId).maybeSingle();
  if (memberError || !clinicMember) throw new Error("員工不屬於目前品牌");
  const { error } = await service.from("attendance_staff").upsert({ clinic_id: member.clinicId, user_id: userId, display_name: displayName || null, line_user_id: lineUserId || null, active: fd.get("active") === "on" }, { onConflict: "clinic_id,user_id" });
  if (error?.code === "23505") throw new Error("這個 LINE 帳號已綁定其他員工");
  if (error) throw new Error(`儲存員工綁定失敗：${error.message}`);
  revalidatePath("/admin/handoff");
  revalidatePath("/admin/dashboard");
}
