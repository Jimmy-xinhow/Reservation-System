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
  id: string;
  registration_no: string;
  status: string;
  payment_status: string;
  amount: number;
  discount_amount: number;
  membership_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  created_at: string;
  events: { title: string } | { title: string }[] | null;
  event_sessions: { name: string; start_at: string } | { name: string; start_at: string }[] | null;
}

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
const member = await requireNonProvider();
  if (!(await isAdminModuleEnabled(member.supabase, member.clinicId, "events"))) return <ModuleDisabled title="活動與報名" />;
  const params = await searchParams;
  const q = (params.q ?? "").trim().replace(/[,%()*]/g, "");
  const status = ["pending", "confirmed", "cancelled", "waitlisted", "attended", "no_show"].includes(params.status ?? "") ? params.status : null;
  const supabase = await createSupabaseServer();
  let query = supabase
    .from("registrations")
    .select("id, registration_no, status, payment_status, amount, discount_amount, membership_id, name, phone, email, created_at, events(title), event_sessions(name, start_at)")
    .eq("clinic_id", member.clinicId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`registration_no.ilike.%${q}%,name.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RegistrationRow[];
  const showPii = canViewSensitiveCustomerData(member.role);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div><div className="eyebrow">活動與報名</div><h1 className="admin-page-title">報名名單</h1><p className="admin-page-description">搜尋、確認及處理最近 100 筆報名；個資只對授權角色顯示。</p></div>
        <Link href={`/api/admin/registrations?format=csv${status ? `&status=${encodeURIComponent(status)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn btn-secondary w-fit">匯出 CSV</Link>
      </div>
      <form className="admin-toolbar">
        <label className="flex-1 text-sm"><span className="label">搜尋</span><input name="q" defaultValue={q} className="input" placeholder="報名編號、姓名或電話" /></label>
        <label className="text-sm"><span className="label">狀態</span><select name="status" defaultValue={status ?? ""} className="input"><option value="">全部</option><option value="pending">待付款</option><option value="confirmed">已確認</option><option value="waitlisted">候補</option><option value="attended">已報到</option><option value="cancelled">已取消</option><option value="no_show">未到</option></select></label>
        <button className="btn btn-primary" type="submit">套用</button>
      </form>
      <div className="admin-table-shell">
        <table className="tbl">
          <thead><tr><th>報名資訊</th><th>活動／場次</th><th>顧客</th><th>金額</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead>
          <tbody>
        {rows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">目前沒有符合條件的報名。</td></tr> : rows.map((row) => {
          const event = Array.isArray(row.events) ? row.events[0] : row.events;
          const session = Array.isArray(row.event_sessions) ? row.event_sessions[0] : row.event_sessions;
          return <tr key={row.id}><td><code className="text-xs font-semibold text-slate-700">{row.registration_no}</code></td><td><div className="font-medium text-slate-900">{event?.title ?? "未命名活動"}</div><div className="mt-0.5 text-xs text-slate-500">{session ? `${session.name} · ${formatEventDate(session.start_at)}` : "未設定場次"}</div></td><td>{showPii ? <><div className="font-medium text-slate-800">{row.name}</div><div className="text-xs text-slate-500">{row.phone}{row.email ? ` · ${row.email}` : ""}</div></> : <span className="text-xs text-slate-400">聯絡資料已遮蔽</span>}</td><td>{formatAmount(Number(row.amount))}{row.discount_amount > 0 && <div className="text-xs text-emerald-700">已折 {formatAmount(row.discount_amount)}</div>}</td><td><div className="flex flex-col items-start gap-1"><span className="badge bg-brand-50 text-brand-700">{registrationStatusLabel(row.status)}</span><span className="text-xs text-slate-500">{paymentStatusLabel(row.payment_status)}</span></div></td><td className="text-xs text-slate-500">{formatEventDate(row.created_at)}</td><td>{canOperate(member.role) && <div className="flex flex-wrap gap-1">{["pending", "confirmed", "attended"].includes(row.status) && <Link href={`/admin/checkout?registration_id=${row.id}`} className="admin-inline-action text-brand-700">結帳</Link>}{["pending", "confirmed", "waitlisted"].includes(row.status) && <form action={cancelRegistrationAdminAction}><input type="hidden" name="id" value={row.id} /><SubmitButton className="admin-inline-action text-red-700">取消</SubmitButton></form>}{row.status === "confirmed" && <form action={markRegistrationNoShowAction}><input type="hidden" name="id" value={row.id} /><SubmitButton className="admin-inline-action">未到</SubmitButton></form>}</div>}</td></tr>;
        })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
