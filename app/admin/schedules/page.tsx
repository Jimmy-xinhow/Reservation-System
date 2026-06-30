import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import {
  createTemplateAction,
  toggleTemplateAction,
  deleteTemplateAction,
  createDoctorAction,
  toggleDoctorAction,
} from "../actions";
import ScheduleEditor from "../_components/ScheduleEditor";

export const dynamic = "force-dynamic";

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
      <ScheduleEditor
        doctors={docs}
        templates={tpls}
        createAction={createTemplateAction}
        toggleAction={toggleTemplateAction}
        deleteAction={deleteTemplateAction}
      />
    </div>
  );
}
