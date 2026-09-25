"use server";

import { redirect } from "next/navigation";
import { deliveryError } from "@/lib/delivery-error";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { recordCrmInteraction } from "@/lib/crm-interactions";

function storageError(error: unknown): Error {
  console.error("Followup storage failed", { category: deliveryError(error) });
  return new Error("回訪資料暫時無法儲存或讀取，請重新整理確認結果後再試");
}

async function storage<T>(operation: PromiseLike<T>): Promise<T> {
  try { return await operation; } catch (error) { throw storageError(error); }
}

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }
function refresh(patientId?: string): void { revalidatePath("/admin/followups"); if (patientId) revalidatePath(`/admin/patients/${patientId}`); }

function parseTaipeiDateTimeLocal(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return new Date(Number.NaN);
  return new Date(`${value}+08:00`);
}

export async function createScheduledFollowupAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const patientId = text(fd, "patient_id");
  const channel = text(fd, "channel");
  const purpose = text(fd, "purpose");
  const body = text(fd, "body");
  const scheduled = parseTaipeiDateTimeLocal(text(fd, "scheduled_for"));
  if (!patientId || !["line", "email", "phone", "manual"].includes(channel) || !["service", "marketing"].includes(purpose) || !body || Number.isNaN(scheduled.getTime())) throw new Error("回訪資料不完整");
  const service = createServiceClient();
  const { data: patient, error: patientError } = await storage(service.from("patients").select("id, marketing_opt_in, line_user_id, email").eq("id", patientId).eq("clinic_id", member.clinicId).eq("active", true).maybeSingle());
  if (patientError) throw storageError(patientError);
  if (!patient) throw new Error("顧客不屬於目前品牌");
  if (purpose === "marketing" && !patient.marketing_opt_in) throw new Error("顧客尚未同意行銷，不能建立行銷回訪");
  if (channel === "line" && !patient.line_user_id) throw new Error("顧客尚未綁定 LINE，請改用其他方式");
  if (channel === "email" && !patient.email) throw new Error("顧客尚未填寫 Email，請改用其他方式");
  const { error } = await storage(service.from("scheduled_followups").insert({ clinic_id: member.clinicId, patient_id: patientId, channel, purpose, subject: text(fd, "subject").slice(0, 160) || null, body: body.slice(0, 3000), scheduled_for: scheduled.toISOString(), status: "pending", assigned_to: member.user.id, created_by: member.user.id }));
  if (error) throw storageError(error);
  refresh(patientId);
}

export async function setScheduledFollowupStatusAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!["completed", "cancelled", "pending"].includes(status)) throw new Error("回訪狀態不正確");
  const service = createServiceClient();
  const { data: current, error: currentError } = await storage(service.from("scheduled_followups").select("id, patient_id, body, channel, status").eq("id", id).eq("clinic_id", member.clinicId).maybeSingle());
  if (currentError) throw storageError(currentError);
  if (!current) throw new Error("找不到回訪事項");
  const allowed = status === "pending" ? current.status === "failed" : ["pending", "failed"].includes(current.status);
  if (!allowed) throw new Error("目前狀態不能執行這個操作");
  const { data: updated, error } = await storage(service.from("scheduled_followups").update({ status, last_error: status === "pending" ? null : undefined, processed_at: status === "completed" ? new Date().toISOString() : null }).eq("id", id).eq("clinic_id", member.clinicId).eq("status", current.status).select("id").maybeSingle());
  if (error) throw storageError(error);
  if (!updated) throw new Error("回訪狀態已變更，請重新整理後再試");
  let timelineFailed = false;
  if (status === "completed") {
    try {
      await recordCrmInteraction(service, { clinicId: member.clinicId, patientId: current.patient_id, kind: "message", channel: "staff", title: "完成指定回訪", body: current.body, createdBy: member.user.id });
    } catch (error) {
      timelineFailed = true;
      console.error("Followup completion timeline failed", { followupId: id, clinicId: member.clinicId, category: deliveryError(error) });
    }
  }
  refresh(current.patient_id);
  if (timelineFailed) redirect("/admin/followups?notice=completed-timeline-failed");
}
