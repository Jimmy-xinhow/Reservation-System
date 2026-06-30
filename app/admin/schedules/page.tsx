import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import {
  createTemplateAction,
  updateTemplateAction,
  toggleTemplateAction,
  deleteTemplateAction,
  createDoctorAction,
  updateDoctorAction,
  toggleDoctorAction,
} from "../actions";
import ScheduleEditor from "../_components/ScheduleEditor";
import EntityManager from "../_components/EntityManager";

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
      <EntityManager
        title="醫師"
        nameLabel="姓名"
        secondaryLabel="專長"
        secondaryField="specialty"
        items={docs.map((d) => ({ id: d.id, name: d.name, secondary: d.specialty, active: d.active }))}
        createAction={createDoctorAction}
        updateAction={updateDoctorAction}
        toggleAction={toggleDoctorAction}
      />

      {/* 門診段 */}
      <ScheduleEditor
        doctors={docs}
        templates={tpls}
        createAction={createTemplateAction}
        updateAction={updateTemplateAction}
        toggleAction={toggleTemplateAction}
        deleteAction={deleteTemplateAction}
      />
    </div>
  );
}
