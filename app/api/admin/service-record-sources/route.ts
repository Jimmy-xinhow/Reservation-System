import { NextRequest } from "next/server";
import { getOptionalMember, hasBrandPermission } from "@/lib/admin";
import { adminQuery } from "@/lib/admin-query";
import { ok, fail } from "@/lib/http";
import { formatDateTime } from "@/lib/slots";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
type Relation<T> = T | T[] | null;
type Person = { name: string; clinic_id: string };
type Appointment = { id: string; start_at: string; status: string; patients: Relation<Person>; services: Relation<{ name: string }> };
type Registration = { id: string; created_at: string; status: string; patients: Relation<Person>; events: Relation<{ title: string }>; event_sessions: Relation<{ name: string; start_at: string }> };
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export async function GET(req: NextRequest) {
  let member;
  try { member = await getOptionalMember(); }
  catch { return fail("暫時無法確認登入權限，請重新載入後再試", 500); }
  if (!member) return fail("請先登入品牌後台", 401);
  if (!hasBrandPermission(member, "operations.manage") && !hasBrandPermission(member, "brand.manage")) {
    return fail("目前帳號沒有日常營運權限", 403);
  }

  const params = req.nextUrl.searchParams;
  const raw = (params.get("q") ?? "").trim();
  const q = raw.replace(/[,%()*._\\]/g, " ").replace(/\s+/g, " ").trim();
  const page = Number(params.get("page") ?? "0");
  const kind = params.get("kind") ?? "all";
  if (raw.length > 80 || !Number.isSafeInteger(page) || page < 0 || page > 10000 || !["all", "appointment", "registration"].includes(kind)) {
    return fail("搜尋條件不正確", 400);
  }
  if (raw && q.length < 2) return fail("請輸入至少兩個字或數字", 400);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  try {
    const service = createServiceClient();
    const appointmentQuery = () => {
      const patient = q ? "patients!inner(name,clinic_id)" : "patients(name,clinic_id)";
      let query = service.from("appointments")
        .select(`id, start_at, status, ${patient}, services(name)`)
        .eq("clinic_id", member.clinicId)
        .neq("status", "cancelled");
      if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`, { referencedTable: "patients" });
      return query.order("start_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    };
    const registrationQuery = () => {
      const patient = q ? "patients!inner(name,clinic_id)" : "patients(name,clinic_id)";
      let query = service.from("registrations")
        .select(`id, created_at, status, ${patient}, events(title), event_sessions(name,start_at)`)
        .eq("clinic_id", member.clinicId)
        .not("patient_id", "is", null)
        .not("status", "in", "(cancelled,waitlisted)");
      if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`, { referencedTable: "patients" });
      return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    };
    const [appointmentResult, registrationResult] = await adminQuery(Promise.all([
      kind === "registration" ? Promise.resolve({ data: [] as Appointment[], error: null }) : appointmentQuery(),
      kind === "appointment" ? Promise.resolve({ data: [] as Registration[], error: null }) : registrationQuery(),
    ]));
    if (appointmentResult.error || registrationResult.error || !Array.isArray(appointmentResult.data) || !Array.isArray(registrationResult.data)) {
      return fail("讀取服務來源失敗，請重新載入後再試", 500);
    }
    // Service-role joins bypass RLS: discard a source if its linked patient
    // is absent or belongs to another brand, including while old data is repaired.
    const appointments = (appointmentResult.data as unknown as Appointment[])
      .filter(item => one(item.patients)?.clinic_id === member.clinicId);
    const registrations = (registrationResult.data as unknown as Registration[])
      .filter(item => one(item.patients)?.clinic_id === member.clinicId);
    const sources = [
      ...appointments.slice(0, PAGE_SIZE).map(item => ({
        id: item.id, kind: "appointment" as const,
        label: `${formatDateTime(item.start_at)}｜${one(item.patients)?.name ?? "顧客"}｜${one(item.services)?.name ?? "服務"}`,
      })),
      ...registrations.slice(0, PAGE_SIZE).map(item => {
        const session = one(item.event_sessions);
        return { id: item.id, kind: "registration" as const,
          label: `${formatDateTime(session?.start_at ?? item.created_at)}｜${one(item.patients)?.name ?? "學員"}｜${one(item.events)?.title ?? session?.name ?? "課程／活動"}` };
      }),
    ];
    return ok({ sources, hasMore: appointments.length > PAGE_SIZE || registrations.length > PAGE_SIZE });
  } catch {
    return fail("讀取服務來源失敗，請重新載入後再試", 500);
  }
}
