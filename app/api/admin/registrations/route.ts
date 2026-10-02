import { NextRequest } from "next/server";
import { requireNonProvider, canViewSensitiveCustomerData } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import { fail } from "@/lib/http";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csv(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
function validUuid(value: string | null): value is string { return /^[0-9a-f-]{36}$/i.test(value ?? ""); }
function validDate(value: string | null): value is string { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? ""); }
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export async function GET(req: NextRequest) {
  const member = await requireNonProvider();
  try {
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim().replace(/[,%()*]/g, "");
    const status = ["pending", "confirmed", "cancelled", "waitlisted", "attended", "no_show"].includes(params.get("status") ?? "") ? params.get("status") : null;
    const eventId = validUuid(params.get("event_id")) ? params.get("event_id") as string : null;
    const sessionId = validUuid(params.get("session_id")) ? params.get("session_id") as string : null;
    const from = validDate(params.get("registered_from")) ? params.get("registered_from") as string : null;
    const to = validDate(params.get("registered_to")) ? params.get("registered_to") as string : null;
    const supabase = await createSupabaseServer();
    const pii = canViewSensitiveCustomerData(member.role);
    const projection = `event_id, session_id, registration_no, status, payment_status, amount, discount_amount, membership_id, created_at, events(title), event_sessions(name, start_at)${pii ? ", name, phone, email" : ""}`;
    const data = await fetchAllSupabasePages((pageFrom, pageTo) => {
      let query = supabase.from("registrations").select(projection).eq("clinic_id", member.clinicId);
      if (status) query = query.eq("status", status);
      if (eventId) query = query.eq("event_id", eventId);
      if (sessionId) query = query.eq("session_id", sessionId);
      if (from) query = query.gte("created_at", new Date(`${from}T00:00:00+08:00`).toISOString());
      if (to) query = query.lt("created_at", new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400000).toISOString());
      if (q) query = query.or(pii ? `registration_no.ilike.%${q}%,name.ilike.%${q}%,phone.ilike.%${q}%` : `registration_no.ilike.%${q}%`);
      return query.order("created_at", { ascending: false }).order("id").range(pageFrom, pageTo);
    });
    if (params.get("format") !== "csv") {
      return Response.json({ ok: true, data }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const header = pii ? ["event", "session", "session_start", "registration_no", "status", "payment_status", "amount", "discount_amount", "membership_used", "name", "phone", "email", "created_at"] : ["event", "session", "session_start", "registration_no", "status", "payment_status", "amount", "discount_amount", "membership_used", "created_at"];
    const lines = [header.map(csv).join(",")];
    for (const row of data as unknown as Array<Record<string, unknown>>) {
      const event = one(row.events); const session = one(row.event_sessions);
      const prefix = [event?.title, session?.name, session?.start_at, row.registration_no, row.status, row.payment_status, row.amount, row.discount_amount, row.membership_id ? 1 : 0];
      const values = pii ? [...prefix, row.name, row.phone, row.email, row.created_at] : [...prefix, row.created_at];
      lines.push(values.map(csv).join(","));
    }
    return new Response("\uFEFF" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=registrations.csv", "Cache-Control": "private, no-store" } });
  } catch {
    return fail("目前無法取得報名資料，請稍後再試", 500);
  }
}
