import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  asPaymentFormFields,
  decryptAndVerifyNewebpay,
  getPaymentSettingsByMerchant,
  verifyEcpay,
} from "@/lib/payment";
import { processPaymentWebhook } from "@/lib/payment-webhook";
import { notificationKindForStatus, notifyRegistrationStatus } from "@/lib/registration-notifications";
import { notifyAppointmentStatus } from "@/lib/appointment-notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function resultRedirect(req: NextRequest, order: string, provider: Provider, state: string, clinicSlug: string | null): NextResponse {
  const url = new URL("/payment/result", req.url);
  url.searchParams.set("order", order);
  url.searchParams.set("provider", provider);
  url.searchParams.set("state", state);
  if (clinicSlug) url.searchParams.set("clinic_slug", clinicSlug);
  return NextResponse.redirect(url);
}

async function notifyRegistrationForPayment(svc: SupabaseClient, provider: Provider, merchantOrderNo: string): Promise<void> {
  const { data: order, error } = await svc
    .from("payment_orders")
    .select("registration_id, status")
    .eq("provider", provider)
    .eq("merchant_order_no", merchantOrderNo)
    .maybeSingle();
  if (error || !order?.registration_id) return;
  const kind = notificationKindForStatus(order.status === "paid" ? "confirmed" : order.status === "failed" ? "cancelled" : "");
  if (kind) await notifyRegistrationStatus(svc, String(order.registration_id), kind);
}

async function notifyAppointmentForPayment(svc: SupabaseClient, provider: Provider, merchantOrderNo: string): Promise<void> {
  const { data: order, error } = await svc
    .from("payment_orders")
    .select("appointment_id, status")
    .eq("provider", provider)
    .eq("merchant_order_no", merchantOrderNo)
    .maybeSingle();
  if (error || !order?.appointment_id) return;
  const kind = order.status === "paid" ? "confirmed" : order.status === "failed" ? "cancelled" : null;
  if (kind) await notifyAppointmentStatus(svc, String(order.appointment_id), kind);
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
    await processPaymentWebhook(svc, {
      provider,
      merchantOrderNo,
      providerTransactionNo: fields.TradeNo ?? null,
      eventKey: `${merchantOrderNo}:${fields.TradeNo ?? "none"}:${fields.RtnCode ?? ""}`,
      success: fields.RtnCode === "1",
      amount: Number(fields.TradeAmt ?? fields.TotalAmount ?? 0),
      payload: fields,
    });
    await notifyRegistrationForPayment(svc, provider, merchantOrderNo).catch(() => undefined);
    await notifyAppointmentForPayment(svc, provider, merchantOrderNo).catch(() => undefined);
    return resultRedirect(req, merchantOrderNo, provider, "returned", clinicSlug);
  }

  const merchantId = fields.MerchantID ?? "";
  const settings = await getPaymentSettingsByMerchant(svc, "newebpay", merchantId);
  if (!settings) return orderFromQuery ? resultRedirect(req, orderFromQuery, provider, "error", clinicSlug) : new NextResponse("付款回傳驗證失敗", { status: 400 });
  const payload = decryptAndVerifyNewebpay(fields, settings);
  const merchantOrderNo = validOrder(String(payload.MerchantOrderNo ?? "")) ?? orderFromQuery;
  if (!merchantOrderNo) return new NextResponse("付款回傳缺少訂單", { status: 400 });
  const tradeNo = payload.TradeNo ? String(payload.TradeNo) : null;
  const status = String(payload.Status ?? "");
  const resultCode = String(payload.ResultCode ?? "");
  await processPaymentWebhook(svc, {
    provider,
    merchantOrderNo,
    providerTransactionNo: tradeNo,
    eventKey: `${merchantOrderNo}:${tradeNo ?? "none"}:${status}:${resultCode}`,
    success: status === "SUCCESS" && resultCode === "00",
    amount: Number(payload.Amt ?? 0),
    payload,
  });
  await notifyRegistrationForPayment(svc, provider, merchantOrderNo).catch(() => undefined);
  await notifyAppointmentForPayment(svc, provider, merchantOrderNo).catch(() => undefined);
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
