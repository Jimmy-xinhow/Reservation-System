"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function safeHttpsUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function createCourseUnitAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const eventId = text(fd, "event_id");
  const title = text(fd, "title");
  const summary = text(fd, "summary");
  const unitType = text(fd, "unit_type");
  const accessRule = text(fd, "access_rule");
  const contentUrlInput = text(fd, "content_url");
  const body = text(fd, "body");
  const sortOrder = Math.max(0, Math.min(999, Number.parseInt(text(fd, "sort_order"), 10) || 0));

  if (!eventId || !title) throw new Error("請選擇課程並填寫單元名稱");
  if (!["video", "link", "download", "text"].includes(unitType)) throw new Error("教材類型不正確");
  if (!["registered", "paid", "attended"].includes(accessRule)) throw new Error("開放條件不正確");
  const contentUrl = safeHttpsUrl(contentUrlInput);
  if (contentUrlInput && !contentUrl) throw new Error("教材網址必須是有效的 HTTPS 網址");
  if (!contentUrl && !body) throw new Error("請填寫教材網址或文字內容");

  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).eq("clinic_id", clinicId).maybeSingle();
  if (!event) throw new Error("課程不屬於目前品牌");
  const { error } = await supabase.from("course_units").insert({
    clinic_id: clinicId,
    event_id: eventId,
    title: title.slice(0, 160),
    summary: summary.slice(0, 500) || null,
    unit_type: unitType,
    content_url: contentUrl,
    body: body.slice(0, 10000) || null,
    access_rule: accessRule,
    sort_order: sortOrder,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/course-content");
}

export async function toggleCourseUnitAction(fd: FormData): Promise<void> {
  const { supabase, clinicId } = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("找不到教材單元");
  const { error } = await supabase.from("course_units").update({ active: !active }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/course-content");
}
