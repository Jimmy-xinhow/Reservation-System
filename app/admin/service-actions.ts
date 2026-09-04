"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

function str(fd: FormData, k: string): string {
  return (fd.get(k) ?? "").toString().trim();
}
function bool(fd: FormData, k: string): boolean {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}
function intOr(fd: FormData, k: string, dflt: number): number {
  const n = Number(str(fd, k));
  return Number.isFinite(n) ? n : dflt;
}
type ServiceBookingField = { key: string; label: string; type: "text" | "textarea" | "date" | "select" | "checkbox" | "consent"; required: boolean; options: string[] };
function parseServiceBookingFields(fd: FormData): ServiceBookingField[] {
  const raw = str(fd, "booking_fields");
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("預約表單 JSON 格式錯誤"); }
  if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("預約表單最多 20 個欄位");
  return parsed.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("預約表單欄位格式錯誤");
    const row = value as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const type = row.type;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !label || !["text", "textarea", "date", "select", "checkbox", "consent"].includes(String(type))) throw new Error("預約表單欄位設定錯誤");
    const options = Array.isArray(row.options) ? row.options.filter((option): option is string => typeof option === "string").map((option) => option.trim()).filter(Boolean).slice(0, 30) : [];
    if (type === "select" && options.length === 0) throw new Error(`${label}需要至少一個選項`);
    return { key, label, type: type as ServiceBookingField["type"], required: type === "consent" || row.required === true, options };
  });
}

// ── 看診服務 services ─────────────────────────────────────
export async function createServiceAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const name = str(fd, "name");
  if (!name) throw new Error("請填服務名稱");
  const { error } = await supabase.from("services").insert({
    clinic_id: clinicId,
    name,
    category: str(fd, "category") || null,
    description: str(fd, "description") || null,
    price: Math.max(0, Math.round(intOr(fd, "price", 0))),
    duration_minutes: Math.max(1, intOr(fd, "duration_minutes", 30)),
    buffer_minutes: Math.max(0, intOr(fd, "buffer_minutes", 0)),
    booking_target: ["provider_required", "provider_optional", "resource_only"].includes(str(fd, "booking_target")) ? str(fd, "booking_target") : "provider_required",
    booking_fields: parseServiceBookingFields(fd),
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function updateServiceAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!id || !name) throw new Error("缺少服務或名稱");
  const { error } = await supabase
    .from("services")
    .update({
      name,
      category: str(fd, "category") || null,
      description: str(fd, "description") || null,
      price: Math.max(0, Math.round(intOr(fd, "price", 0))),
      duration_minutes: Math.max(1, intOr(fd, "duration_minutes", 30)),
      buffer_minutes: Math.max(0, intOr(fd, "buffer_minutes", 0)),
      booking_target: ["provider_required", "provider_optional", "resource_only"].includes(str(fd, "booking_target")) ? str(fd, "booking_target") : "provider_required",
      booking_fields: parseServiceBookingFields(fd),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function toggleServiceAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("services")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function deleteServiceAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error("此服務已有預約使用，無法刪除，請改為停用。");
  revalidatePath("/admin/services");
}
