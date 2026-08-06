"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function integer(fd: FormData, key: string, fallback: number): number {
  const value = Number(text(fd, key));
  return Number.isInteger(value) ? value : fallback;
}

function refresh(): void {
  revalidatePath("/admin/memberships");
  revalidatePath("/admin/events");
}

export async function createMembershipPlanAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const name = text(fd, "name");
  const description = text(fd, "description") || null;
  const price = Math.max(0, integer(fd, "price", 0));
  const creditsTotal = integer(fd, "credits_total", 1);
  const validDaysValue = text(fd, "valid_days");
  const validDays = validDaysValue ? integer(fd, "valid_days", 0) : null;
  const usageScope = text(fd, "usage_scope");
  const serviceId = text(fd, "service_id") || null;
  if (!name || creditsTotal < 1 || (validDays !== null && validDays < 1)) throw new Error("請填寫正確的套票方案資料");
  if (!["appointment", "registration", "both"].includes(usageScope)) throw new Error("套票使用範圍不正確");
  if (serviceId) {
    const { data: service } = await supabase.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (!service) throw new Error("指定服務不存在或已停用");
  }
  const { error } = await supabase.from("membership_plans").insert({ clinic_id: clinicId, name: name.slice(0, 100), description, price, credits_total: creditsTotal, valid_days: validDays, usage_scope: usageScope, service_id: serviceId, active: true });
  if (error) throw new Error(error.message);
  refresh();
}

export async function toggleMembershipPlanAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("缺少套票方案 ID");
  const { error } = await supabase.from("membership_plans").update({ active: !active }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  refresh();
}

export async function grantPatientMembershipAction(fd: FormData): Promise<void> {
  const { clinicId, user } = await requireOperator();
  const patientId = text(fd, "patient_id");
  const planId = text(fd, "plan_id");
  if (!patientId || !planId) throw new Error("請選擇顧客與套票方案");
  const svc = createServiceClient();
  const { error } = await svc.rpc("grant_patient_membership", { p_clinic_id: clinicId, p_patient_id: patientId, p_plan_id: planId, p_actor_user_id: user.id, p_source: "manual", p_note: text(fd, "note") || null });
  if (error) throw new Error(error.message);
  refresh();
}

export async function createDiscountCodeAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const code = text(fd, "code").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const kind = text(fd, "kind");
  const value = integer(fd, "value", 0);
  const minAmount = Math.max(0, integer(fd, "min_amount", 0));
  const maxUsesValue = text(fd, "max_uses");
  const maxUses = maxUsesValue ? integer(fd, "max_uses", 0) : null;
  const startsAt = text(fd, "starts_at") ? new Date(text(fd, "starts_at")).toISOString() : null;
  const endsAt = text(fd, "ends_at") ? new Date(text(fd, "ends_at")).toISOString() : null;
  if (!code || !["percent", "fixed"].includes(kind) || value < 1 || (kind === "percent" && value > 100) || (maxUses !== null && maxUses < 1)) throw new Error("優惠碼設定不正確");
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new Error("優惠碼結束時間必須晚於開始時間");
  const { error } = await supabase.from("discount_codes").insert({ clinic_id: clinicId, code, kind, value, min_amount: minAmount, max_uses: maxUses, starts_at: startsAt, ends_at: endsAt, active: true });
  if (error) throw new Error(error.message);
  refresh();
}

export async function toggleDiscountCodeAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("缺少優惠碼 ID");
  const { error } = await supabase.from("discount_codes").update({ active: !active }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  refresh();
}

export async function createMembershipLevelAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const code = text(fd, "code").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const name = text(fd, "name");
  const sortOrder = Math.max(0, integer(fd, "sort_order", 0));
  const discountPercent = Math.max(0, Math.min(100, integer(fd, "discount_percent", 0)));
  if (!code || !name) throw new Error("請輸入會員等級代碼與名稱");
  const { error } = await createServiceClient().from("membership_levels").insert({ clinic_id: clinicId, code, name: name.slice(0, 80), sort_order: sortOrder, discount_percent: discountPercent, active: true });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/membership-levels");
}

export async function toggleMembershipLevelAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  const { error } = await createServiceClient().from("membership_levels").update({ active: !active }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/membership-levels");
}

export async function saveMembershipPlanLevelPriceAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const planId = text(fd, "plan_id");
  const levelId = text(fd, "level_id");
  const price = Math.max(0, integer(fd, "price", 0));
  if (!planId || !levelId) throw new Error("請選擇會員方案與等級");
  const svc = createServiceClient();
  const [{ data: plan }, { data: level }] = await Promise.all([
    svc.from("membership_plans").select("id").eq("id", planId).eq("clinic_id", clinicId).maybeSingle(),
    svc.from("membership_levels").select("id").eq("id", levelId).eq("clinic_id", clinicId).maybeSingle(),
  ]);
  if (!plan || !level) throw new Error("會員方案或等級不屬於目前品牌");
  const { error } = await svc.from("membership_plan_level_prices").upsert({ clinic_id: clinicId, plan_id: planId, level_id: levelId, price }, { onConflict: "plan_id,level_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/membership-levels");
}

export async function assignPatientMembershipLevelAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const patientId = text(fd, "patient_id");
  const levelId = text(fd, "level_id") || null;
  const svc = createServiceClient();
  if (levelId) {
    const { data: level } = await svc.from("membership_levels").select("id").eq("id", levelId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (!level) throw new Error("會員等級不屬於目前品牌或已停用");
  }
  const { error } = await svc.from("patients").update({ membership_level_id: levelId }).eq("id", patientId).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/membership-levels");
}
