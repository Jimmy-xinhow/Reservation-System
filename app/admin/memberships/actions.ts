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
  revalidatePath("/membership");
}

export async function saveMembershipPlanAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const planId = text(fd, "plan_id") || null;
  const name = text(fd, "name");
  const description = text(fd, "description") || null;
  const price = Math.max(0, integer(fd, "price", 0));
  const creditsTotal = integer(fd, "credits_total", 1);
  const validDaysValue = text(fd, "valid_days");
  const validDays = validDaysValue ? integer(fd, "valid_days", 0) : null;
  const usageScope = text(fd, "usage_scope");
  const serviceId = text(fd, "service_id") || null;
  const allowedChannels = ["appointment", "registration", "product", "course", "offline"];
  const redeemChannels = fd.getAll("redeem_channels").map(String).filter((channel) => allowedChannels.includes(channel));
  const cardTheme = text(fd, "card_theme");
  const cardAccent = text(fd, "card_accent");
  const cardImageUrl = text(fd, "card_image_url") || null;
  const redemptionNote = text(fd, "redemption_note") || null;
  if (!name || creditsTotal < 1 || (validDays !== null && validDays < 1)) throw new Error("請填寫正確的套票方案資料");
  if (!["appointment", "registration", "both"].includes(usageScope)) throw new Error("套票使用範圍不正確");
  if (redeemChannels.length === 0) throw new Error("請至少選擇一個套票使用場景");
  const requiredAutoChannels = usageScope === "both" ? ["appointment", "registration"] : [usageScope];
  if (requiredAutoChannels.some((channel) => !redeemChannels.includes(channel))) throw new Error("可使用場景必須包含上方選定的自動扣抵範圍");
  if (!["forest", "ink", "clay", "sand"].includes(cardTheme) || !/^#[0-9a-fA-F]{6}$/.test(cardAccent)) throw new Error("套票卡面設定不正確");
  if (cardImageUrl && (!/^https:\/\//i.test(cardImageUrl) || cardImageUrl.length > 1000)) throw new Error("卡面圖片必須是 HTTPS 網址");
  if (serviceId) {
    const { data: service } = await supabase.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (!service) throw new Error("指定服務不存在或已停用");
  }
  const values = { name: name.slice(0, 100), description: description?.slice(0, 1000) ?? null, price, credits_total: creditsTotal, valid_days: validDays, usage_scope: usageScope, service_id: serviceId, card_image_url: cardImageUrl, card_theme: cardTheme, card_accent: cardAccent.toUpperCase(), redeem_channels: [...new Set(redeemChannels)], redemption_note: redemptionNote?.slice(0, 300) ?? null };
  const { error } = planId
    ? await supabase.from("membership_plans").update(values).eq("id", planId).eq("clinic_id", clinicId)
    : await supabase.from("membership_plans").insert({ clinic_id: clinicId, ...values, active: true });
  if (error) throw new Error(error.message);
  refresh();
}

export async function redeemPatientMembershipAction(fd: FormData): Promise<void> {
  const { clinicId, user } = await requireOperator();
  const membershipId = text(fd, "membership_id");
  const channel = text(fd, "channel");
  if (!membershipId || !["product", "course", "offline"].includes(channel)) throw new Error("請選擇套票與兌換用途");
  const { error } = await createServiceClient().rpc("redeem_patient_membership_credit", { p_clinic_id: clinicId, p_actor_user_id: user.id, p_membership_id: membershipId, p_channel: channel, p_note: text(fd, "note").slice(0, 500) || null });
  if (error) throw new Error(error.message.includes("channel") ? "此套票未開放選定的兌換用途" : error.message);
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
  const benefitType = text(fd, "benefit_type");
  const kind = text(fd, "kind");
  const value = integer(fd, "value", 0);
  const minAmount = Math.max(0, integer(fd, "min_amount", 0));
  const maxUsesValue = text(fd, "max_uses");
  const maxUses = maxUsesValue ? integer(fd, "max_uses", 0) : null;
  const recipientName = text(fd, "recipient_name") || null;
  const recipientPhone = text(fd, "recipient_phone") || null;
  const startsAt = text(fd, "starts_at") ? new Date(text(fd, "starts_at")).toISOString() : null;
  const endsAt = text(fd, "ends_at") ? new Date(text(fd, "ends_at")).toISOString() : null;
  if (!code || !["coupon", "voucher"].includes(benefitType) || !["percent", "fixed"].includes(kind) || value < 1 || (kind === "percent" && value > 100) || (maxUses !== null && maxUses < 1)) throw new Error("優惠碼／禮券設定不正確");
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new Error("優惠碼結束時間必須晚於開始時間");
  const resolvedMaxUses = benefitType === "voucher" ? 1 : maxUses;
  const { error } = await supabase.from("discount_codes").insert({ clinic_id: clinicId, code, benefit_type: benefitType, kind, value, min_amount: minAmount, max_uses: resolvedMaxUses, recipient_name: recipientName, recipient_phone: recipientPhone, starts_at: startsAt, ends_at: endsAt, active: true });
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
  revalidatePath("/admin/patients");
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
  if (!patientId) throw new Error("缺少顧客資料");
  const svc = createServiceClient();
  if (levelId) {
    const { data: level } = await svc.from("membership_levels").select("id").eq("id", levelId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (!level) throw new Error("會員等級不屬於目前品牌或已停用");
  }
  const { error } = await svc.from("patients").update({ membership_level_id: levelId }).eq("id", patientId).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/membership-levels");
  revalidatePath("/admin/patients");
}
