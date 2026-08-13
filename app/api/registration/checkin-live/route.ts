import { NextRequest } from "next/server";
import { requireOperator } from "@/lib/admin";
import { fail, ok } from "@/lib/http";
import { isAdminModuleEnabled } from "@/lib/admin-modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const member = await requireOperator();
    if (!(await isAdminModuleEnabled(member.supabase, member.clinicId, "events"))) return fail("此品牌未啟用活動與報名", 403);
    const date = request.nextUrl.searchParams.get("date")?.trim() || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("日期格式不正確");
    const start = new Date(`${date}T00:00:00+08:00`).toISOString();
    const end = new Date(`${date}T23:59:59+08:00`).toISOString();
    const { data, error } = await member.supabase.from("registrations")
      .select("id, registration_no, status, name, phone, events(title), event_sessions!inner(name, start_at, end_at)")
      .eq("clinic_id", member.clinicId)
      .in("status", ["confirmed", "attended", "no_show"])
      .gte("event_sessions.start_at", start)
      .lte("event_sessions.start_at", end)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return fail(error.message, 500);
    return ok(data ?? []);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "載入報到名單失敗", 500);
  }
}
