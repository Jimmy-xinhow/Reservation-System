"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOperator, requireStatusOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { getQueueForDate } from "@/lib/queue";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";

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

const STATUSES = ["booked", "confirmed", "cancelled", "done", "no_show"] as const;
export async function setStatusAction(fd: FormData) {
  const { supabase, clinicId, role, user } = await requireStatusOperator();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !STATUSES.includes(status as (typeof STATUSES)[number])) throw new Error("參數錯誤");
  if (role === "provider" && status !== "done" && status !== "no_show") {
    throw new Error("服務提供者只能標記完成或未到");
  }
  if (status === "cancelled") {
    const { data: cancelled, error: cancelError } = await createServiceClient().rpc("cancel_appointment_by_operator", {
      p_clinic_id: clinicId,
      p_appointment_id: id,
      p_actor_user_id: user.id,
      p_note: "cancelled by operator",
    });
    if (cancelError) throw new Error(cancelError.message);
    if (typeof cancelled !== "string") throw new Error("預約取消失敗");
    revalidatePath("/admin");
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/queue");
    return;
  }
  const { data: changed, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .in("status", ["booked", "confirmed"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!changed) throw new Error("查無預約或沒有此預約的操作權限");

  if (status === "confirmed") {
    await notifyAppointmentStatus(createServiceClient(), id, "confirmed").catch((notificationError: unknown) => {
      console.error("Appointment confirmation notification failed", notificationError);
    });
  }

  // 未到自動停權:每累計滿 3 次未到 → 停權 1 個月
  if (status === "no_show" && role !== "provider") {
    const { data: appt } = await supabase
      .from("appointments")
      .select("patient_id")
      .eq("id", id)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (appt?.patient_id) {
      const { count } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
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
          .eq("clinic_id", clinicId);
      }
    }
    revalidatePath("/admin/patients");
  }
  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/queue");
}

// ── 叫號:線上/現場兩條序列,支援手動與自動穿插 ──────────────
// op: next_online / next_offline / auto / prev_online / prev_offline / reset
export async function advanceServingAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const doctorId = str(fd, "doctor_id");
  const date = str(fd, "date");
  const sessionKey = str(fd, "session_key");
  const op = str(fd, "op");
  // 各序列現有最大號(自動模式判斷是否還有現場可插)
  const maxOnline = intOr(fd, "max_online", 0);
  const maxOffline = intOr(fd, "max_offline", 0);
  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select("id")
    .eq("id", doctorId)
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .maybeSingle();
  if (doctorError) throw new Error(doctorError.message);
  if (!doctor) throw new Error("服務提供者不屬於目前品牌或已停用");
  if (!doctorId || !date || !sessionKey) throw new Error("參數錯誤");

  const { data: cur } = await supabase
    .from("serving_numbers")
    .select("online_current, offline_current, auto_every, online_run")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .eq("date", date)
    .eq("session_key", sessionKey)
    .maybeSingle();

  let online = cur?.online_current ?? 0;
  let offline = cur?.offline_current ?? 0;
  const autoEvery = cur?.auto_every ?? 0;
  let run = cur?.online_run ?? 0;
  let lastKind = "";

  const callOnline = () => {
    online += 1;
    run += 1;
    lastKind = "online";
  };
  const callOffline = () => {
    offline += 1;
    run = 0;
    lastKind = "offline";
  };

  if (op === "next_online") callOnline();
  else if (op === "next_offline") callOffline();
  else if (op === "prev_online") online = Math.max(0, online - 1);
  else if (op === "prev_offline") offline = Math.max(0, offline - 1);
  else if (op === "reset") {
    online = 0;
    offline = 0;
    run = 0;
    lastKind = "";
  } else if (op === "auto") {
    // 每叫滿 N 個線上,若還有現場候診就插一個現場,否則叫線上
    const hasOffline = offline < maxOffline;
    const hasOnline = online < maxOnline;
    if (autoEvery > 0 && run >= autoEvery && hasOffline) callOffline();
    else if (hasOnline) callOnline();
    else if (hasOffline) callOffline();
  }

  const prevOnline = cur?.online_current ?? 0;
  const prevOffline = cur?.offline_current ?? 0;

  const { error } = await supabase.from("serving_numbers").upsert(
    {
      clinic_id: clinicId,
      doctor_id: doctorId,
      date,
      session_key: sessionKey,
      online_current: online,
      offline_current: offline,
      online_run: run,
      last_kind: lastKind || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id,doctor_id,date,session_key" },
  );
  if (error) throw new Error(error.message);

  // 叫下一位時,把「剛才那位」(前一個目前號)自動標記為完成
  if (lastKind === "online" && online > prevOnline && prevOnline > 0) {
    await completeServed(supabase, clinicId, date, sessionKey, "online", prevOnline);
  } else if (lastKind === "offline" && offline > prevOffline && prevOffline > 0) {
    await completeServed(supabase, clinicId, date, sessionKey, "offline", prevOffline);
  }

  revalidatePath("/admin/queue");
  revalidatePath("/admin/dashboard");
}

/** 把某門診段某序列 seq 號的病患標為完成(若仍在候診)。 */
async function completeServed(
  supabase: SupabaseClient,
  clinicId: string,
  date: string,
  sessionKey: string,
  stream: "online" | "offline",
  seq: number,
) {
  const { data: cs } = await supabase
    .from("clinic_settings")
    .select("booking_mode")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const mode = (cs?.booking_mode as "time" | "number") ?? "time";
  const sessions = await getQueueForDate(supabase, clinicId, date, mode);
  const sess = sessions.find((s) => s.key === sessionKey);
  if (!sess) return;
  const list = stream === "online" ? sess.online : sess.offline;
  const appt = list.find((a) => a.seq === seq);
  if (!appt) return;
  if (appt.status === "booked" || appt.status === "confirmed") {
    await supabase
      .from("appointments")
      .update({ status: "done" })
      .eq("id", appt.id)
      .eq("clinic_id", clinicId)
      .in("status", ["booked", "confirmed"]);
  }
}

// 設定自動穿插:每 N 個線上插 1 個現場(0=關閉自動)
export async function setQueueAutoAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const doctorId = str(fd, "doctor_id");
  const date = str(fd, "date");
  const sessionKey = str(fd, "session_key");
  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select("id")
    .eq("id", doctorId)
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .maybeSingle();
  if (doctorError) throw new Error(doctorError.message);
  if (!doctor) throw new Error("服務提供者不屬於目前品牌或已停用");
  if (!doctorId || !date || !sessionKey) throw new Error("參數錯誤");
  const autoEvery = Math.max(0, intOr(fd, "auto_every", 0));

  const { error } = await supabase.from("serving_numbers").upsert(
    {
      clinic_id: clinicId,
      doctor_id: doctorId,
      date,
      session_key: sessionKey,
      auto_every: autoEvery,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id,doctor_id,date,session_key" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/queue");
}

export async function cancelAppointmentAction(fd: FormData) {
  // 取消 = 改 status,不 DELETE
  const { supabase, clinicId, user } = await requireOperator();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少 id");
  const { data: current } = await supabase.from("appointments").select("patient_id").eq("id", id).eq("clinic_id", clinicId).maybeSingle();
  const { error } = await createServiceClient().rpc("cancel_appointment", { p_clinic_id: clinicId, p_appointment_id: id, p_note: "cancelled appointment" });
  if (error) throw new Error(error.message);
  await notifyAppointmentStatus(createServiceClient(), id, "cancelled").catch((notificationError: unknown) => console.error("Appointment cancellation notification failed", notificationError));
  if (current?.patient_id) {
    await recordCrmInteraction(supabase, {
      clinicId,
      patientId: current.patient_id,
      kind: "booking",
      channel: "staff",
      title: "後台取消預約",
      body: "櫃檯取消預約",
      appointmentId: id,
      createdBy: user.id,
    });
  }
  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
}

export async function cancelAppointmentWaitlistAction(fd: FormData) {
  const { clinicId, user } = await requireOperator();
  const id = str(fd, "id");
  if (!id) throw new Error("缺少候補編號");
  const { error } = await createServiceClient().rpc("cancel_appointment_waitlist_by_operator", {
    p_clinic_id: clinicId,
    p_waitlist_id: id,
    p_actor_user_id: user.id,
    p_note: "cancelled by operator",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/admin/dashboard");
}

const DEPOSIT_STATUSES = ["none", "pending", "paid", "waived", "refunded"] as const;
export async function setDepositAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  const deposit_status = str(fd, "deposit_status");
  if (!id || !DEPOSIT_STATUSES.includes(deposit_status as (typeof DEPOSIT_STATUSES)[number]))
    throw new Error("參數錯誤");
  const { error } = await supabase
    .from("appointments")
    .update({ deposit_status })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// ── 建立 / 改期(走 RPC,需 service client;先守門驗權限)──────
async function getOrCreatePatient(clinicId: string, name: string, phone: string, birthday?: string): Promise<string> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("create_or_get_public_patient", {
    p_clinic_id: clinicId,
    p_name: name,
    p_phone: phone,
    p_birthday: birthday || null,
    p_line_user_id: null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.patient_id) throw new Error("建立顧客失敗");
  return row.patient_id as string;
}

async function book(opts: {
  clinicId: string;
  mode: "time" | "number";
  doctorId: string;
  patientId: string;
  visitType: "first" | "return";
  isSelfPay: boolean;
  startAt?: string;
  templateId?: string;
  date?: string;
  serviceId?: string;
}): Promise<string> {
  const svc = createServiceClient();
  let selectedServiceId: string | null = null;
  let selectedServiceTarget: "provider_required" | "provider_optional" | "resource_only" | null = null;
  if (opts.serviceId) {
    const { data: service, error: serviceError } = await svc
      .from("services")
      .select("id, booking_target")
      .eq("id", opts.serviceId)
      .eq("clinic_id", opts.clinicId)
      .eq("active", true)
      .maybeSingle();
    if (serviceError) throw new Error(serviceError.message);
    if (!service) throw new Error("服務不存在或已停用");
    selectedServiceId = String(service.id);
    selectedServiceTarget = service.booking_target as "provider_required" | "provider_optional" | "resource_only";
  }
  if (!opts.doctorId && !selectedServiceId) throw new Error("請指定服務提供者或服務");
  if (!opts.doctorId && selectedServiceTarget === "provider_required") throw new Error("此服務需要指定服務提供者");
  let apptId: string | null = null;
  if (opts.mode === "time") {
    if (!opts.startAt) throw new Error("缺少時間");
    const { data, error } = opts.doctorId
      ? await svc.rpc("book_time_slot", {
          p_clinic_id: opts.clinicId,
          p_doctor_id: opts.doctorId,
          p_patient_id: opts.patientId,
          p_start_at: opts.startAt,
          p_visit_type: opts.visitType,
          p_is_self_pay: opts.isSelfPay,
          p_service_id: selectedServiceId,
        })
      : await svc.rpc("book_service_slot", {
          p_clinic_id: opts.clinicId,
          p_service_id: selectedServiceId,
          p_patient_id: opts.patientId,
          p_start_at: opts.startAt,
          p_visit_type: opts.visitType,
          p_is_self_pay: opts.isSelfPay,
          p_booking_answers: {},
        });
    if (error) throw new Error(error.message);
    apptId = data as string;
  } else {
    if (!opts.templateId || !opts.date) throw new Error("缺少服務場次或日期");
    const { data, error } = opts.doctorId
      ? await svc.rpc("book_number", {
          p_clinic_id: opts.clinicId,
          p_doctor_id: opts.doctorId,
          p_patient_id: opts.patientId,
          p_template_id: opts.templateId,
          p_date: opts.date,
          p_visit_type: opts.visitType,
          p_is_self_pay: opts.isSelfPay,
          p_service_id: selectedServiceId,
        })
      : await svc.rpc("book_service_session", {
          p_clinic_id: opts.clinicId,
          p_service_id: selectedServiceId,
          p_patient_id: opts.patientId,
          p_template_id: opts.templateId,
          p_date: opts.date,
          p_visit_type: opts.visitType,
          p_is_self_pay: opts.isSelfPay,
          p_booking_answers: {},
        });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    apptId = (row?.appointment_id as string) ?? null;
  }
  // 後台建立 = 現場(offline);服務先驗證，再一次寫入 metadata。
  if (apptId) {
    const { error: bindingError } = await svc
      .from("appointments")
      .update({ source: "offline", service_id: selectedServiceId })
      .eq("id", apptId)
      .eq("clinic_id", opts.clinicId);
    if (bindingError) {
      await svc.rpc("cancel_appointment", {
        p_clinic_id: opts.clinicId,
        p_appointment_id: apptId,
        p_note: "admin booking metadata binding failed",
      });
      throw new Error(bindingError.message);
    }
  }
  if (!apptId) throw new Error("建立預約失敗");
  return apptId;
}

export async function createAppointmentAction(fd: FormData) {
  const { clinicId } = await requireOperator();
  const mode = str(fd, "mode") === "number" ? "number" : "time";
  const doctorId = str(fd, "doctor_id");
  const name = str(fd, "name");
  const phone = str(fd, "phone");
  const birthday = str(fd, "birthday");
  const serviceId = str(fd, "service_id");
  if ((!doctorId && !serviceId) || !name || !phone) throw new Error("請填寫服務提供者或服務、姓名、電話");
  const visitType = str(fd, "visit_type") === "first" ? "first" : "return";
  const isSelfPay = bool(fd, "is_self_pay");

  // 已從搜尋套入既有病患 → 直接用其 id;否則以姓名+電話找或建
  const selectedId = str(fd, "patient_id");
  let patientId: string;
  if (selectedId) {
    const svc = createServiceClient();
    const { data: p } = await svc
      .from("patients")
      .select("id")
      .eq("id", selectedId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    patientId = p?.id ?? (await getOrCreatePatient(clinicId, name, phone, birthday || undefined));
  } else {
    patientId = await getOrCreatePatient(clinicId, name, phone, birthday || undefined);
  }
  await book({
    clinicId,
    mode,
    doctorId,
    patientId,
    visitType,
    isSelfPay,
    startAt: str(fd, "start_at") || undefined,
    templateId: str(fd, "template_id") || undefined,
    date: str(fd, "date") || undefined,
    serviceId: serviceId || undefined,
  });
  revalidatePath("/admin");
}

export async function rescheduleAppointmentAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireOperator();
  const oldId = str(fd, "old_id");
  const mode = str(fd, "mode") === "number" ? "number" : "time";
  const doctorId = str(fd, "doctor_id");
  if (!oldId) throw new Error("缺少必要參數");

  // 先取得原約診的病患
  const { data: old, error: oErr } = await supabase
    .from("appointments")
    .select("patient_id, visit_type, is_self_pay, membership_id, service_id")
    .eq("id", oldId)
    .eq("clinic_id", clinicId)
    .single();
  if (oErr || !old) throw new Error("查無原預約");

  const serviceId = (old.service_id as string | null) ?? null;
  if (!doctorId && !serviceId) throw new Error("原預約缺少服務或服務提供者，無法改期");
  const { data: newAppointmentId, error: rescheduleError } = await createServiceClient().rpc("reschedule_service_appointment", {
    p_clinic_id: clinicId,
    p_old_appointment_id: oldId,
    p_mode: mode,
    p_doctor_id: doctorId || null,
    p_service_id: serviceId,
    p_start_at: str(fd, "start_at") || null,
    p_template_id: str(fd, "template_id") || null,
    p_date: str(fd, "date") || null,
  });
  if (rescheduleError || typeof newAppointmentId !== "string") {
    throw new Error(rescheduleError?.message ?? "改期失敗");
  }
  await notifyAppointmentStatus(createServiceClient(), newAppointmentId, "rescheduled").catch((notificationError: unknown) => console.error("Appointment reschedule notification failed", notificationError));
  await recordCrmInteraction(supabase, {
    clinicId,
    patientId: old.patient_id,
    kind: "booking",
    channel: "staff",
    title: "改期預約",
    body: "櫃檯完成改期，原預約已保留為取消狀態",
    appointmentId: newAppointmentId,
    createdBy: user.id,
  });
  revalidatePath("/admin");
}
