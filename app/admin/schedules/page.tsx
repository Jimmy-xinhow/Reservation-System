import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import {
  createTemplateAction,
  toggleTemplateAction,
  deleteTemplateAction,
  createDoctorAction,
  toggleDoctorAction,
} from "../actions";

export const dynamic = "force-dynamic";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  active: boolean;
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

export default async function SchedulesPage() {
  const supabase = await createSupabaseServer();
  const [{ data: doctors }, { data: templates }] = await Promise.all([
    supabase.from("doctors").select("id, name, specialty, active").eq("clinic_id", CLINIC_ID).order("name"),
    supabase
      .from("schedule_templates")
      .select("id, doctor_id, weekday, start_time, end_time, slot_minutes, capacity, active")
      .eq("clinic_id", CLINIC_ID)
      .order("weekday")
      .order("start_time"),
  ]);

  const docs = (doctors ?? []) as Doctor[];
  const tpls = (templates ?? []) as Template[];
  const docName = (id: string) => docs.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">門診表</h1>

      {/* 醫師 */}
      <section className="space-y-3">
        <h2 className="font-semibold">醫師</h2>
        <form action={createDoctorAction} className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3">
          <label className="text-sm">
            姓名
            <input name="name" required className="mt-1 block rounded border p-2" />
          </label>
          <label className="text-sm">
            專長
            <input name="specialty" className="mt-1 block rounded border p-2" />
          </label>
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white">新增醫師</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <form key={d.id} action={toggleDoctorAction} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="active" value={String(d.active)} />
              <span className={d.active ? "" : "text-gray-400 line-through"}>
                {d.name}
                {d.specialty ? `(${d.specialty})` : ""}
              </span>
              <button className="text-xs text-blue-600">{d.active ? "停用" : "啟用"}</button>
            </form>
          ))}
        </div>
      </section>

      {/* 門診段 */}
      <section className="space-y-3">
        <h2 className="font-semibold">門診段(同醫師同一天可多診次)</h2>
        <form action={createTemplateAction} className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3">
          <label className="text-sm">
            醫師
            <select name="doctor_id" required className="mt-1 block rounded border p-2">
              <option value="">選擇</option>
              {docs.filter((d) => d.active).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            星期
            <select name="weekday" className="mt-1 block rounded border p-2" defaultValue="1">
              {WD.map((w, i) => (
                <option key={i} value={i}>
                  週{w}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            開始
            <input type="time" name="start_time" required className="mt-1 block rounded border p-2" />
          </label>
          <label className="text-sm">
            結束
            <input type="time" name="end_time" required className="mt-1 block rounded border p-2" />
          </label>
          <label className="text-sm">
            每格(分)
            <input type="number" name="slot_minutes" defaultValue={15} className="mt-1 block w-20 rounded border p-2" />
          </label>
          <label className="text-sm">
            容量/總號
            <input type="number" name="capacity" defaultValue={1} className="mt-1 block w-20 rounded border p-2" />
          </label>
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white">新增門診段</button>
        </form>

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="p-2">星期</th>
                <th className="p-2">醫師</th>
                <th className="p-2">時間</th>
                <th className="p-2">每格</th>
                <th className="p-2">容量/總號</th>
                <th className="p-2">狀態</th>
                <th className="p-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {tpls.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-gray-400">
                    尚無門診段
                  </td>
                </tr>
              )}
              {tpls.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">週{WD[t.weekday]}</td>
                  <td className="p-2">{docName(t.doctor_id)}</td>
                  <td className="p-2">
                    {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                  </td>
                  <td className="p-2">{t.slot_minutes} 分</td>
                  <td className="p-2">{t.capacity}</td>
                  <td className="p-2">{t.active ? "啟用" : "停用"}</td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <form action={toggleTemplateAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="active" value={String(t.active)} />
                        <button className="text-xs text-blue-600">{t.active ? "停用" : "啟用"}</button>
                      </form>
                      <form action={deleteTemplateAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="text-xs text-red-600">刪除</button>
                      </form>
                    </div>
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
