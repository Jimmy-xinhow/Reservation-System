import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireBrandAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { attendanceTokenHash } from "@/lib/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const member = await requireBrandAdmin();
    const service = createServiceClient();
    const { data: settings, error: settingsError } = await service.from("attendance_settings").select("qr_enabled, qr_refresh_seconds").eq("clinic_id", member.clinicId).maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    if (settings?.qr_enabled !== true) return NextResponse.json({ error: "QR 打卡尚未啟用" }, { status: 409 });
    const seconds = Number(settings.qr_refresh_seconds ?? 60);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    const { error } = await service.from("attendance_qr_tokens").insert({ clinic_id: member.clinicId, token_hash: attendanceTokenHash(token), expires_at: expiresAt, created_by: member.user.id });
    if (error) throw new Error(error.message);
    await service.from("attendance_qr_tokens").delete().eq("clinic_id", member.clinicId).lt("expires_at", new Date(Date.now() - 86400000).toISOString());
    return NextResponse.json({ token, expiresAt, refreshSeconds: seconds }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "產生 QR Code 失敗" }, { status: 500 });
  }
}
