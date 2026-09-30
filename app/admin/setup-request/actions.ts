"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import { requireAdmin } from "@/lib/admin";
import { parseBrandSetupAnswers } from "@/lib/brand-setup-intake";
import { createServiceClient } from "@/lib/supabase";

export async function submitBrandSetupRequestAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const answers = parseBrandSetupAnswers(fd);
  const { error } = await adminQuery(createServiceClient().from("brand_setup_requests").upsert({
    clinic_id: member.clinicId,
    requested_by: member.user.id,
    answers,
    status: "submitted",
    submitted_at: new Date().toISOString(),
    handled_by: null,
    handled_at: null,
    confirmed_by: null,
    confirmed_at: null,
  }, { onConflict: "clinic_id" }));
  if (error) throw new Error(adminErrorMessage(error));
  revalidatePath("/admin/setup-request");
  revalidatePath("/admin/platform/setup-requests");
  redirect("/admin/setup-request?submitted=1");
}

export async function confirmBrandSetupRequestAction(): Promise<void> {
  const member = await requireAdmin();
  const { data, error } = await adminQuery(createServiceClient().from("brand_setup_requests")
    .update({ status: "completed", confirmed_by: member.user.id, confirmed_at: new Date().toISOString() })
    .eq("clinic_id", member.clinicId).eq("status", "ready_for_review")
    .select("id").maybeSingle());
  if (error) throw new Error(adminErrorMessage(error));
  if (!data) throw new Error("目前沒有可確認的代設定需求，請重新整理查看狀態。");
  revalidatePath("/admin/setup-request");
  revalidatePath("/admin/platform/setup-requests");
  redirect("/admin/setup-request?confirmed=1");
}
