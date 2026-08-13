"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

function value(fd: FormData, key: string): string { return (fd.get(key) ?? "").toString().trim(); }
function integer(fd: FormData, key: string, fallback = 0): number { const parsed = Number.parseInt(value(fd, key), 10); return Number.isFinite(parsed) ? parsed : fallback; }

export async function createServiceAddonAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const serviceId = value(fd, "service_id");
  const name = value(fd, "name");
  const description = value(fd, "description");
  const duration = Math.max(0, Math.min(480, integer(fd, "duration_minutes")));
  const price = Math.max(0, Math.min(1_000_000, integer(fd, "price")));
  if (!serviceId || !name || name.length > 120) throw new Error("請選擇服務並填寫 120 字內的加購名稱");
  const { count, error: serviceError } = await member.supabase.from("services").select("id", { count: "exact", head: true }).eq("id", serviceId).eq("clinic_id", member.clinicId);
  if (serviceError || count !== 1) throw new Error("找不到目前品牌的服務");
  const { error } = await member.supabase.from("service_addons").insert({ clinic_id: member.clinicId, service_id: serviceId, name, description: description || null, duration_minutes: duration, price, active: true });
  if (error) throw new Error(`新增加購失敗：${error.message}`);
  revalidatePath("/admin/services");
}

export async function updateServiceAddonAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const id = value(fd, "id");
  const name = value(fd, "name");
  const description = value(fd, "description");
  const duration = Math.max(0, Math.min(480, integer(fd, "duration_minutes")));
  const price = Math.max(0, Math.min(1_000_000, integer(fd, "price")));
  if (!id || !name || name.length > 120) throw new Error("加購名稱格式不正確");
  const { error } = await member.supabase.from("service_addons").update({ name, description: description || null, duration_minutes: duration, price }).eq("id", id).eq("clinic_id", member.clinicId);
  if (error) throw new Error(`更新加購失敗：${error.message}`);
  revalidatePath("/admin/services");
}

export async function toggleServiceAddonAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const id = value(fd, "id");
  const active = value(fd, "active") === "true";
  if (!id) throw new Error("缺少加購識別碼");
  const { error } = await member.supabase.from("service_addons").update({ active: !active }).eq("id", id).eq("clinic_id", member.clinicId);
  if (error) throw new Error(`更新加購狀態失敗：${error.message}`);
  revalidatePath("/admin/services");
}
