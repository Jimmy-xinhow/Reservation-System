import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { canOperate, canViewSensitiveCustomerData, requireNonProvider } from "@/lib/admin";
import { formatAmount, formatEventDate, paymentStatusLabel, registrationStatusLabel } from "@/lib/registration";
import { SubmitButton } from "@/components/SubmitButton";
import { cancelRegistrationAdminAction, markRegistrationNoShowAction } from "./actions";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";

export const dynamic = "force-dynamic";

interface RegistrationRow {
  id: string; event_id: string; session_id: string; registration_no: string; status: string; payment_status: string;
  amount: number; discount_amount: number; membership_id: string | null; name: string; phone: string; email: string | null; created_at: string;
  events: { title: string } | { title: string }[] | null;
  event_sessions: { name: string; start_at: string } | { name: string; start_at: string }[] | null;
}
interface EventOption { id: string; title: string; }
interface SessionOption { id: string; event_id: string; name: string; start_at: string; }
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function taipeiDate(offsetDays = 0): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + offsetDays * 86400000)); }
function safeDate(value: string | undefined, fallback: string): string { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value as string : fallback; }
function safeUuid(value: string | undefined): string | null { return /^[0-9a-f-]{36}$/i.test(value ?? "") ? value as string : null; }

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; event_id?: string; session_id?: string; registered_from?: string; registered_to?: string }> }) {
  const member = await requireNonProvider();
  if (!(await isAdminModuleEnabled(member.supabase, member.clinicId, "events"))) return <ModuleDisabled title="活動與報名" />;
  const params = await searchParams;
  const q = (params.q ?? "").trim().replace(/[,%()*]/g, "");
  const status = ["pending", "confirmed", "cancelled", "waitlisted", "attended", "no_show"].includes(params.status ?? "") ? params.status : null;
  const eventId = safeUuid(params.event_id);
  const sessionId = safeUuid(params.session_id);
  const registeredFrom = safeDate(params.registered_from, taipeiDate(-30));
  const registeredTo = safeDate(params.registered_to, taipeiDate());
  const fromIso = new Date(`${registeredFrom}T00:00:00+08:00`).toISOString();
  const toExclusive = new Date(new Date(`${registeredTo}T00:00:00+08:00`).getTime() + 86400000).toISOString();
  const supabase = await createSupabaseServer();
  const [eventsResult, sessionsResult] = await Promise.all([
    supabase.from("events").select("id, title").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }),
    supabase.from("event_sessions").select("id, event_id, name, start_at").eq("clinic_id", member.clinicId).order("start_at", { ascending: false }).limit(500),
  ]);
  const optionsError = eventsResult.error ?? sessionsResult.error;
  if (optionsError) throw new Error(optionsError.message);
  const eventOptions = (eventsResult.data ?? []) as EventOption[];
  const allSessionOptions = (sessionsResult.data ?? []) as SessionOption[];
  const sessionOptions = eventId ? allSessionOptions.filter((session) => session.event_id === eventId) : allSessionOptions;
  let query = supabase.from("registrations")
    .select("id, event_id, session_id, registration_no, status, payment_status, amount, discount_amount, membership_id, name, phone, email, created_at, events(title), event_sessions(name, start_at)")
    .eq("clinic_id", member.clinicId).gte("created_at", fromIso).lt("created_at", toExclusive).order("created_at", { ascending: false }).limit(1000);
  if (status) query = query.eq("status", status);
  if (eventId) query = query.eq("event_id", eventId);
  if (sessionId) query = query.eq("session_id", sessionId);
  if (q) query = query.or(`registration_no.ilike.%${q}%,name.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RegistrationRow[];
  const showPii = canViewSensitiveCustomerData(member.role);
  const groups = new Map<string, RegistrationRow[]>();
  for (const row of rows) { const key = `${row.event_id}:${row.session_id}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const exportParams = new URLSearchParams({ format: "csv", registered_from: registeredFrom, registered_to: registeredTo });
  if (status) exportParams.set("status", status); if (eventId) exportParams.set("event_id", eventId); if (sessionId) exportParams.set("session_id", sessionId); if (q) exportParams.set("q", q);

  return <div className="admin-page">
    <div className="admin-page-header"><div><div className="eyebrow">活動與報名</div><h1 className="admin-page-title">報名名單</h1><p className="admin-page-description">依活動與場次分組管理，預設只顯示近 30 天建立的報名，避免歷史資料混在同一張長表。</p></div><Link href={`/api/admin/registrations?${exportParams.toString()}`} className="btn btn-secondary w-fit">匯出目前範圍 CSV</Link></div>
    <form className="admin-toolbar grid gap-3 lg:grid-cols-6">
      <label className="text-sm lg:col-span-2"><span className="label">搜尋</span><input name="q" defaultValue={q} className="input" placeholder="報名編號、姓名或電話" /></label>
      <label className="text-sm"><span className="label">活動</span><select name="event_id" defaultValue={eventId ?? ""} className="input"><option value="">全部活動</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
      <label className="text-sm"><span className="label">場次</span><select name="session_id" defaultValue={sessionId ?? ""} className="input"><option value="">全部場次</option>{sessionOptions.map((session) => <option key={session.id} value={session.id}>{session.name} · {formatEventDate(session.start_at)}</option>)}</select></label>
      <label className="text-sm"><span className="label">狀態</span><select name="status" defaultValue={status ?? ""} className="input"><option value="">全部</option><option value="pending">待付款</option><option value="confirmed">已確認</option><option value="waitlisted">候補</option><option value="attended">已報到</option><option value="cancelled">已取消</option><option value="no_show">未到</option></select></label>
      <div className="flex items-end"><button className="btn btn-primary w-full" type="submit">套用篩選</button></div>
      <label className="text-sm"><span className="label">報名日期起</span><input name="registered_from" type="date" defaultValue={registeredFrom} className="input" /></label>
      <label className="text-sm"><span className="label">報名日期迄</span><input name="registered_to" type="date" defaultValue={registeredTo} className="input" /></label>
      <div className="flex items-end lg:col-span-4"><Link href="/admin/registrations" className="btn btn-ghost">清除條件並回到近 30 天</Link></div>
    </form>
    {rows.length === 0 ? <div className="admin-section p-10 text-center text-sm text-slate-400">目前範圍沒有符合條件的報名。</div> : <div className="space-y-4">{[...groups.values()].map((groupRows) => {
      const first = groupRows[0]; const event = one(first.events); const session = one(first.event_sessions);
      return <section key={`${first.event_id}:${first.session_id}`} className="admin-section overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3"><div><h2 className="font-semibold text-slate-900">{event?.title ?? "未命名活動"}</h2><p className="mt-0.5 text-xs text-slate-500">{session ? `${session.name} · ${formatEventDate(session.start_at)}` : "未設定場次"}</p></div><span className="badge bg-white text-slate-700">此場次 {groupRows.length} 筆</span></header>
        <div className="admin-table-shell admin-table-mobile-cards border-0"><table className="tbl"><thead><tr><th>報名編號</th><th>顧客</th><th>金額</th><th>狀態</th><th>報名日期</th><th>操作</th></tr></thead><tbody>{groupRows.map((row) => <tr key={row.id}>
          <td data-label="報名編號"><code className="text-xs font-semibold text-slate-700">{row.registration_no}</code></td><td data-label="顧客">{showPii ? <><div className="font-medium text-slate-800">{row.name}</div><div className="text-xs text-slate-500">{row.phone}{row.email ? ` · ${row.email}` : ""}</div></> : <span className="text-xs text-slate-400">聯絡資料已遮蔽</span>}</td><td data-label="金額">{formatAmount(Number(row.amount))}{row.discount_amount > 0 && <div className="text-xs text-emerald-700">已折 {formatAmount(row.discount_amount)}</div>}</td><td data-label="狀態"><div className="flex flex-col items-start gap-1"><span className="badge bg-brand-50 text-brand-700">{registrationStatusLabel(row.status)}</span><span className="text-xs text-slate-500">{paymentStatusLabel(row.payment_status)}</span></div></td><td className="text-xs text-slate-500" data-label="報名日期">{formatEventDate(row.created_at)}</td><td data-label="操作">{canOperate(member.role) && <div className="flex flex-wrap gap-1">{["pending", "confirmed", "attended"].includes(row.status) && <Link href={`/admin/checkout/new?registration_id=${row.id}`} className="admin-inline-action text-brand-700">結帳</Link>}{["pending", "confirmed", "waitlisted"].includes(row.status) && <form action={cancelRegistrationAdminAction}><input type="hidden" name="id" value={row.id} /><SubmitButton className="admin-inline-action text-red-700">取消</SubmitButton></form>}{row.status === "confirmed" && <form action={markRegistrationNoShowAction}><input type="hidden" name="id" value={row.id} /><SubmitButton className="admin-inline-action">未到</SubmitButton></form>}</div>}</td>
        </tr>)}</tbody></table></div>
      </section>;
    })}</div>}
  </div>;
}
