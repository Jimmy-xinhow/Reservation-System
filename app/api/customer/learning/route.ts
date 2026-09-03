import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { fail, ok } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LearningRequest {
  browser_token?: string;
  action?: "complete" | "uncomplete";
  unit_id?: string;
}

interface RegistrationRow {
  id: string;
  event_id: string;
  status: string;
  payment_status: string;
  expires_at: string | null;
  events: { title: string } | { title: string }[] | null;
}

interface UnitRow {
  id: string;
  event_id: string;
  title: string;
  summary: string | null;
  unit_type: "video" | "link" | "download" | "text";
  content_url: string | null;
  body: string | null;
  access_rule: "registered" | "paid" | "attended";
  sort_order: number;
}

function eventTitle(value: RegistrationRow["events"]): string {
  return Array.isArray(value) ? value[0]?.title ?? "未命名課程" : value?.title ?? "未命名課程";
}

function canAccess(unit: UnitRow, registration: RegistrationRow): boolean {
  const isActivePending = registration.status === "pending"
    && (!registration.expires_at || new Date(registration.expires_at).getTime() > Date.now());
  const isConfirmed = ["confirmed", "attended"].includes(registration.status);
  if (!isActivePending && !isConfirmed) return false;
  if (unit.access_rule === "attended") return registration.status === "attended";
  if (unit.access_rule === "paid") {
    return isConfirmed && ["paid", "not_required"].includes(registration.payment_status);
  }
  return true;
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, "customer:learning", 30);
  if (!rate.allowed) return fail("操作太頻繁，請稍後再試", 429);
  try {
    const body = await request.json().catch(() => null) as LearningRequest | null;
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(request, service);
    if (!clinicId) return fail("找不到品牌入口", 404);
    const identity = body?.browser_token?.trim() ? verifyBrowserBookingToken(body.browser_token.trim()) : null;
    if (!identity) return fail("顧客身分已過期，請重新驗證", 401);
    if (identity.clinicId !== clinicId) return fail("品牌入口不相符", 403);

    const { data: patient, error: patientError } = await service.from("patients").select("id, name").eq("id", identity.patientId).eq("clinic_id", clinicId).eq("active", true).maybeSingle();
    if (patientError) throw new Error(patientError.message);
    if (!patient) return fail("找不到顧客資料", 404);

    const { data: registrationsData, error: registrationsError } = await service
      .from("registrations")
      .select("id, event_id, status, payment_status, expires_at, events(title)")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id)
      .in("status", ["pending", "confirmed", "attended"]);
    if (registrationsError) throw new Error(registrationsError.message);
    const registrations = (registrationsData ?? []) as unknown as RegistrationRow[];
    const eventIds = [...new Set(registrations.map((registration) => registration.event_id))];
    if (eventIds.length === 0) return ok({ patient, courses: [] });

    const { data: unitsData, error: unitsError } = await service
      .from("course_units")
      .select("id, event_id, title, summary, unit_type, content_url, body, access_rule, sort_order")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .in("event_id", eventIds)
      .order("sort_order")
      .order("created_at");
    if (unitsError) throw new Error(unitsError.message);
    const units = (unitsData ?? []) as UnitRow[];

    if (body?.action) {
      const unit = units.find((item) => item.id === body.unit_id);
      if (!unit) return fail("找不到可使用的教材單元", 404);
      const registration = registrations.find((item) => item.event_id === unit.event_id && canAccess(unit, item));
      if (!registration) return fail("尚未符合這個教材的開放條件", 403);
      if (body.action === "complete") {
        const { error } = await service.from("course_unit_progress").upsert({
          clinic_id: clinicId,
          event_id: unit.event_id,
          unit_id: unit.id,
          registration_id: registration.id,
          patient_id: patient.id,
          completed_at: new Date().toISOString(),
        }, { onConflict: "registration_id,unit_id" });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await service.from("course_unit_progress").delete().eq("clinic_id", clinicId).eq("patient_id", patient.id).eq("unit_id", unit.id);
        if (error) throw new Error(error.message);
      }
    }

    const accessible = units.filter((unit) => registrations.some((registration) => registration.event_id === unit.event_id && canAccess(unit, registration)));
    const { data: progressData, error: progressError } = accessible.length > 0
      ? await service.from("course_unit_progress").select("unit_id, completed_at").eq("clinic_id", clinicId).eq("patient_id", patient.id).in("unit_id", accessible.map((unit) => unit.id))
      : { data: [], error: null };
    if (progressError) throw new Error(progressError.message);
    const completed = new Map((progressData ?? []).map((row) => [String(row.unit_id), String(row.completed_at)]));
    const courses = eventIds.map((eventId) => {
      const registration = registrations.find((item) => item.event_id === eventId);
      const courseUnits = accessible.filter((unit) => unit.event_id === eventId).map((unit) => ({ ...unit, completed_at: completed.get(unit.id) ?? null }));
      return registration && courseUnits.length > 0 ? { event_id: eventId, title: eventTitle(registration.events), units: courseUnits } : null;
    }).filter((course): course is NonNullable<typeof course> => course !== null);

    return ok({ patient, courses });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "學習內容載入失敗", 500);
  }
}
