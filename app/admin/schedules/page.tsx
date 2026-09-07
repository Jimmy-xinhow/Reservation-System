import { createSupabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";
import {
  createTemplateAction,
  updateTemplateAction,
  toggleTemplateAction,
  deleteTemplateAction,
  createDoctorAction,
  updateDoctorAction,
  toggleDoctorAction,
} from "../schedule-actions";
import ScheduleEditor from "../_components/ScheduleEditor";
import EntityManager from "../_components/EntityManager";
import { ServiceSetupTabs } from "@/components/admin/ManagementTabs";

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
  const activeDoctors = docs.filter((doctor) => doctor.active).length;
  const activeTemplates = tpls.filter((template) => template.active).length;
  const resourceOnlyTemplates = tpls.filter((template) => template.active && !template.doctor_id && template.service_id).length;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">排班設定</p>
          <h1 className="admin-page-title">人員與服務時段</h1>
          <p className="admin-page-description">先建立服務人員，再設定每週可預約時段；場地或設備型服務可直接用服務建立時段。</p>
        </div>
      </header>

      <ServiceSetupTabs active="schedules" />

      <section className="admin-metric-strip grid-cols-3" aria-label="排班摘要">
        <div className="admin-metric"><span className="admin-metric-label">啟用服務人員</span><strong className="admin-metric-value">{activeDoctors}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">啟用時段</span><strong className="admin-metric-value">{activeTemplates}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">免指定人員時段</span><strong className="admin-metric-value">{resourceOnlyTemplates}</strong></div>
      </section>

      <EntityManager
        title="服務提供者"
        description="管理顧客可指定或由系統安排的服務人員。"
        nameLabel="姓名"
        secondaryLabel="專長"
        secondaryField="specialty"
        items={docs.map((d) => ({ id: d.id, name: d.name, secondary: d.specialty, active: d.active }))}
        createAction={createDoctorAction}
        updateAction={updateDoctorAction}
        toggleAction={toggleDoctorAction}
      />

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
