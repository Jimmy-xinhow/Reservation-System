import { NextRequest } from "next/server";
import { requireMember } from "@/lib/admin";
import { CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/patients/search?q=...
// 後台建立預約時,依姓名 / 電話 / 生日搜尋既有病患,方便直接套入。
export async function GET(req: NextRequest) {
  let supabase;
  try {
    ({ supabase } = await requireMember());
  } catch {
    return fail("未授權", 401);
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[,%()*]/g, "");
  if (!q) return ok({ patients: [] });

  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(q);
  const orParts = [`name.ilike.%${q}%`, `phone.ilike.%${q}%`];
  if (isDate) orParts.push(`birthday.eq.${q}`);

  const { data, error } = await supabase
    .from("patients")
    .select("id, name, phone, birthday")
    .eq("clinic_id", CLINIC_ID)
    .eq("active", true)
    .or(orParts.join(","))
    .order("name")
    .limit(10);
  if (error) return fail(error.message, 500);
  return ok({ patients: data ?? [] });
}
