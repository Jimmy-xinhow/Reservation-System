"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/admin";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function integer(fd: FormData, key: string, fallback: number): number {
  const value = Number(text(fd, key));
  return Number.isInteger(value) ? value : fallback;
}

function localTaipeiIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("日期時間格式不正確");
  return new Date(`${value}:00+08:00`).toISOString();
}

export async function createEventAction(fd: FormData): Promise<void> {
  const { supabase, clinicId, user } = await requireAdmin();
  const title = text(fd, "title");
  const slug = text(fd, "slug").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const accessMode = text(fd, "access_mode") || "public";
  const openAt = text(fd, "registration_open_at") ? localTaipeiIso(text(fd, "registration_open_at")) : null;
  const closeAt = text(fd, "registration_close_at") ? localTaipeiIso(text(fd, "registration_close_at")) : null;
  if (!title || !slug) throw new Error("請填寫活動名稱與網址代稱");
  if (!['public', 'private'].includes(accessMode)) throw new Error("活動公開模式不正確");
  if (openAt && closeAt && new Date(closeAt) <= new Date(openAt)) throw new Error("報名截止時間必須晚於開放時間");
  const privateToken = accessMode === "private" ? randomBytes(24).toString("hex") : null;
  const { data: eventRow, error } = await supabase.from("events").insert({
    clinic_id: clinicId,
    title: title.slice(0, 160),
    slug,
    description: text(fd, "description") || null,
    status: "draft",
    access_mode: accessMode,
    access_token_hash: privateToken ? createHash("sha256").update(privateToken).digest("hex") : null,
    registration_open_at: openAt,
    registration_close_at: closeAt,
    terms_version: 1,
    terms_text: text(fd, "terms_text") || null,
    created_by: user.id,
  }).select("id").single();
  const event = eventRow as { id: string } | null;
  if (error || !event) throw new Error(error?.message ?? "建立活動失敗");
  const { error: formError } = await supabase.from("registration_forms").insert({
    clinic_id: clinicId,
    event_id: event.id,
    version: 1,
    status: "published",
  });
  if (formError) throw new Error(formError.message);
  revalidatePath("/admin/events");
  if (privateToken) redirect(`/admin/events?private_event=${encodeURIComponent(event.id)}&private_token=${encodeURIComponent(privateToken)}`);
}

export async function regeneratePrivateEventLinkAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const eventId = text(fd, "id");
  if (!eventId) throw new Error("找不到活動");
  const { data: event } = await supabase.from("events").select("id, access_mode").eq("id", eventId).eq("clinic_id", clinicId).maybeSingle();
  if (!event || event.access_mode !== "private") throw new Error("只有私密活動可以重新產生連結");
  const token = randomBytes(24).toString("hex");
  const { error } = await supabase.from("events").update({ access_token_hash: createHash("sha256").update(token).digest("hex") }).eq("id", eventId).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/events");
  redirect(`/admin/events?private_event=${encodeURIComponent(eventId)}&private_token=${encodeURIComponent(token)}`);
}

export async function setEventStatusAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!id || !["draft", "published", "archived"].includes(status)) throw new Error("活動狀態不正確");
  const { error } = await supabase.from("events").update({ status }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/events");
}

export async function createEventSessionAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const eventId = text(fd, "event_id");
  const name = text(fd, "name");
  const start = localTaipeiIso(text(fd, "start_at"));
  const end = localTaipeiIso(text(fd, "end_at"));
  const capacity = integer(fd, "capacity", 1);
  if (!eventId || !name || capacity < 1 || new Date(end) <= new Date(start)) throw new Error("場次資料不正確");
  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).eq("clinic_id", clinicId).maybeSingle();
  if (!event) throw new Error("找不到活動");
  const { error } = await supabase.from("event_sessions").insert({
    clinic_id: clinicId,
    event_id: eventId,
    name: name.slice(0, 120),
    start_at: start,
    end_at: end,
    venue: text(fd, "venue") || null,
    capacity,
    waitlist_enabled: fd.get("waitlist_enabled") === "on",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/events");
}

export async function createTicketTypeAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const eventId = text(fd, "event_id");
  const name = text(fd, "name");
  const price = integer(fd, "price", 0);
  const capacityText = text(fd, "capacity");
  const capacity = capacityText ? integer(fd, "capacity", 0) : null;
  const saleStartAt = text(fd, "sale_start_at") ? localTaipeiIso(text(fd, "sale_start_at")) : null;
  const saleEndAt = text(fd, "sale_end_at") ? localTaipeiIso(text(fd, "sale_end_at")) : null;
  const membershipPlanId = text(fd, "membership_plan_id") || null;
  if (saleStartAt && saleEndAt && new Date(saleEndAt) <= new Date(saleStartAt)) throw new Error("票種銷售期間不正確");
  if (!eventId || !name || price < 0 || (capacity !== null && capacity < 1)) throw new Error("票種資料不正確");
  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).eq("clinic_id", clinicId).maybeSingle();
  if (!event) throw new Error("找不到活動");
  if (membershipPlanId) {
    const { data: plan } = await supabase.from("membership_plans").select("id").eq("id", membershipPlanId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (!plan) throw new Error("套票方案不存在或已停用");
  }
  const { error } = await supabase.from("event_ticket_types").insert({
    clinic_id: clinicId,
    event_id: eventId,
    name: name.slice(0, 100),
    price,
    capacity,
    sale_start_at: saleStartAt,
    sale_end_at: saleEndAt,
    membership_plan_id: membershipPlanId,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/events");
}

export async function addRegistrationFieldAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const eventId = text(fd, "event_id");
  const fieldKey = text(fd, "field_key").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const label = text(fd, "label");
  const fieldType = text(fd, "field_type");
  const required = fd.get("required") === "on";
  const options = text(fd, "options").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 50);
  if (!eventId || !fieldKey || !label || !["text", "textarea", "date", "select", "checkbox"].includes(fieldType)) throw new Error("表單欄位資料不正確");
  if (fieldType === "select" && options.length === 0) throw new Error("選單欄位至少要有一個選項");

  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).eq("clinic_id", clinicId).maybeSingle();
  if (!event) throw new Error("找不到活動");
  const { data: oldForm } = await supabase
    .from("registration_forms")
    .select("id, version")
    .eq("event_id", eventId)
    .eq("clinic_id", clinicId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (oldForm?.version ?? 0) + 1;
  const { data: newForm, error: formError } = await supabase
    .from("registration_forms")
    .insert({ clinic_id: clinicId, event_id: eventId, version: nextVersion, status: "published" })
    .select("id")
    .single();
  if (formError || !newForm) throw new Error(formError?.message ?? "建立表單版本失敗");

  if (oldForm) {
    const { data: oldFields } = await supabase.from("registration_form_fields").select("field_key, label, field_type, required, options, sort_order").eq("form_id", oldForm.id).eq("clinic_id", clinicId).order("sort_order");
    if (oldFields && oldFields.length > 0) {
      const { error: copyError } = await supabase.from("registration_form_fields").insert(oldFields.map((field) => ({ ...field, clinic_id: clinicId, form_id: newForm.id })));
      if (copyError) throw new Error(copyError.message);
    }
    await supabase.from("registration_forms").update({ status: "archived" }).eq("id", oldForm.id).eq("clinic_id", clinicId);
  }
  const { error: fieldError } = await supabase.from("registration_form_fields").insert({
    clinic_id: clinicId,
    form_id: newForm.id,
    field_key: fieldKey,
    label: label.slice(0, 120),
    field_type: fieldType,
    required,
    options,
    sort_order: oldForm ? 1000 : 0,
  });
  if (fieldError) throw new Error(fieldError.message);
  revalidatePath("/admin/events");
}
