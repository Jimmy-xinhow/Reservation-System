import { NextRequest } from "next/server";
import { requireNonProvider, canViewSensitiveCustomerData } from "@/lib/admin";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validDate(value: string | null, fallback: string): string { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback; }
function today(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()); }
function csvCell(value: unknown): string { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

export async function GET(req: NextRequest) {
  try {
    const member = await requireNonProvider();
    const end = validDate(req.nextUrl.searchParams.get("to"), today());
    const start = validDate(req.nextUrl.searchParams.get("from"), end);
    const startIso = new Date(`${start}T00:00:00+08:00`).toISOString();
    const endIso = new Date(`${end}T23:59:59.999+08:00`).toISOString();
    const [appointments, registrations] = await Promise.all([
      fetchAllSupabasePages((from, to) => member.supabase.from("appointments").select("id, start_at, status, source, membership_id, patients(name, phone), doctors(name), services(name)").eq("clinic_id", member.clinicId).gte("start_at", startIso).lte("start_at", endIso).order("start_at").order("id").range(from, to)),
      fetchAllSupabasePages((from, to) => member.supabase.from("registrations").select("id, created_at, registration_no, status, payment_status, amount, discount_amount, membership_id, name, phone, events(title), event_sessions(name), event_ticket_types(name)").eq("clinic_id", member.clinicId).gte("created_at", startIso).lte("created_at", endIso).order("created_at").order("id").range(from, to)),
    ]);
    const includePii = canViewSensitiveCustomerData(member.role);
    const appointmentRows = (appointments ?? []) as unknown as Array<{ id: string; start_at: string; status: string; source: string | null; membership_id: string | null; patients: { name: string; phone: string } | { name: string; phone: string }[] | null; doctors: { name: string } | { name: string }[] | null; services: { name: string } | { name: string }[] | null }>;
    const registrationRows = (registrations ?? []) as unknown as Array<{ registration_no: string; created_at: string; status: string; payment_status: string; amount: number; discount_amount: number; membership_id: string | null; name: string; phone: string; events: { title: string } | { title: string }[] | null; event_sessions: { name: string } | { name: string }[] | null; event_ticket_types: { name: string } | { name: string }[] | null }>;
    const relationName = <T extends { name: string }>(value: T | T[] | null): string => (Array.isArray(value) ? value[0]?.name : value?.name) ?? "";
    const relationTitle = (value: { title: string } | { title: string }[] | null): string => (Array.isArray(value) ? value[0]?.title : value?.title) ?? "";
    const lines = [
      ["類型", "編號", "日期", "狀態", "付款狀態", "金額", "優惠折抵", "套票扣抵", "來源", "服務提供者", "服務", "活動", "場次", "票種", "顧客姓名", "顧客電話"].map(csvCell).join(","),
      ...appointmentRows.map((row) => ["預約", row.id, row.start_at, row.status, "", "", "", row.membership_id ? 1 : 0, row.source ?? "", relationName(row.doctors), relationName(row.services), "", "", "", includePii ? (Array.isArray(row.patients) ? row.patients[0]?.name : row.patients?.name) : "", includePii ? (Array.isArray(row.patients) ? row.patients[0]?.phone : row.patients?.phone) : ""].map(csvCell).join(",")),
      ...registrationRows.map((row) => ["報名", row.registration_no, row.created_at, row.status, row.payment_status, row.amount, row.discount_amount, row.membership_id ? 1 : 0, "registration", "", "", relationTitle(row.events), relationName(row.event_sessions), relationName(row.event_ticket_types), includePii ? row.name : "", includePii ? row.phone : ""].map(csvCell).join(",")),
    ];
    return new Response(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="booking-report-${start}-${end}.csv"` } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "報表匯出失敗", { status: 500 });
  }
}
