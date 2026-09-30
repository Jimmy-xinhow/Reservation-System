"use server";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";


import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
    const { count, error } = await adminQuery(member.supabase.from("clinic_members").select("user_id", { count: "exact", head: true }).eq("clinic_id", member.clinicId).eq("user_id", assignedTo));
    if (error || count !== 1) throw new Error("指派人員不屬於目前品牌");
  }
  const dueAt = dueLocal ? new Date(`${dueLocal}:00+08:00`).toISOString() : null;
  const { error } = await adminQuery(member.supabase.from("handoff_tasks").insert({ clinic_id: member.clinicId, title, category, priority, due_at: dueAt, assigned_to: assignedTo || null, note: note || null, created_by: member.user.id }));
  if (error) throw new Error(adminErrorMessage(`建立交班待辦失敗：${error.message}`));
  revalidatePath("/admin/handoff");
  revalidatePath("/admin/dashboard");
}

export async function updateHandoffTaskAction(fd: FormData): Promise<void> {
  const member = await requireOperator();
  const id = value(fd, "id");
  const status = value(fd, "status");
  const priority = value(fd, "priority");
  if (!id) throw new Error("缺少待辦識別碼");
  if (!["open", "in_progress", "done"].includes(status)) throw new Error("待辦狀態不正確");
  if (!["low", "normal", "high"].includes(priority)) throw new Error("優先度不正確");
  const { data, error } = await adminQuery(member.supabase.from("handoff_tasks")
    .update({ status, priority }).eq("id", id).eq("clinic_id", member.clinicId)
    .select("id,status,priority").maybeSingle());
  if (error) throw new Error(adminErrorMessage(`更新交班待辦失敗：${error.message}`));
  if (!data || data.id !== id || data.status !== status || data.priority !== priority) {
    throw new Error("無法確認交班待辦已更新，請重新整理後再試。");
  }
  revalidatePath("/admin/handoff");
  revalidatePath("/admin/dashboard");
  const requestedFilters = new URLSearchParams(value(fd, "filters"));
  const filters = new URLSearchParams();
  for (const key of ["status", "category", "priority", "assignee"]) {
    const filter = requestedFilters.get(key);
    if (filter && filter.length <= 100) filters.set(key, filter);
  }
  redirect(`/admin/handoff${filters.size ? `?${filters}` : ""}`);
}
