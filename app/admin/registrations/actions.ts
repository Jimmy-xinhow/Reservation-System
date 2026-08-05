"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requireMember, canOperate } from "@/lib/admin";
import { notifyRegistrationStatus } from "@/lib/registration-notifications";

export async function cancelRegistrationAdminAction(fd: FormData) {
  const member = await requireMember();
  if (!canOperate(member.role)) throw new Error("目前角色不可修改報名狀態");
  const id = String(fd.get("id") ?? "").trim();
  if (!id) throw new Error("缺少報名編號");
  const svc = createServiceClient();
  const { data: registration, error: lookupError } = await member.supabase
    .from("registrations")
    .select("id, status")
    .eq("id", id)
    .eq("clinic_id", member.clinicId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!registration) throw new Error("找不到報名資料");
  if (["attended", "cancelled"].includes(registration.status)) return;
  const { error: cancelError } = await svc.rpc("cancel_registration_by_id", {
    p_clinic_id: member.clinicId,
    p_registration_id: registration.id,
    p_actor_user_id: member.user.id,
  });
  if (cancelError) throw new Error(cancelError.message);
  await notifyRegistrationStatus(svc, registration.id, "cancelled").catch(() => undefined);
  revalidatePath("/admin/registrations");
  revalidatePath("/admin/events");
}
