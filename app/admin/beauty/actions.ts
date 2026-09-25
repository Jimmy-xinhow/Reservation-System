"use server";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";


import { revalidatePath } from "next/cache";
import { requireAdmin, requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }
function numberValue(fd: FormData, key: string): number { const value = Number(text(fd, key)); return Number.isFinite(value) ? value : 0; }

export async function createTreatmentRecordAction(fd: FormData): Promise<string> {
  const { clinicId, user } = await requireOperator();
  const sourceKey = text(fd, "source_key");
  const [sourceKind, sourceId] = sourceKey.split(":", 2);
  const treatmentName = text(fd, "treatment_name");
  const assessment = text(fd, "assessment");
  const content = text(fd, "content");
  const aftercare = text(fd, "aftercare");
  if (!sourceId || !["appointment", "registration"].includes(sourceKind) || !treatmentName || !content) throw new Error("請選擇服務／課程來源並填寫紀錄標題與內容");
  const service = createServiceClient();
  const sourceResult = sourceKind === "appointment"
    ? await adminQuery(service.from("appointments").select("id, patient_id").eq("id", sourceId).eq("clinic_id", clinicId).maybeSingle())
    : await adminQuery(service.from("registrations").select("id, patient_id").eq("id", sourceId).eq("clinic_id", clinicId).maybeSingle());
  if (sourceResult.error) throw new Error(adminErrorMessage(sourceResult.error));
  if (!sourceResult.data) throw new Error("服務／課程來源不屬於目前品牌");
  if (!sourceResult.data.patient_id) throw new Error("這筆報名尚未連結顧客，請先從顧客資料完成關聯");
  const consent = fd.get("photo_consent") === "on";
  const photoCount = Number(text(fd, "photo_count"));
  if (!Number.isInteger(photoCount) || photoCount < 0 || photoCount > 6) throw new Error("每筆服務紀錄最多 6 張照片");
  if (photoCount > 0 && !consent) throw new Error("儲存照片前必須確認顧客已同意");
  const { data: record, error } = await adminQuery(service.from("patient_records").insert({
    clinic_id: clinicId,
    patient_id: sourceResult.data.patient_id,
    appointment_id: sourceKind === "appointment" ? sourceId : null,
    registration_id: sourceKind === "registration" ? sourceId : null,
    record_type: "service_record",
    treatment_name: treatmentName.slice(0, 160),
    assessment: assessment.slice(0, 3000) || null,
    content: content.slice(0, 5000),
    aftercare: aftercare.slice(0, 3000) || null,
    private_photo_paths: [],
    photo_consent: consent,
    recorded_by: user.id,
  }).select("id").single());
  if (error) throw new Error(adminErrorMessage(error));
  revalidatePath("/admin/operations/service-records");
  return record.id;
}

export async function createInventoryItemAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const name = text(fd, "name");
  const sku = text(fd, "sku").toUpperCase();
  const stock = Math.max(0, numberValue(fd, "stock_on_hand"));
  const reorder = Math.max(0, numberValue(fd, "reorder_level"));
  const price = Math.max(0, Math.round(numberValue(fd, "retail_price")));
  if (!name) throw new Error("請填寫品項名稱");
  const { error } = await adminQuery(createServiceClient().from("inventory_items").insert({ clinic_id: clinicId, name: name.slice(0, 160), sku: sku.slice(0, 60) || null, unit: text(fd, "unit").slice(0, 20) || "件", stock_on_hand: stock, reorder_level: reorder, retail_price: price, active: true }));
  if (error) throw new Error(adminErrorMessage(error));
  revalidatePath("/admin/operations/inventory");
}

export async function recordInventoryMovementAction(fd: FormData): Promise<void> {
  const { clinicId, user } = await requireOperator();
  const kind = text(fd, "kind");
  const quantity = numberValue(fd, "quantity");
  if (!["stock_in", "use", "sale", "waste"].includes(kind) || quantity <= 0) throw new Error("庫存異動資料不正確");
  const { error } = await adminQuery(createServiceClient().rpc("record_inventory_movement", { p_clinic_id: clinicId, p_item_id: text(fd, "item_id"), p_kind: kind, p_quantity: quantity, p_note: text(fd, "note") || null, p_actor_user_id: user.id }));
  if (error) throw new Error(error.message.includes("insufficient") ? "目前庫存不足，無法扣除" : adminErrorMessage(error));
  revalidatePath("/admin/operations/inventory");
}

export async function saveCommissionRuleAction(fd: FormData): Promise<void> {
  const { clinicId } = await requireAdmin();
  const doctorId = text(fd, "doctor_id");
  const serviceId = text(fd, "service_id") || null;
  const amount = Math.max(0, Math.round(numberValue(fd, "amount_per_service")));
  const calculationType = text(fd, "calculation_type") === "percent" ? "percent" : "fixed";
  const ratePercent = Math.max(0, Math.min(100, numberValue(fd, "rate_percent")));
  if (!doctorId) throw new Error("請選擇服務人員");
  const service = createServiceClient();
  const [{ data: doctor }, serviceResult] = await adminQuery(Promise.all([
    service.from("doctors").select("id").eq("id", doctorId).eq("clinic_id", clinicId).eq("active", true).maybeSingle(),
    serviceId ? service.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]));
  if (!doctor || (serviceId && !serviceResult.data)) throw new Error("服務人員或服務不屬於目前品牌");
  let query = service.from("beauty_commission_rules").select("id").eq("clinic_id", clinicId).eq("doctor_id", doctorId);
  query = serviceId ? query.eq("service_id", serviceId) : query.is("service_id", null);
  const { data: existing, error: existingError } = await adminQuery(query.maybeSingle());
  if (existingError) throw new Error(adminErrorMessage(existingError));
  const result = existing
    ? await adminQuery(service.from("beauty_commission_rules").update({ amount_per_service: amount, calculation_type: calculationType, rate_percent: ratePercent, active: true }).eq("id", existing.id).eq("clinic_id", clinicId))
    : await adminQuery(service.from("beauty_commission_rules").insert({ clinic_id: clinicId, doctor_id: doctorId, service_id: serviceId, amount_per_service: amount, calculation_type: calculationType, rate_percent: ratePercent, active: true }));
  if (result.error) throw new Error(adminErrorMessage(result.error));
  revalidatePath("/admin/operations/commissions");
}
