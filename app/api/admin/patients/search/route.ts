import { NextRequest } from "next/server";
import { requireMember } from "@/lib/admin";
import { CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Hit = { id: string; name: string; phone: string; birthday: string | null };

// GET /api/admin/patients/search?q=...
// 後台建立預約時,依姓名 / 電話 / 生日搜尋既有病患,方便直接套入。
// 生日可輸入完整 YYYY-MM-DD,或四碼 MMDD(如 0315 = 3/15,不分年份)。
export async function GET(req: NextRequest) {
  let supabase;
  try {
    ({ supabase } = await requireMember());
  } catch {
    return fail("未授權", 401);
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[,%()*]/g, "");
  if (!q) return ok({ patients: [] });

  const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(q);
  // 四碼數字 = MMDD;驗證月(01-12)日(01-31)才視為生日搜尋。
  const mmdd = /^\d{4}$/.test(q) ? q : null;
  const mm = mmdd ? Number(mmdd.slice(0, 2)) : 0;
  const dd = mmdd ? Number(mmdd.slice(2, 4)) : 0;
  const isMonthDay = !!mmdd && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;

  const orParts = [`name.ilike.%${q}%`, `phone.ilike.%${q}%`];
  if (isFullDate) orParts.push(`birthday.eq.${q}`);

  const { data, error } = await supabase
    .from("patients")
    .select("id, name, phone, birthday")
    .eq("clinic_id", CLINIC_ID)
    .eq("active", true)
    .or(orParts.join(","))
    .order("name")
    .limit(10);
  if (error) return fail(error.message, 500);

  const hits: Hit[] = data ?? [];

  // MMDD:PostgREST 無法對 date 抽月/日,改在此處掃描生日後合併。
  if (isMonthDay) {
    const suffix = `-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`; // -MM-DD
    const { data: withBday, error: bErr } = await supabase
      .from("patients")
      .select("id, name, phone, birthday")
      .eq("clinic_id", CLINIC_ID)
      .eq("active", true)
      .not("birthday", "is", null)
      .order("name")
      .limit(1000);
    if (bErr) return fail(bErr.message, 500);

    const seen = new Set(hits.map((h) => h.id));
    for (const p of (withBday ?? []) as Hit[]) {
      if (p.birthday?.endsWith(suffix) && !seen.has(p.id)) {
        seen.add(p.id);
        hits.push(p);
      }
    }
    hits.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }

  return ok({ patients: hits.slice(0, 10) });
}
