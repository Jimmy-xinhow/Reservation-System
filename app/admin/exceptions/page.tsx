import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { createExceptionAction, deleteExceptionAction } from "../actions";

export const dynamic = "force-dynamic";

interface Doctor {
  id: string;
  name: string;
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
  const [{ data: doctors }, { data: exceptions }] = await Promise.all([
    supabase.from("doctors").select("id, name").eq("clinic_id", CLINIC_ID).eq("active", true).order("name"),
    supabase
      .from("schedule_exceptions")
      .select("id, doctor_id, date, is_closed, start_time, end_time, capacity")
      .eq("clinic_id", CLINIC_ID)
      .order("date", { ascending: false }),
  ]);

  const docs = (doctors ?? []) as Doctor[];
  const rows = (exceptions ?? []) as Exception[];
  const docName = (id: string) => docs.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">休診 / 加診</h1>

      <form action={createExceptionAction} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="block text-sm font-medium text-slate-600">
          醫師
          <select name="doctor_id" required className="input mt-1">
            <option value="">選擇</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-600">
          日期
          <input type="date" name="date" required className="input mt-1" />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          類型
          <select name="kind" className="input mt-1" defaultValue="closed">
            <option value="closed">休診(整天)</option>
            <option value="extra">加診</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-600">
          開始
          <input type="time" name="start_time" className="input mt-1" />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          結束
          <input type="time" name="end_time" className="input mt-1" />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          每格(分)
          <input type="number" name="slot_minutes" defaultValue={15} className="input mt-1 w-24" />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          容量/總號
          <input type="number" name="capacity" defaultValue={1} className="input mt-1 w-24" />
        </label>
        <button className="btn btn-primary">新增</button>
      </form>
      <p className="text-xs text-slate-400">加診才需填時間與容量;休診為整天,時間欄留空即可。</p>

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
                    ? "整天"
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
