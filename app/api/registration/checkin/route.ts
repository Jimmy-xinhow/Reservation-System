import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { requireOperator } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const member = await requireOperator();
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    if (!body?.token) return fail("缺少報到憑證");
    const svc = createServiceClient();
    const { data, error } = await svc.rpc("checkin_registration", {
      p_clinic_id: member.clinicId,
      p_token: body.token,
      p_user_id: member.user.id,
    });
    if (error) return fail(error.message, 409);
    const row = Array.isArray(data) ? data[0] : data;
    return ok(row ?? null);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "報到失敗", 500);
  }
}
