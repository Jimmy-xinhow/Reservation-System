"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }
function numberValue(fd: FormData, key: string): number { const value = Number(text(fd, key)); return Number.isFinite(value) ? value : 0; }

function photoPaths(fd: FormData, clinicId: string, appointmentId: string): string[] {
  const raw = text(fd, "private_photo_paths");
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("照片資料格式錯誤"); }
  if (!Array.isArray(parsed) || parsed.length > 6) throw new Error("每筆療程最多 6 張照片");
  const prefix = `${clinicId}/${appointmentId}/`;
  const paths = parsed.filter((value): value is string => typeof value === "string");
  if (paths.length !== parsed.length || paths.some((path) => !path.startsWith(prefix))) throw new Error("照片不屬於目前品牌或預約");
  return paths;
}

export async function createTreatmentRecordAction(fd: FormData): Promise<void> {
  const { clinicId, user } = await requireOperator();
  const appointmentId = text(fd, "appointment_id");
  const treatmentName = text(fd, "treatment_name");
  const assessment = text(fd, "assessment");
  const content = text(fd, "content");
  const aftercare = text(fd, "aftercare");
  if (!appointmentId || !treatmentName || !content) throw new Error("請選擇預約並填寫療程名稱與服務內容");
  const service = createServiceClient();
  const { data: appointment, error: appointmentError } = await service.from("appointments").select("id, patient_id").eq("id", appointmentId).eq("clinic_id", clinicId).maybeSingle();
  if (appointmentError) throw new Error(appointmentError.message);
  if (!appointment) throw new Error("預約不屬於目前品牌");
  const paths = photoPaths(fd, clinicId, appointmentId);
  const consent = fd.get("photo_consent") === "on";
  if (paths.length > 0 && !consent) throw new Error("儲存照片前必須確認顧客已同意");
  const { error } = await service.from("patient_records").insert({
    clinic_id: clinicId,
    patient_id: appointment.patient_id,
    appointment_id: appointmentId,
    record_type: "beauty_treatment",
    treatment_name: treatmentName.slice(0, 160),
    assessment: assessment.slice(0, 3000) || null,
    content: content.slice(0, 5000),
    aftercare: aftercare.slice(0, 3000) || null,
    private_photo_paths: paths,
    photo_consent: consent,
    recorded_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/beauty");
}

export async function createInventoryItemAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const name = text(fd, "name");
  const sku = text(fd, "sku").toUpperCase();
  const stock = Math.max(0, numberValue(fd, "stock_on_hand"));
  const reorder = Math.max(0, numberValue(fd, "reorder_level"));
  const price = Math.max(0, Math.round(numberValue(fd, "retail_price")));
  if (!name) throw new Error("請填寫品項名稱");
  const { error } = await createServiceClient().from("inventory_items").insert({ clinic_id: clinicId, name: name.slice(0, 160), sku: sku.slice(0, 60) || null, unit: text(fd, "unit").slice(0, 20) || "件", stock_on_hand: stock, reorder_level: reorder, retail_price: price, active: true });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/beauty");
}

export async function recordInventoryMovementAction(fd: FormData): Promise<void> {
  const { clinicId, user } = await requireOperator();
  const kind = text(fd, "kind");
  const quantity = numberValue(fd, "quantity");
  if (!["stock_in", "use", "sale", "waste"].includes(kind) || quantity <= 0) throw new Error("庫存異動資料不正確");
  const { error } = await createServiceClient().rpc("record_inventory_movement", { p_clinic_id: clinicId, p_item_id: text(fd, "item_id"), p_kind: kind, p_quantity: quantity, p_note: text(fd, "note") || null, p_actor_user_id: user.id });
  if (error) throw new Error(error.message.includes("insufficient") ? "目前庫存不足，無法扣除" : error.message);
  revalidatePath("/admin/beauty");
}

export async function saveCommissionRuleAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const doctorId = text(fd, "doctor_id");
  const serviceId = text(fd, "service_id") || null;
  const amount = Math.max(0, Math.round(numberValue(fd, "amount_per_service")));
  if (!doctorId) throw new Error("請選擇服務人員");
  const service = createServiceClient();
  const [{ data: doctor }, serviceResult] = await Promise.all([
    service.from("doctors").select("id").eq("id", doctorId).eq("clinic_id", clinicId).eq("active", true).maybeSingle(),
    serviceId ? service.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (!doctor || (serviceId && !serviceResult.data)) throw new Error("服務人員或服務不屬於目前品牌");
  let query = service.from("beauty_commission_rules").select("id").eq("clinic_id", clinicId).eq("doctor_id", doctorId);
  query = serviceId ? query.eq("service_id", serviceId) : query.is("service_id", null);
  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const result = existing
    ? await service.from("beauty_commission_rules").update({ amount_per_service: amount, active: true }).eq("id", existing.id).eq("clinic_id", clinicId)
    : await service.from("beauty_commission_rules").insert({ clinic_id: clinicId, doctor_id: doctorId, service_id: serviceId, amount_per_service: amount, active: true });
  if (result.error) throw new Error(result.error.message);
  revalidatePath("/admin/beauty");
}
