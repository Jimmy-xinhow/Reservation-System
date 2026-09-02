"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/admin";
import { recordCrmInteraction } from "@/lib/crm-interactions";

function str(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

function bool(fd: FormData, key: string): boolean {
  const value = fd.get(key);
  return value === "on" || value === "true" || value === "1";
}

export async function setPatientBlockAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少顧客");
  const block = str(fd, "block") === "1";
  let blockedUntil: string | null = null;
  if (block) {
    const until = new Date();
    until.setMonth(until.getMonth() + 1);
    blockedUntil = until.toISOString();
  }
  const { error } = await supabase
    .from("patients")
    .update({ blocked_until: blockedUntil })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/patients");
}

// ── 顧客建檔/記錄 patients ────────────────────────────────
// 修正顧客自行填錯的基本資料(姓名 / 電話)。櫃檯即可操作。
export async function updatePatientBasicAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  const name = str(fd, "name");
  const phone = str(fd, "phone");
  if (!id) throw new Error("缺少顧客");
  if (!name) throw new Error("請填姓名");
  if (!phone) throw new Error("請填電話");
  const { error } = await supabase
    .from("patients")
    .update({ name, phone })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/patients/${id}`);
  revalidatePath("/admin/patients");
}

// 刪除病患:
//  - 無約診紀錄(誤建檔/重複)→ 真的刪掉,patient_records 隨之 cascade。
//  - 有約診紀錄 → 軟刪除(active=false),僅從後台列表隱藏,約診與歷史全保留。
export async function deletePatientAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少顧客");
  const [{ count: appointmentCount }, { count: recordCount }, { count: interactionCount }, { count: membershipCount }, { count: segmentCount }, { count: discountCount }] = await Promise.all([
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("patient_id", id),
    supabase.from("patient_records").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("patient_id", id),
    supabase.from("crm_interactions").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("patient_id", id),
    supabase.from("patient_memberships").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("patient_id", id),
    supabase.from("crm_segment_members").select("patient_id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("patient_id", id),
    supabase.from("discount_redemptions").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("patient_id", id),
  ]);
  const hasHistory = [appointmentCount, recordCount, interactionCount, membershipCount, segmentCount, discountCount].some((count) => (count ?? 0) > 0);

  if (hasHistory) {
    const { error } = await supabase
      .from("patients")
      .update({ active: false })
      .eq("id", id)
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("patients")
      .delete()
      .eq("id", id)
      .eq("clinic_id", clinicId);
  if (error) throw new Error("刪除失敗:此顧客可能已有關聯資料。");
  }
  revalidatePath("/admin/patients");
}

export async function updatePatientAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少顧客");
  const { error } = await supabase
    .from("patients")
    .update({
      tags: str(fd, "tags") || null,
      birthday: str(fd, "birthday") || null,
      gender: str(fd, "gender") || null,
      email: str(fd, "email") || null,
      marketing_opt_in: bool(fd, "marketing_opt_in"),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/patients/${id}`);
}

// ── 病況紀錄 patient_records(逐筆)──────────────────────────
export async function addPatientRecordAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireOperator();
  const patientId = str(fd, "patient_id");
  const content = str(fd, "content");
  if (!patientId) throw new Error("缺少顧客");
  if (!content) throw new Error("請填寫病況內容");
  const { error } = await supabase.from("patient_records").insert({
    clinic_id: clinicId,
    patient_id: patientId,
    content,
  });
  if (error) throw new Error(error.message);
  await recordCrmInteraction(supabase, {
    clinicId,
    patientId,
    kind: "note",
    channel: "staff",
    title: "新增顧客備註",
    body: content,
    createdBy: user.id,
  });
  revalidatePath(`/admin/patients/${patientId}`);
}
export async function deletePatientRecordAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  const patientId = str(fd, "patient_id");
  if (!id) throw new Error("缺少紀錄");
  const { error } = await supabase
    .from("patient_records")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/patients/${patientId}`);
}
