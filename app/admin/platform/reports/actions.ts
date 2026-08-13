"use server";

import { revalidatePath } from "next/cache";
import { requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";

function value(fd: FormData, key: string): string { return (fd.get(key) ?? "").toString().trim(); }

export async function startTrialObservationAction(fd: FormData): Promise<void> {
  const actor = await requireSystemPermission("brands.manage");
  const clinicId = value(fd, "clinic_id");
  const notes = value(fd, "notes");
  if (!clinicId) throw new Error("請選擇試用品牌");
  const { error } = await createServiceClient().rpc("start_trial_brand_observation", { p_actor_user_id: actor.user.id, p_clinic_id: clinicId, p_notes: notes || null });
  if (error) throw new Error(error.message.includes("three") ? "同時最多觀察三個試用品牌" : `啟動觀察失敗：${error.message}`);
  revalidatePath("/admin/platform/reports");
}

export async function completeTrialObservationAction(fd: FormData): Promise<void> {
  const actor = await requireSystemPermission("brands.manage");
  const observationId = value(fd, "observation_id");
  if (!observationId) throw new Error("缺少觀察識別碼");
  const { error } = await createServiceClient().rpc("complete_trial_brand_observation", { p_actor_user_id: actor.user.id, p_observation_id: observationId });
  if (error) throw new Error(`完成觀察失敗：${error.message}`);
  revalidatePath("/admin/platform/reports");
}

export async function updateFeatureInterestAction(fd: FormData): Promise<void> {
  const actor = await requireSystemPermission("reports.view");
  const clinicId = value(fd, "clinic_id");
  const featureKey = value(fd, "feature_key");
  const interest = value(fd, "interest");
  const willingnessRaw = value(fd, "willingness_monthly");
  const note = value(fd, "note");
  if (!clinicId) throw new Error("缺少品牌識別碼");
  if (!["calendar_sync", "refund_reconciliation", "pos_inventory", "commission", "multilingual", "white_label"].includes(featureKey)) throw new Error("加購功能不正確");
  if (!["unknown", "interested", "not_interested", "quoted", "won"].includes(interest)) throw new Error("意願狀態不正確");
  const willingness = willingnessRaw ? Number.parseInt(willingnessRaw, 10) : null;
  if (willingness !== null && (!Number.isInteger(willingness) || willingness < 0 || willingness > 1_000_000)) throw new Error("月付意願金額不正確");
  if (note.length > 1000) throw new Error("備註不可超過 1000 字");
  const { error } = await createServiceClient().from("feature_interest_signals").upsert({ clinic_id: clinicId, feature_key: featureKey, interest, willingness_monthly: willingness, note: note || null, recorded_by: actor.user.id, updated_at: new Date().toISOString() }, { onConflict: "clinic_id,feature_key" });
  if (error) throw new Error(`保存付費意願失敗：${error.message}`);
  revalidatePath("/admin/platform/reports");
}
