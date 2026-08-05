"use server";

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

  const { data, error } = await supabase
    .from("crm_segments")
    .insert({
      clinic_id: clinicId,
      name: name.slice(0, 100),
      description,
      rule_type: ruleType,
      rule_value: ruleValue,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const svc = createServiceClient();
  const { error: refreshError } = await svc.rpc("refresh_crm_segment", { p_clinic_id: clinicId, p_segment_id: data.id });
  if (refreshError) throw new Error(refreshError.message);
  refreshCrm();
}

export async function refreshSegmentAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少分眾 ID");
  const svc = createServiceClient();
  const { error } = await svc.rpc("refresh_crm_segment", { p_clinic_id: clinicId, p_segment_id: id });
  if (error) throw new Error(error.message);
  refreshCrm();
}

export async function toggleSegmentAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("缺少分眾 ID");
  const { error } = await supabase
    .from("crm_segments")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  refreshCrm();
}

export async function deleteSegmentAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少分眾 ID");
  const { error } = await supabase
    .from("crm_segments")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
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
    const { data: segment } = await supabase
      .from("crm_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!segment) throw new Error("找不到指定分眾");
  }

  const { error } = await supabase.from("crm_automations").insert({
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
  });
  if (error) throw new Error(error.message);
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
    const { data: segment } = await supabase
      .from("crm_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!segment) throw new Error("找不到指定分眾");
  }

  const { data: updated, error } = await supabase
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
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("找不到指定自動化");
  refreshCrm();
}

export async function toggleAutomationAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("缺少自動化 ID");
  const { error } = await supabase
    .from("crm_automations")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  refreshCrm();
}

export async function deleteAutomationAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  if (!id) throw new Error("缺少自動化 ID");
  const { error } = await supabase
    .from("crm_automations")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  refreshCrm();
}
