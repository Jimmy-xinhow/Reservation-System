import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { asPaymentFormFields, getPaymentSettingsByMerchant, verifyEcpay } from "@/lib/payment";
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
    const settings = await getPaymentSettingsByMerchant(svc, "ecpay", merchantId);
    if (!settings || !verifyEcpay(fields, settings)) return response("0|SIGNATURE_ERROR", 400);

    const merchantOrderNo = fields.MerchantTradeNo ?? "";
    const tradeNo = fields.TradeNo ?? null;
    const eventKey = `${merchantOrderNo}:${tradeNo ?? "none"}:${fields.RtnCode ?? ""}`;
    const result = await processPaymentWebhook(svc, {
      provider: "ecpay",
      clinicId: settings.clinic_id,
      merchantOrderNo,
      providerTransactionNo: tradeNo,
      eventKey,
      success: fields.RtnCode === "1",
      amount: Number(fields.TradeAmt ?? fields.TotalAmount ?? 0),
      payload: fields,
    });
    const { data: order } = await svc.from("payment_orders").select("registration_id, appointment_id").eq("clinic_id", settings.clinic_id).eq("merchant_order_no", merchantOrderNo).eq("provider", "ecpay").maybeSingle();
    if (result.changed && order?.registration_id) await notifyRegistrationStatus(svc, String(order.registration_id), fields.RtnCode === "1" ? "confirmed" : "cancelled").catch(() => undefined);
    if (result.changed && order?.appointment_id) await notifyAppointmentStatus(svc, String(order.appointment_id), fields.RtnCode === "1" ? "confirmed" : "cancelled").catch(() => undefined);
    return response("1|OK");
  } catch {
    return response("0|ERROR", 500);
  }
}
