
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import Link from "next/link";
import { canViewSensitiveCustomerData, requireMember } from "@/lib/admin";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { deliveryError } from "@/lib/delivery-error";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
interface DeliveryRow {
  id: string;
  status: "pending" | "sent" | "failed" | "skipped";
  channel: "line" | "email";
  trigger_key: string;
  error: string | null;
  attempt_count: number;
  attempted_at: string | null;
  sent_at: string | null;
  created_at: string;
  patients: Relation<{ name: string; email: string | null; phone: string }>;
  crm_automations: Relation<{ name: string; trigger_type: string }>;
}

const STATUS_LABEL = { pending: "待處理", sent: "已送出", failed: "失敗", skipped: "已跳過" } as const;
const STATUS_CLASS = { pending: "bg-amber-50 text-amber-700", sent: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700", skipped: "bg-slate-100 text-slate-600" } as const;
const PAGE_SIZE = 100;

function taipei(value: string | null): string { return value ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) : "—"; }

export default async function DeliveryLogsPage({ searchParams }: { searchParams: Promise<{ status?: string; channel?: string; page?: string }> }) {
  const [member, params] = await Promise.all([requireMember(), searchParams]);
  if (!(await isAdminModuleEnabled(member.supabase, member.clinicId, "crm"))) return <ModuleDisabled title="顧客回訪與自動提醒" />;
  if (!canViewSensitiveCustomerData(member.role)) return <p className="admin-section p-6 text-sm text-slate-500">目前角色無法查看顧客投遞資料。</p>;
  const status = ["pending", "sent", "failed", "skipped"].includes(params.status ?? "") ? params.status : "";
  const channel = ["line", "email"].includes(params.channel ?? "") ? params.channel : "";
  const page = /^[1-9]\d{0,6}$/.test(params.page ?? "") ? Number(params.page) : 1;
  const offset = (page - 1) * PAGE_SIZE;
  let query = member.supabase.from("crm_delivery_logs").select("id,status,channel,trigger_key,error,attempt_count,attempted_at,sent_at,created_at,patients(name,email,phone),crm_automations(name,trigger_type)").eq("clinic_id", member.clinicId);
  if (status) query = query.eq("status", status);
  if (channel) query = query.eq("channel", channel);
  const { data, error } = await adminQuery(query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE));
  if (error) throw new Error(adminErrorMessage(`讀取投遞紀錄失敗：${error.message}`));
  if (!Array.isArray(data)) throw new Error("投遞紀錄讀取不完整，請重新載入後再試");
  const hasNext = data.length > PAGE_SIZE;
  const rows = data.slice(0, PAGE_SIZE) as unknown as DeliveryRow[];
  const pageHref = (nextPage: number): string => {
    const queryParams = new URLSearchParams();
    if (status) queryParams.set("status", status);
    if (channel) queryParams.set("channel", channel);
    queryParams.set("page", String(nextPage));
    return `/admin/crm/deliveries?${queryParams.toString()}`;
  };

  return <div className="admin-page">
    <header className="admin-page-header"><div><p className="eyebrow">顧客經營</p><h1 className="admin-page-title">訊息投遞紀錄</h1><p className="admin-page-description">逐筆追查 LINE／Email 自動通知的收件人、狀態、嘗試次數、時間與錯誤原因。「已送出」代表服務商接受請求，不代表顧客已收到或閱讀。</p></div><Link href="/admin/crm#delivery" className="btn btn-secondary">返回自動提醒</Link></header>
    <form className="admin-section grid gap-3 p-4 sm:grid-cols-[minmax(180px,.7fr)_minmax(180px,.7fr)_auto_auto] sm:items-end" method="get"><label className="text-sm"><span className="label">狀態</span><select name="status" defaultValue={status} className="input"><option value="">全部狀態</option><option value="sent">已送出</option><option value="failed">失敗</option><option value="skipped">已跳過</option><option value="pending">待處理</option></select></label><label className="text-sm"><span className="label">渠道</span><select name="channel" defaultValue={channel} className="input"><option value="">全部渠道</option><option value="line">LINE</option><option value="email">Email</option></select></label><button className="btn btn-primary" type="submit">套用篩選</button>{(status || channel) && <Link href="/admin/crm/deliveries" className="btn btn-secondary">清除</Link>}</form>
    <section className="admin-table-shell"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">投遞明細</h2><p className="mt-0.5 text-xs text-slate-500">依建立時間由新到舊，每頁最多 {PAGE_SIZE} 筆；可翻頁追查歷史紀錄。</p></div><span className="text-sm text-slate-500">第 {page} 頁 · {rows.length} 筆</span></div><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>建立／送出時間</th><th>顧客</th><th>自動化</th><th>渠道</th><th>狀態</th><th>嘗試</th><th>錯誤或跳過原因</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">{page === 1 ? "此篩選條件目前沒有投遞紀錄。" : "此頁沒有投遞紀錄，請返回上一頁。"}</td></tr> : rows.map((row) => { const patient = one(row.patients); const automation = one(row.crm_automations); return <tr key={row.id}><td className="whitespace-nowrap text-xs text-slate-500"><div>{taipei(row.created_at)}</div>{row.sent_at && <div className="mt-1 text-emerald-700">送出 {taipei(row.sent_at)}</div>}{!row.sent_at && row.attempted_at && <div className="mt-1">嘗試 {taipei(row.attempted_at)}</div>}</td><td><strong>{patient?.name ?? "顧客"}</strong><div className="mt-1 text-xs text-slate-500">{row.channel === "email" ? patient?.email ?? "未留 Email" : patient?.phone ?? "未留電話"}</div></td><td>{automation?.name ?? "系統通知"}<div className="mt-1 text-xs text-slate-500">{row.trigger_key}</div></td><td>{row.channel === "line" ? "LINE" : "Email"}</td><td><span className={`badge ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span></td><td>{row.attempt_count}</td><td className="max-w-md whitespace-normal text-sm text-slate-600">{row.error ? deliveryError(row.error) : "—"}</td></tr>; })}</tbody></table></div><nav aria-label="投遞紀錄分頁" className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm"><div>{page > 1 && <Link href={pageHref(page - 1)} className="btn btn-secondary">上一頁</Link>}</div><div>{hasNext && <Link href={pageHref(page + 1)} className="btn btn-secondary">下一頁</Link>}</div></nav></section>
  </div>;
}
