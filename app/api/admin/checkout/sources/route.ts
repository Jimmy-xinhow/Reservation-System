import { NextRequest } from "next/server";
import { getOptionalMember, hasBrandPermission } from "@/lib/admin";
import { adminQuery } from "@/lib/admin-query";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
type Kind = "appointment" | "registration" | "patient";
type Relation<T> = T | T[] | null;
type Appointment = { id: string; start_at: string; patients: Relation<{ name: string }>; services: Relation<{ name: string; price: number }> };
type Registration = { id: string; registration_no: string; name: string; amount: number; events: Relation<{ title: string }> };
type Patient = { id: string; name: string; phone: string };
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function dateTime(value: string): string { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

export async function GET(req: NextRequest) {
  let member;
  try { member = await getOptionalMember(); }
  catch { return fail("暫時無法確認登入權限，請重新載入後再試", 500); }
  if (!member) return fail("請先登入品牌後台", 401);
  if (!hasBrandPermission(member, "operations.manage") && !hasBrandPermission(member, "brand.manage")) {
    return fail("目前帳號沒有結帳權限", 403);
  }

  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");
  const raw = (params.get("q") ?? "").trim();
  const q = raw.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const page = Number(params.get("page") ?? "0");
  if (!kind || !["appointment", "registration", "patient"].includes(kind) || raw.length > 80
    || !Number.isSafeInteger(page) || page < 0 || page > 10000) return fail("搜尋條件不正確", 400);
  if (raw && q.length < 2) return fail("請輸入至少兩個字或數字", 400);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE;
  const supabase = member.supabase;

  try {
    if (kind === "appointment") {
      let query = supabase.from("appointments")
        .select(`id, start_at, ${q ? "patients!inner(name)" : "patients(name)"}, services(name,price)`)
        .eq("clinic_id", member.clinicId)
        .in("status", ["booked", "confirmed", "done"]);
      if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`, { referencedTable: "patients" });
      const { data, error } = await adminQuery(query.order("start_at", { ascending: false }).order("id", { ascending: false }).range(from, to));
      if (error || !Array.isArray(data)) return fail("讀取結帳來源失敗，請稍後再試", 500);
      const rows = data as unknown as Appointment[];
      return ok({ options: rows.slice(0, PAGE_SIZE).map((row) => ({ value: `appointment:${row.id}`, kind: "appointment" as const, label: `${dateTime(row.start_at)} · ${one(row.patients)?.name ?? "顧客"} · ${one(row.services)?.name ?? "一般服務"}`, amount: Number(one(row.services)?.price ?? 0) })), hasMore: rows.length > PAGE_SIZE });
    }
    if (kind === "registration") {
      let query = supabase.from("registrations")
        .select("id, registration_no, name, amount, events(title)")
        .eq("clinic_id", member.clinicId)
        .in("status", ["pending", "confirmed", "attended"]);
      if (q) query = query.or(`name.ilike.%${q}%,registration_no.ilike.%${q}%`);
      const { data, error } = await adminQuery(query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to));
      if (error || !Array.isArray(data)) return fail("讀取結帳來源失敗，請稍後再試", 500);
      const rows = data as Registration[];
      return ok({ options: rows.slice(0, PAGE_SIZE).map((row) => ({ value: `registration:${row.id}`, kind: "registration" as const, label: `${row.registration_no} · ${row.name} · ${one(row.events)?.title ?? "活動"}`, amount: Number(row.amount) })), hasMore: rows.length > PAGE_SIZE });
    }
    const patientKind: Kind = "patient";
    let query = supabase.from("patients")
      .select("id, name, phone")
      .eq("clinic_id", member.clinicId)
      .eq("active", true);
    if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
    const { data, error } = await adminQuery(query.order("name").order("id").range(from, to));
    if (error || !Array.isArray(data)) return fail("讀取結帳來源失敗，請稍後再試", 500);
    const rows = data as Patient[];
    return ok({ options: rows.slice(0, PAGE_SIZE).map((row) => ({ value: `patient:${row.id}`, kind: patientKind, label: `${row.name} · 電話末四碼 ${row.phone.slice(-4)}`, amount: null })), hasMore: rows.length > PAGE_SIZE });
  } catch {
    return fail("讀取結帳來源失敗，請稍後再試", 500);
  }
}
