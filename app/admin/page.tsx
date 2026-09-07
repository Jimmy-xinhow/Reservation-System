import { createServiceClient } from "@/lib/supabase";
import { canOperate, canViewSensitiveCustomerData, getAssignedDoctorIds, getOptionalMember } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";
import { redirect } from "next/navigation";
import { formatTime } from "@/lib/slots";
import {
  setStatusAction,
  cancelAppointmentAction,
  setDepositAction,
  cancelAppointmentWaitlistAction,
} from "./appointment-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { AppointmentDateToolbar } from "./_components/AppointmentDateToolbar";
import AppointmentEditor from "./appointments/AppointmentEditor";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  start_at: string;
  doctor_id: string | null;
  service_id: string | null;
  queue_number: number | null;
  visit_type: string;
  status: string;
  deposit_status: string;
  deposit_amount: number;
  doctors: { name: string } | null;
  patients: { name: string; phone: string } | null;
  services: { name: string } | null;
}

interface WaitlistRow {
  id: string;
  appointment_id: string | null;
  requested_date: string;
  requested_start_at: string | null;
  position: number;
  status: "waiting" | "offered";
  offer_expires_at: string | null;
  doctors: { name: string } | null;
  patients: { name: string; phone: string } | null;
  services: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  cancelled: "已取消",
  done: "完成",
  no_show: "未到",
};

const STATUS_STYLE: Record<string, string> = {
  booked: "bg-brand-50 text-brand-700",
  confirmed: "bg-brand-50 text-brand-700",
  done: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-600",
  no_show: "bg-amber-50 text-amber-700",
};

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function maskPhone(phone: string | undefined): string {
  if (!phone) return "";
  return phone.length <= 4 ? "••••" : `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ doctor?: string; status?: string; date?: string; modal?: string; appointment_id?: string }>;
}) {
  const [sp, member, platformAdmin] = await Promise.all([searchParams, getOptionalMember(), getOptionalPlatformAdmin()]);
  const fDoctor = sp.doctor ?? "";
  const fStatus = sp.status ?? "";

  if (!member && platformAdmin) redirect("/admin/platform");
  if (!member) redirect("/admin/login?reason=no-access");
  const { clinicId, role } = member;
  const providerOnly = role === "provider";
  const supabase = member.supabase;
  const assignedDoctorIds = providerOnly ? await getAssignedDoctorIds(member) : [];
  const settingsClient = providerOnly ? createServiceClient() : supabase;
  const today = taipeiToday();
  const viewDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const dayStart = new Date(`${viewDate}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${viewDate}T23:59:59.999+08:00`).toISOString();

  let apptQuery = supabase
    .from("appointments")
    .select(
      "id, start_at, queue_number, visit_type, status, deposit_status, deposit_amount, doctor_id, service_id, doctors(name), patients(name, phone), services(name)",
    )
    .eq("clinic_id", clinicId)
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd);
  if (fDoctor) apptQuery = apptQuery.eq("doctor_id", fDoctor);
  if (fStatus) apptQuery = apptQuery.eq("status", fStatus);
  if (providerOnly) {
    apptQuery = apptQuery.in(
      "doctor_id",
      assignedDoctorIds.length > 0 ? assignedDoctorIds : ["00000000-0000-0000-0000-000000000000"],
    );
  }

  const [{ data: settings }, { data: doctors }, { data: appts }, { data: waitlistData }] = await Promise.all([
    settingsClient.from("clinic_settings").select("booking_mode").eq("clinic_id", clinicId).maybeSingle(),
    (() => {
      let query = supabase.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true);
      if (providerOnly) query = query.in("id", assignedDoctorIds.length > 0 ? assignedDoctorIds : ["00000000-0000-0000-0000-000000000000"]);
      return query.order("name");
    })(),
    apptQuery.order("start_at").order("queue_number", { nullsFirst: true }),
    providerOnly
      ? Promise.resolve({ data: [] })
      : supabase
          .from("appointment_waitlist_entries")
          .select("id, appointment_id, requested_date, requested_start_at, position, status, offer_expires_at, doctors(name), patients(name, phone), services(name)")
          .eq("clinic_id", clinicId)
          .eq("requested_date", viewDate)
          .in("status", ["waiting", "offered"])
          .order("position"),
  ]);

  // 注意:settings 為 null 代表「讀不到設定」(權限/RLS/未建),不要靜默當成 time 制掩蓋,
  // 以 settingsUnavailable 明確提示;mode 僅用於排版,真正的狀態以警示呈現。
  const settingsUnavailable = !settings;
  const mode = (settings?.booking_mode as "time" | "number") ?? "time";
  const waitlistRows = (waitlistData ?? []) as unknown as WaitlistRow[];
  const offeredAppointmentIds = new Set(waitlistRows.filter((item) => item.status === "offered" && item.appointment_id).map((item) => item.appointment_id));
  const rows = ((appts ?? []) as unknown as Row[]).filter((item) => !offeredAppointmentIds.has(item.id));
  // 切換日期時保留服務提供者/狀態篩選
  const dayLink = (d: string) => {
    const u = new URLSearchParams();
    u.set("date", d);
    if (fDoctor) u.set("doctor", fDoctor);
    if (fStatus) u.set("status", fStatus);
    return `/admin?${u.toString()}`;
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">預約營運</p>
          <h1 className="admin-page-title">
            預約列表 · {viewDate}
            {viewDate === today && <span className="ml-2 text-sm font-normal text-accent-600">今天</span>}
          </h1>
          <p className="admin-page-description">集中查看當日預約；新增、改期與結帳會開啟獨立視窗，完成後仍留在原本列表。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-brand-50 text-brand-700">
            {settingsUnavailable ? "讀不到設定" : mode === "time" ? "時間制" : "號次制"}
          </span>
          {canOperate(role) && <a href={`${dayLink(viewDate)}&modal=new`} className="btn btn-primary"><span aria-hidden="true">＋</span>新增預約</a>}
        </div>
      </div>

      <AppointmentDateToolbar initialDate={viewDate} initialDoctor={fDoctor} initialStatus={fStatus} doctors={doctors ?? []} count={rows.length} />

      {settingsUnavailable && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          讀不到此品牌設定(clinic_settings)。請確認登入帳號已對應到本品牌(clinic_members),
          否則畫面模式與部分功能會不正確。
        </p>
      )}

      {!providerOnly && waitlistRows.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="font-semibold text-slate-900">本日預約候補</h2><p className="mt-1 text-xs text-slate-500">取消有效預約後會依順位原子保留名額；保留期限與通知狀態可追蹤。</p></div>
            <span className="badge bg-amber-50 text-amber-800">{waitlistRows.length} 筆</span>
          </div>
          <div className="divide-y divide-slate-100">
            {waitlistRows.map((item) => <article key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium text-slate-900">{item.requested_start_at ? formatTime(item.requested_start_at) : "場次候補"} · {item.services?.name ?? item.doctors?.name ?? "預約"}</div><div className="mt-1 text-xs text-slate-500">{item.patients?.name ?? "未命名顧客"} · {canViewSensitiveCustomerData(role) ? item.patients?.phone : maskPhone(item.patients?.phone)} · 順位 {item.position}</div>{item.status === "offered" && <p className="mt-1 text-xs text-amber-700">名額保留至 {item.offer_expires_at ? `${formatTime(item.offer_expires_at)}` : "通知期限"}</p>}</div><div className="flex items-center gap-2"><span className={`badge ${item.status === "offered" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{item.status === "offered" ? "待顧客接受" : "候補中"}</span><form action={cancelAppointmentWaitlistAction}><input type="hidden" name="id" value={item.id} /><SubmitButton className="btn btn-secondary min-h-11 px-3 text-xs">取消候補</SubmitButton></form></div></article>)}
          </div>
        </section>
      )}

      <div className="admin-table-shell admin-table-mobile-cards">
        <table className="tbl">
          <thead>
            <tr>
              <th>{mode === "time" ? "時間" : "號次"}</th>
              <th>服務提供者</th>
              <th>顧客</th>
              <th>服務</th>
              <th>初/複</th>
              <th>狀態</th>
              <th>訂金</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-400" data-mobile-empty="true">
                  本日尚無預約
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold text-slate-900" data-label={mode === "time" ? "時間" : "號次"}>
                  {mode === "time" ? formatTime(r.start_at) : `第 ${r.queue_number} 號`}
                </td>
                <td data-label="服務提供者">{r.doctors?.name}</td>
                <td data-label="顧客">
                  <div className="font-medium text-slate-800">{r.patients?.name}</div>
                  <div className="text-xs text-slate-400">
                    {canViewSensitiveCustomerData(role) ? r.patients?.phone : maskPhone(r.patients?.phone)}
                  </div>
                </td>
                <td data-label="服務">
                  {r.services?.name ? (
                    <span className="badge bg-slate-100 text-slate-600">{r.services.name}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td data-label="服務類型">
                  {r.visit_type === "first" ? (
                    <span className="badge bg-accent-500/10 text-accent-600">首次服務</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-600">再次服務</span>
                  )}
                </td>
                <td data-label="狀態">
                  <span className={`badge ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[r.status] ?? "其他狀態"}
                  </span>
                </td>
                <td data-label="訂金">
                  {r.deposit_status === "none" ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <form action={setDepositAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={r.id} />
                      <select
                        name="deposit_status"
                        defaultValue={r.deposit_status}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="pending">待繳</option>
                        <option value="paid">已繳</option>
                        <option value="waived">免收</option>
                        <option value="refunded">已退</option>
                      </select>
                      <SubmitButton className="admin-inline-action text-brand-700">更新訂金</SubmitButton>
                      <span className="text-xs text-slate-400">${r.deposit_amount}</span>
                    </form>
                  )}
                </td>
                <td data-label="操作">
                  <div className="flex flex-wrap gap-1.5">
                    {!providerOnly && ["booked", "confirmed", "done"].includes(r.status) && <a href={`/admin/checkout?modal=new-sale&appointment_id=${r.id}`} className="admin-inline-action admin-inline-action-primary">完成／結帳</a>}
                    {!providerOnly && ["booked", "confirmed"].includes(r.status) && <a href={`${dayLink(viewDate)}&modal=reschedule&appointment_id=${r.id}`} className="admin-inline-action">改期</a>}
                  {r.status !== "cancelled" && r.status !== "done" && (
                    <>
                      {r.status === "booked" && <StatusBtn id={r.id} status="confirmed" label="確認" />}
                      <StatusBtn id={r.id} status="done" label="完成" />
                      <StatusBtn id={r.id} status="no_show" label="未到" />
                      <form action={cancelAppointmentAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                          取消
                        </SubmitButton>
                      </form>
                    </>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(sp.modal === "new" || (sp.modal === "reschedule" && sp.appointment_id)) && <AppointmentEditor appointmentId={sp.modal === "reschedule" ? sp.appointment_id : undefined} date={viewDate} returnTo={dayLink(viewDate)} variant="modal" />}
    </div>
  );
}

function StatusBtn({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
        {label}
      </SubmitButton>
    </form>
  );
}
