import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  asPaymentFormFields,
  decryptAndVerifyNewebpay,
  getPaymentSettingsByMerchant,
  verifyEcpay,
  parseNewebpayPaymentResult,
} from "@/lib/payment";
import { processPaymentWebhook } from "@/lib/payment-webhook";
import { notificationKindForStatus, notifyRegistrationStatus } from "@/lib/registration-notifications";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findPaymentOrderByMerchant } from "@/lib/payment-order-lookup";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifiedPaymentCustomerOrigin } from "@/lib/payment-public-origin";
import { queryPaidNewebpayOrder } from "@/lib/newebpay-query";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = ["ecpay", "newebpay"] as const;
type Provider = (typeof PROVIDERS)[number];

function validProvider(value: string | null): Provider | null {
  return value && PROVIDERS.includes(value as Provider) ? (value as Provider) : null;
}

function validOrder(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

async function resultBaseUrl(req: NextRequest): Promise<string> {
  // The browser return can arrive on a brand domain. Resolve its tenant from
  // the edge Host and the brand slug before using it as a redirect target.
  try {
    const service = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, service);
    if (clinicId) {
      const brandOrigin = await verifiedPaymentCustomerOrigin(req, service, clinicId);
      if (brandOrigin) return brandOrigin;
    }
  } catch {
    // Keep the platform origin when the brand domain cannot be verified.
  }
  const configured = process.env.APP_URL?.trim();
  if (!configured) return req.nextUrl.origin;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
    return parsed.origin;
  } catch {
    return req.nextUrl.origin;
  }
}

async function resultRedirect(req: NextRequest, order: string, provider: Provider, state: string, clinicSlug: string | null): Promise<NextResponse> {
  // Railway may show localhost internally; only the configured platform origin
  // or a verified domain for this brand can receive the result page.
  const url = new URL("/payment/result", await resultBaseUrl(req));
  url.searchParams.set("order", order);
  url.searchParams.set("provider", provider);
  url.searchParams.set("state", state);
  if (clinicSlug) url.searchParams.set("clinic_slug", clinicSlug);
  // Gateway returns are form POSTs; the result page must be opened with GET.
  return NextResponse.redirect(url, 303);
}

async function notifyRegistrationForPayment(svc: SupabaseClient, clinicId: string, provider: Provider, merchantOrderNo: string): Promise<void> {
  const order = await findPaymentOrderByMerchant(svc, clinicId, provider, merchantOrderNo).catch(() => null);
  if (!order?.registration_id) return;
  const kind = notificationKindForStatus(order.status === "paid" ? "confirmed" : order.status === "failed" ? "cancelled" : "");
  if (kind) await notifyRegistrationStatus(svc, String(order.registration_id), kind);
}

async function notifyAppointmentForPayment(svc: SupabaseClient, clinicId: string, provider: Provider, merchantOrderNo: string): Promise<void> {
  const order = await findPaymentOrderByMerchant(svc, clinicId, provider, merchantOrderNo).catch(() => null);
  if (!order?.appointment_id) return;
  const kind = order.status === "paid" ? "confirmed" : order.status === "failed" ? "cancelled" : null;
  if (kind) await notifyAppointmentStatus(svc, String(order.appointment_id), kind);
}

function isCbcDecodeFailure(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return code === "ERR_OSSL_BAD_DECRYPT" || code === "ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH";
}

async function recoverNewebpayBrowserReturn(
  req: NextRequest,
  svc: SupabaseClient,
  settings: NonNullable<Awaited<ReturnType<typeof getPaymentSettingsByMerchant>>>,
  merchantOrderNo: string,
): Promise<boolean> {
  const order = await findPaymentOrderByMerchant(svc, settings.clinic_id, "newebpay", merchantOrderNo);
  if (!order) return false;
  if (order.status === "paid") return true;
  if (!["pending", "expired"].includes(order.status)) return false;
  const rate = await checkRateLimit(req, "payment:newebpay-return-query", 5);
  if (!rate.allowed) return false;
  const verified = await queryPaidNewebpayOrder(settings, merchantOrderNo, Number(order.amount));
  if (!verified) return false;
  const processed = await processPaymentWebhook(svc, {
    provider: "newebpay",
    clinicId: settings.clinic_id,
    merchantOrderNo,
    providerTransactionNo: verified.tradeNo,
    eventKey: `${merchantOrderNo}:${verified.tradeNo}:QUERY_RECONCILE`,
    success: true,
    amount: Number(order.amount),
    payload: verified.payload,
  });
  if (!processed.accepted) return false;
  if (processed.changed) {
    await notifyRegistrationForPayment(svc, settings.clinic_id, "newebpay", merchantOrderNo).catch(() => undefined);
    await notifyAppointmentForPayment(svc, settings.clinic_id, "newebpay", merchantOrderNo).catch(() => undefined);
  }
  return true;
}

async function processReturnFields(req: NextRequest, fields: Record<string, string>, provider: Provider): Promise<NextResponse> {
  const orderFromQuery = validOrder(req.nextUrl.searchParams.get("order"));
  const clinicSlug = req.nextUrl.searchParams.get("clinic_slug")?.trim() || null;
  const svc = createServiceClient();

  if (provider === "ecpay") {
    const merchantId = fields.MerchantID ?? "";
    const settings = await getPaymentSettingsByMerchant(svc, "ecpay", merchantId);
    const merchantOrderNo = validOrder(fields.MerchantTradeNo) ?? orderFromQuery;
    if (!settings || !merchantOrderNo || !verifyEcpay(fields, settings)) {
      return orderFromQuery ? resultRedirect(req, orderFromQuery, provider, "error", clinicSlug) : new NextResponse("付款回傳驗證失敗", { status: 400 });
    }
    if (fields.SimulatePaid === "1") return resultRedirect(req, merchantOrderNo, provider, "returned", clinicSlug);
    await processPaymentWebhook(svc, {
      provider,
      clinicId: settings.clinic_id,
      merchantOrderNo,
      providerTransactionNo: fields.TradeNo ?? null,
      eventKey: `${merchantOrderNo}:${fields.TradeNo ?? "none"}:${fields.RtnCode ?? ""}`,
      success: fields.RtnCode === "1",
      amount: Number(fields.TradeAmt ?? fields.TotalAmount ?? 0),
      payload: fields,
    });
    await notifyRegistrationForPayment(svc, settings.clinic_id, provider, merchantOrderNo).catch(() => undefined);
    await notifyAppointmentForPayment(svc, settings.clinic_id, provider, merchantOrderNo).catch(() => undefined);
    return resultRedirect(req, merchantOrderNo, provider, "returned", clinicSlug);
  }

  const merchantId = fields.MerchantID ?? "";
  const settings = await getPaymentSettingsByMerchant(svc, "newebpay", merchantId);
  if (!settings) return orderFromQuery ? resultRedirect(req, orderFromQuery, provider, "error", clinicSlug) : new NextResponse("付款回傳驗證失敗", { status: 400 });
  let payload: Record<string, unknown>;
  try {
    payload = decryptAndVerifyNewebpay(fields, settings);
  } catch (error) {
    // The original Notify remains rejected. A browser return with a matching
    // order may recover only through the official signed single-order query.
    if (isCbcDecodeFailure(error) && orderFromQuery &&
        await recoverNewebpayBrowserReturn(req, svc, settings, orderFromQuery)) {
      return resultRedirect(req, orderFromQuery, provider, "returned", clinicSlug);
    }
    throw error;
  }
  const { merchantOrderNo, tradeNo, eventKey, success, amount } = parseNewebpayPaymentResult(payload, settings.merchant_id);
  await processPaymentWebhook(svc, {
    provider,
    clinicId: settings.clinic_id,
    merchantOrderNo,
    providerTransactionNo: tradeNo,
    eventKey,
    success,
    amount,
    payload,
  });
  await notifyRegistrationForPayment(svc, settings.clinic_id, provider, merchantOrderNo).catch(() => undefined);
  await notifyAppointmentForPayment(svc, settings.clinic_id, provider, merchantOrderNo).catch(() => undefined);
  return resultRedirect(req, merchantOrderNo, provider, "returned", clinicSlug);
}

export async function POST(req: NextRequest) {
  const provider = validProvider(req.nextUrl.searchParams.get("provider"));
  const order = validOrder(req.nextUrl.searchParams.get("order"));
  const clinicSlug = req.nextUrl.searchParams.get("clinic_slug")?.trim() || null;
  if (!provider) return new NextResponse("付款回傳缺少金流商", { status: 400 });
  try {
    return await processReturnFields(req, asPaymentFormFields(await req.formData()), provider);
  } catch {
    return order ? resultRedirect(req, order, provider, "error", clinicSlug) : new NextResponse("付款回傳處理失敗", { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const provider = validProvider(req.nextUrl.searchParams.get("provider"));
  const order = validOrder(req.nextUrl.searchParams.get("order"));
  const clinicSlug = req.nextUrl.searchParams.get("clinic_slug")?.trim() || null;
  if (!provider || !order) return new NextResponse("付款回傳缺少訂單", { status: 400 });
  return resultRedirect(req, order, provider, "returned", clinicSlug);
}
