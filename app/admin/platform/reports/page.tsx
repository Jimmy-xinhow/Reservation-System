import { hasSystemPermission, requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";
import { TrialObservationPanel } from "./TrialObservationPanel";

export const dynamic = "force-dynamic";

interface BrandRow { id: string; name: string; slug: string | null; active: boolean; created_at: string; }
interface ClinicCountRow { clinic_id: string; }
interface PlatformReportRow extends BrandRow { members: number; services: number; appointments: number; registrations: number; patients: number; }

export default async function PlatformReportsPage() {
  const platform = await requireSystemPermission("reports.view");
  const service = createServiceClient();
  const [{ data: brands, error: brandsError }, members, services, appointments, registrations, patients] = await Promise.all([
    service.from("clinics").select("id, name, slug, active, created_at").order("created_at", { ascending: false }),
    fetchAllSupabasePages((from, to) => service.from("clinic_members").select("clinic_id").order("clinic_id").range(from, to)),
    fetchAllSupabasePages((from, to) => service.from("services").select("clinic_id").eq("active", true).order("clinic_id").range(from, to)),
    fetchAllSupabasePages((from, to) => service.from("appointments").select("clinic_id").order("clinic_id").range(from, to)),
    fetchAllSupabasePages((from, to) => service.from("registrations").select("clinic_id").order("clinic_id").range(from, to)),
    fetchAllSupabasePages((from, to) => service.from("patients").select("clinic_id").order("clinic_id").range(from, to)),
  ]);
  if (brandsError) throw new Error(`讀取品牌清單失敗：${brandsError.message}`);
  const brandRows = (brands ?? []) as BrandRow[];
  const reportRows: PlatformReportRow[] = brandRows.map((brand) => ({
    ...brand,
    members: countForClinic(members as ClinicCountRow[], brand.id),
    services: countForClinic(services as ClinicCountRow[], brand.id),
    appointments: countForClinic(appointments as ClinicCountRow[], brand.id),
    registrations: countForClinic(registrations as ClinicCountRow[], brand.id),
    patients: countForClinic(patients as ClinicCountRow[], brand.id),
  }));
  const totals = reportRows.reduce((sum, row) => ({ members: sum.members + row.members, services: sum.services + row.services, appointments: sum.appointments + row.appointments, registrations: sum.registrations + row.registrations, patients: sum.patients + row.patients }), { members: 0, services: 0, appointments: 0, registrations: 0, patients: 0 });
  const activeCount = reportRows.filter((row) => row.active).length;

  return (
    <div className="space-y-8">
      <header><p className="eyebrow">Cross-tenant insights</p><h1 className="mt-1 text-2xl font-bold text-slate-950">跨品牌報表</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">以系統管理者授權的系統視角比較品牌使用量與開通狀態。這裡只呈現聚合數字，不顯示姓名、電話、LINE ID 或其他顧客個資。</p></header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="品牌" value={reportRows.length} detail={`${activeCount} 個啟用中`} /><Metric label="成員" value={totals.members} detail="跨品牌總數" /><Metric label="服務" value={totals.services} detail="啟用中的服務" /><Metric label="預約" value={totals.appointments} detail="累計紀錄" /><Metric label="報名" value={totals.registrations} detail="累計紀錄" /></section>

      <TrialObservationPanel brands={brandRows} canManage={hasSystemPermission(platform, "brands.manage")} />

      <section className="card overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-slate-900">品牌使用量比較</h2><p className="mt-1 text-sm text-slate-500">資料從各品牌的 tenant key 聚合；沒有跨品牌明細查詢入口。</p></div><span className="badge bg-indigo-50 text-indigo-700">平台視角</span></div><div className="hidden overflow-x-auto md:block"><table className="tbl"><thead><tr><th>品牌</th><th>狀態</th><th>成員</th><th>啟用服務</th><th>預約</th><th>報名</th><th>顧客</th></tr></thead><tbody>{reportRows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">尚未建立品牌。</td></tr> : reportRows.map((row) => <tr key={row.id}><td><p className="font-medium text-slate-900">{row.name}</p><p className="mt-1 text-xs text-slate-400">/{row.slug ?? "未設定代號"}</p></td><td><span className={`badge ${row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{row.active ? "啟用" : "停用"}</span></td><td>{row.members}</td><td>{row.services}</td><td>{row.appointments}</td><td>{row.registrations}</td><td>{row.patients}</td></tr>)}</tbody></table></div><div className="divide-y divide-slate-100 md:hidden">{reportRows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">尚未建立品牌。</p> : reportRows.map((row) => <article key={row.id} className="space-y-3 px-5 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{row.name}</p><p className="mt-1 text-xs text-slate-400">/{row.slug ?? "未設定代號"}</p></div><span className={`badge ${row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{row.active ? "啟用" : "停用"}</span></div><div className="grid grid-cols-2 gap-2 text-sm"><CompactMetric label="成員" value={row.members} /><CompactMetric label="服務" value={row.services} /><CompactMetric label="預約" value={row.appointments} /><CompactMetric label="報名" value={row.registrations} /><CompactMetric label="顧客" value={row.patients} /></div></article>)}</div></section>
      <p className="text-xs leading-5 text-slate-400">本頁的預約、報名與顧客數為累計資料，未套日期範圍；品牌營運分析與 CSV 明細請進入該品牌的「營運報表」。</p>
    </div>
  );
}

function countForClinic(rows: ClinicCountRow[], clinicId: string): number { let count = 0; for (const row of rows) if (row.clinic_id === clinicId) count += 1; return count; }
function Metric({ label, value, detail }: { label: string; value: number; detail: string }) { return <div className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></div>; }
function CompactMetric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>; }
