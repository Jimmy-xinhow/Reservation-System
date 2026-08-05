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

export async function markRegistrationNoShowAction(fd: FormData): Promise<void> {
  const member = await requireMember();
  if (!canOperate(member.role)) throw new Error("目前角色無法更新報名狀態");
  const id = String(fd.get("id") ?? "").trim();
  if (!id) throw new Error("缺少報名編號");

  const { data: registration, error: lookupError } = await member.supabase
    .from("registrations")
    .select("id, status, event_sessions(start_at)")
    .eq("id", id)
    .eq("clinic_id", member.clinicId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!registration) throw new Error("找不到此品牌的報名資料");
  if (registration.status !== "confirmed") {
    if (registration.status === "no_show") return;
    throw new Error("只有已確認的報名可以標記為未到");
  }

  const session = Array.isArray(registration.event_sessions) ? registration.event_sessions[0] : registration.event_sessions;
  if (!session?.start_at || new Date(session.start_at).getTime() > Date.now()) {
    throw new Error("場次尚未開始，不能標記為未到");
  }

  const { data: updated, error: updateError } = await member.supabase
    .from("registrations")
    .update({ status: "no_show", updated_at: new Date().toISOString() })
    .eq("id", registration.id)
    .eq("clinic_id", member.clinicId)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!updated) throw new Error("報名狀態已被其他操作更新，請重新整理");
  revalidatePath("/admin/registrations");
  revalidatePath("/admin/reports");
}
