import { NextRequest } from "next/server";
import { requireNonProvider, canViewSensitiveCustomerData } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  try {
    const member = await requireNonProvider();
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim().replace(/[,%()*]/g, "");
    const status = ["pending", "confirmed", "cancelled", "waitlisted", "attended", "no_show"].includes(params.get("status") ?? "") ? params.get("status") : null;
    const supabase = await createSupabaseServer();
    let query = supabase.from("registrations").select("registration_no, status, payment_status, amount, discount_amount, membership_id, name, phone, email, created_at, events(title), event_sessions(name, start_at)").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }).limit(1000);
    if (status) query = query.eq("status", status);
    if (q) query = query.or(`registration_no.ilike.%${q}%,name.ilike.%${q}%,phone.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) return fail(error.message, 500);
    const pii = canViewSensitiveCustomerData(member.role);
    if (params.get("format") !== "csv") {
      const responseData = pii
        ? data ?? []
        : (data ?? []).map((row) => {
            const safe = { ...(row as Record<string, unknown>) };
            delete safe.name;
            delete safe.phone;
            delete safe.email;
            return safe;
          });
      return Response.json({ ok: true, data: responseData });
    }
    const header = pii ? ["registration_no", "status", "payment_status", "amount", "discount_amount", "membership_used", "name", "phone", "email", "created_at"] : ["registration_no", "status", "payment_status", "amount", "discount_amount", "membership_used", "created_at"];
    const lines = [header.map(csv).join(",")];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const values = pii ? [row.registration_no, row.status, row.payment_status, row.amount, row.discount_amount, row.membership_id ? 1 : 0, row.name, row.phone, row.email, row.created_at] : [row.registration_no, row.status, row.payment_status, row.amount, row.discount_amount, row.membership_id ? 1 : 0, row.created_at];
      lines.push(values.map(csv).join(","));
    }
    return new Response("\uFEFF" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=registrations.csv" } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "無法取得報名資料", 401);
  }
}
