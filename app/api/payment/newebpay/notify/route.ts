import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { asPaymentFormFields, decryptAndVerifyNewebpay, getPaymentSettingsByMerchant } from "@/lib/payment";
import { processPaymentWebhook } from "@/lib/payment-webhook";
import { notifyRegistrationStatus } from "@/lib/registration-notifications";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  try {
    const fields = asPaymentFormFields(await req.formData());
    const merchantId = fields.MerchantID ?? "";
    const svc = createServiceClient();
    const settings = await getPaymentSettingsByMerchant(svc, "newebpay", merchantId);
    if (!settings) return response("SIGNATURE_ERROR", 400);
    const payload = decryptAndVerifyNewebpay(fields, settings);
    const merchantOrderNo = String(payload.MerchantOrderNo ?? "");
    const tradeNo = payload.TradeNo ? String(payload.TradeNo) : null;
    const status = String(payload.Status ?? "");
    const resultCode = String(payload.ResultCode ?? "");
    const eventKey = `${merchantOrderNo}:${tradeNo ?? "none"}:${status}:${resultCode}`;
    const result = await processPaymentWebhook(svc, {
      provider: "newebpay",
      clinicId: settings.clinic_id,
      merchantOrderNo,
      providerTransactionNo: tradeNo,
      eventKey,
      success: status === "SUCCESS" && resultCode === "00",
      amount: Number(payload.Amt ?? 0),
      payload,
    });
    const { data: order } = await svc.from("payment_orders").select("registration_id, appointment_id").eq("clinic_id", settings.clinic_id).eq("merchant_order_no", merchantOrderNo).eq("provider", "newebpay").maybeSingle();
    if (result.changed && order?.registration_id) await notifyRegistrationStatus(svc, String(order.registration_id), status === "SUCCESS" && resultCode === "00" ? "confirmed" : "cancelled").catch(() => undefined);
    if (result.changed && order?.appointment_id) await notifyAppointmentStatus(svc, String(order.appointment_id), status === "SUCCESS" && resultCode === "00" ? "confirmed" : "cancelled").catch(() => undefined);
    return response("OK");
  } catch {
    return response("ERROR", 500);
  }
}
