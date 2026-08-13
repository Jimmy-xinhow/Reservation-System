import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

interface AuditRow { id: string; created_at: string; from_status: string | null; to_status: string; source: string; actor_id: string | null; note: string | null; kind: string; reference_id: string; }
export default async function AuditPage() {
  const { supabase, clinicId } = await requireAdmin();
  const [{ data: appointments }, { data: registrations }, { data: payments }] = await Promise.all([
    supabase.from("appointment_status_events").select("id, created_at, from_status, to_status, source, actor_id, note, appointment_id").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
    supabase.from("registration_status_events").select("id, created_at, from_status, to_status, source, actor_id, note, registration_id").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
    supabase.from("payment_status_events").select("id, created_at, from_status, to_status, source, actor_id, note, payment_order_id").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
  ]);
  const rows: AuditRow[] = [
    ...((appointments ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: "預約", reference_id: String(row.appointment_id) }) as AuditRow),
    ...((registrations ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: "報名", reference_id: String(row.registration_id) }) as AuditRow),
    ...((payments ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: "付款", reference_id: String(row.payment_order_id) }) as AuditRow),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 200);
  return <div className="space-y-6"><div><p className="eyebrow">Governance</p><h1 className="text-2xl font-bold text-slate-900">操作與狀態稽核</h1><p className="mt-2 text-sm leading-6 text-slate-500">集中查看預約、報名與付款狀態的變更來源，協助客訴、退款與營運追蹤。</p></div><div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>時間</th><th>類型</th><th>狀態變更</th><th>來源</th><th>操作者</th><th>備註</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">尚無稽核紀錄。</td></tr> : rows.map((row) => <tr key={`${row.kind}-${row.id}`}><td className="whitespace-nowrap text-xs text-slate-500">{new Date(row.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</td><td><span className="badge bg-slate-100 text-slate-600">{row.kind}</span></td><td className="font-medium text-slate-800">{row.from_status ?? "—"} → {row.to_status}</td><td className="text-sm text-slate-600">{row.source}</td><td className="font-mono text-xs text-slate-400">{row.actor_id ?? "system"}</td><td className="max-w-xs text-sm text-slate-500">{row.note ?? "—"}</td></tr>)}</tbody></table></div></div>;
}
