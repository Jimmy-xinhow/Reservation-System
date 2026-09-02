"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

function str(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

function bool(fd: FormData, key: string): boolean {
  const value = fd.get(key);
  return value === "on" || value === "true" || value === "1";
}

function intOr(fd: FormData, key: string, fallback: number): number {
  const value = Number(str(fd, key));
  return Number.isFinite(value) ? value : fallback;
}

// ── 服務排程 schedule_templates ────────────────────────────
export async function createTemplateAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const doctorId = str(fd, "doctor_id");
  const serviceId = str(fd, "service_id");
  if (!doctorId && !serviceId) throw new Error("請指定服務提供者或服務");
  if (doctorId) {
    const { data: doctor, error: doctorError } = await supabase
      .from("doctors")
      .select("id")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .maybeSingle();
    if (doctorError) throw new Error(doctorError.message);
    if (!doctor) throw new Error("服務提供者不屬於目前品牌或已停用");
  }
  if (serviceId) {
    const { data: service, error: serviceError } = await supabase.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (serviceError) throw new Error(serviceError.message);
    if (!service) throw new Error("服務不屬於目前品牌或已停用");
  }
  const { error } = await supabase.from("schedule_templates").insert({
    clinic_id: clinicId,
    doctor_id: doctorId || null,
    service_id: serviceId || null,
    weekday: intOr(fd, "weekday", 1),
    start_time: str(fd, "start_time"),
    end_time: str(fd, "end_time"),
    slot_minutes: intOr(fd, "slot_minutes", 15),
    capacity: intOr(fd, "capacity", 1),
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function updateTemplateAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const doctorId = str(fd, "doctor_id");
  const serviceId = str(fd, "service_id");
  if (!doctorId && !serviceId) throw new Error("請指定服務提供者或服務");
  if (doctorId) {
    const { data: doctor, error: doctorError } = await supabase
      .from("doctors")
      .select("id")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .maybeSingle();
    if (doctorError) throw new Error(doctorError.message);
    if (!doctor) throw new Error("服務提供者不屬於目前品牌或已停用");
  }
  if (serviceId) {
    const { data: service, error: serviceError } = await supabase.from("services").select("id").eq("id", serviceId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (serviceError) throw new Error(serviceError.message);
    if (!service) throw new Error("服務不屬於目前品牌或已停用");
  }
  if (!id) throw new Error("缺少 id");
  const { error } = await supabase
    .from("schedule_templates")
    .update({
      doctor_id: doctorId || null,
      service_id: serviceId || null,
      weekday: intOr(fd, "weekday", 1),
      start_time: str(fd, "start_time"),
      end_time: str(fd, "end_time"),
      slot_minutes: intOr(fd, "slot_minutes", 15),
      capacity: intOr(fd, "capacity", 1),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function toggleTemplateAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("schedule_templates")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function deleteTemplateAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("schedule_templates")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error("此服務時段已有預約，無法刪除，請改為停用。");
  revalidatePath("/admin/schedules");
}

// ── 休診 / 加診 schedule_exceptions ───────────────────────
export async function createExceptionAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const isClosed = str(fd, "kind") !== "extra"; // kind=closed(休診) / extra(加診)
  const start = str(fd, "start_time");
  const end = str(fd, "end_time");
  const date = str(fd, "date");
  const tplId = str(fd, "template_id");

  // 休診某門診段且未選日期 → 永久停用該門診段(等同門診表停用)
  if (isClosed && tplId && !date) {
    const { error } = await supabase
      .from("schedule_templates")
      .update({ active: false })
      .eq("id", tplId)
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/exceptions");
    revalidatePath("/admin/schedules");
    return;
  }
  if (!date) throw new Error("請選擇日期");

  const doctorId = str(fd, "doctor_id");
  const serviceId = str(fd, "service_id");
  if (!doctorId && !serviceId) throw new Error("請指定服務提供者或服務");
  if (doctorId) {
    const { data: doctor, error: doctorError } = await supabase
      .from("doctors")
      .select("id")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .maybeSingle();
    if (doctorError) throw new Error(doctorError.message);
    if (!doctor) throw new Error("服務提供者不屬於目前品牌或已停用");
  }
  if (serviceId) {
    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("id")
      .eq("id", serviceId)
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .maybeSingle();
    if (serviceError) throw new Error(serviceError.message);
    if (!service) throw new Error("服務不屬於目前品牌或已停用");
  }

  const row: Record<string, unknown> = {
    clinic_id: clinicId,
    doctor_id: doctorId || null,
    service_id: serviceId || null,
    date,
    is_closed: isClosed,
  };
  if (isClosed) {
    // 有指定時段 = 只休某診;留空 = 整天休診
    if (start) {
      row.start_time = start;
      row.end_time = end || start;
    }
  } else {
    row.start_time = start;
    row.end_time = end;
    row.slot_minutes = intOr(fd, "slot_minutes", 15);
    row.capacity = intOr(fd, "capacity", 1);
  }
  const { error } = await supabase.from("schedule_exceptions").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/exceptions");
}

export async function deleteExceptionAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("schedule_exceptions")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/exceptions");
}

// ── 服務提供者(服務排程可選)────────────────────────────────
export async function createDoctorAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const { error } = await supabase.from("doctors").insert({
    clinic_id: clinicId,
    name: str(fd, "name"),
    specialty: str(fd, "specialty") || null,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function updateDoctorAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!id || !name) throw new Error("缺少服務提供者或姓名");
  const { error } = await supabase
    .from("doctors")
    .update({ name, specialty: str(fd, "specialty") || null })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function toggleDoctorAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("doctors")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}
