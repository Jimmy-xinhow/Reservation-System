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
      <h1 className="text-xl font-bold text-slate-900">門診表</h1>

      {/* 醫師 */}
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">醫師</h2>
        <form action={createDoctorAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="block text-sm font-medium text-slate-600">
            姓名
            <input name="name" required className="input mt-1" />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            專長
            <input name="specialty" className="input mt-1" />
          </label>
          <button className="btn btn-primary">新增醫師</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <form key={d.id} action={toggleDoctorAction} className="card flex items-center gap-2 px-3 py-2 text-sm">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="active" value={String(d.active)} />
              <span className={d.active ? "font-medium text-slate-700" : "text-slate-400 line-through"}>
                {d.name}
                {d.specialty ? `(${d.specialty})` : ""}
              </span>
              <button className="text-xs font-medium text-brand-600 hover:underline">
                {d.active ? "停用" : "啟用"}
              </button>
            </form>
          ))}
        </div>
      </section>

      {/* 門診段 */}
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">門診段(同醫師同一天可多診次)</h2>
        <form action={createTemplateAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="block text-sm font-medium text-slate-600">
            醫師
            <select name="doctor_id" required className="input mt-1">
              <option value="">選擇</option>
              {docs.filter((d) => d.active).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-600">
            星期
            <select name="weekday" className="input mt-1" defaultValue="1">
              {WD.map((w, i) => (
                <option key={i} value={i}>
                  週{w}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-600">
            開始
            <input type="time" name="start_time" required className="input mt-1" />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            結束
            <input type="time" name="end_time" required className="input mt-1" />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            每格(分)
            <input type="number" name="slot_minutes" defaultValue={15} className="input mt-1 w-24" />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            容量/總號
            <input type="number" name="capacity" defaultValue={1} className="input mt-1 w-24" />
          </label>
          <button className="btn btn-primary">新增門診段</button>
        </form>

        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>星期</th>
                <th>醫師</th>
                <th>時間</th>
                <th>每格</th>
                <th>容量/總號</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tpls.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    尚無門診段
                  </td>
                </tr>
              )}
              {tpls.map((t) => (
                <tr key={t.id}>
                  <td>週{WD[t.weekday]}</td>
                  <td>{docName(t.doctor_id)}</td>
                  <td>
                    {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                  </td>
                  <td>{t.slot_minutes} 分</td>
                  <td>{t.capacity}</td>
                  <td>
                    <span className={`badge ${t.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                      {t.active ? "啟用" : "停用"}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-3">
                      <form action={toggleTemplateAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="active" value={String(t.active)} />
                        <button className="text-xs font-medium text-brand-600 hover:underline">
                          {t.active ? "停用" : "啟用"}
                        </button>
                      </form>
                      <form action={deleteTemplateAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="text-xs font-medium text-red-600 hover:underline">刪除</button>
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
