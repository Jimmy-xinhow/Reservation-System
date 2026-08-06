"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_CLINIC_COOKIE, requireMember, requireAdmin, requireOperator, requireStatusOperator, type Role } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pushMessages,
  lineAccessTokenForDestination,
  createRichMenu,
  uploadRichMenuImage,
  setDefaultRichMenu,
  deleteRichMenu,
  clearDefaultRichMenu,
  getRichMenuImage,
} from "@/lib/line";
import { LAYOUTS, slotBounds, slotAction, type Layout, type Slot } from "@/lib/richmenu";
import { getQueueForDate } from "@/lib/queue";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";
import { headers, cookies } from "next/headers";

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
type ServiceBookingField = { key: string; label: string; type: "text" | "textarea" | "date" | "select" | "checkbox"; required: boolean; options: string[] };
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
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !label || !["text", "textarea", "date", "select", "checkbox"].includes(String(type))) throw new Error("預約表單欄位設定錯誤");
    const options = Array.isArray(row.options) ? row.options.filter((option): option is string => typeof option === "string").map((option) => option.trim()).filter(Boolean).slice(0, 30) : [];
    if (type === "select" && options.length === 0) throw new Error(`${label}需要至少一個選項`);
    return { key, label, type: type as ServiceBookingField["type"], required: row.required === true, options };
  });
}
export async function setActiveClinicAction(fd: FormData): Promise<void> {
  const context = await requireMember();
  const clinicId = str(fd, "clinic_id");
  if (!context.clinics.some((clinic) => clinic.id === clinicId)) throw new Error("無權限切換此品牌");
  const store = await cookies();
  store.set(ACTIVE_CLINIC_COOKIE, clinicId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/admin");
}

/** 建立新品牌並將目前登入帳號設為該品牌 owner；實際交易由 DB function 原子完成。 */
export async function createBrandAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const name = str(fd, "name");
  const slug = str(fd, "slug").toLowerCase();
  const phone = str(fd, "phone");
  const address = str(fd, "address");
  if (!name || name.length > 120) throw new Error("品牌名稱必須為 1–120 字");
  if (!/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) throw new Error("品牌短網址只能使用英數字與連字號");
  if (phone.length > 80 || address.length > 240) throw new Error("品牌公開資訊過長");

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("create_brand_with_owner", {
    p_actor_user_id: member.user.id,
    p_source_clinic_id: member.clinicId,
    p_name: name,
    p_slug: slug,
    p_phone: phone || null,
    p_address: address || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("品牌短網址已存在");
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { clinic_id?: unknown } | null;
  if (!row || typeof row.clinic_id !== "string") throw new Error("品牌建立失敗");

  const store = await cookies();
  store.set(ACTIVE_CLINIC_COOKIE, row.clinic_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?brand_created=1");
}

// ── 使用者(後台帳號)管理 ─────────────────────────────────
// 角色:admin=管理員(可管理使用者與 LINE 設定)、staff=櫃檯(日常預約作業)。
export interface StaffMember {
  userId: string;
  email: string;
  role: Role;
  isSelf: boolean;
  createdAt: string | null;
  assignedDoctors: Array<{ id: string; name: string }>;
}

/** 本診所目前的管理員人數(用於防止把最後一位管理員降級/移除)。 */
async function adminCount(svc: SupabaseClient, clinicId: string): Promise<number> {
  const { count } = await svc
    .from("clinic_members")
    .select("user_id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .in("role", ["owner", "admin"]);
  return count ?? 0;
}

/** 列出本診所的後台帳號(僅管理員可用)。 */
export async function listStaff(): Promise<StaffMember[]> {
  const { user, clinicId } = await requireAdmin();
  const svc = createServiceClient();
  const { data: members } = await svc
    .from("clinic_members")
    .select("user_id, role, created_at")
    .eq("clinic_id", clinicId);
  const rows = members ?? [];
  if (rows.length === 0) return [];

  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailMap = new Map((list?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const [{ data: doctors }, { data: assignments }] = await Promise.all([
    svc.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    svc.from("doctor_assignments").select("user_id, doctor_id").eq("clinic_id", clinicId).eq("active", true),
  ]);
  const doctorNames = new Map((doctors ?? []).map((doctor) => [doctor.id as string, doctor.name as string]));
  const assignedByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const assignment of assignments ?? []) {
    const doctorId = assignment.doctor_id as string;
    const name = doctorNames.get(doctorId);
    if (!name) continue;
    const current = assignedByUser.get(assignment.user_id as string) ?? [];
    current.push({ id: doctorId, name });
    assignedByUser.set(assignment.user_id as string, current);
  }
  return rows.map((m) => ({
    userId: m.user_id as string,
    email: emailMap.get(m.user_id as string) ?? "(未知)",
    role: (m.role === "owner" || m.role === "admin" || m.role === "frontdesk" || m.role === "provider" || m.role === "staff" ? m.role : "staff") as Role,
    isSelf: m.user_id === user.id,
    createdAt: (m.created_at as string) ?? null,
    assignedDoctors: assignedByUser.get(m.user_id as string) ?? [],
  }));
}

export async function listClinicDoctors(): Promise<Array<{ id: string; name: string }>> {
  const { clinicId } = await requireAdmin();
  const svc = createServiceClient();
  const { data, error } = await svc.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

export async function createStaffAction(fd: FormData) {
  const { clinicId } = await requireAdmin();
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  const submittedRole = str(fd, "role");
  const role: Role = ["admin", "frontdesk", "provider", "staff"].includes(submittedRole) ? submittedRole as Role : "staff";
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
    .upsert({ clinic_id: clinicId, user_id: userId, role }, { onConflict: "clinic_id,user_id" });
  if (mErr) throw new Error(mErr.message);
  revalidatePath("/admin/users");
}

export async function setStaffRoleAction(fd: FormData) {
  const { clinicId } = await requireAdmin();
  const userId = str(fd, "user_id");
  const submittedRole = str(fd, "role");
  const role: Role = ["admin", "frontdesk", "provider", "staff"].includes(submittedRole) ? submittedRole as Role : "staff";
  if (!userId) throw new Error("缺少帳號");
  const svc = createServiceClient();
  // 防止把最後一位管理員降級(含自己)→ 診所將無人能管理
  const { data: currentTarget } = await svc
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (currentTarget?.role === "owner") throw new Error("品牌擁有者角色不可變更");
  if (role !== "admin" && role !== "owner") {
    const { data: target } = await svc
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    if (target?.role === "admin" && (await adminCount(svc, clinicId)) <= 1)
      throw new Error("至少要保留一位管理員");
  }
  const { error } = await svc
    .from("clinic_members")
    .update({ role })
    .eq("clinic_id", clinicId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}

export async function setDoctorAssignmentsAction(fd: FormData) {
  const { clinicId } = await requireAdmin();
  const userId = str(fd, "user_id");
  if (!userId) throw new Error("缺少帳號");
  const selectedDoctorIds = [...new Set(fd.getAll("doctor_ids").map((value) => value.toString()).filter(Boolean))];
  const svc = createServiceClient();
  const { data: target } = await svc
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (target?.role !== "provider") throw new Error("只有服務提供者可設定人員指派");
  const { data: doctors, error: doctorError } = await svc
    .from("doctors")
    .select("id")
    .eq("clinic_id", clinicId)
    .in("id", selectedDoctorIds.length > 0 ? selectedDoctorIds : ["00000000-0000-0000-0000-000000000000"]);
  if (doctorError) throw new Error(doctorError.message);
  const allowedIds = new Set((doctors ?? []).map((doctor) => doctor.id as string));
  const validIds = selectedDoctorIds.filter((id) => allowedIds.has(id));
  const { error: clearError } = await svc
    .from("doctor_assignments")
    .update({ active: false })
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("active", true);
  if (clearError) throw new Error(clearError.message);
  if (validIds.length > 0) {
    const { error: upsertError } = await svc.from("doctor_assignments").upsert(
      validIds.map((doctorId) => ({ clinic_id: clinicId, doctor_id: doctorId, user_id: userId, active: true })),
      { onConflict: "clinic_id,doctor_id,user_id" },
    );
    if (upsertError) throw new Error(upsertError.message);
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/queue");
}

export async function removeStaffAction(fd: FormData) {
  const { user, clinicId } = await requireAdmin();
  const userId = str(fd, "user_id");
  if (!userId) throw new Error("缺少帳號");
  if (userId === user.id) throw new Error("無法移除自己");
  const svc = createServiceClient();
  // 防止移除最後一位管理員
  const { data: target } = await svc
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (target?.role === "owner") throw new Error("品牌擁有者不可移除");
  if (target?.role === "admin" && (await adminCount(svc, clinicId)) <= 1)
    throw new Error("至少要保留一位管理員");
  // 僅移除本診所權限(不刪除 auth 帳號)
  const { error } = await svc
    .from("clinic_members")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}

export async function resetStaffPasswordAction(fd: FormData) {
  const { clinicId } = await requireAdmin();
  const userId = str(fd, "user_id");
  const password = str(fd, "password");
  if (!userId) throw new Error("缺少帳號");
  if (password.length < 8) throw new Error("密碼至少 8 碼");
  const svc = createServiceClient();
  const { data: target, error: targetError } = await svc
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (targetError) throw new Error(targetError.message);
  if (!target) throw new Error("找不到目標成員或無權限操作");
  if (target.role === "owner") throw new Error("不可重設 owner 密碼");
  const { error } = await svc.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}

// ── LINE 測試推播 ─────────────────────────────────────────
export async function sendTestPushAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const to = str(fd, "line_user_id");
  if (!to) redirect("/admin/line?test=err&reason=" + encodeURIComponent("請填 line_user_id"));

  let reason: string | null = null;
  try {
    const { data: clinic, error } = await supabase
      .from("clinics")
      .select("line_destination")
      .eq("id", clinicId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const token = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
    await pushMessages(to, [{ type: "text", text: "【品牌】測試推播 ✅ 連線正常。" }], token);
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

// 手動加入/解除黑名單(停權 1 個月 / 清除)
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

// ── 服務排程 schedule_templates ────────────────────────────
export async function createTemplateAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("schedule_templates")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error("此服務時段已有預約,無法刪除,請改為停用。");
  revalidatePath("/admin/schedules");
}

// ── 休診 / 加診 schedule_exceptions ───────────────────────
export async function createExceptionAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
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

// ── 看診服務 services ─────────────────────────────────────
export async function createServiceAction(fd: FormData) {
  const { supabase, clinicId } = await requireOperator();
  const name = str(fd, "name");
  if (!name) throw new Error("請填服務名稱");
  const { error } = await supabase.from("services").insert({
    clinic_id: clinicId,
    name,
    category: str(fd, "category") || null,
    description: str(fd, "description") || null,
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
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!id || !name) throw new Error("缺少服務或名稱");
  const { error } = await supabase
    .from("services")
    .update({
      name,
      category: str(fd, "category") || null,
      description: str(fd, "description") || null,
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
  const { supabase, clinicId } = await requireOperator();
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
  const { supabase, clinicId } = await requireOperator();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error("此服務已有預約使用,無法刪除,請改為停用。");
  revalidatePath("/admin/services");
}

// ── LINE 自動回覆規則 ─────────────────────────────────────
const REPLY_ACTIONS = ["text", "booking", "query", "progress", "message"] as const;
export async function createReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const keywords = str(fd, "keywords");
  const action = str(fd, "action");
  if (!keywords) throw new Error("請填關鍵字");
  if (!REPLY_ACTIONS.includes(action as (typeof REPLY_ACTIONS)[number])) throw new Error("動作錯誤");
  const { error } = await supabase.from("line_auto_replies").insert({
    clinic_id: clinicId,
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
  const { supabase, clinicId } = await requireAdmin();
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
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function toggleReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("line_auto_replies")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function deleteReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("line_auto_replies")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function updateLineTextsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
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
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

// ── LINE 訊息素材 line_messages ───────────────────────────
export async function saveMessageAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
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
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("line_messages")
      .insert({ clinic_id: clinicId, name, kind, data });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/messages");
}

export async function deleteMessageAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("line_messages")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
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
  accessToken: string;
  clinicSlug: string | null;
}): Promise<string> {
  const spec = LAYOUTS[opts.layout];
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const liffUrl = liffId
    ? `https://liff.line.me/${liffId}${opts.clinicSlug ? `?clinic_slug=${encodeURIComponent(opts.clinicSlug)}` : ""}`
    : null;
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
  }, opts.accessToken);
  try {
    await uploadRichMenuImage(newId, opts.imageBytes, opts.contentType, opts.accessToken);
    await setDefaultRichMenu(newId, opts.accessToken);
  } catch (e) {
    await deleteRichMenu(newId, opts.accessToken);
    throw e;
  }
  if (opts.oldId && opts.oldId !== newId) await deleteRichMenu(opts.oldId, opts.accessToken);
  return newId;
}

async function getClinicLineContext(supabase: SupabaseClient, clinicId: string): Promise<{ accessToken: string; clinicSlug: string | null }> {
  const { data: clinic, error } = await supabase
    .from("clinics")
    .select("line_destination, slug")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    accessToken: lineAccessTokenForDestination(clinic?.line_destination as string | undefined),
    clinicSlug: (clinic?.slug as string | null) ?? null,
  };
}

function reqBaseUrl(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export async function saveRichMenuAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
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
    { clinic_id: clinicId, layout, chat_bar_text: chatBarText, slots, updated_at: new Date().toISOString() },
    { onConflict: "clinic_id" },
  );
  if (error) redirect(`/admin/richmenu?err=${encodeURIComponent(error.message.slice(0, 200))}`);

  // 若已發布過,用「現有背景圖」立即同步更新選單(動作/格數變更馬上生效,不必重傳圖)
  let syncErr: string | null = null;
  try {
    const { data: cfg } = await supabase
      .from("line_richmenu")
      .select("published_id")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    const oldId = (cfg?.published_id as string | null) ?? null;
    if (oldId) {
      const context = await getClinicLineContext(supabase, clinicId);
      const img = await getRichMenuImage(oldId, context.accessToken);
      if (img) {
        const newId = await buildAndPublishRichMenu({
          layout,
          slots,
          chatBarText,
          imageBytes: img.bytes,
          contentType: img.contentType,
          oldId,
          baseUrl: reqBaseUrl(await headers()),
          accessToken: context.accessToken,
          clinicSlug: context.clinicSlug,
        });
        await supabase
          .from("line_richmenu")
          .update({ published_id: newId, updated_at: new Date().toISOString() })
          .eq("clinic_id", clinicId);
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
  const { supabase, clinicId } = await requireAdmin();
  let errMsg: string | null = null;
  try {
    const { data: cfg } = await supabase
      .from("line_richmenu")
      .select("layout, chat_bar_text, slots, published_id")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!cfg) throw new Error("請先按「儲存選單設定」再發布");

    const layout = cfg.layout as Layout;
    const spec = LAYOUTS[layout];
    if (!spec) throw new Error("版型錯誤");

    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) throw new Error("請選擇圖片");
    if (file.size > 1024 * 1024) throw new Error("圖片需小於 1MB");
    const contentType = file.type === "image/png" ? "image/png" : "image/jpeg";

    const context = await getClinicLineContext(supabase, clinicId);
    const newId = await buildAndPublishRichMenu({
      layout,
      slots: (cfg.slots as Slot[]) ?? [],
      chatBarText: (cfg.chat_bar_text as string) || "選單",
      imageBytes: await file.arrayBuffer(),
      contentType,
      oldId: (cfg.published_id as string | null) ?? null,
      baseUrl: reqBaseUrl(await headers()),
      accessToken: context.accessToken,
      clinicSlug: context.clinicSlug,
    });

    await supabase
      .from("line_richmenu")
      .update({ published_id: newId, updated_at: new Date().toISOString() })
      .eq("clinic_id", clinicId);
  } catch (e) {
    errMsg = e instanceof Error ? e.message : "發布失敗";
  }
  revalidatePath("/admin/richmenu");
  // 回傳結果(此 action 由 client 端程式呼叫,不能用 redirect,否則會丟出 NEXT_REDIRECT)
  return errMsg ? { ok: false, error: errMsg } : { ok: true };
}

export async function unpublishRichMenuAction() {
  const { supabase, clinicId } = await requireAdmin();
  const { data: cfg } = await supabase
    .from("line_richmenu")
    .select("published_id")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const context = await getClinicLineContext(supabase, clinicId);
  await clearDefaultRichMenu(context.accessToken);
  const id = cfg?.published_id as string | null;
  if (id) await deleteRichMenu(id, context.accessToken);
  await supabase.from("line_richmenu").update({ published_id: null }).eq("clinic_id", clinicId);
  revalidatePath("/admin/richmenu");
}

// ── Email 提醒設定(只在 clinic_settings 保存啟用狀態；金鑰與寄件人由 server environment 管理)──────
export async function updateEmailSettingsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const patch: Record<string, unknown> = {
    email_enabled: bool(fd, "email_enabled"),
  };
  // Email 機密不由後台表單寫入資料庫，僅更新品牌的啟用狀態。
  const { error } = await supabase.from("clinic_settings").update(patch).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

// ── 標準金流設定(僅管理員;密鑰不回填到前端)────────────────
export async function updatePaymentSettingsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const provider = str(fd, "provider");
  if (provider !== "ecpay" && provider !== "newebpay") throw new Error("金流商錯誤");
  const environment = str(fd, "environment") === "production" ? "production" : "test";
  const merchantId = str(fd, "merchant_id");
  if (!merchantId) throw new Error("請填寫 Merchant ID");

  const { error } = await supabase.from("clinic_payment_settings").upsert(
    {
      clinic_id: clinicId,
      provider,
      merchant_id: merchantId,
      environment,
      active: bool(fd, "active"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

export async function addClinicDomainAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const hostname = str(fd, "hostname").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (!hostname || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) throw new Error("請填寫正確網域名稱");
  const verificationToken = `booking-domain-${randomBytes(12).toString("hex")}`;
  const { error } = await supabase.from("clinic_domains").insert({ clinic_id: clinicId, hostname, kind: "custom", verification_token: verificationToken, active: false });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

export async function verifyClinicDomainAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { data: domain } = await supabase.from("clinic_domains").select("id, hostname, verification_token").eq("id", id).eq("clinic_id", clinicId).maybeSingle();
  if (!domain?.verification_token) throw new Error("找不到待驗證網域");
  let records: string[][] = [];
  try { records = await resolveTxt(`_booking-verification.${domain.hostname}`); } catch { throw new Error("尚未查到 DNS TXT 驗證紀錄"); }
  if (!records.flat().includes(domain.verification_token)) throw new Error("DNS TXT 驗證值不一致");
  const { error } = await supabase.from("clinic_domains").update({ verified_at: new Date().toISOString(), active: true }).eq("id", id).eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}

// ── 診所公開資訊 clinics(名稱、LINE ID、電話、地址、簡介)──────
export async function updateClinicProfileAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const name = str(fd, "name");
  if (!name) throw new Error("請填品牌名稱");
  let lineId = str(fd, "line_basic_id");
  if (lineId && !lineId.startsWith("@")) lineId = "@" + lineId; // 自動補 @
  const lineDestination = str(fd, "line_destination");
  const slug = str(fd, "slug").toLowerCase();
  if (slug && !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) throw new Error("品牌短網址只能使用英數字與連字號");
  const { error } = await supabase
    .from("clinics")
    .update({
      name,
      slug: slug || null,
      line_basic_id: lineId || null,
      line_destination: lineDestination || null,
      phone: str(fd, "phone") || null,
      address: str(fd, "address") || null,
      intro: str(fd, "intro") || null,
    })
    .eq("id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
  revalidatePath("/");
}

// ── 診所設定 clinic_settings ──────────────────────────────
export async function updateSettingsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
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
      cancel_lead_minutes: Math.max(0, intOr(fd, "cancel_lead_minutes", 120)),
      reschedule_lead_minutes: Math.max(0, intOr(fd, "reschedule_lead_minutes", 120)),
      public_booking_enabled: bool(fd, "public_booking_enabled"),
      public_registration_enabled: bool(fd, "public_registration_enabled"),
    })
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/settings");
}
