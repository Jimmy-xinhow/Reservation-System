import { requirePlatformAdmin } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface EventRow { id: string; clinic_id: string; created_at: string; from_status: string | null; to_status: string; source: string; actor_id: string | null; note: string | null; reference_id: string; kind: string; }
interface BrandRow { id: string; name: string; }

export default async function PlatformAuditPage() {
  await requirePlatformAdmin();
  const service = createServiceClient();
  const [{ data: brands, error: brandsError }, { data: appointments, error: appointmentsError }, { data: registrations, error: registrationsError }, { data: payments, error: paymentsError }] = await Promise.all([
    service.from("clinics").select("id, name"),
    service.from("appointment_status_events").select("id, clinic_id, created_at, from_status, to_status, source, actor_id, note, appointment_id").order("created_at", { ascending: false }).limit(100),
    service.from("registration_status_events").select("id, clinic_id, created_at, from_status, to_status, source, actor_id, note, registration_id").order("created_at", { ascending: false }).limit(100),
    service.from("payment_status_events").select("id, clinic_id, created_at, from_status, to_status, source, actor_id, note, payment_order_id").order("created_at", { ascending: false }).limit(100),
  ]);
  const errors = [brandsError, appointmentsError, registrationsError, paymentsError].filter(Boolean);
  if (errors.length > 0) throw new Error(`讀取平台稽核紀錄失敗：${errors[0]?.message ?? "未知錯誤"}`);
  const brandsById = new Map((brands ?? []).map((brand) => [brand.id, (brand as BrandRow).name]));
  const rows: EventRow[] = [
    ...((appointments ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...toEvent(row, "預約"), reference_id: String(row.appointment_id) })),
    ...((registrations ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...toEvent(row, "報名"), reference_id: String(row.registration_id) })),
    ...((payments ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...toEvent(row, "付款"), reference_id: String(row.payment_order_id) })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 200);

  return <div className="space-y-8"><header><p className="eyebrow">Platform governance</p><h1 className="mt-1 text-2xl font-bold text-slate-950">平台稽核</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">集中查看跨品牌的預約、報名與付款狀態異動，協助系統擁有者判斷問題是否來自單一品牌、通知流程或金流回呼。</p></header><section className="card overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-slate-900">最近 200 筆狀態異動</h2><p className="mt-1 text-sm text-slate-500">事件依時間排序；操作者 ID 僅供平台稽核使用。</p></div><span className="badge bg-indigo-50 text-indigo-700">跨品牌</span></div><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>時間</th><th>品牌</th><th>類型</th><th>狀態變更</th><th>來源</th><th>操作者</th><th>備註</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">尚無跨品牌稽核紀錄。</td></tr> : rows.map((row) => <tr key={`${row.kind}-${row.id}`}><td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.created_at)}</td><td className="font-medium text-slate-800">{brandsById.get(row.clinic_id) ?? "未知品牌"}</td><td><span className="badge bg-slate-100 text-slate-600">{row.kind}</span></td><td className="whitespace-nowrap font-medium text-slate-800">{row.from_status ?? "—"} → {row.to_status}</td><td className="text-sm text-slate-600">{row.source}</td><td className="max-w-40 truncate font-mono text-xs text-slate-400" title={row.actor_id ?? "system"}>{row.actor_id ?? "system"}</td><td className="max-w-xs text-sm text-slate-500">{row.note ?? "—"}</td></tr>)}</tbody></table></div></section><p className="text-xs leading-5 text-slate-400">平台稽核只讀取狀態事件，不提供跨品牌修改入口；取消仍保留為狀態異動，不會被刪除。</p></div>;
}

function toEvent(row: Record<string, unknown>, kind: string): EventRow { return { id: String(row.id), clinic_id: String(row.clinic_id), created_at: String(row.created_at), from_status: typeof row.from_status === "string" ? row.from_status : null, to_status: String(row.to_status), source: String(row.source), actor_id: typeof row.actor_id === "string" ? row.actor_id : null, note: typeof row.note === "string" ? row.note : null, reference_id: "", kind }; }
function formatDateTime(value: string): string { return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }); }
