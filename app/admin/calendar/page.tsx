import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { canOperate, canViewSensitiveCustomerData, getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { formatTime } from "@/lib/slots";
import { SubmitButton } from "@/components/SubmitButton";
import { cancelAppointmentAction, setStatusAction } from "../actions";

export const dynamic = "force-dynamic";

const DAY_START = 8 * 60;
const DAY_END = 21 * 60;
const PX_PER_MINUTE = 1.15;

interface Doctor { id: string; name: string; }
interface Appointment {
  id: string;
  doctor_id: string;
  start_at: string;
  end_at: string;
  status: string;
  visit_type: string;
  deposit_status: string;
  doctors: { name: string } | null;
  patients: { name: string; phone: string } | null;
  services: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = { booked: "已預約", confirmed: "已確認", done: "已完成", no_show: "未到", cancelled: "已取消" };
const STATUS_COLOR: Record<string, string> = {
  booked: "border-blue-200 bg-blue-50 text-blue-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  done: "border-slate-200 bg-slate-100 text-slate-700",
  no_show: "border-amber-200 bg-amber-50 text-amber-800",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()); }
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
}
function displayDate(value: string) { return value.replaceAll("-", "/"); }
function queryLink(date: string, doctor?: string, selected?: string) {
  const query = new URLSearchParams({ date });
  if (doctor) query.set("doctor", doctor);
  if (selected) query.set("selected", selected);
  return `/admin/calendar?${query.toString()}`;
}
function timeMinute(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}
function maskPhone(value: string | undefined) { return value && value.length > 4 ? `${"•".repeat(value.length - 4)}${value.slice(-4)}` : "••••"; }

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; doctor?: string; selected?: string }> }) {
  const params = await searchParams;
  const member = await requireMember();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today();
  const selectedDoctor = params.doctor ?? "";
  const supabase = await createSupabaseServer();
  const assigned = await getAssignedDoctorIds(member);
  const isProvider = member.role === "provider";
  const noDoctor = "00000000-0000-0000-0000-000000000000";
  const dayStart = new Date(`${date}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59.999+08:00`).toISOString();

  let doctorQuery = supabase.from("doctors").select("id, name").eq("clinic_id", member.clinicId).eq("active", true).order("name");
  let appointmentQuery = supabase.from("appointments").select("id, doctor_id, start_at, end_at, status, visit_type, deposit_status, doctors(name), patients(name, phone), services(name)").eq("clinic_id", member.clinicId).gte("start_at", dayStart).lte("start_at", dayEnd).order("start_at");
  if (isProvider) {
    const allowed = assigned.length ? assigned : [noDoctor];
    doctorQuery = doctorQuery.in("id", allowed);
    appointmentQuery = appointmentQuery.in("doctor_id", allowed);
  }
  if (selectedDoctor) appointmentQuery = appointmentQuery.eq("doctor_id", selectedDoctor);
  const [{ data: doctorData, error: doctorError }, { data: appointmentData, error: appointmentError }] = await Promise.all([doctorQuery, appointmentQuery]);
  if (doctorError) throw new Error(doctorError.message);
  if (appointmentError) throw new Error(appointmentError.message);

  const doctors = (doctorData ?? []) as Doctor[];
  const appointments = (appointmentData ?? []) as unknown as Appointment[];
  const selected = appointments.find((item) => item.id === params.selected) ?? null;
  const byDoctor = new Map<string, Appointment[]>();
  for (const appointment of appointments) byDoctor.set(appointment.doctor_id, [...(byDoctor.get(appointment.doctor_id) ?? []), appointment]);
  const gridHeight = (DAY_END - DAY_START) * PX_PER_MINUTE;
  const timeRows = Array.from({ length: (DAY_END - DAY_START) / 30 + 1 }, (_, index) => DAY_START + index * 30);
  const showPii = canViewSensitiveCustomerData(member.role);
  const canOperateHere = canOperate(member.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><div className="eyebrow">Operations / Calendar</div><h1 className="text-2xl font-bold tracking-tight text-slate-900">預約日曆</h1><p className="mt-1 text-sm text-slate-500">以工程後台的時間軸查看人員工作量與預約狀態。</p></div>
        <Link href={`/admin?date=${date}`} className="btn btn-primary w-fit">新增預約</Link>
      </div>

      <section className="card p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2"><Link href={queryLink(today(), selectedDoctor)} className="btn btn-secondary px-3 py-2">今天</Link><Link href={queryLink(shiftDate(date, -1), selectedDoctor)} aria-label="前一天" className="btn btn-secondary px-3 py-2 text-lg">‹</Link><Link href={queryLink(shiftDate(date, 1), selectedDoctor)} aria-label="後一天" className="btn btn-secondary px-3 py-2 text-lg">›</Link><span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{displayDate(date)} · 台北時間</span></div>
          <form className="flex flex-col gap-2 sm:flex-row sm:items-center"><label htmlFor="calendar-doctor" className="text-sm font-medium text-slate-600">人員篩選</label><select id="calendar-doctor" name="doctor" defaultValue={selectedDoctor} className="input h-11 w-full sm:w-52"><option value="">全部人員</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select><input type="hidden" name="date" value={date} /><SubmitButton className="btn btn-secondary">套用</SubmitButton></form>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">{Object.entries(STATUS_LABEL).map(([status, label]) => <span key={status} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${STATUS_COLOR[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>)}</div>
      </section>

      {doctors.length === 0 ? <section className="card p-8 text-center"><p className="font-medium text-slate-700">尚未設定可用的服務人員</p><p className="mt-1 text-sm text-slate-500">先建立人員與門診時段，日曆才會顯示可操作欄位。</p><Link href="/admin/schedules" className="btn btn-primary mt-4">前往門診排程</Link></section> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card overflow-hidden"><div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">人員工作時間軸</h2><p className="mt-0.5 text-xs text-slate-400">{appointments.length} 筆預約 · 點擊卡片查看詳情</p></div><Link href={`/admin?date=${date}`} className="text-sm font-medium text-brand-600 hover:underline">切換列表</Link></div></div><div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `72px repeat(${doctors.length}, minmax(180px, 1fr))` }}><div className="border-r border-slate-200 px-3 py-3 text-xs font-semibold text-slate-400">時間</div>{doctors.map((doctor) => <div key={doctor.id} className="border-r border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700">{doctor.name}</div>)}</div><div className="grid" style={{ gridTemplateColumns: `72px repeat(${doctors.length}, minmax(180px, 1fr))` }}><div className="relative border-r border-slate-200 bg-slate-50" style={{ height: gridHeight }}>{timeRows.map((minute) => <div key={minute} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-slate-400" style={{ top: (minute - DAY_START) * PX_PER_MINUTE }}>{String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}</div>)}</div>{doctors.map((doctor) => <CalendarColumn key={doctor.id} doctor={doctor} appointments={byDoctor.get(doctor.id) ?? []} selectedDate={date} selectedDoctor={selectedDoctor} selectedId={selected?.id} gridHeight={gridHeight} timeRows={timeRows} />)}</div></div></div></section>
        <aside className="card h-fit overflow-hidden"><div className="border-b border-slate-200 px-5 py-4"><div className="eyebrow mb-1">Appointment detail</div><h2 className="font-semibold text-slate-900">預約詳情</h2></div>{!selected ? <div className="px-5 py-10 text-center text-sm leading-6 text-slate-400">選取左側預約卡片，查看顧客、服務與狀態。</div> : <div className="space-y-5 p-5"><div className="flex items-start justify-between gap-3"><div><div className="text-lg font-semibold text-slate-900">{selected.patients?.name ?? "未命名顧客"}</div><div className="mt-1 text-sm text-slate-500">{selected.services?.name ?? "未指定服務"}</div></div><span className={`badge ${STATUS_COLOR[selected.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[selected.status] ?? selected.status}</span></div><dl className="space-y-3 text-sm"><Detail label="日期" value={date} /><Detail label="時間" value={`${formatTime(selected.start_at)} – ${formatTime(selected.end_at)}`} /><Detail label="人員" value={selected.doctors?.name ?? "未指定"} /><Detail label="類型" value={selected.visit_type === "first" ? "初診" : "複診"} /><Detail label="訂金" value={selected.deposit_status === "none" ? "未設定" : selected.deposit_status} /><Detail label="電話" value={showPii ? (selected.patients?.phone ?? "未提供") : maskPhone(selected.patients?.phone)} /></dl><div className="grid gap-2"><Link href={`/admin?date=${date}`} className="btn btn-secondary w-full">編輯／重新排程</Link>{canOperateHere && (selected.status === "booked" || selected.status === "confirmed") && <><form action={setStatusAction}><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="status" value="done" /><SubmitButton className="btn btn-secondary w-full">標記完成</SubmitButton></form><form action={setStatusAction}><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="status" value="no_show" /><SubmitButton className="btn btn-secondary w-full">標記未到</SubmitButton></form><form action={cancelAppointmentAction}><input type="hidden" name="id" value={selected.id} /><SubmitButton className="btn btn-danger w-full">取消預約</SubmitButton></form></>}</div></div>}</aside>
      </div>}
    </div>
  );
}

function CalendarColumn({ doctor, appointments, selectedDate, selectedDoctor, selectedId, gridHeight, timeRows }: { doctor: Doctor; appointments: Appointment[]; selectedDate: string; selectedDoctor: string; selectedId?: string; gridHeight: number; timeRows: number[] }) {
  void doctor;
  return <div className="relative border-r border-slate-200 bg-white" style={{ height: gridHeight }}>{timeRows.map((minute) => <div key={minute} className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ top: (minute - DAY_START) * PX_PER_MINUTE }} />)}{appointments.map((appointment) => { const start = Math.max(DAY_START, timeMinute(appointment.start_at)); const end = Math.min(DAY_END, Math.max(start + 30, timeMinute(appointment.end_at))); return <Link key={appointment.id} href={queryLink(selectedDate, selectedDoctor, appointment.id)} className={`absolute inset-x-1 z-10 overflow-hidden rounded-lg border p-2 text-left text-xs shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${STATUS_COLOR[appointment.status] ?? "border-slate-200 bg-slate-50 text-slate-700"} ${selectedId === appointment.id ? "ring-2 ring-brand-500 ring-offset-1" : ""}`} style={{ top: (start - DAY_START) * PX_PER_MINUTE + 2, height: Math.max(50, (end - start) * PX_PER_MINUTE - 4) }}><div className="flex items-center justify-between gap-1 font-semibold"><span>{formatTime(appointment.start_at)}</span><span className="truncate font-normal">{STATUS_LABEL[appointment.status] ?? appointment.status}</span></div><div className="mt-1 truncate font-medium">{appointment.patients?.name ?? "未命名顧客"}</div><div className="mt-0.5 truncate opacity-75">{appointment.services?.name ?? "未指定服務"}</div></Link>; })}</div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2"><dt className="text-slate-400">{label}</dt><dd className="text-right font-medium text-slate-700">{value}</dd></div>; }
