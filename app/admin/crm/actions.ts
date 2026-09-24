"use server";

import { redirect } from "next/navigation";
import { errorCategory } from "@/lib/error-category";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import {
  AUTOMATION_TRIGGER_TYPES,
  SEGMENT_RULE_TYPES,
  validateAutomationBody,
  validateSegmentValue,
  type MarketingChannel,
  type AutomationTriggerType,
  type SegmentRuleType,
} from "@/lib/crm";

function text(fd: FormData, name: string): string {
  return (fd.get(name) ?? "").toString().trim();
}

function integer(fd: FormData, name: string, fallback: number): number {
  const value = Number(text(fd, name));
  return Number.isInteger(value) ? value : fallback;
}

function refreshCrm(): void {
  revalidatePath("/admin/crm");
  revalidatePath("/admin/patients");
}

export async function createSegmentAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const name = text(fd, "name");
  const description = text(fd, "description") || null;
  const ruleType = text(fd, "rule_type") as SegmentRuleType;
  if (!name) throw new Error("請填寫分眾名稱");
  if (!SEGMENT_RULE_TYPES.includes(ruleType)) throw new Error("不支援的分眾規則");
  const ruleValue = validateSegmentValue(ruleType, text(fd, "rule_value"));

  let segmentId: string;
  try {
    const { data, error } = await supabase
      .from("crm_segments")
      .insert({ clinic_id: clinicId, name: name.slice(0, 100), description, rule_type: ruleType, rule_value: ruleValue, active: true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("Missing segment confirmation");
    segmentId = data.id;
  } catch (error) {
    console.error("CRM segment creation unconfirmed", { clinicId, category: errorCategory(error instanceof Error ? error.message : "") });
    throw new Error("無法確認分眾建立結果，請重新整理查看清單，避免重複建立");
  }

  let refreshFailed = false;
  try {
    const svc = createServiceClient();
    const { error } = await svc.rpc("refresh_crm_segment", { p_clinic_id: clinicId, p_segment_id: segmentId });
    if (error) throw new Error(error.message);
  } catch (error) {
    refreshFailed = true;
    console.error("CRM new segment refresh failed", { clinicId, segmentId, category: errorCategory(error instanceof Error ? error.message : "") });
  }
  refreshCrm();
  if (refreshFailed) redirect("/admin/crm?notice=segment-created-refresh-failed#segments");
}

export async function refreshSegmentAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少分眾 ID");
  let refreshFailed = false;
  try {
    const svc = createServiceClient();
    const { error } = await svc.rpc("refresh_crm_segment", { p_clinic_id: clinicId, p_segment_id: id });
    if (error) throw new Error(error.message);
  } catch (error) {
    refreshFailed = true;
    console.error("CRM segment refresh failed", { clinicId, category: errorCategory(error instanceof Error ? error.message : "") });
  }
  refreshCrm();
  redirect(refreshFailed ? "/admin/crm?notice=segment-refresh-failed#segments" : "/admin/crm?notice=segment-refreshed#segments");
}

async function crmQuery<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
  try {
    const result = await query;
    if (result.error) throw result.error;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "";
    console.error("CRM settings query failed", { category: errorCategory(message) });
    throw new Error("無法確認 CRM 設定操作結果，請重新載入查看資料後再試");
  }
}

export async function toggleSegmentAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const activeValue = text(fd, "active");
  if (!["true", "false"].includes(activeValue)) throw new Error("啟用狀態不正確");
  const active = activeValue === "true";
  if (!id) throw new Error("缺少分眾 ID");
  const { data: changed } = await crmQuery(supabase
    .from("crm_segments")
    .update({ active: !active })
    .eq("active", active)
    .eq("id", id)
    .eq("clinic_id", clinicId).select("id").maybeSingle());
  if (!changed) throw new Error("找不到指定資料或狀態已變更，請重新載入後再試");
  refreshCrm();
}

export async function deleteSegmentAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少分眾 ID");
  const { data: changed } = await crmQuery(supabase
    .from("crm_segments")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId).select("id").maybeSingle());
  if (!changed) throw new Error("找不到指定資料或狀態已變更，請重新載入後再試");
  refreshCrm();
}

export async function createAutomationAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const name = text(fd, "name");
  const triggerType = text(fd, "trigger_type") as AutomationTriggerType;
  const segmentId = text(fd, "segment_id") || null;
  const channel = text(fd, "channel") as MarketingChannel;
  const delayMinutes = Math.max(0, integer(fd, "delay_minutes", 0));
  const triggerDays = Math.max(1, integer(fd, "trigger_days", 30));
  const cooldownDays = Math.max(1, integer(fd, "cooldown_days", 30));
  const subject = text(fd, "subject") || null;
  const body = validateAutomationBody(text(fd, "body"));

  if (!name) throw new Error("請填寫自動化名稱");
  if (!AUTOMATION_TRIGGER_TYPES.includes(triggerType)) throw new Error("不支援的自動化觸發條件");
  if (channel !== "line" && channel !== "email") throw new Error("不支援的發送渠道");
  if (channel === "email" && !subject) throw new Error("Email 自動化需要主旨");
  if (segmentId) {
    const { data: segment } = await crmQuery(supabase
      .from("crm_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle());
    if (!segment) throw new Error("找不到指定分眾");
  }

  const { data: changed } = await crmQuery(supabase.from("crm_automations").insert({
    clinic_id: clinicId,
    name: name.slice(0, 100),
    trigger_type: triggerType,
    segment_id: segmentId,
    channel,
    delay_minutes: delayMinutes,
    trigger_days: triggerDays,
    cooldown_days: cooldownDays,
    subject,
    body,
    active: true,
  }).select("id").single());
  if (!changed) throw new Error("找不到指定資料或狀態已變更，請重新載入後再試");
  refreshCrm();
}

export async function updateAutomationAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const name = text(fd, "name");
  const triggerType = text(fd, "trigger_type") as AutomationTriggerType;
  const segmentId = text(fd, "segment_id") || null;
  const channel = text(fd, "channel") as MarketingChannel;
  const delayMinutes = Math.max(0, integer(fd, "delay_minutes", 0));
  const triggerDays = Math.max(1, integer(fd, "trigger_days", 30));
  const cooldownDays = Math.max(1, integer(fd, "cooldown_days", 30));
  const subject = text(fd, "subject") || null;
  const body = validateAutomationBody(text(fd, "body"));

  if (!id) throw new Error("缺少自動化 ID");
  if (!name) throw new Error("請填寫自動化名稱");
  if (!AUTOMATION_TRIGGER_TYPES.includes(triggerType)) throw new Error("不支援的自動化觸發條件");
  if (channel !== "line" && channel !== "email") throw new Error("不支援的發送渠道");
  if (channel === "email" && !subject) throw new Error("Email 自動化需要主旨");
  if (segmentId) {
    const { data: segment } = await crmQuery(supabase
      .from("crm_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle());
    if (!segment) throw new Error("找不到指定分眾");
  }

  const { data: updated } = await crmQuery(supabase
    .from("crm_automations")
    .update({
      name: name.slice(0, 100),
      trigger_type: triggerType,
      segment_id: segmentId,
      channel,
      delay_minutes: delayMinutes,
      trigger_days: triggerDays,
      cooldown_days: cooldownDays,
      subject: channel === "email" ? subject : null,
      body,
    })
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle());
  if (!updated) throw new Error("找不到指定自動化");
  refreshCrm();
}

export async function toggleAutomationAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const activeValue = text(fd, "active");
  if (!["true", "false"].includes(activeValue)) throw new Error("啟用狀態不正確");
  const active = activeValue === "true";
  if (!id) throw new Error("缺少自動化 ID");
  const { data: changed } = await crmQuery(supabase
    .from("crm_automations")
    .update({ active: !active })
    .eq("active", active)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .is("archived_at", null).select("id").maybeSingle());
  if (!changed) throw new Error("找不到指定資料或狀態已變更，請重新載入後再試");
  refreshCrm();
}

export async function deleteAutomationAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少自動化 ID");
  const { data: changed } = await crmQuery(supabase
    .from("crm_automations")
    .update({ active: false, archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .is("archived_at", null).select("id").maybeSingle());
  if (!changed) throw new Error("找不到指定資料或狀態已變更，請重新載入後再試");
  refreshCrm();
}
