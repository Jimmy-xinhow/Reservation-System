import { hasSystemPermission, requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";
import { TrialObservationPanel } from "./TrialObservationPanel";

export const dynamic = "force-dynamic";

interface BrandRow { id: string; name: string; slug: string | null; active: boolean; created_at: string; }
interface PlatformReportRow extends BrandRow { members: number; services: number; appointments: number; registrations: number; patients: number; }

export default async function PlatformReportsPage() {
  const platform = await requireSystemPermission("reports.view");
  const service = createServiceClient();
  const { data, error } = await service.rpc("get_platform_usage_summary");
  if (error) throw new Error(`讀取品牌使用量失敗：${error.message}`);
  const reportRows: PlatformReportRow[] = ((data ?? []) as Array<PlatformReportRow & Record<string, unknown>>).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    created_at: row.created_at,
    members: Number(row.members),
    services: Number(row.services),
    appointments: Number(row.appointments),
    registrations: Number(row.registrations),
    patients: Number(row.patients),
  }));
  const brandRows: BrandRow[] = reportRows.map(({ id, name, slug, active, created_at }) => ({ id, name, slug, active, created_at }));
  const totals = reportRows.reduce((sum, row) => ({ members: sum.members + row.members, services: sum.services + row.services, appointments: sum.appointments + row.appointments, registrations: sum.registrations + row.registrations, patients: sum.patients + row.patients }), { members: 0, services: 0, appointments: 0, registrations: 0, patients: 0 });
  const activeCount = reportRows.filter((row) => row.active).length;

  return (
    <div className="space-y-8">
      <header><p className="eyebrow">跨品牌使用概況</p><h1 className="mt-1 text-2xl font-bold text-slate-950">跨品牌報表</h1><p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">比較各品牌的使用量與啟用狀態。這裡只呈現總數，不顯示姓名、電話、LINE 識別碼或其他顧客個資。</p></header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="品牌" value={reportRows.length} detail={`${activeCount} 個啟用中`} /><Metric label="成員" value={totals.members} detail="跨品牌總數" /><Metric label="服務" value={totals.services} detail="啟用中的服務" /><Metric label="預約" value={totals.appointments} detail="累計紀錄" /><Metric label="報名" value={totals.registrations} detail="累計紀錄" /></section>

      <TrialObservationPanel brands={brandRows} canManage={hasSystemPermission(platform, "brands.manage")} />

      <section className="card overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-slate-900">品牌使用量比較</h2><p className="mt-1 text-sm text-slate-600">資料依品牌分開統計，本頁不提供跨品牌顧客明細。</p></div><span className="badge bg-indigo-50 text-indigo-700">系統管理者可見</span></div><div className="hidden overflow-x-auto md:block"><table className="tbl"><thead><tr><th>品牌</th><th>狀態</th><th>成員</th><th>啟用服務</th><th>預約</th><th>報名</th><th>顧客</th></tr></thead><tbody>{reportRows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">尚未建立品牌。</td></tr> : reportRows.map((row) => <tr key={row.id}><td><p className="font-medium text-slate-900">{row.name}</p><p className="mt-1 text-xs text-slate-400">網址代號：/{row.slug ?? "未設定"}</p></td><td><span className={`badge ${row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{row.active ? "啟用" : "停用"}</span></td><td>{row.members}</td><td>{row.services}</td><td>{row.appointments}</td><td>{row.registrations}</td><td>{row.patients}</td></tr>)}</tbody></table></div><div className="divide-y divide-slate-100 md:hidden">{reportRows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">尚未建立品牌。</p> : reportRows.map((row) => <article key={row.id} className="space-y-3 px-5 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{row.name}</p><p className="mt-1 text-xs text-slate-400">網址代號：/{row.slug ?? "未設定"}</p></div><span className={`badge ${row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{row.active ? "啟用" : "停用"}</span></div><div className="grid grid-cols-2 gap-2 text-sm"><CompactMetric label="成員" value={row.members} /><CompactMetric label="服務" value={row.services} /><CompactMetric label="預約" value={row.appointments} /><CompactMetric label="報名" value={row.registrations} /><CompactMetric label="顧客" value={row.patients} /></div></article>)}</div></section>
      <p className="text-xs leading-5 text-slate-400">本頁的預約、報名與顧客數為累計資料，未套日期範圍；品牌營運分析與 CSV 明細請進入該品牌的「營運報表」。</p>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) { return <div className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></div>; }
function CompactMetric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>; }
