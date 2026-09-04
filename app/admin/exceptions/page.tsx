import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import { createExceptionAction, deleteExceptionAction } from "../schedule-actions";
import ExceptionForm from "../_components/ExceptionForm";
import { SubmitButton } from "@/components/SubmitButton";

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
  const targetName = (row: Pick<Exception, "doctor_id" | "service_id">) => {
    const provider = row.doctor_id ? docs.find((d) => d.id === row.doctor_id)?.name : null;
    const service = row.service_id ? svcs.find((s) => s.id === row.service_id)?.name : null;
    return [provider, service].filter(Boolean).join(" · ") || "未指定";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">服務例外日期</h1>

      <ExceptionForm doctors={docs} services={svcs} templates={tpls} createAction={createExceptionAction} />
      <p className="text-xs text-slate-400">
        加開場次可從「套用服務時段」挑既有時段帶入(再微調),或直接輸入;停用可選整天或單一場次。
      </p>

      <div className="card overflow-x-auto">
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
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  尚無紀錄
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="font-medium text-slate-800">{e.date}</td>
                <td>{targetName(e)}</td>
                <td>
                  <span className={`badge ${e.is_closed ? "bg-red-50 text-red-600" : "bg-accent-500/10 text-accent-600"}`}>
                    {e.is_closed ? "關閉服務" : "加開服務"}
                  </span>
                </td>
                <td>
                  {e.is_closed
                    ? e.start_time
                      ? `只休 ${e.start_time.slice(0, 5)}–${e.end_time?.slice(0, 5) ?? ""}`
                      : "整天"
                    : `${e.start_time?.slice(0, 5) ?? ""}–${e.end_time?.slice(0, 5) ?? ""}`}
                </td>
                <td>{e.is_closed ? "—" : e.capacity}</td>
                <td>
                  <form action={deleteExceptionAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton className="admin-inline-action text-red-700">刪除</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
