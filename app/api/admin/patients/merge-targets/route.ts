import { NextRequest } from "next/server";
import { getOptionalMember, hasBrandPermission } from "@/lib/admin";
import { adminQuery } from "@/lib/admin-query";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Patient = { id: string; name: string; phone: string };

export async function GET(req: NextRequest) {
  let member;
  try { member = await getOptionalMember(); }
  catch { return fail("暫時無法確認登入權限，請重新載入後再試", 500); }
  if (!member) return fail("請先登入品牌後台", 401);
  if (!hasBrandPermission(member, "brand.manage")) return fail("目前帳號沒有合併顧客權限", 403);

  const params = req.nextUrl.searchParams;
  const sourceId = params.get("source") ?? "";
  const raw = (params.get("q") ?? "").trim();
  const q = raw.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const page = Number(params.get("page") ?? "0");
  if (!UUID.test(sourceId) || raw.length > 80 || q.length < 2 || !Number.isSafeInteger(page) || page < 0 || page > 10000) {
    return fail("搜尋條件不正確", 400);
  }

  try {
    const supabase = member.supabase;
    const { data: source, error: sourceError } = await adminQuery(supabase.from("patients")
      .select("id").eq("clinic_id", member.clinicId).eq("id", sourceId).eq("active", true).maybeSingle());
    if (sourceError) return fail("讀取顧客失敗，請稍後再試", 500);
    if (!source) return fail("找不到要合併的顧客", 404);

    const from = page * PAGE_SIZE;
    const { data, error } = await adminQuery(supabase.from("patients")
      .select("id, name, phone")
      .eq("clinic_id", member.clinicId)
      .eq("active", true)
      .neq("id", sourceId)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("name")
      .order("id")
      .range(from, from + PAGE_SIZE));
    if (error || !Array.isArray(data)) return fail("讀取顧客失敗，請稍後再試", 500);
    const rows = data as Patient[];
    return ok({
      options: rows.slice(0, PAGE_SIZE).map((row) => ({ id: row.id, label: `${row.name} · 電話末四碼 ${row.phone.slice(-4)}` })),
      hasMore: rows.length > PAGE_SIZE,
    });
  } catch {
    return fail("讀取顧客失敗，請稍後再試", 500);
  }
}
