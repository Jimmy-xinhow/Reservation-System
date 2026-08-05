import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CrmInteractionKind = "note" | "booking" | "registration" | "message" | "campaign";
export type CrmInteractionChannel = "line" | "email" | "staff" | "system";

export interface CrmInteractionInput {
  clinicId: string;
  patientId: string;
  kind: CrmInteractionKind;
  channel: CrmInteractionChannel;
  title: string;
  body: string;
  appointmentId?: string | null;
  registrationId?: string | null;
  createdBy?: string | null;
}

/**
 * CRM Lite 的時間軸只記錄必要的事件摘要，不把姓名、電話或 token 複製進 interaction body。
 * 呼叫端應在主要業務成功後使用；時間軸失敗不應回滾已完成的預約／報名。
 */
export async function recordCrmInteraction(svc: SupabaseClient, input: CrmInteractionInput): Promise<void> {
  const { error } = await svc.from("crm_interactions").insert({
    clinic_id: input.clinicId,
    patient_id: input.patientId,
    kind: input.kind,
    channel: input.channel,
    title: input.title.slice(0, 160),
    body: input.body.slice(0, 2000),
    appointment_id: input.appointmentId ?? null,
    registration_id: input.registrationId ?? null,
    created_by: input.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
}
