"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }

export async function freezeSubscriptionAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const subscriptionId = text(fd, "subscription_id");
  const startsOn = text(fd, "starts_on");
  const endsOn = text(fd, "ends_on");
  if (!subscriptionId || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw new Error("請選擇會籍並填寫凍結日期");
  const { error } = await createServiceClient().rpc("freeze_patient_subscription", {
    p_clinic_id: member.clinicId,
    p_actor_user_id: member.user.id,
    p_subscription_id: subscriptionId,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_reason: text(fd, "reason") || null,
  });
  if (error) throw new Error(error.message.includes("overlaps") ? "這段期間與既有凍結紀錄重疊" : error.message);
  revalidatePath("/admin/fitness");
  revalidatePath("/admin/customer-value");
}
