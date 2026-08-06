"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function value(formData: FormData, key: string): string { return String(formData.get(key) ?? "").trim(); }
function positiveInt(formData: FormData, key: string, fallback: number): number {
  const parsed = Number(value(formData, key));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function createResourceAction(formData: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const name = value(formData, "name");
  const kind = value(formData, "kind") || "room";
  if (!name || name.length > 120) throw new Error("請輸入資源名稱（1–120 字）");
  if (!["room", "equipment", "staff", "other"].includes(kind)) throw new Error("資源類型不正確");
  const { error } = await createServiceClient().from("service_resources").insert({ clinic_id: clinicId, name, kind, capacity: positiveInt(formData, "capacity", 1) });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
}

export async function toggleResourceAction(formData: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const id = value(formData, "id");
  const active = value(formData, "active") === "true";
  const { error } = await createServiceClient().from("service_resources").update({ active: !active }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
}

export async function assignResourceAction(formData: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const serviceId = value(formData, "service_id");
  const resourceId = value(formData, "resource_id");
  if (!serviceId || !resourceId) throw new Error("請選擇服務與資源");
  const svc = createServiceClient();
  const [{ data: service }, { data: resource }] = await Promise.all([
    svc.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).maybeSingle(),
    svc.from("service_resources").select("id").eq("id", resourceId).eq("clinic_id", clinicId).maybeSingle(),
  ]);
  if (!service || !resource) throw new Error("服務或資源不屬於目前品牌");
  const { error } = await svc.from("service_resource_assignments").upsert({ clinic_id: clinicId, service_id: serviceId, resource_id: resourceId, quantity: positiveInt(formData, "quantity", 1) }, { onConflict: "service_id,resource_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
}

export async function removeAssignmentAction(formData: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const id = value(formData, "id");
  const { error } = await createServiceClient().from("service_resource_assignments").delete().eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
}
