"use server";

import { revalidatePath } from "next/cache";
import { canReviewObsoletePendingNotification } from "@/lib/appointment-notification-review";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import { requireSystemAdmin } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";

export async function reviewObsoletePendingNotificationAction(fd: FormData): Promise<void> {
  const platform = await requireSystemAdmin();
  const id = fd.get("id");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("通知紀錄格式不正確。");
  }
  const service = createServiceClient();
  const { data: notice, error: noticeError } = await adminQuery(service.from("appointment_notification_logs")
    .select("id,clinic_id,appointment_id,kind,status,sent_at,provider_message_id,reviewed_at,updated_at")
    .eq("id", id).maybeSingle());
  if (noticeError) throw new Error(adminErrorMessage(noticeError));
  if (!notice) throw new Error("找不到這筆通知，請重新整理後確認。");

  const { data: appointment, error: appointmentError } = await adminQuery(service.from("appointments")
    .select("id,clinic_id,status,start_at")
    .eq("id", notice.appointment_id).eq("clinic_id", notice.clinic_id).maybeSingle());
  if (appointmentError) throw new Error(adminErrorMessage(appointmentError));
  if (!canReviewObsoletePendingNotification(notice, appointment)) {
    throw new Error("這筆通知仍可能需要處理，不能標記為過期不補寄。");
  }

  const { data: reviewed, error: reviewError } = await adminQuery(service.from("appointment_notification_logs")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: platform.user.id,
      review_resolution: "obsolete_no_resend" })
    .eq("id", id).eq("clinic_id", notice.clinic_id)
    .eq("appointment_id", notice.appointment_id).eq("kind", "pending").eq("status", "failed")
    .eq("updated_at", notice.updated_at).is("sent_at", null)
    .is("provider_message_id", null).is("reviewed_at", null)
    .select("id").maybeSingle());
  if (reviewError) throw new Error(adminErrorMessage(reviewError));
  if (!reviewed) throw new Error("通知狀態已改變，請重新整理後確認。");
  revalidatePath("/admin/platform/operations");
}
