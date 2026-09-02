"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/admin";

function value(fd: FormData, key: string): string { return (fd.get(key) ?? "").toString().trim(); }

export async function createHandoffTaskAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const title = value(fd, "title");
  const category = value(fd, "category");
  const priority = value(fd, "priority");
  const dueLocal = value(fd, "due_at");
  const assignedTo = value(fd, "assigned_to");
  const note = value(fd, "note");
  if (!title || title.length > 160) throw new Error("待辦標題必須填寫，且不可超過 160 字");
  if (!["appointment", "payment", "customer", "channel", "other"].includes(category)) throw new Error("待辦分類不正確");
  if (!["low", "normal", "high"].includes(priority)) throw new Error("優先度不正確");
  if (note.length > 1000) throw new Error("備註不可超過 1000 字");
  if (assignedTo) {
    const { count, error } = await member.supabase.from("clinic_members").select("user_id", { count: "exact", head: true }).eq("clinic_id", member.clinicId).eq("user_id", assignedTo);
    if (error || count !== 1) throw new Error("指派人員不屬於目前品牌");
  }
  const dueAt = dueLocal ? new Date(`${dueLocal}:00+08:00`).toISOString() : null;
  const { error } = await member.supabase.from("handoff_tasks").insert({ clinic_id: member.clinicId, title, category, priority, due_at: dueAt, assigned_to: assignedTo || null, note: note || null, created_by: member.user.id });
  if (error) throw new Error(`建立交班待辦失敗：${error.message}`);
  revalidatePath("/admin/handoff");
}

export async function updateHandoffTaskAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const id = value(fd, "id");
  const status = value(fd, "status");
  const priority = value(fd, "priority");
  if (!id) throw new Error("缺少待辦識別碼");
  if (!["open", "in_progress", "done"].includes(status)) throw new Error("待辦狀態不正確");
  if (!["low", "normal", "high"].includes(priority)) throw new Error("優先度不正確");
  const { error } = await member.supabase.from("handoff_tasks").update({ status, priority }).eq("id", id).eq("clinic_id", member.clinicId);
  if (error) throw new Error(`更新交班待辦失敗：${error.message}`);
  revalidatePath("/admin/handoff");
}
