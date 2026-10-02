"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/admin";
import { deliveryError } from "@/lib/delivery-error";
import { deliverClaimedEmailRedrive } from "@/lib/email-redrive";
import { emailConfigForClinic } from "@/lib/email";
import { createServiceClient } from "@/lib/supabase";

export async function redriveRejectedEmailAction(form: FormData): Promise<void> {
  const member = await requireOperator();
  const appointmentId = String(form.get("appointment_id") ?? "").trim();
  const source = String(form.get("source") ?? "").trim();
  const kind = String(form.get("kind") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (form.get("confirm_send") !== "on") throw new Error("請先確認收件地址與補送內容");
  if (!/^[0-9a-f-]{36}$/i.test(appointmentId)) throw new Error("預約識別碼不正確");
  if (source !== "reminder" && source !== "appointment") throw new Error("通知種類不正確");
  if (source === "reminder" ? kind !== "reminder" : !["pending", "confirmed", "cancelled", "rescheduled"].includes(kind)) {
    throw new Error("通知種類不正確");
  }
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("請輸入有效的 Email");

  const service = createServiceClient();
  const [{ data: settings, error: settingsError }, config] = await Promise.all([
    service.from("clinic_settings").select("email_enabled").eq("clinic_id", member.clinicId).maybeSingle(),
    emailConfigForClinic(member.clinicId, service),
  ]);
  if (settingsError || !settings?.email_enabled || !config) throw new Error("此品牌尚未啟用或設定 Email 寄送");
  if (source === "reminder") {
    const { data: appointment, error: appointmentError } = await member.supabase.from("appointments")
      .select("start_at,status").eq("id", appointmentId).eq("clinic_id", member.clinicId).maybeSingle();
    const hours = Number(process.env.REMINDER_HOURS_BEFORE ?? 24) || 24;
    const startAt = Date.parse(appointment?.start_at ?? "");
    if (appointmentError || !appointment || !["booked", "confirmed"].includes(appointment.status) ||
        !Number.isFinite(startAt) || startAt <= Date.now() || startAt > Date.now() + hours * 3600_000) {
      throw new Error("此預約已不在行前提醒時間範圍內");
    }
  }

  const { data: redriveId, error: claimError } = await service.rpc("claim_rejected_email_redrive", {
    p_clinic_id: member.clinicId,
    p_appointment_id: appointmentId,
    p_source: source,
    p_kind: kind,
    p_actor_user_id: member.user.id,
    p_email: email,
  });
  if (claimError || typeof redriveId !== "string") {
    throw new Error(`補送未開始：${deliveryError(claimError ?? "領取失敗")}`);
  }
  const result = await deliverClaimedEmailRedrive(service, member.clinicId, redriveId, email);
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/patients");
  redirect(`/admin/notifications?result=${result}`);
}
