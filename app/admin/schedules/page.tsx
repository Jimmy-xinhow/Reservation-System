import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin"
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
interface Service {
  id: string;
  name: string;
  active: boolean;
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

export default async function SchedulesPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  const [{ data: doctors }, { data: templates }, { data: services }] = await Promise.all([
    supabase.from("doctors").select("id, name, specialty, active").eq("clinic_id", clinicId).order("name"),
    supabase
      .from("schedule_templates")
      .select("id, doctor_id, service_id, weekday, start_time, end_time, slot_minutes, capacity, active")
      .eq("clinic_id", clinicId)
      .order("weekday")
      .order("start_time"),
    supabase.from("services").select("id, name, active").eq("clinic_id", clinicId).order("name"),
  ]);

  const docs = (doctors ?? []) as Doctor[];
  const tpls = (templates ?? []) as Template[];
  const serviceRows = (services ?? []) as Service[];

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-slate-900">服務排程</h1>

        {/* 服務提供者 */}
      <EntityManager
        title="服務提供者"
        nameLabel="姓名"
        secondaryLabel="專長"
        secondaryField="specialty"
        items={docs.map((d) => ({ id: d.id, name: d.name, secondary: d.specialty, active: d.active }))}
        createAction={createDoctorAction}
        updateAction={updateDoctorAction}
        toggleAction={toggleDoctorAction}
      />

        {/* 服務時段 */}
      <ScheduleEditor
        doctors={docs}
        services={serviceRows}
        templates={tpls}
        createAction={createTemplateAction}
        updateAction={updateTemplateAction}
        toggleAction={toggleTemplateAction}
        deleteAction={deleteTemplateAction}
      />
    </div>
  );
}
