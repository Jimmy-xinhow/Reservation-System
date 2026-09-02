import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { safeReply } from "@/lib/line-webhook-reply";

// ── 確認 / 取消(提醒按鈕 + LINE 查詢內的取消)──────────────
export async function handleStatusPostback(
  replyToken: string,
  action: "confirm" | "cancel",
  id: string | null,
  lineUserId: string | undefined,
  svc: SupabaseClient,
  clinicId: string,
  lineAccessToken: string,
): Promise<void> {
  if (!id) {
    await safeReply(replyToken, "無法辨識的操作", lineAccessToken);
    return;
  }
  const { data: appt } = await svc
    .from("appointments")
    .select("id, status, deposit_status, clinic_id, patient_id, membership_id, patients(line_user_id)")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!appt) {
    await safeReply(replyToken, "查無此預約", lineAccessToken);
    return;
  }
  const patient = appt.patients as unknown as
    | { line_user_id: string | null }
    | { line_user_id: string | null }[]
    | null;
  const owner = Array.isArray(patient) ? patient[0]?.line_user_id : patient?.line_user_id;
  if (!lineUserId || !owner || owner !== lineUserId) {
    await safeReply(replyToken, "這筆預約不屬於目前 LINE 帳號", lineAccessToken);
    return;
  }
  if (appt.status === "cancelled" || appt.status === "done" || appt.status === "no_show") {
    await safeReply(replyToken, "此預約已無法變更，請洽服務人員。", lineAccessToken);
    return;
  }

  if (action === "confirm" && appt.deposit_status === "pending") {
    await safeReply(replyToken, "請先完成訂金付款，付款完成後才會正式確認預約。", lineAccessToken);
    return;
  }
  const newStatus = action === "confirm" ? "confirmed" : "cancelled";
  const { error } = action === "cancel"
    ? await svc.rpc("cancel_appointment", {
        p_clinic_id: clinicId,
        p_appointment_id: id,
        p_note: "cancelled from LINE",
      })
    : await svc
        .from("appointments")
        .update({ status: newStatus })
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .in("status", ["booked", "confirmed"]);
  if (error) {
    await safeReply(replyToken, "處理失敗，請稍後再試或洽服務人員。", lineAccessToken);
    return;
  }
  await notifyAppointmentStatus(svc, appt.id as string, action === "cancel" ? "cancelled" : "confirmed")
    .catch((notificationError: unknown) => console.error("LINE appointment notification failed", notificationError));
  await recordCrmInteraction(svc, {
    clinicId,
    patientId: appt.patient_id as string,
    kind: "booking",
    channel: "line",
    title: action === "confirm" ? "確認預約" : "取消預約",
    body: action === "confirm" ? "顧客透過 LINE 確認預約" : "顧客透過 LINE 取消預約",
    appointmentId: appt.id as string,
  }).catch((interactionError: unknown) => console.error("CRM LINE interaction failed", interactionError));
  await safeReply(
    replyToken,
    action === "confirm" ? "已收到您的確認，期待為您服務。" : "已為您取消此預約。",
    lineAccessToken,
  );
}
