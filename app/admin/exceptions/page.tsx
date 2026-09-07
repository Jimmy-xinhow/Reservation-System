import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import { createExceptionAction, deleteExceptionAction } from "../schedule-actions";
import ExceptionForm from "../_components/ExceptionForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ServiceSetupTabs } from "@/components/admin/ManagementTabs";

export const dynamic = "force-dynamic";

interface Doctor {
  id: string;
  name: string;
}
interface Service {
  id: string;
  name: string;
}
interface Template {
  id: string;
  doctor_id: string | null;
  service_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity: number;
  active: boolean;
}
interface Exception {
  id: string;
  doctor_id: string | null;
  service_id: string | null;
  date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
}

export default async function ExceptionsPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  const [{ data: doctors }, { data: services }, { data: templates }, { data: exceptions }] = await Promise.all([
    supabase.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    supabase.from("services").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    supabase
      .from("schedule_templates")
      .select("id, doctor_id, service_id, weekday, start_time, end_time, slot_minutes, capacity, active")
      .eq("clinic_id", clinicId)
      .order("weekday"),
    supabase
      .from("schedule_exceptions")
      .select("id, doctor_id, service_id, date, is_closed, start_time, end_time, capacity")
      .eq("clinic_id", clinicId)
      .order("date", { ascending: false }),
  ]);

  const docs = (doctors ?? []) as Doctor[];
  const svcs = (services ?? []) as Service[];
  const tpls = (templates ?? []) as Template[];
  const rows = (exceptions ?? []) as Exception[];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const futureRows = rows.filter((row) => row.date >= today);
  const futureClosures = futureRows.filter((row) => row.is_closed).length;
  const futureExtras = futureRows.filter((row) => !row.is_closed).length;
  const targetName = (row: Pick<Exception, "doctor_id" | "service_id">) => {
    const provider = row.doctor_id ? docs.find((d) => d.id === row.doctor_id)?.name : null;
    const service = row.service_id ? svcs.find((s) => s.id === row.service_id)?.name : null;
    return [provider, service].filter(Boolean).join(" · ") || "未指定";
  };

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">例外日期</p>
          <h1 className="admin-page-title">休假與臨時加開</h1>
          <p className="admin-page-description">在固定排班之外，設定特定日期的休假、停課或臨時加開時段。</p>
        </div>
      </header>

      <ServiceSetupTabs active="exceptions" />

      <section className="admin-metric-strip grid-cols-3" aria-label="例外日期摘要">
        <div className="admin-metric"><span className="admin-metric-label">未來休假／停課</span><strong className="admin-metric-value">{futureClosures}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">未來臨時加開</span><strong className="admin-metric-value">{futureExtras}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">全部紀錄</span><strong className="admin-metric-value">{rows.length}</strong></div>
      </section>

      <ExceptionForm doctors={docs} services={svcs} templates={tpls} createAction={createExceptionAction} />

      <section className="admin-section">
        <div className="admin-section-header">
          <div><h2 className="font-semibold text-slate-900">例外日期清單</h2><p className="mt-0.5 text-xs text-slate-500">依日期由新到舊排列，刪除後會恢復原本固定排班。</p></div>
          <span className="text-xs tabular-nums text-slate-500">{rows.length} 筆</span>
        </div>
      <div className="admin-table-shell admin-table-mobile-cards border-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>日期</th>
              <th>服務提供者／服務</th>
              <th>類型</th>
              <th>時間</th>
              <th>容量</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">
                  尚未設定休假或臨時加開
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id}>
                <td data-label="日期" className="font-medium text-slate-800">{e.date}</td>
                <td data-label="服務提供者／服務">{targetName(e)}</td>
                <td data-label="類型">
                  <span className={`badge ${e.is_closed ? "bg-red-50 text-red-600" : "bg-accent-500/10 text-accent-600"}`}>
                    {e.is_closed ? "關閉服務" : "加開服務"}
                  </span>
                </td>
                <td data-label="時間">
                  {e.is_closed
                    ? e.start_time
                      ? `只休 ${e.start_time.slice(0, 5)}–${e.end_time?.slice(0, 5) ?? ""}`
                      : "整天"
                    : `${e.start_time?.slice(0, 5) ?? ""}–${e.end_time?.slice(0, 5) ?? ""}`}
                </td>
                <td data-label="容量">{e.is_closed ? "—" : e.capacity}</td>
                <td data-label="操作">
                  <form action={deleteExceptionAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <ConfirmSubmitButton confirmMessage="刪除後，這一天會恢復原本固定排班。確定刪除這筆例外設定嗎？" className="admin-inline-action text-red-700">刪除例外設定</ConfirmSubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </section>
    </div>
  );
}
