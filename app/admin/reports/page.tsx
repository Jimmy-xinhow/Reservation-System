import Link from "next/link";
import { requireNonProvider } from "@/lib/admin";
import { formatDateTime } from "@/lib/slots";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;

interface AppointmentRow {
  start_at: string;
  status: string;
  membership_id: string | null;
  source: string | null;
  doctors: Relation<{ name: string }>;
  services: Relation<{ name: string }>;
}

interface RegistrationRow {
  created_at: string;
  status: string;
  payment_status: string;
  amount: number;
  discount_amount: number;
  membership_id: string | null;
  events: Relation<{ title: string }>;
  event_sessions: Relation<{ name: string }>;
  event_ticket_types: Relation<{ name: string }>;
}

interface PaymentRow { status: string; amount: number; }
interface DeliveryRow { status: string; }

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function todayTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(value);
}

function rangeIso(from: string, to: string): { start: string; end: string } {
  return {
    start: new Date(`${from}T00:00:00+08:00`).toISOString(),
    end: new Date(`${to}T23:59:59.999+08:00`).toISOString(),
  };
}

function percent(value: number, total: number): string {
  return total === 0 ? "—" : `${((value / total) * 100).toFixed(1)}%`;
}

function bookingBreakdown(rows: AppointmentRow[]) {
  const grouped = new Map<string, { day: string; provider: string; service: string; status: string; source: string; count: number }>();
  for (const row of rows) {
    const provider = one(row.doctors)?.name ?? "未指定";
    const service = one(row.services)?.name ?? "未指定";
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(row.start_at));
    const source = row.source ?? "未指定";
    const key = [day, provider, service, row.status, source].join("\u0000");
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key, { day, provider, service, status: row.status, source, count: 1 });
  }
  return [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day) || a.provider.localeCompare(b.provider));
}

function registrationBreakdown(rows: RegistrationRow[]) {
  const grouped = new Map<string, { event: string; session: string; ticket: string; status: string; count: number }>();
  for (const row of rows) {
    const event = one(row.events)?.title ?? "未指定活動";
    const session = one(row.event_sessions)?.name ?? "未指定場次";
    const ticket = one(row.event_ticket_types)?.name ?? "未指定票種";
    const key = [event, session, ticket, row.status].join("\u0000");
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key, { event, session, ticket, status: row.status, count: 1 });
  }
  return [...grouped.values()].sort((a, b) => a.event.localeCompare(b.event) || a.session.localeCompare(b.session));
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
const { supabase, clinicId, clinicName } = await requireNonProvider();
  const params = await searchParams;
  const today = todayTaipei();
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : shiftDate(today, -29);
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today;
  const normalizedFrom = from <= to ? from : to;
  const normalizedTo = from <= to ? to : from;
  const range = rangeIso(normalizedFrom, normalizedTo);
  const [appointmentResult, registrationResult, paymentResult, deliveryResult, waitlistResult, promotedResult] = await Promise.all([
    supabase.from("appointments").select("start_at, status, membership_id, source, doctors(name), services(name)").eq("clinic_id", clinicId).gte("start_at", range.start).lte("start_at", range.end),
    supabase.from("registrations").select("created_at, status, payment_status, amount, discount_amount, membership_id, events(title), event_sessions(name), event_ticket_types(name)").eq("clinic_id", clinicId).gte("created_at", range.start).lte("created_at", range.end),
    supabase.from("payment_orders").select("status, amount").eq("clinic_id", clinicId).gte("created_at", range.start).lte("created_at", range.end),
    supabase.from("crm_delivery_logs").select("status").eq("clinic_id", clinicId).gte("created_at", range.start).lte("created_at", range.end),
    supabase.from("waitlist_entries").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).gte("created_at", range.start).lte("created_at", range.end),
    supabase.from("waitlist_entries").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("status", "promoted").gte("updated_at", range.start).lte("updated_at", range.end),
  ]);
  const error = appointmentResult.error ?? registrationResult.error ?? paymentResult.error ?? deliveryResult.error ?? waitlistResult.error ?? promotedResult.error;
  if (error) throw new Error(error.message);

  const appointmentRows = (appointmentResult.data ?? []) as unknown as AppointmentRow[];
  const registrationRows = (registrationResult.data ?? []) as unknown as RegistrationRow[];
  const paymentRows = (paymentResult.data ?? []) as unknown as PaymentRow[];
  const deliveryRows = (deliveryResult.data ?? []) as unknown as DeliveryRow[];
  const appointmentNoShow = appointmentRows.filter((row) => row.status === "no_show").length;
  const registrationAttended = registrationRows.filter((row) => row.status === "attended").length;
  const paidPayments = paymentRows.filter((row) => row.status === "paid");
  const deliverySent = deliveryRows.filter((row) => row.status === "sent").length;
  const deliveryFailed = deliveryRows.filter((row) => row.status === "failed").length;
  const deliverySkipped = deliveryRows.filter((row) => row.status === "skipped").length;
  const membershipUses = appointmentRows.filter((row) => row.membership_id).length + registrationRows.filter((row) => row.membership_id).length;
  const discountAmount = registrationRows.reduce((sum, row) => sum + Number(row.discount_amount ?? 0), 0);
  const bookingRows = bookingBreakdown(appointmentRows);
  const registrationBreakdownRows = registrationBreakdown(registrationRows);
  const exportHref = `/api/admin/reports?from=${encodeURIComponent(normalizedFrom)}&to=${encodeURIComponent(normalizedTo)}`;
  const generatedAt = formatDateTime(new Date().toISOString());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="text-2xl font-bold text-slate-900">營運報表</h1>
          <p className="mt-1 text-sm text-slate-500">品牌：{clinicName} · 資料範圍：{normalizedFrom} 至 {normalizedTo} · 時區：Asia/Taipei</p>
          <p className="mt-1 text-xs text-slate-400">最後更新：{generatedAt} · 取消資料保留於明細，但不計入有效名額。</p>
        </div>
        <Link href={exportHref} className="btn btn-secondary w-fit">匯出 CSV</Link>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm"><span className="label">開始日期</span><input type="date" name="from" defaultValue={normalizedFrom} className="input" /></label>
        <label className="text-sm"><span className="label">結束日期</span><input type="date" name="to" defaultValue={normalizedTo} className="input" /></label>
        <button className="btn btn-primary" type="submit">套用範圍</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="預約紀錄" value={appointmentRows.length} />
        <Metric label="報名紀錄" value={registrationRows.length} />
        <Metric label="預約未到率" value={percent(appointmentNoShow, appointmentRows.length)} />
        <Metric label="報名報到完成" value={registrationAttended} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3 p-5"><h2 className="font-semibold text-slate-900">預約與報名摘要</h2><Line label="預約未到（分母：全部預約紀錄）" value={`${appointmentNoShow} / ${appointmentRows.length}`} /><Line label="候補筆數" value={waitlistResult.count ?? 0} /><Line label="候補填補率" value={percent(promotedResult.count ?? 0, waitlistResult.count ?? 0)} /><Line label="報名取消" value={registrationRows.filter((row) => row.status === "cancelled").length} /><Line label="套票扣抵" value={`${membershipUses} 次`} /></section>
        <section className="card space-y-3 p-5"><h2 className="font-semibold text-slate-900">付款、優惠與 CRM 摘要</h2><Line label="付款成功" value={`${paidPayments.length} 筆 · NT$${paidPayments.reduce((sum, row) => sum + Number(row.amount), 0).toLocaleString("zh-TW")}`} /><Line label="優惠折抵" value={`NT$${discountAmount.toLocaleString("zh-TW")}`} /><Line label="付款失敗／逾時" value={paymentRows.filter((row) => row.status === "failed" || row.status === "expired").length} /><Line label="行銷投遞成功" value={deliverySent} /><Line label="行銷失敗／跳過" value={`${deliveryFailed} / ${deliverySkipped}`} /></section>
      </div>

      <BreakdownTable title="預約明細分組（日期／服務提供者／服務／狀態／來源）" headers={["日期", "服務提供者", "服務", "狀態", "來源", "筆數"]} rows={bookingRows.map((row) => [row.day, row.provider, row.service, row.status, row.source, String(row.count)])} />
      <BreakdownTable title="報名明細分組（活動／場次／票種／狀態）" headers={["活動", "場次", "票種", "狀態", "筆數"]} rows={registrationBreakdownRows.map((row) => [row.event, row.session, row.ticket, row.status, String(row.count)])} />
      <p className="text-xs leading-5 text-slate-400">報表所有查詢均限制在目前品牌與日期範圍；CSV 套用相同品牌與角色權限，服務提供者不會取得顧客電話等不必要個資。無資料時以 0 或「—」呈現，不把取消資料誤算為有效名額。</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) { return <div className="card p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div>; }
function Line({ label, value }: { label: string; value: number | string }) { return <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-800">{value}</span></div>; }
function BreakdownTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return <section className="card overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">{title}</h2></div>{rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-400">此範圍沒有資料。</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.join("-")}-${index}`}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}</section>;
}
