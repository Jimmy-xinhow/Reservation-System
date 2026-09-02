import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok, rateLimitResponse } from "@/lib/http";
import { resolvePublicClinicId } from "@/lib/public-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = await rateLimitResponse(req, "payment:status", 30);
  if (limited) return limited;
  const orderNo = req.nextUrl.searchParams.get("order")?.trim() ?? "";
  const provider = req.nextUrl.searchParams.get("provider")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(orderNo) || !["ecpay", "newebpay"].includes(provider)) return fail("付款訂單格式錯誤", 400);
  try {
    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);
    const { data: order, error: orderError } = await svc
      .from("payment_orders")
      .select("id, status, amount, registration_id, appointment_id, membership_plan_id, patient_id, expires_at")
      .eq("clinic_id", clinicId)
      .eq("provider", provider)
      .eq("merchant_order_no", orderNo)
      .maybeSingle();
    if (orderError) return fail(orderError.message, 500);
    if (!order) return fail("找不到付款訂單", 404);

    let registrationStatus: string | null = null;
    let registrationPaymentStatus: string | null = null;
    if (order.registration_id) {
      const { data: registration, error } = await svc
        .from("registrations")
        .select("status, payment_status")
        .eq("id", order.registration_id)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (error) return fail(error.message, 500);
      registrationStatus = registration?.status ?? null;
      registrationPaymentStatus = registration?.payment_status ?? null;
    }
    let appointmentStatus: string | null = null;
    if (order.appointment_id) {
      const { data: appointment, error } = await svc
        .from("appointments")
        .select("status, deposit_status")
        .eq("id", order.appointment_id)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (error) return fail(error.message, 500);
      appointmentStatus = appointment?.status ?? null;
    }
    let membershipId: string | null = null;
    if (order.membership_plan_id && order.patient_id) {
      const { data: membership, error } = await svc
        .from("patient_memberships")
        .select("id")
        .eq("payment_order_id", order.id)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (error) return fail(error.message, 500);
      membershipId = membership?.id ?? null;
    }
    return ok({
      status: order.status,
      amount: Number(order.amount),
      target: order.registration_id ? "registration" : order.membership_plan_id ? "membership" : "appointment",
      registration_id: order.registration_id,
      registration_status: registrationStatus,
      registration_payment_status: registrationPaymentStatus,
      appointment_status: appointmentStatus,
      membership_id: membershipId,
      expires_at: order.expires_at,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "查詢付款狀態失敗", 500);
  }
}
