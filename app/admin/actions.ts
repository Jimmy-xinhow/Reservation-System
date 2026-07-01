"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/admin";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { pushMessages } from "@/lib/line";

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

// ── LINE 測試推播 ─────────────────────────────────────────
export async function sendTestPushAction(fd: FormData) {
  await requireMember();
  const to = str(fd, "line_user_id");
  if (!to) redirect("/admin/line?test=err&reason=" + encodeURIComponent("請填 line_user_id"));

  let reason: string | null = null;
  try {
    await pushMessages(to, [{ type: "text", text: "【慈愛中醫診所】測試推播 ✅ 連線正常。" }]);
  } catch (e) {
    reason = e instanceof Error ? e.message : "推播失敗";
  }
  // redirect() 放在 try/catch 外,避免吞掉其控制流
  redirect(reason ? "/admin/line?test=err&reason=" + encodeURIComponent(reason) : "/admin/line?test=ok");
}

// ── 登出 ──────────────────────────────────────────────────
export async function signOutAction() {
  const { supabase } = await requireMember();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

// ── 今日約診:狀態 / 取消 / 訂金 ───────────────────────────
const STATUSES = ["booked", "confirmed", "cancelled", "done", "no_show"] as const;
export async function setStatusAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !STATUSES.includes(status as (typeof STATUSES)[number])) throw new Error("參數錯誤");
  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);

  // 未到自動停權:每累計滿 3 次未到 → 停權 1 個月
  if (status === "no_show") {
    const { data: appt } = await supabase
      .from("appointments")
      .select("patient_id")
      .eq("id", id)
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle();
    if (appt?.patient_id) {
      const { count } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", CLINIC_ID)
        .eq("patient_id", appt.patient_id)
        .eq("status", "no_show");
      const n = count ?? 0;
      if (n > 0 && n % 3 === 0) {
        const until = new Date();
        until.setMonth(until.getMonth() + 1);
        await supabase
          .from("patients")
          .update({ blocked_until: until.toISOString() })
          .eq("id", appt.patient_id)
          .eq("clinic_id", CLINIC_ID);
      }
    }
    revalidatePath("/admin/patients");
  }
  revalidatePath("/admin");
}

// ── 叫號:推進/回退/重設某門診段目前看診號 ──────────────
export async function advanceServingAction(fd: FormData) {
  const { supabase } = await requireMember();
  const doctorId = str(fd, "doctor_id");
  const date = str(fd, "date");
  const sessionKey = str(fd, "session_key");
  const op = str(fd, "op"); // next / prev / reset
  if (!doctorId || !date || !sessionKey) throw new Error("參數錯誤");

  const { data: cur } = await supabase
    .from("serving_numbers")
    .select("current_number")
    .eq("clinic_id", CLINIC_ID)
    .eq("doctor_id", doctorId)
    .eq("date", date)
    .eq("session_key", sessionKey)
    .maybeSingle();
  let n = cur?.current_number ?? 0;
  if (op === "next") n += 1;
  else if (op === "prev") n = Math.max(0, n - 1);
  else if (op === "reset") n = 0;

  const { error } = await supabase.from("serving_numbers").upsert(
    {
      clinic_id: CLINIC_ID,
      doctor_id: doctorId,
      date,
      session_key: sessionKey,
      current_number: n,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id,doctor_id,date,session_key" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/queue");
}

// 手動加入/解除黑名單(停權 1 個月 / 清除)
export async function setPatientBlockAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少病患");
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
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/patients");
}

export async function cancelAppointmentAction(fd: FormData) {
  // 取消 = 改 status,不 DELETE
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少 id");
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

const DEPOSIT_STATUSES = ["none", "pending", "paid", "waived", "refunded"] as const;
export async function setDepositAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const deposit_status = str(fd, "deposit_status");
  if (!id || !DEPOSIT_STATUSES.includes(deposit_status as (typeof DEPOSIT_STATUSES)[number]))
    throw new Error("參數錯誤");
  const { error } = await supabase
    .from("appointments")
    .update({ deposit_status })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// ── 建立 / 改期(走 RPC,需 service client;先守門驗權限)──────
async function getOrCreatePatient(name: string, phone: string): Promise<string> {
  const svc = createServiceClient();
  const { data: existing } = await svc
    .from("patients")
    .select("id")
    .eq("clinic_id", CLINIC_ID)
    .eq("phone", phone)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await svc
    .from("patients")
    .insert({ clinic_id: CLINIC_ID, name, phone })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

async function book(opts: {
  mode: "time" | "number";
  doctorId: string;
  patientId: string;
  visitType: "first" | "return";
  isSelfPay: boolean;
  startAt?: string;
  templateId?: string;
  date?: string;
}): Promise<void> {
  const svc = createServiceClient();
  if (opts.mode === "time") {
    if (!opts.startAt) throw new Error("缺少時間");
    const { error } = await svc.rpc("book_time_slot", {
      p_clinic_id: CLINIC_ID,
      p_doctor_id: opts.doctorId,
      p_patient_id: opts.patientId,
      p_start_at: opts.startAt,
      p_visit_type: opts.visitType,
      p_is_self_pay: opts.isSelfPay,
    });
    if (error) throw new Error(error.message);
  } else {
    if (!opts.templateId || !opts.date) throw new Error("缺少診次或日期");
    const { error } = await svc.rpc("book_number", {
      p_clinic_id: CLINIC_ID,
      p_doctor_id: opts.doctorId,
      p_patient_id: opts.patientId,
      p_template_id: opts.templateId,
      p_date: opts.date,
      p_visit_type: opts.visitType,
      p_is_self_pay: opts.isSelfPay,
    });
    if (error) throw new Error(error.message);
  }
}

export async function createAppointmentAction(fd: FormData) {
  await requireMember(); // 守門
  const mode = str(fd, "mode") === "number" ? "number" : "time";
  const doctorId = str(fd, "doctor_id");
  const name = str(fd, "name");
  const phone = str(fd, "phone");
  if (!doctorId || !name || !phone) throw new Error("請填寫醫師、姓名、電話");
  const visitType = str(fd, "visit_type") === "first" ? "first" : "return";
  const isSelfPay = bool(fd, "is_self_pay");

  const patientId = await getOrCreatePatient(name, phone);
  await book({
    mode,
    doctorId,
    patientId,
    visitType,
    isSelfPay,
    startAt: str(fd, "start_at") || undefined,
    templateId: str(fd, "template_id") || undefined,
    date: str(fd, "date") || undefined,
  });
  revalidatePath("/admin");
}

export async function rescheduleAppointmentAction(fd: FormData) {
  const { supabase } = await requireMember();
  const oldId = str(fd, "old_id");
  const mode = str(fd, "mode") === "number" ? "number" : "time";
  const doctorId = str(fd, "doctor_id");
  if (!oldId || !doctorId) throw new Error("缺少必要參數");

  // 先取得原約診的病患
  const { data: old, error: oErr } = await supabase
    .from("appointments")
    .select("patient_id, visit_type, is_self_pay")
    .eq("id", oldId)
    .eq("clinic_id", CLINIC_ID)
    .single();
  if (oErr || !old) throw new Error("查無原約診");

  // 先訂新的(若失敗不動原約診)
  await book({
    mode,
    doctorId,
    patientId: old.patient_id,
    visitType: old.visit_type as "first" | "return",
    isSelfPay: old.is_self_pay as boolean,
    startAt: str(fd, "start_at") || undefined,
    templateId: str(fd, "template_id") || undefined,
    date: str(fd, "date") || undefined,
  });
  // 新的成功後取消舊的
  const { error: cErr } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", oldId)
    .eq("clinic_id", CLINIC_ID);
  if (cErr) throw new Error(cErr.message);
  revalidatePath("/admin");
}

// ── 門診表 schedule_templates ──────────────────────────────
export async function createTemplateAction(fd: FormData) {
  const { supabase } = await requireMember();
  const { error } = await supabase.from("schedule_templates").insert({
    clinic_id: CLINIC_ID,
    doctor_id: str(fd, "doctor_id"),
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
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少 id");
  const { error } = await supabase
    .from("schedule_templates")
    .update({
      doctor_id: str(fd, "doctor_id"),
      weekday: intOr(fd, "weekday", 1),
      start_time: str(fd, "start_time"),
      end_time: str(fd, "end_time"),
      slot_minutes: intOr(fd, "slot_minutes", 15),
      capacity: intOr(fd, "capacity", 1),
    })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function toggleTemplateAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("schedule_templates")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function deleteTemplateAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("schedule_templates")
    .delete()
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error("此門診段已有約診,無法刪除,請改為停用。");
  revalidatePath("/admin/schedules");
}

// ── 休診 / 加診 schedule_exceptions ───────────────────────
export async function createExceptionAction(fd: FormData) {
  const { supabase } = await requireMember();
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
      .eq("clinic_id", CLINIC_ID);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/exceptions");
    revalidatePath("/admin/schedules");
    return;
  }
  if (!date) throw new Error("請選擇日期");

  const row: Record<string, unknown> = {
    clinic_id: CLINIC_ID,
    doctor_id: str(fd, "doctor_id"),
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
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("schedule_exceptions")
    .delete()
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/exceptions");
}

// ── 醫師(門診表需要)────────────────────────────────────
export async function createDoctorAction(fd: FormData) {
  const { supabase } = await requireMember();
  const { error } = await supabase.from("doctors").insert({
    clinic_id: CLINIC_ID,
    name: str(fd, "name"),
    specialty: str(fd, "specialty") || null,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function updateDoctorAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!id || !name) throw new Error("缺少醫師或姓名");
  const { error } = await supabase
    .from("doctors")
    .update({ name, specialty: str(fd, "specialty") || null })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

export async function toggleDoctorAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("doctors")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/schedules");
}

// ── 病患建檔/記錄 patients ───────────────────────────────
export async function updatePatientAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少病患");
  const { error } = await supabase
    .from("patients")
    .update({
      note: str(fd, "note") || null,
      tags: str(fd, "tags") || null,
      birthday: str(fd, "birthday") || null,
      gender: str(fd, "gender") || null,
      email: str(fd, "email") || null,
      marketing_opt_in: bool(fd, "marketing_opt_in"),
    })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/patients");
}

// ── 看診服務 services ─────────────────────────────────────
export async function createServiceAction(fd: FormData) {
  const { supabase } = await requireMember();
  const name = str(fd, "name");
  if (!name) throw new Error("請填服務名稱");
  const { error } = await supabase.from("services").insert({
    clinic_id: CLINIC_ID,
    name,
    description: str(fd, "description") || null,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function updateServiceAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!id || !name) throw new Error("缺少服務或名稱");
  const { error } = await supabase
    .from("services")
    .update({ name, description: str(fd, "description") || null })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function toggleServiceAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("services")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function deleteServiceAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error("此服務已被約診使用,無法刪除,請改為停用。");
  revalidatePath("/admin/services");
}

// ── Email 提醒設定(存於 clinic_settings;金鑰留空則沿用舊值)──────
export async function updateEmailSettingsAction(fd: FormData) {
  const { supabase } = await requireMember();
  const patch: Record<string, unknown> = {
    email_enabled: bool(fd, "email_enabled"),
    email_from: str(fd, "email_from") || null,
  };
  // 只有輸入新金鑰才更新(避免用遮罩值覆蓋);輸入 "-" 代表清除
  const key = str(fd, "resend_api_key");
  if (key === "-") patch.resend_api_key = null;
  else if (key) patch.resend_api_key = key;

  const { error } = await supabase.from("clinic_settings").update(patch).eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

// ── 診所公開資訊 clinics(名稱、LINE ID、電話、地址、簡介)──────
export async function updateClinicProfileAction(fd: FormData) {
  const { supabase } = await requireMember();
  const name = str(fd, "name");
  if (!name) throw new Error("請填診所名稱");
  let lineId = str(fd, "line_basic_id");
  if (lineId && !lineId.startsWith("@")) lineId = "@" + lineId; // 自動補 @
  const { error } = await supabase
    .from("clinics")
    .update({
      name,
      line_basic_id: lineId || null,
      phone: str(fd, "phone") || null,
      address: str(fd, "address") || null,
      intro: str(fd, "intro") || null,
    })
    .eq("id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
  revalidatePath("/");
}

// ── 診所設定 clinic_settings ──────────────────────────────
export async function updateSettingsAction(fd: FormData) {
  const { supabase } = await requireMember();
  const booking_mode = str(fd, "booking_mode") === "number" ? "number" : "time";
  const deposit_scope = (["all", "self_pay", "none"] as const).includes(
    str(fd, "deposit_scope") as "all" | "self_pay" | "none",
  )
    ? str(fd, "deposit_scope")
    : "self_pay";

  const { error } = await supabase
    .from("clinic_settings")
    .update({
      booking_mode,
      first_visit_extends: bool(fd, "first_visit_extends"),
      first_visit_minutes: str(fd, "first_visit_minutes")
        ? intOr(fd, "first_visit_minutes", 0)
        : null,
      allow_multi_patient_per_phone: bool(fd, "allow_multi_patient_per_phone"),
      max_patients_per_phone: Math.max(1, intOr(fd, "max_patients_per_phone", 1)),
      deposit_enabled: bool(fd, "deposit_enabled"),
      deposit_amount: Math.max(0, intOr(fd, "deposit_amount", 0)),
      deposit_scope,
      min_lead_minutes: Math.max(0, intOr(fd, "min_lead_minutes", 30)),
      max_advance_days: Math.max(1, intOr(fd, "max_advance_days", 30)),
    })
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}
