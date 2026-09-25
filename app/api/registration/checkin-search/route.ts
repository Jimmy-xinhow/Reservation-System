import { rpcFailure } from "@/lib/rpc-error";
import { NextRequest } from "next/server";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { isAdminModuleEnabled } from "@/lib/admin-modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const member = await requireOperator();
  try {
    if (!(await isAdminModuleEnabled(member.supabase, member.clinicId, "events"))) return fail("此品牌未啟用活動與報名", 403);
    const rawQuery = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const queryText = rawQuery.replace(/[,%()*]/g, "").slice(0, 80);
    const eventId = request.nextUrl.searchParams.get("event_id")?.trim() ?? "";
    const sessionId = request.nextUrl.searchParams.get("session_id")?.trim() ?? "";
    const date = request.nextUrl.searchParams.get("date")?.trim() ?? "";
    if (eventId && !/^[0-9a-f-]{36}$/i.test(eventId)) return fail("活動識別碼不正確");
    if (sessionId && !/^[0-9a-f-]{36}$/i.test(sessionId)) return fail("場次識別碼不正確");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("日期格式不正確");
    if (queryText.length < 2 && !sessionId) return ok([]);

    let query = member.supabase
      .from("registrations")
      .select("id, event_id, session_id, registration_no, status, name, phone, email, events(title), event_sessions!inner(name, start_at)")
      .eq("clinic_id", member.clinicId)
      .in("status", ["confirmed", "attended", "no_show"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (queryText.length >= 2) query = query.or(`registration_no.ilike.%${queryText}%,name.ilike.%${queryText}%,phone.ilike.%${queryText}%`);
    if (eventId) query = query.eq("event_id", eventId);
    if (sessionId) query = query.eq("session_id", sessionId);
    if (date) {
      query = query.gte("event_sessions.start_at", new Date(`${date}T00:00:00+08:00`).toISOString());
      query = query.lt("event_sessions.start_at", new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86400000).toISOString());
    }
    const { data, error } = await query;
    if (error) return fail(error.message, 500);
    return ok(data ?? []);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "無法搜尋報名資料", 500);
  }
}

export async function POST(request: NextRequest) {
  const member = await requireOperator();
  try {
    if (!(await isAdminModuleEnabled(member.supabase, member.clinicId, "events"))) return fail("此品牌未啟用活動與報名", 403);
    const body = (await request.json().catch(() => null)) as { registration_id?: string } | null;
    const registrationId = body?.registration_id?.trim() ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(registrationId)) return fail("報名資料識別碼無效", 400);

    const svc = createServiceClient();
    const { data, error } = await svc.rpc("checkin_registration_by_id", {
      p_clinic_id: member.clinicId,
      p_registration_id: registrationId,
      p_user_id: member.user.id,
    });
    if (error) return rpcFailure(error, "checkin");
    const receipt = Array.isArray(data) ? data[0] : data;
    if (!receipt) return fail("找不到報名資料", 404);
    return ok(receipt);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "報到失敗", 500);
  }
}
