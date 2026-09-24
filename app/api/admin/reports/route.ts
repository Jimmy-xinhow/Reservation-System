import { reportRange } from "@/lib/report-range";
import { fail } from "@/lib/http";
import { NextRequest } from "next/server";
import { requireNonProvider, canViewSensitiveCustomerData } from "@/lib/admin";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string { return `"${( /^[\s]*[=+@-]/.test(String(value ?? "")) ? "'" + String(value ?? "") : String(value ?? "") ).replace(/"/g, '""')}"`; }

export async function GET(req: NextRequest) {
  // Keep authentication/permission redirects outside the report error handler.
  const member = await requireNonProvider();
  try {
    const range = reportRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));
    const { startDate: start, endDate: end, start: startIso, end: endIso } = range;
    const [appointments, registrations, salesPayments, payments, deliveries, waitlist] = await Promise.all([
      fetchAllSupabasePages((from, to) => member.supabase.from("appointments").select("id, start_at, status, source, membership_id, patients(name, phone), doctors(name), services(name)").eq("clinic_id", member.clinicId).gte("start_at", startIso).lte("start_at", endIso).order("start_at").order("id").range(from, to)),
      fetchAllSupabasePages((from, to) => member.supabase.from("registrations").select("id, created_at, registration_no, status, payment_status, amount, discount_amount, membership_id, name, phone, events(title), event_sessions(name), event_ticket_types(name)").eq("clinic_id", member.clinicId).gte("created_at", startIso).lte("created_at", endIso).order("created_at").order("id").range(from, to)),
      fetchAllSupabasePages((from, to) => member.supabase.from("sales_payments").select("id, received_at, method, amount, reference, sales_orders(order_no, patients(name, phone))").eq("clinic_id", member.clinicId).gte("received_at", startIso).lte("received_at", endIso).order("received_at").order("id").range(from, to)),
      fetchAllSupabasePages((from, to) => member.supabase.from("payment_orders").select("id, merchant_order_no, created_at, status, amount").eq("clinic_id", member.clinicId).gte("created_at", startIso).lte("created_at", endIso).order("created_at").order("id").range(from, to)),
      fetchAllSupabasePages((from, to) => member.supabase.from("crm_delivery_logs").select("id, created_at, status").eq("clinic_id", member.clinicId).gte("created_at", startIso).lte("created_at", endIso).order("created_at").order("id").range(from, to)),
      fetchAllSupabasePages((from, to) => member.supabase.from("waitlist_entries").select("id, created_at, status").eq("clinic_id", member.clinicId).gte("created_at", startIso).lte("created_at", endIso).order("created_at").order("id").range(from, to)),
    ]);
    const includePii = canViewSensitiveCustomerData(member.role);
    const appointmentRows = (appointments ?? []) as unknown as Array<{ id: string; start_at: string; status: string; source: string | null; membership_id: string | null; patients: { name: string; phone: string } | { name: string; phone: string }[] | null; doctors: { name: string } | { name: string }[] | null; services: { name: string } | { name: string }[] | null }>;
    const registrationRows = (registrations ?? []) as unknown as Array<{ registration_no: string; created_at: string; status: string; payment_status: string; amount: number; discount_amount: number; membership_id: string | null; name: string; phone: string; events: { title: string } | { title: string }[] | null; event_sessions: { name: string } | { name: string }[] | null; event_ticket_types: { name: string } | { name: string }[] | null }>;
    const salesPaymentRows = (salesPayments ?? []) as unknown as Array<{ id: string; received_at: string; method: string; amount: number; reference: string | null; sales_orders: { order_no: string; patients: { name: string; phone: string } | { name: string; phone: string }[] | null } | Array<{ order_no: string; patients: { name: string; phone: string } | { name: string; phone: string }[] | null }> | null }>;
    const relationName = <T extends { name: string }>(value: T | T[] | null): string => (Array.isArray(value) ? value[0]?.name : value?.name) ?? "";
    const relationTitle = (value: { title: string } | { title: string }[] | null): string => (Array.isArray(value) ? value[0]?.title : value?.title) ?? "";
    const paymentRows = payments as Array<{ id: string; merchant_order_no: string; created_at: string; status: string; amount: number }>;
    const deliveryRows = deliveries as Array<{ id: string; created_at: string; status: string }>;
    const waitlistRows = waitlist as Array<{ id: string; created_at: string; status: string }>;
    const lines = [
      ["類型", "編號", "日期", "狀態", "付款狀態", "金額", "優惠折抵", "套票扣抵", "來源", "服務提供者", "服務", "活動", "場次", "票種", "顧客姓名", "顧客電話"].map(csvCell).join(","),
      ...appointmentRows.map((row) => ["預約", row.id, row.start_at, row.status, "", "", "", row.membership_id ? 1 : 0, row.source ?? "", relationName(row.doctors), relationName(row.services), "", "", "", includePii ? (Array.isArray(row.patients) ? row.patients[0]?.name : row.patients?.name) : "", includePii ? (Array.isArray(row.patients) ? row.patients[0]?.phone : row.patients?.phone) : ""].map(csvCell).join(",")),
      ...registrationRows.map((row) => ["報名", row.registration_no, row.created_at, row.status, row.payment_status, row.amount, row.discount_amount, row.membership_id ? 1 : 0, "registration", "", "", relationTitle(row.events), relationName(row.event_sessions), relationName(row.event_ticket_types), includePii ? row.name : "", includePii ? row.phone : ""].map(csvCell).join(",")),
      ...salesPaymentRows.map((row) => { const order = Array.isArray(row.sales_orders) ? row.sales_orders[0] : row.sales_orders; const patient = order ? (Array.isArray(order.patients) ? order.patients[0] : order.patients) : null; return ["後台收款", order?.order_no ?? row.id, row.received_at, "received", row.method, row.amount, "", "", row.reference ?? "", "", "", "", "", "", includePii ? patient?.name ?? "" : "", includePii ? patient?.phone ?? "" : ""].map(csvCell).join(","); }),
      ...paymentRows.map((row) => ["線上付款", row.merchant_order_no || row.id, row.created_at, row.status, row.status, row.amount, "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(",")),
      ...deliveryRows.map((row) => ["CRM 投遞", row.id, row.created_at, row.status, "", "", "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(",")),
      ...waitlistRows.map((row) => ["候補", row.id, row.created_at, row.status, "", "", "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(",")),
    ];
    return new Response(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="booking-report-${start}-${end}.csv"` } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "報表匯出失敗", 500);
  }
}
