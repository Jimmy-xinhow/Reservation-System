import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { canOperate, canViewSensitiveCustomerData, requireNonProvider } from "@/lib/admin";
import { formatAmount, formatEventDate } from "@/lib/registration";
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><div className="eyebrow">Registration</div><h1 className="text-2xl font-bold text-slate-900">報名名單</h1><p className="mt-1 text-sm text-slate-500">品牌：{member.clinicName}，最多顯示最近 100 筆。</p></div>
        <Link href={`/api/admin/registrations?format=csv${status ? `&status=${encodeURIComponent(status)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn btn-secondary w-fit">匯出 CSV</Link>
      </div>
      <form className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm"><span className="label">搜尋</span><input name="q" defaultValue={q} className="input" placeholder="報名編號、姓名或電話" /></label>
        <label className="text-sm"><span className="label">狀態</span><select name="status" defaultValue={status ?? ""} className="input"><option value="">全部</option><option value="pending">待付款</option><option value="confirmed">已確認</option><option value="waitlisted">候補</option><option value="attended">已報到</option><option value="cancelled">已取消</option><option value="no_show">未到</option></select></label>
        <button className="btn btn-primary" type="submit">套用</button>
      </form>
      <div className="space-y-3">
        {rows.length === 0 ? <div className="card p-8 text-center text-sm text-slate-400">目前沒有符合條件的報名。</div> : rows.map((row) => {
          const event = Array.isArray(row.events) ? row.events[0] : row.events;
          const session = Array.isArray(row.event_sessions) ? row.event_sessions[0] : row.event_sessions;
          return <article key={row.id} className="card space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{event?.title ?? "未命名活動"}</div><div className="mt-1 text-sm text-slate-500">{session ? `${session.name} · ${formatEventDate(session.start_at)}` : "未設定場次"}</div></div><div className="flex gap-2 text-xs"><span className="badge bg-brand-50 text-brand-700">{row.status}</span><span className="badge bg-slate-100 text-slate-600">{row.payment_status}</span></div></div><div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3"><div>報名編號：<code>{row.registration_no}</code></div><div>金額：{formatAmount(Number(row.amount))}</div><div>建立：{formatEventDate(row.created_at)}</div></div>{showPii ? <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3"><div>姓名：{row.name}</div><div>電話：{row.phone}</div><div>Email：{row.email ?? "—"}</div></div> : <p className="text-xs text-slate-400">目前角色僅顯示必要報名資訊，已遮蔽聯絡資料。</p>}{canOperate(member.role) && <div className="flex flex-wrap gap-2">{["pending", "confirmed", "waitlisted"].includes(row.status) && <form action={cancelRegistrationAdminAction}><input type="hidden" name="id" value={row.id} /><SubmitButton className="btn btn-secondary text-xs">取消報名</SubmitButton></form>}{row.status === "confirmed" && <form action={markRegistrationNoShowAction}><input type="hidden" name="id" value={row.id} /><SubmitButton className="btn btn-secondary text-xs">標記未到</SubmitButton></form>}</div>}</article>;
        })}
      </div>
    </div>
  );
}
