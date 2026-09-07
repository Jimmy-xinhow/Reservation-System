import { TechnicalDetails } from "@/components/TechnicalDetails";
import { requireAdmin } from "@/lib/admin";
import { auditSourceLabel, auditStatusLabel } from "@/lib/admin-display";

export const dynamic = "force-dynamic";

interface AuditRow { id: string; created_at: string; from_status: string | null; to_status: string; source: string; actor_id: string | null; note: string | null; kind: string; reference_id: string; }
export default async function AuditPage() {
  const { supabase, clinicId } = await requireAdmin();
  const [{ data: appointments, error: appointmentsError }, { data: registrations, error: registrationsError }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase.from("appointment_status_events").select("id, created_at, from_status, to_status, source, actor_id, note, appointment_id").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
    supabase.from("registration_status_events").select("id, created_at, from_status, to_status, source, actor_id, note, registration_id").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
    supabase.from("payment_status_events").select("id, created_at, from_status, to_status, source, actor_id, note, payment_order_id").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
  ]);
  const firstError = appointmentsError ?? registrationsError ?? paymentsError;
  if (firstError) throw new Error(`讀取操作紀錄失敗：${firstError.message}`);
  const rows: AuditRow[] = [
    ...((appointments ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: "預約", reference_id: String(row.appointment_id) }) as AuditRow),
    ...((registrations ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: "報名", reference_id: String(row.registration_id) }) as AuditRow),
    ...((payments ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: "付款", reference_id: String(row.payment_order_id) }) as AuditRow),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 200);
  const bookingRows = rows.filter((row) => row.kind === "預約").length;
  const registrationRows = rows.filter((row) => row.kind === "報名").length;
  const paymentRows = rows.filter((row) => row.kind === "付款").length;
  return <div className="admin-page"><header className="admin-page-header"><div><p className="eyebrow">操作追蹤</p><h1 className="admin-page-title">操作與狀態紀錄</h1><p className="admin-page-description">查看預約、報名與付款狀態由誰、在何時變更，協助客訴與營運追蹤。</p></div></header><section className="admin-metric-strip grid-cols-3" aria-label="操作紀錄摘要"><div className="admin-metric"><span className="admin-metric-label">預約變更</span><strong className="admin-metric-value">{bookingRows}</strong></div><div className="admin-metric"><span className="admin-metric-label">報名變更</span><strong className="admin-metric-value">{registrationRows}</strong></div><div className="admin-metric"><span className="admin-metric-label">付款變更</span><strong className="admin-metric-value">{paymentRows}</strong></div></section><section className="admin-section"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">最近狀態變更</h2><p className="mt-0.5 text-xs text-slate-500">最多顯示最近 200 筆，識別碼收在「查看技術資料」內。</p></div><span className="text-xs tabular-nums text-slate-500">{rows.length} 筆</span></div><div className="admin-table-shell admin-table-mobile-cards border-0"><table className="tbl"><thead><tr><th>時間</th><th>類型</th><th>狀態變更</th><th>來源</th><th>操作者</th><th>備註</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-10 text-center text-sm text-slate-400">尚無操作紀錄</td></tr> : rows.map((row) => <tr key={`${row.kind}-${row.id}`}><td data-label="時間" className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</td><td data-label="類型"><span className="badge bg-slate-100 text-slate-600">{row.kind}</span></td><td data-label="狀態變更" className="font-medium text-slate-800">{auditStatusLabel(row.from_status)} → {auditStatusLabel(row.to_status)}</td><td data-label="來源" className="text-sm text-slate-600">{auditSourceLabel(row.source)}</td><td data-label="操作者" className="text-sm text-slate-600">{row.actor_id ? "後台帳號" : "系統自動執行"}<TechnicalDetails className="mt-1" summary="查看技術資料" items={[{ label: "來源代碼", value: row.source }, { label: "前一狀態代碼", value: row.from_status ?? "none" }, { label: "目前狀態代碼", value: row.to_status }, { label: "帳號識別碼", value: row.actor_id ?? "system" }, { label: "紀錄識別碼", value: row.reference_id }]} /></td><td data-label="備註" className="max-w-xs text-sm text-slate-500">{row.note ?? "—"}</td></tr>)}</tbody></table></div></section></div>;
}
