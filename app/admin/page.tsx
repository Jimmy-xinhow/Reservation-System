import { createSupabaseServer } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase";
import { canOperate, canViewSensitiveCustomerData, getAssignedDoctorIds, getOptionalMember, hasBrandPermission } from "@/lib/admin";
import { getOptionalPlatformAdmin } from "@/lib/platform";
import { redirect } from "next/navigation";
import { formatTime } from "@/lib/slots";
import BookingForm from "./_components/BookingForm";
import {
  setStatusAction,
  cancelAppointmentAction,
  setDepositAction,
  createAppointmentAction,
  rescheduleAppointmentAction,
  cancelAppointmentWaitlistAction,
} from "./appointment-actions";
import { SubmitButton } from "@/components/SubmitButton";

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

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

function maskPhone(phone: string | undefined): string {
  if (!phone) return "";
  return phone.length <= 4 ? "••••" : `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ doctor?: string; status?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const fDoctor = sp.doctor ?? "";
  const fStatus = sp.status ?? "";

  const [member, platformAdmin] = await Promise.all([getOptionalMember(), getOptionalPlatformAdmin()]);
  if (!member && platformAdmin) redirect("/admin/platform");
  if (!member) redirect("/admin/login?reason=no-access");
  const { clinicId, role } = member;
  const canManageBrand = hasBrandPermission(member, "brand.manage");
  const supabase = await createSupabaseServer();
  const assignedDoctorIds = await getAssignedDoctorIds(member);
  const providerOnly = role === "provider";
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

  const [{ data: settings }, { data: doctors }, { data: appts }, { data: services }, { data: waitlistData }, { data: clinic }] = await Promise.all([
    settingsClient.from("clinic_settings").select("booking_mode").eq("clinic_id", clinicId).maybeSingle(),
    (() => {
      let query = supabase.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true);
      if (providerOnly) query = query.in("id", assignedDoctorIds.length > 0 ? assignedDoctorIds : ["00000000-0000-0000-0000-000000000000"]);
      return query.order("name");
    })(),
    apptQuery.order("start_at").order("queue_number", { nullsFirst: true }),
    supabase.from("services").select("id, name, booking_target, booking_fields").eq("clinic_id", clinicId).eq("active", true).order("created_at"),
    providerOnly
      ? Promise.resolve({ data: [] })
      : supabase
          .from("appointment_waitlist_entries")
          .select("id, appointment_id, requested_date, requested_start_at, position, status, offer_expires_at, doctors(name), patients(name, phone), services(name)")
          .eq("clinic_id", clinicId)
          .eq("requested_date", viewDate)
          .in("status", ["waiting", "offered"])
          .order("position"),
    // 後台空檔查詢需要明確的品牌 slug；用 server-only client 讀取目前已驗證成員的品牌，避免受 RLS 讀取範圍影響而漏傳租戶識別。
    createServiceClient().from("clinics").select("slug").eq("id", clinicId).maybeSingle(),
  ]);

  // 注意:settings 為 null 代表「讀不到設定」(權限/RLS/未建),不要靜默當成 time 制掩蓋,
  // 以 settingsUnavailable 明確提示;mode 僅用於排版,真正的狀態以警示呈現。
  const settingsUnavailable = !settings;
  const mode = (settings?.booking_mode as "time" | "number") ?? "time";
  const waitlistRows = (waitlistData ?? []) as unknown as WaitlistRow[];
  const offeredAppointmentIds = new Set(waitlistRows.filter((item) => item.status === "offered" && item.appointment_id).map((item) => item.appointment_id));
  const rows = ((appts ?? []) as unknown as Row[]).filter((item) => !offeredAppointmentIds.has(item.id));
  const rescheduleOptions = rows
    .filter((r) => r.status === "booked" || r.status === "confirmed")
    .map((r) => ({
      id: r.id,
      doctor_id: r.doctor_id,
      service_id: r.service_id,
      label: `${r.patients?.name ?? ""} ${mode === "time" ? formatTime(r.start_at) : `第${r.queue_number}號`}`,
    }));

  // 切換日期時保留服務提供者/狀態篩選
  const dayLink = (d: string) => {
    const u = new URLSearchParams();
    u.set("date", d);
    if (fDoctor) u.set("doctor", fDoctor);
    if (fStatus) u.set("status", fStatus);
    return `/admin?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            預約列表 · {viewDate}
            {viewDate === today && <span className="ml-2 text-sm font-normal text-accent-600">今天</span>}
          </h1>
        </div>
        <span className="badge bg-brand-50 text-brand-700">
          {settingsUnavailable ? "讀不到設定" : mode === "time" ? "時間制" : "號次制"}
        </span>
      </div>

      {/* 日期切換 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a href={dayLink(shiftDate(viewDate, -1))} className="btn btn-secondary px-3 py-1.5">
          ← 前一天
        </a>
        <a href={dayLink(today)} className="btn btn-ghost px-3 py-1.5">
          今天
        </a>
        <a href={dayLink(shiftDate(viewDate, 1))} className="btn btn-secondary px-3 py-1.5">
          後一天 →
        </a>
      </div>

      {settingsUnavailable && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          讀不到此品牌設定(clinic_settings)。請確認登入帳號已對應到本品牌(clinic_members),
          否則畫面模式與部分功能會不正確。
        </p>
      )}

      {!canOperate(role) ? (
        <div className="card space-y-2 p-5">
          <p className="text-sm font-medium text-slate-700">服務提供者僅能查看已指派的工作資料。</p>
          <p className="text-xs text-slate-500">
            {assignedDoctorIds.length > 0 ? "目前已套用指派範圍；顧客電話已遮罩。" : "目前尚未設定指派範圍，請由品牌管理員在帳號管理中設定。"}
          </p>
        </div>
      ) : (doctors ?? []).length === 0 && (services ?? []).length === 0 ? (
        <div className="card flex flex-col items-start gap-2 p-5">
          <p className="text-sm text-slate-600">尚未建立服務提供者或服務項目，顧客目前無法預約。</p>
          {canManageBrand ? (
            <a href="/admin/schedules" className="btn btn-primary">
              前往服務排程新增服務提供者
            </a>
          ) : (
            <p className="text-xs text-slate-500">請聯絡品牌管理者完成服務與排程設定。</p>
          )}
        </div>
      ) : (
        <BookingForm
          mode={mode}
          doctors={doctors ?? []}
          services={services ?? []}
          appointments={rescheduleOptions}
          clinicSlug={typeof clinic?.slug === "string" ? clinic.slug : undefined}
          defaultDate={viewDate}
          createAction={createAppointmentAction}
          rescheduleAction={rescheduleAppointmentAction}
        />
      )}

      {/* 篩選列 + 筆數 */}
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">日期</label>
          <input type="date" name="date" defaultValue={viewDate} className="input" />
        </div>
        {(doctors ?? []).length > 1 && (
          <div>
            <label className="label">服務提供者</label>
            <select name="doctor" defaultValue={fDoctor} className="input">
              <option value="">全部服務提供者</option>
              {(doctors ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">狀態</label>
          <select name="status" defaultValue={fStatus} className="input">
            <option value="">全部狀態</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-secondary">套用</SubmitButton>
        {(fDoctor || fStatus) && (
          <a href="/admin" className="btn btn-ghost">
            清除
          </a>
        )}
        <span className="ml-auto self-center text-sm text-slate-400">{rows.length} 筆</span>
      </form>

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

      <div className="card overflow-x-auto">
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
                <td colSpan={8} className="py-10 text-center text-slate-400">
                  本日尚無預約
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold text-slate-900">
                  {mode === "time" ? formatTime(r.start_at) : `第 ${r.queue_number} 號`}
                </td>
                <td>{r.doctors?.name}</td>
                <td>
                  <div className="font-medium text-slate-800">{r.patients?.name}</div>
                  <div className="text-xs text-slate-400">
                    {canViewSensitiveCustomerData(role) ? r.patients?.phone : maskPhone(r.patients?.phone)}
                  </div>
                </td>
                <td>
                  {r.services?.name ? (
                    <span className="badge bg-slate-100 text-slate-600">{r.services.name}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td>
                  {r.visit_type === "first" ? (
                    <span className="badge bg-accent-500/10 text-accent-600">首次服務</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-600">再次服務</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[r.status] ?? "其他狀態"}
                  </span>
                </td>
                <td>
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
                      <SubmitButton className="text-xs font-medium text-brand-600 hover:underline">更新</SubmitButton>
                      <span className="text-xs text-slate-400">${r.deposit_amount}</span>
                    </form>
                  )}
                </td>
                <td>
                  {r.status !== "cancelled" && r.status !== "done" && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.status === "booked" && <StatusBtn id={r.id} status="confirmed" label="確認" />}
                      <StatusBtn id={r.id} status="done" label="完成" />
                      <StatusBtn id={r.id} status="no_show" label="未到" />
                      <form action={cancelAppointmentAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                          取消
                        </SubmitButton>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
