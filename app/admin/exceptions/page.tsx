import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { createExceptionAction, deleteExceptionAction } from "../actions";
import ExceptionForm from "../_components/ExceptionForm";

export const dynamic = "force-dynamic";

interface Doctor {
  id: string;
  name: string;
}
interface Template {
  id: string;
  doctor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity: number;
  active: boolean;
}
interface Exception {
  id: string;
  doctor_id: string;
  date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
}

export default async function ExceptionsPage() {
  const supabase = await createSupabaseServer();
  const [{ data: doctors }, { data: templates }, { data: exceptions }] = await Promise.all([
    supabase.from("doctors").select("id, name").eq("clinic_id", CLINIC_ID).eq("active", true).order("name"),
    supabase
      .from("schedule_templates")
      .select("id, doctor_id, weekday, start_time, end_time, slot_minutes, capacity, active")
      .eq("clinic_id", CLINIC_ID)
      .order("weekday"),
    supabase
      .from("schedule_exceptions")
      .select("id, doctor_id, date, is_closed, start_time, end_time, capacity")
      .eq("clinic_id", CLINIC_ID)
      .order("date", { ascending: false }),
  ]);

  const docs = (doctors ?? []) as Doctor[];
  const tpls = (templates ?? []) as Template[];
  const rows = (exceptions ?? []) as Exception[];
  const docName = (id: string) => docs.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">休診 / 加診</h1>

      <ExceptionForm doctors={docs} templates={tpls} createAction={createExceptionAction} />
      <p className="text-xs text-slate-400">
        加診可從「套用門診段」挑既有時段帶入(再微調),或直接輸入;休診為整天,選休診即可。
      </p>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>日期</th>
              <th>醫師</th>
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
                <td>{docName(e.doctor_id)}</td>
                <td>
                  <span className={`badge ${e.is_closed ? "bg-red-50 text-red-600" : "bg-accent-500/10 text-accent-600"}`}>
                    {e.is_closed ? "休診" : "加診"}
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
                    <button className="text-xs font-medium text-red-600 hover:underline">刪除</button>
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
