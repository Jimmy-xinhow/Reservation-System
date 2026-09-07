import { canOperate, getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { CalendarWorkspace } from "./CalendarWorkspace";
import AppointmentEditor from "../appointments/AppointmentEditor";

export const dynamic = "force-dynamic";

interface Doctor { id: string; name: string; }

function todayTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ modal?: string; appointment_id?: string; date?: string }> }) {
  const [params, member] = await Promise.all([searchParams, requireMember()]);
  const supabase = member.supabase;
  const assigned = member.role === "provider" ? await getAssignedDoctorIds(member) : [];
  let query = supabase.from("doctors").select("id, name").eq("clinic_id", member.clinicId).eq("active", true).order("name");
  if (member.role === "provider") query = query.in("id", assigned.length ? assigned : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const modal = params.modal === "new" || params.modal === "reschedule" ? params.modal : null;
  return <>
    <CalendarWorkspace doctors={(data ?? []) as Doctor[]} initialDate={todayTaipei()} canOperate={canOperate(member.role)} />
    {modal && <AppointmentEditor appointmentId={modal === "reschedule" ? params.appointment_id : undefined} date={params.date} returnTo="/admin/calendar" variant="modal" />}
  </>;
}
