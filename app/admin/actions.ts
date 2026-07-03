"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/admin";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pushMessages,
  createRichMenu,
  uploadRichMenuImage,
  setDefaultRichMenu,
  deleteRichMenu,
  clearDefaultRichMenu,
  getRichMenuImage,
} from "@/lib/line";
import { LAYOUTS, slotBounds, slotAction, type Layout, type Slot } from "@/lib/richmenu";
import { getQueueForDate } from "@/lib/queue";
import { headers } from "next/headers";

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

// ── 使用者(櫃檯帳號)管理 ─────────────────────────────────
export interface StaffMember {
  userId: string;
  email: string;
  isSelf: boolean;
  createdAt: string | null;
}

/** 列出本診所的櫃檯帳號(需先 requireMember)。 */
export async function listStaff(): Promise<StaffMember[]> {
  const { user } = await requireMember();
  const svc = createServiceClient();
  const { data: members } = await svc
    .from("clinic_members")
    .select("user_id, created_at")
    .eq("clinic_id", CLINIC_ID);
  const rows = members ?? [];
  if (rows.length === 0) return [];

  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailMap = new Map((list?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  return rows.map((m) => ({
    userId: m.user_id as string,
    email: emailMap.get(m.user_id as string) ?? "(未知)",
    isSelf: m.user_id === user.id,
    createdAt: (m.created_at as string) ?? null,
  }));
}

export async function createStaffAction(fd: FormData) {
  await requireMember();
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("請填正確 Email");
  if (password.length < 8) throw new Error("密碼至少 8 碼");

  const svc = createServiceClient();
  // 建立帳號;若已存在則沿用該帳號
  let userId: string | null = null;
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created?.user) {
    userId = created.user.id;
  } else if (error) {
    // 已註冊 → 找出其 id
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = (list?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
    if (!found) throw new Error(error.message);
    userId = found.id;
  }
  if (!userId) throw new Error("建立帳號失敗");

  const { error: mErr } = await svc
    .from("clinic_members")
    .upsert({ clinic_id: CLINIC_ID, user_id: userId }, { onConflict: "clinic_id,user_id" });
  if (mErr) throw new Error(mErr.message);
  revalidatePath("/admin/users");
}

export async function removeStaffAction(fd: FormData) {
  const { user } = await requireMember();
  const userId = str(fd, "user_id");
  if (!userId) throw new Error("缺少帳號");
  if (userId === user.id) throw new Error("無法移除自己");
  const svc = createServiceClient();
  // 僅移除本診所權限(不刪除 auth 帳號)
  const { error } = await svc
    .from("clinic_members")
    .delete()
    .eq("clinic_id", CLINIC_ID)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}

export async function resetStaffPasswordAction(fd: FormData) {
  await requireMember();
  const userId = str(fd, "user_id");
  const password = str(fd, "password");
  if (!userId) throw new Error("缺少帳號");
  if (password.length < 8) throw new Error("密碼至少 8 碼");
  const svc = createServiceClient();
  const { error } = await svc.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
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
  revalidatePath("/admin/queue");
}

// ── 叫號:線上/現場兩條序列,支援手動與自動穿插 ──────────────
// op: next_online / next_offline / auto / prev_online / prev_offline / reset
export async function advanceServingAction(fd: FormData) {
  const { supabase } = await requireMember();
  const doctorId = str(fd, "doctor_id");
  const date = str(fd, "date");
  const sessionKey = str(fd, "session_key");
  const op = str(fd, "op");
  // 各序列現有最大號(自動模式判斷是否還有現場可插)
  const maxOnline = intOr(fd, "max_online", 0);
  const maxOffline = intOr(fd, "max_offline", 0);
  if (!doctorId || !date || !sessionKey) throw new Error("參數錯誤");

  const { data: cur } = await supabase
    .from("serving_numbers")
    .select("online_current, offline_current, auto_every, online_run")
    .eq("clinic_id", CLINIC_ID)
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
      clinic_id: CLINIC_ID,
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
    await completeServed(supabase, date, sessionKey, "online", prevOnline);
  } else if (lastKind === "offline" && offline > prevOffline && prevOffline > 0) {
    await completeServed(supabase, date, sessionKey, "offline", prevOffline);
  }

  revalidatePath("/admin/queue");
  revalidatePath("/admin/dashboard");
}

/** 把某門診段某序列 seq 號的病患標為完成(若仍在候診)。 */
async function completeServed(
  supabase: SupabaseClient,
  date: string,
  sessionKey: string,
  stream: "online" | "offline",
  seq: number,
) {
  const { data: cs } = await supabase
    .from("clinic_settings")
    .select("booking_mode")
    .eq("clinic_id", CLINIC_ID)
    .maybeSingle();
  const mode = (cs?.booking_mode as "time" | "number") ?? "time";
  const sessions = await getQueueForDate(supabase, CLINIC_ID, date, mode);
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
      .eq("clinic_id", CLINIC_ID);
  }
}

// 設定自動穿插:每 N 個線上插 1 個現場(0=關閉自動)
export async function setQueueAutoAction(fd: FormData) {
  const { supabase } = await requireMember();
  const doctorId = str(fd, "doctor_id");
  const date = str(fd, "date");
  const sessionKey = str(fd, "session_key");
  if (!doctorId || !date || !sessionKey) throw new Error("參數錯誤");
  const autoEvery = Math.max(0, intOr(fd, "auto_every", 0));

  const { error } = await supabase.from("serving_numbers").upsert(
    {
      clinic_id: CLINIC_ID,
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
  serviceId?: string;
}): Promise<void> {
  const svc = createServiceClient();
  let apptId: string | null = null;
  if (opts.mode === "time") {
    if (!opts.startAt) throw new Error("缺少時間");
    const { data, error } = await svc.rpc("book_time_slot", {
      p_clinic_id: CLINIC_ID,
      p_doctor_id: opts.doctorId,
      p_patient_id: opts.patientId,
      p_start_at: opts.startAt,
      p_visit_type: opts.visitType,
      p_is_self_pay: opts.isSelfPay,
    });
    if (error) throw new Error(error.message);
    apptId = data as string;
  } else {
    if (!opts.templateId || !opts.date) throw new Error("缺少診次或日期");
    const { data, error } = await svc.rpc("book_number", {
      p_clinic_id: CLINIC_ID,
      p_doctor_id: opts.doctorId,
      p_patient_id: opts.patientId,
      p_template_id: opts.templateId,
      p_date: opts.date,
      p_visit_type: opts.visitType,
      p_is_self_pay: opts.isSelfPay,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    apptId = (row?.appointment_id as string) ?? null;
  }
  // 後台建立 = 現場(offline);順帶記錄服務
  if (apptId) {
    const patch: Record<string, unknown> = { source: "offline" };
    if (opts.serviceId) patch.service_id = opts.serviceId;
    await svc.from("appointments").update(patch).eq("id", apptId);
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
    serviceId: str(fd, "service_id") || undefined,
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
      tags: str(fd, "tags") || null,
      birthday: str(fd, "birthday") || null,
      gender: str(fd, "gender") || null,
      email: str(fd, "email") || null,
      marketing_opt_in: bool(fd, "marketing_opt_in"),
    })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/patients/${id}`);
}

// ── 病況紀錄 patient_records(逐筆)──────────────────────────
export async function addPatientRecordAction(fd: FormData) {
  const { supabase } = await requireMember();
  const patientId = str(fd, "patient_id");
  const content = str(fd, "content");
  if (!patientId) throw new Error("缺少病患");
  if (!content) throw new Error("請填寫病況內容");
  const { error } = await supabase.from("patient_records").insert({
    clinic_id: CLINIC_ID,
    patient_id: patientId,
    content,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/patients/${patientId}`);
}

export async function deletePatientRecordAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const patientId = str(fd, "patient_id");
  if (!id) throw new Error("缺少紀錄");
  const { error } = await supabase
    .from("patient_records")
    .delete()
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/patients/${patientId}`);
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

// ── LINE 自動回覆規則 ─────────────────────────────────────
const REPLY_ACTIONS = ["text", "booking", "query", "progress", "message"] as const;
export async function createReplyAction(fd: FormData) {
  const { supabase } = await requireMember();
  const keywords = str(fd, "keywords");
  const action = str(fd, "action");
  if (!keywords) throw new Error("請填關鍵字");
  if (!REPLY_ACTIONS.includes(action as (typeof REPLY_ACTIONS)[number])) throw new Error("動作錯誤");
  const { error } = await supabase.from("line_auto_replies").insert({
    clinic_id: CLINIC_ID,
    keywords,
    action,
    reply_text: str(fd, "reply_text") || null,
    message_id: str(fd, "message_id") || null,
    sort: intOr(fd, "sort", 0),
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function updateReplyAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const keywords = str(fd, "keywords");
  const action = str(fd, "action");
  if (!id || !keywords) throw new Error("缺少必要欄位");
  if (!REPLY_ACTIONS.includes(action as (typeof REPLY_ACTIONS)[number])) throw new Error("動作錯誤");
  const { error } = await supabase
    .from("line_auto_replies")
    .update({
      keywords,
      action,
      reply_text: str(fd, "reply_text") || null,
      message_id: str(fd, "message_id") || null,
      sort: intOr(fd, "sort", 0),
    })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function toggleReplyAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("line_auto_replies")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function deleteReplyAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("line_auto_replies")
    .delete()
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function updateLineTextsAction(fd: FormData) {
  const { supabase } = await requireMember();
  const { error } = await supabase
    .from("clinic_settings")
    .update({
      line_welcome_text: str(fd, "line_welcome_text") || null,
      line_fallback_text: str(fd, "line_fallback_text") || null,
      line_menu_title: str(fd, "line_menu_title") || null,
      line_menu_btn_booking: bool(fd, "line_menu_btn_booking"),
      line_menu_btn_query: bool(fd, "line_menu_btn_query"),
      line_menu_btn_progress: bool(fd, "line_menu_btn_progress"),
      line_menu_btn_info: bool(fd, "line_menu_btn_info"),
      line_menu_link_label: str(fd, "line_menu_link_label") || null,
      line_menu_link_url: str(fd, "line_menu_link_url") || null,
    })
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

// ── LINE 訊息素材 line_messages ───────────────────────────
export async function saveMessageAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const name = str(fd, "name");
  const kind = str(fd, "kind");
  const dataRaw = str(fd, "data");
  if (!name) throw new Error("請填訊息名稱");
  if (!["text", "card", "carousel"].includes(kind)) throw new Error("類型錯誤");
  let data: unknown;
  try {
    data = JSON.parse(dataRaw || "{}");
  } catch {
    throw new Error("內容格式錯誤");
  }
  if (id) {
    const { error } = await supabase
      .from("line_messages")
      .update({ name, kind, data })
      .eq("id", id)
      .eq("clinic_id", CLINIC_ID);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("line_messages")
      .insert({ clinic_id: CLINIC_ID, name, kind, data });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/messages");
}

export async function deleteMessageAction(fd: FormData) {
  const { supabase } = await requireMember();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("line_messages")
    .delete()
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/messages");
}

// ── LINE 圖文選單 Rich Menu ───────────────────────────────
// 依 slots 建立新 rich menu、上傳圖、設為預設、刪舊。回傳新 id。
async function buildAndPublishRichMenu(opts: {
  layout: Layout;
  slots: Slot[];
  chatBarText: string;
  imageBytes: ArrayBuffer;
  contentType: string;
  oldId: string | null;
  baseUrl: string;
}): Promise<string> {
  const spec = LAYOUTS[opts.layout];
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const liffUrl = liffId ? `https://liff.line.me/${liffId}` : null;
  const bounds = slotBounds(opts.layout);
  const areas = bounds
    .map((b, i) => {
      const action = opts.slots[i] ? slotAction(opts.slots[i], liffUrl, opts.baseUrl) : null;
      return action ? { bounds: b, action } : null;
    })
    .filter(Boolean) as { bounds: (typeof bounds)[number]; action: Record<string, unknown> }[];
  if (areas.length === 0) throw new Error("請至少設定一個有動作的格子");
  const newId = await createRichMenu({
    size: { width: spec.width, height: spec.height },
    selected: true,
    name: `clinic-menu-${Date.now() % 100000}`,
    chatBarText: opts.chatBarText || "選單",
    areas,
  });
  try {
    await uploadRichMenuImage(newId, opts.imageBytes, opts.contentType);
    await setDefaultRichMenu(newId);
  } catch (e) {
    await deleteRichMenu(newId);
    throw e;
  }
  if (opts.oldId && opts.oldId !== newId) await deleteRichMenu(opts.oldId);
  return newId;
}

function reqBaseUrl(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export async function saveRichMenuAction(fd: FormData) {
  const { supabase } = await requireMember();
  const layout = str(fd, "layout") as Layout;
  if (!LAYOUTS[layout]) throw new Error("版型錯誤");
  const count = LAYOUTS[layout].slots;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      label: str(fd, `label_${i}`),
      action: (str(fd, `action_${i}`) || "none") as Slot["action"],
      value: str(fd, `value_${i}`) || undefined,
    });
  }
  const chatBarText = str(fd, "chat_bar_text") || "選單";
  const { error } = await supabase.from("line_richmenu").upsert(
    { clinic_id: CLINIC_ID, layout, chat_bar_text: chatBarText, slots, updated_at: new Date().toISOString() },
    { onConflict: "clinic_id" },
  );
  if (error) redirect(`/admin/richmenu?err=${encodeURIComponent(error.message.slice(0, 200))}`);

  // 若已發布過,用「現有背景圖」立即同步更新選單(動作/格數變更馬上生效,不必重傳圖)
  let syncErr: string | null = null;
  try {
    const { data: cfg } = await supabase
      .from("line_richmenu")
      .select("published_id")
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle();
    const oldId = (cfg?.published_id as string | null) ?? null;
    if (oldId) {
      const img = await getRichMenuImage(oldId);
      if (img) {
        const newId = await buildAndPublishRichMenu({
          layout,
          slots,
          chatBarText,
          imageBytes: img.bytes,
          contentType: img.contentType,
          oldId,
          baseUrl: reqBaseUrl(await headers()),
        });
        await supabase
          .from("line_richmenu")
          .update({ published_id: newId, updated_at: new Date().toISOString() })
          .eq("clinic_id", CLINIC_ID);
      }
    }
  } catch (e) {
    syncErr = e instanceof Error ? e.message : "更新選單失敗";
  }
  redirect(
    syncErr
      ? `/admin/richmenu?err=${encodeURIComponent(syncErr.slice(0, 200))}`
      : "/admin/richmenu?saved=1",
  );
}

export async function publishRichMenuAction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireMember();
  let errMsg: string | null = null;
  try {
    const { data: cfg } = await supabase
      .from("line_richmenu")
      .select("layout, chat_bar_text, slots, published_id")
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle();
    if (!cfg) throw new Error("請先按「儲存選單設定」再發布");

    const layout = cfg.layout as Layout;
    const spec = LAYOUTS[layout];
    if (!spec) throw new Error("版型錯誤");

    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) throw new Error("請選擇圖片");
    if (file.size > 1024 * 1024) throw new Error("圖片需小於 1MB");
    const contentType = file.type === "image/png" ? "image/png" : "image/jpeg";

    const newId = await buildAndPublishRichMenu({
      layout,
      slots: (cfg.slots as Slot[]) ?? [],
      chatBarText: (cfg.chat_bar_text as string) || "選單",
      imageBytes: await file.arrayBuffer(),
      contentType,
      oldId: (cfg.published_id as string | null) ?? null,
      baseUrl: reqBaseUrl(await headers()),
    });

    await supabase
      .from("line_richmenu")
      .update({ published_id: newId, updated_at: new Date().toISOString() })
      .eq("clinic_id", CLINIC_ID);
  } catch (e) {
    errMsg = e instanceof Error ? e.message : "發布失敗";
  }
  revalidatePath("/admin/richmenu");
  // 回傳結果(此 action 由 client 端程式呼叫,不能用 redirect,否則會丟出 NEXT_REDIRECT)
  return errMsg ? { ok: false, error: errMsg } : { ok: true };
}

export async function unpublishRichMenuAction() {
  const { supabase } = await requireMember();
  const { data: cfg } = await supabase
    .from("line_richmenu")
    .select("published_id")
    .eq("clinic_id", CLINIC_ID)
    .maybeSingle();
  await clearDefaultRichMenu();
  const id = cfg?.published_id as string | null;
  if (id) await deleteRichMenu(id);
  await supabase.from("line_richmenu").update({ published_id: null }).eq("clinic_id", CLINIC_ID);
  revalidatePath("/admin/richmenu");
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
