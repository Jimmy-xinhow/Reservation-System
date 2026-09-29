import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { redriveRejectedEmailAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const KIND_LABEL: Record<string, string> = {
  pending: "待付款通知",
  confirmed: "預約確認",
  cancelled: "取消通知",
  rescheduled: "改期通知",
  reminder: "行前提醒",
};
const AUDIT_LABEL: Record<string, string> = {
  claimed: "待處理，請人工核對",
  delivering: "寄送結果待確認",
  sent: "服務商已接受",
  rejected: "服務商再次拒收",
  aborted: "寄送前中止",
  uncertain: "結果不明，禁止重送",
};

interface FailedLog {
  id: string;
  appointment_id: string;
  kind: string;
  created_at: string;
  source: "appointment" | "reminder";
}

interface AppointmentSummary {
  id: string;
  start_at: string;
  status: string;
  deposit_status: string;
  patients: { id: string; name: string; email: string | null } | null;
}

function canRedrive(row: FailedLog, appointment: AppointmentSummary | undefined, reminderHours: number): boolean {
  if (!appointment?.patients) return false;
  const startAt = Date.parse(appointment.start_at);
  if (!Number.isFinite(startAt) || startAt <= Date.now()) return false;
  if (row.source === "reminder") {
    return ["booked", "confirmed"].includes(appointment.status) && startAt <= Date.now() + reminderHours * 3600_000;
  }
  if (row.kind === "pending") return appointment.status === "booked" && appointment.deposit_status === "pending";
  if (row.kind === "confirmed") return ["booked", "confirmed"].includes(appointment.status) && appointment.deposit_status !== "pending";
  if (row.kind === "cancelled") return appointment.status === "cancelled";
  return row.kind === "rescheduled" && ["booked", "confirmed"].includes(appointment.status);
}

function pageNumber(value: string | undefined): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 10000 ? number : 1;
}

function taipei(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "時間未記錄";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function resultMessage(value: string | undefined): string | null {
  if (value === "sent") return "Email 已由寄件服務接受，補送紀錄已更新。";
  if (value === "rejected") return "寄件服務再次明確拒收；請檢查地址或寄件設定後再處理。";
  if (value === "aborted") return "寄送前資料檢查失敗，未向寄件服務送出；請檢查設定後再試。";
  if (value === "uncertain") return "寄送結果無法確認，系統已鎖住這筆補送，請先人工核對，勿再寄一次。";
  return null;
}

function paginationHref(appointmentPage: number, reminderPage: number): string {
  return `/admin/notifications?appointment_page=${appointmentPage}&reminder_page=${reminderPage}`;
}

function FailedList({
  title, rows, appointments, page, hasNext, href, reminderHours,
}: {
  title: string;
  rows: FailedLog[];
  appointments: Map<string, AppointmentSummary>;
  page: number;
  hasNext: boolean;
  reminderHours: number;
  href: (page: number) => string;
}) {
  return <section className="admin-section space-y-4 p-5">
    <div><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-slate-500">只列出供應商已明確拒收的 Email；已送出或結果不明的紀錄不會提供補送。</p></div>
    {rows.length === 0 && <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">本頁沒有可補送的紀錄。</p>}
    <div className="space-y-3">{rows.map((row) => {
      const appointment = appointments.get(row.appointment_id);
      const patient = appointment?.patients;
      return <article key={`${row.source}-${row.id}`} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{KIND_LABEL[row.kind] ?? row.kind}</strong><span className="text-xs text-slate-500">失敗紀錄 {taipei(row.created_at)}</span></div>
        <p className="mt-1 text-sm text-slate-600">{patient?.name ?? "顧客資料不可用"} · 預約 {appointment ? taipei(appointment.start_at) : "資料不可用"} · {appointment?.status ?? "未知狀態"}</p>
        {canRedrive(row, appointment, reminderHours) && patient ? <form action={redriveRejectedEmailAction} className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3">
          <input type="hidden" name="appointment_id" value={row.appointment_id} />
          <input type="hidden" name="source" value={row.source} />
          <input type="hidden" name="kind" value={row.kind} />
          <label className="max-w-lg text-sm"><span className="mb-1 block font-medium">確認或修正收件 Email</span><input className="input w-full" type="email" name="email" defaultValue={patient.email ?? ""} maxLength={200} required /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm_send" required className="mt-1" /><span>我已確認此顧客的收件地址，並同意只補送這筆{KIND_LABEL[row.kind] ?? "通知"}。</span></label>
          <div><SubmitButton className="btn btn-primary">確認並補送 Email</SubmitButton></div>
        </form> : <p className="mt-3 text-sm text-amber-700">預約已過期、狀態改變，或目前不在提醒視窗；不能補送。</p>}
      </article>;
    })}</div>
    <nav className="flex justify-between border-t border-slate-100 pt-3 text-sm">{page > 1 ? <Link className="btn btn-secondary" href={href(page - 1)}>上一頁</Link> : <span />}{hasNext && <Link className="btn btn-secondary" href={href(page + 1)}>下一頁</Link>}</nav>
  </section>;
}

export default async function NotificationRecoveryPage({ searchParams }: {
  searchParams: Promise<{ appointment_page?: string; reminder_page?: string; result?: string }>;
}) {
  const member = await requireOperator();
  const params = await searchParams;
  const appointmentPage = pageNumber(params.appointment_page);
  const reminderPage = pageNumber(params.reminder_page);
  const [appointmentResult, reminderResult, auditResult] = await Promise.all([
    member.supabase.from("appointment_notification_logs")
      .select("id,appointment_id,kind,created_at")
      .eq("clinic_id", member.clinicId).eq("channel", "email").eq("status", "failed")
      .eq("error", "delivery_error:provider_rejected")
      .order("created_at", { ascending: false })
      .range((appointmentPage - 1) * PAGE_SIZE, appointmentPage * PAGE_SIZE),
    member.supabase.from("reminder_logs")
      .select("id,appointment_id,sent_at")
      .eq("clinic_id", member.clinicId).eq("channel", "email").eq("result", "failed")
      .eq("error", "delivery_error:provider_rejected")
      .order("sent_at", { ascending: false })
      .range((reminderPage - 1) * PAGE_SIZE, reminderPage * PAGE_SIZE),
    createServiceClient().from("email_redrive_events")
      .select("id,source,notification_kind,status,created_at")
      .eq("clinic_id", member.clinicId)
      .order("created_at", { ascending: false }).limit(20),
  ]);
  if (appointmentResult.error || reminderResult.error || auditResult.error) throw new Error("Email 補送紀錄讀取失敗");
  const appointmentRows = (appointmentResult.data ?? []).map((row) => ({ ...row, source: "appointment" as const }));
  const reminderRows = (reminderResult.data ?? []).map((row) => ({
    id: row.id, appointment_id: row.appointment_id, kind: "reminder", created_at: row.sent_at ?? "", source: "reminder" as const,
  }));
  const ids = [...new Set([...appointmentRows, ...reminderRows].map((row) => row.appointment_id))];
  const { data: summaryRows, error: summaryError } = ids.length === 0
    ? { data: [] as unknown[], error: null }
    : await member.supabase.from("appointments")
      .select("id,start_at,status,deposit_status,patients(id,name,email)")
      .eq("clinic_id", member.clinicId).in("id", ids);
  if (summaryError) throw new Error("預約資料讀取失敗");
  const appointments = new Map((summaryRows as unknown as AppointmentSummary[]).map((row) => [row.id, row]));
  const notice = resultMessage(params.result);
  const reminderHours = Number(process.env.REMINDER_HOURS_BEFORE ?? 24) || 24;

  return <div className="admin-page space-y-5">
    <header className="admin-page-header"><div><p className="eyebrow">預約營運</p><h1 className="admin-page-title">Email 失敗補送</h1><p className="admin-page-description">核對顧客地址，只補送寄件服務已明確拒收的確認信或行前提醒。結果不明須人工核對。</p></div></header>
    {notice && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">{notice}</p>}
    <FailedList title="預約通知" rows={appointmentRows.slice(0, PAGE_SIZE)} appointments={appointments} page={appointmentPage} hasNext={appointmentRows.length > PAGE_SIZE} href={(page) => paginationHref(page, reminderPage)} reminderHours={reminderHours} />
    <FailedList title="行前提醒" rows={reminderRows.slice(0, PAGE_SIZE)} appointments={appointments} page={reminderPage} hasNext={reminderRows.length > PAGE_SIZE} href={(page) => paginationHref(appointmentPage, page)} reminderHours={reminderHours} />
    <section className="admin-section space-y-3 p-5"><div><h2 className="text-lg font-semibold">最近補送紀錄</h2><p className="text-sm text-slate-500">結果不明須先向寄件服務核對，不得再次按補送。</p></div>
      {(auditResult.data ?? []).length === 0 ? <p className="text-sm text-slate-500">尚無人工補送。</p> :
        <ul className="divide-y divide-slate-100 text-sm">{(auditResult.data ?? []).map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3"><span>{KIND_LABEL[row.notification_kind] ?? row.notification_kind} · {taipei(row.created_at)}</span><strong className={row.status === "sent" ? "text-emerald-700" : row.status === "uncertain" || row.status === "delivering" ? "text-red-700" : "text-amber-700"}>{AUDIT_LABEL[row.status] ?? "待查"}</strong></li>)}</ul>}
    </section>
  </div>;
}
