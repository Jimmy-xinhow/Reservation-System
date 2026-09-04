import { createSupabaseServer } from "@/lib/supabase-server";
import { canOperate, getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { CalendarWorkspace } from "./CalendarWorkspace";

export const dynamic = "force-dynamic";

interface Doctor { id: string; name: string; }

function todayTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export default async function CalendarPage() {
  const member = await requireMember();
  const supabase = await createSupabaseServer();
  const assigned = await getAssignedDoctorIds(member);
  let query = supabase.from("doctors").select("id, name").eq("clinic_id", member.clinicId).eq("active", true).order("name");
  if (member.role === "provider") query = query.in("id", assigned.length ? assigned : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return <CalendarWorkspace doctors={(data ?? []) as Doctor[]} initialDate={todayTaipei()} canOperate={canOperate(member.role)} />;
}
