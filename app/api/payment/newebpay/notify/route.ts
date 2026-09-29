import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { asPaymentFormFields, decryptAndVerifyNewebpay, getPaymentSettingsByMerchant, parseNewebpayPaymentResult } from "@/lib/payment";
import { processPaymentWebhook } from "@/lib/payment-webhook";
import { notifyRegistrationStatus } from "@/lib/registration-notifications";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";
import { findPaymentOrderByMerchant } from "@/lib/payment-order-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function verificationFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return "decode_error";
  if (error.message === "藍新回呼缺少驗證欄位") return "missing_fields";
  if (error.message === "藍新 TradeSha 驗證失敗") return "sha_mismatch";
  if (error instanceof SyntaxError) return "payload_not_json";
  const code = (error as Error & { code?: unknown }).code;
  if (code === "ERR_OSSL_BAD_DECRYPT") return "cbc_bad_padding";
  if (code === "ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH") return "cbc_invalid_block";
  return "decode_error";
}

function verificationEnvelope(fields: Record<string, string>) {
  const tradeInfo = fields.TradeInfo ?? "";
  return {
    encryptType: fields.EncryptType === "1" ? "gcm" : fields.EncryptType === "0" ? "cbc" :
      fields.EncryptType === undefined ? "omitted" : "unexpected",
    ciphertextHex: tradeInfo.length > 0 && tradeInfo.length % 2 === 0 && /^[0-9a-f]+$/i.test(tradeInfo),
    cbcBlockAligned: tradeInfo.length > 0 && tradeInfo.length % 32 === 0,
  };
}

function parsingFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return "invalid_payload";
  const known: Record<string, string> = {
    "藍新回呼缺少交易資料": "missing_result",
    "藍新回呼商店不符": "merchant_mismatch",
    "藍新回呼交易欄位錯誤": "invalid_transaction_fields",
    "藍新成功回呼缺少交易序號": "missing_trade_no",
  };
  return known[error.message] ?? "invalid_payload";
}

export async function POST(req: NextRequest) {
  try {
    const fields = asPaymentFormFields(await req.formData());
    const merchantId = fields.MerchantID ?? "";
    const svc = createServiceClient();
    const settings = await getPaymentSettingsByMerchant(svc, "newebpay", merchantId);
    if (!settings) {
      console.warn("NewebPay notify rejected", { phase: "merchant" });
      return response("SIGNATURE_ERROR", 400);
    }
    let payload: Record<string, unknown>;
    let verified: ReturnType<typeof parseNewebpayPaymentResult>;
    try {
      payload = decryptAndVerifyNewebpay(fields, settings);
    } catch (error) {
      console.warn("NewebPay notify rejected", {
        phase: "verify",
        reason: verificationFailureReason(error),
        ...verificationEnvelope(fields),
      });
      return response("SIGNATURE_ERROR", 400);
    }
    try {
      verified = parseNewebpayPaymentResult(payload, settings.merchant_id);
    } catch (error) {
      console.warn("NewebPay notify rejected", { phase: "parse", reason: parsingFailureReason(error) });
      return response("SIGNATURE_ERROR", 400);
    }
    const { merchantOrderNo, tradeNo, eventKey, success, amount } = verified;
    const result = await processPaymentWebhook(svc, {
      provider: "newebpay",
      clinicId: settings.clinic_id,
      merchantOrderNo,
      providerTransactionNo: tradeNo,
      eventKey,
      success,
      amount,
      payload,
    });
    const order = await findPaymentOrderByMerchant(svc, settings.clinic_id, "newebpay", merchantOrderNo).catch(() => null);
    if (result.changed && order?.registration_id) await notifyRegistrationStatus(svc, String(order.registration_id), success ? "confirmed" : "cancelled").catch(() => undefined);
    if (result.changed && order?.appointment_id) await notifyAppointmentStatus(svc, String(order.appointment_id), success ? "confirmed" : "cancelled").catch(() => undefined);
    return response("OK");
  } catch {
    console.error("NewebPay notify failed", { phase: "internal" });
    return response("ERROR", 500);
  }
}
