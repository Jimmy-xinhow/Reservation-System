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
      <h1 className="text-xl font-bold">休診 / 加診</h1>

      <form action={createExceptionAction} className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3">
        <label className="text-sm">
          醫師
          <select name="doctor_id" required className="mt-1 block rounded border p-2">
            <option value="">選擇</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          日期
          <input type="date" name="date" required className="mt-1 block rounded border p-2" />
        </label>
        <label className="text-sm">
          類型
          <select name="kind" className="mt-1 block rounded border p-2" defaultValue="closed">
            <option value="closed">休診(整天)</option>
            <option value="extra">加診</option>
          </select>
        </label>
        <label className="text-sm">
          開始
          <input type="time" name="start_time" className="mt-1 block rounded border p-2" />
        </label>
        <label className="text-sm">
          結束
          <input type="time" name="end_time" className="mt-1 block rounded border p-2" />
        </label>
        <label className="text-sm">
          每格(分)
          <input type="number" name="slot_minutes" defaultValue={15} className="mt-1 block w-20 rounded border p-2" />
        </label>
        <label className="text-sm">
          容量/總號
          <input type="number" name="capacity" defaultValue={1} className="mt-1 block w-20 rounded border p-2" />
        </label>
        <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white">新增</button>
      </form>
      <p className="text-xs text-gray-400">加診才需填時間與容量;休診為整天,時間欄留空即可。</p>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-2">日期</th>
              <th className="p-2">醫師</th>
              <th className="p-2">類型</th>
              <th className="p-2">時間</th>
              <th className="p-2">容量</th>
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-400">
                  尚無紀錄
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-2">{e.date}</td>
                <td className="p-2">{docName(e.doctor_id)}</td>
                <td className="p-2">{e.is_closed ? "休診" : "加診"}</td>
                <td className="p-2">
                  {e.is_closed
                    ? "整天"
                    : `${e.start_time?.slice(0, 5) ?? ""}–${e.end_time?.slice(0, 5) ?? ""}`}
                </td>
                <td className="p-2">{e.is_closed ? "—" : e.capacity}</td>
                <td className="p-2">
                  <form action={deleteExceptionAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-xs text-red-600">刪除</button>
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
