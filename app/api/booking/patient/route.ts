import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { ok, fail, getClinicSettings } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/patient
 * body: { idToken, name, phone }
 * 以 clinic_id+phone 建立或取得病患;依設定檢查一電話多病患上限。
 * 順手存入經驗證的 line_user_id。
 */
export async function POST(req: NextRequest) {
  try {
    if (!CLINIC_ID) return fail("伺服器未設定 NEXT_PUBLIC_CLINIC_ID", 500);
    const body = (await req.json().catch(() => null)) as {
      idToken?: string;
      name?: string;
      phone?: string;
      birthday?: string;
    } | null;
    if (!body) return fail("請求格式錯誤");

    const name = body.name?.trim();
    const phone = body.phone?.trim();
    const birthday = body.birthday?.trim();
    if (!name) return fail("請填寫姓名");
    if (!phone) return fail("請填寫電話");
    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail("請填寫出生年月日");
    if (!body.idToken) return fail("缺少 LINE 身分驗證");

    // 驗證 LINE 身分(信任前先驗)
    let lineUserId: string;
    try {
      const profile = await verifyLiffIdToken(body.idToken);
      lineUserId = profile.sub;
    } catch (e) {
      return fail("LINE 身分驗證失敗:" + (e instanceof Error ? e.message : "請重新開啟預約頁"), 401);
    }

    const svc = createServiceClient();
    const settings = await getClinicSettings(svc, CLINIC_ID);
    if (!settings) return fail("查無診所設定", 500);

    const { data: existing, error: qErr } = await svc
      .from("patients")
      .select("id, name")
      .eq("clinic_id", CLINIC_ID)
      .eq("phone", phone);
    if (qErr) return fail(qErr.message, 500);
    const rows = existing ?? [];

    // 同電話同姓名 → 沿用該筆,更新 line_user_id 與生日(若曾被軟刪除則復活)
    const sameName = rows.find((r) => r.name === name);
    if (sameName) {
      await svc
        .from("patients")
        .update({ line_user_id: lineUserId, birthday, active: true })
        .eq("id", sameName.id);
      return ok({ patient_id: sameName.id, reused: true });
    }

    // 需新增:檢查上限
    if (!settings.allow_multi_patient_per_phone) {
      if (rows.length >= 1) {
        return fail("此電話已登記其他病患,無法再新增。請洽櫃檯。");
      }
    } else {
      const limit = Math.max(1, settings.max_patients_per_phone);
      if (rows.length >= limit) {
        return fail(`此電話可登記人數已達上限(${limit} 人)`);
      }
    }

    const { data: created, error: cErr } = await svc
      .from("patients")
      .insert({ clinic_id: CLINIC_ID, name, phone, birthday, line_user_id: lineUserId })
      .select("id")
      .single();
    if (cErr) return fail(cErr.message, 500);
    return ok({ patient_id: created.id, reused: false });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "建立病患失敗", 500);
  }
}
