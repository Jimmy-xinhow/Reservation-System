import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase";
import { requireOperator } from "@/lib/admin";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyLiffIdToken } from "@/lib/line";
import { fail, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createEcpayForm,
  createMerchantOrderNo,
  createNewebpayForm,
  getPaymentSettings,
  type PaymentSettings,
} from "@/lib/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenHash(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function requestBaseUrl(req: NextRequest): string {
  const configuredUrl = process.env.APP_URL?.trim();
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
      return parsed.origin;
    } catch {
      throw new Error("APP_URL 設定格式不正確");
    }
  }
  if (process.env.NODE_ENV === "production") throw new Error("正式環境必須設定 APP_URL");
  return req.nextUrl.origin;
}

function safeReturnPath(value: string | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value.slice(0, 500);
}

interface PublicAppointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  deposit_amount: number;
  deposit_status: string;
  deposit_expires_at: string | null;
  status: string;
  patients: { line_user_id: string | null } | { line_user_id: string | null }[] | null;
}

async function formForOrder(
  settings: PaymentSettings,
  order: { merchant_order_no: string; amount: number; registration_id: string | null; appointment_id: string | null; return_path: string },
  baseUrl: string,
  clinicSlug: string | null,
) {
  const isRegistration = Boolean(order.registration_id);
  const returnQuery = new URLSearchParams({ order: order.merchant_order_no, provider: settings.provider });
  if (clinicSlug) returnQuery.set("clinic_slug", clinicSlug);
  const returnUrl = `${baseUrl}/api/payment/return?${returnQuery.toString()}`;
  const notifyUrl = `${baseUrl}/api/payment/${settings.provider}/notify`;
  const clientBackUrl = `${baseUrl}${order.return_path}`;
  const args = {
    settings,
    merchantOrderNo: order.merchant_order_no,
    amount: order.amount,
    itemName: isRegistration ? "課程／活動報名" : "預約訂金",
    returnUrl,
    notifyUrl,
    clientBackUrl,
  };
  return settings.provider === "ecpay" ? createEcpayForm(args) : createNewebpayForm(args);
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, "payment:create", 12);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  const body = (await req.json().catch(() => null)) as {
    registration_id?: string;
    checkin_token?: string;
    appointment_id?: string;
    idToken?: string;
    browser_token?: string;
    return_path?: string;
  } | null;
  if (!body?.registration_id && !body?.appointment_id) return fail("缺少付款對象");
  if (body.registration_id && body.appointment_id) return fail("付款對象不唯一");
  if (body.idToken && body.browser_token) return fail("付款身分不唯一");

  const svc = createServiceClient();
  let clinicId: string;
  let registrationId: string | null = null;
  let appointmentId: string | null = null;
  let amount = 0;
  let publicAppointment: PublicAppointment | null = null;
  let paymentExpiresAt: string | null = null;
  let returnPath = body.registration_id ? "/register" : "/admin";
  let existingOrder: { id: string; merchant_order_no: string; amount: number; registration_id: string | null; appointment_id: string | null; provider: string; status: string; expires_at: string | null; return_path: string | null } | null = null;

  try {
    if (body.registration_id) {
      if (!body.checkin_token) return fail("缺少付款憑證");
      const { data: registration, error } = await svc
        .from("registrations")
        .select("id, clinic_id, amount, status, payment_status, checkin_token_hash, expires_at")
        .eq("id", body.registration_id)
        .eq("checkin_token_hash", tokenHash(body.checkin_token))
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!registration) return fail("付款憑證無效", 404);
      if (registration.payment_status !== "pending" || registration.status !== "pending") return fail("此報名目前不需要付款");
      if (registration.expires_at && new Date(registration.expires_at) <= new Date()) return fail("付款期限已過");
      paymentExpiresAt = registration.expires_at;
      returnPath = safeReturnPath(body.return_path, "/register");
      clinicId = registration.clinic_id;
      const { data: publicSettings, error: publicSettingsError } = await svc
        .from("clinic_settings")
        .select("public_registration_enabled")
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (publicSettingsError) throw new Error(publicSettingsError.message);
      if (publicSettings?.public_registration_enabled === false) return fail("目前暫停公開報名付款", 403);
      registrationId = registration.id;
      amount = Number(registration.amount);
      const { data: found, error: foundError } = await svc
        .from("payment_orders")
        .select("id, merchant_order_no, amount, registration_id, appointment_id, provider, status, expires_at, return_path")
        .eq("registration_id", registration.id)
        .eq("status", "pending")
        .maybeSingle();
      if (foundError) throw new Error(foundError.message);
      existingOrder = found;
    } else {
      appointmentId = body.appointment_id ?? null;
      if (body.idToken || body.browser_token) {
        clinicId = (await resolvePublicClinicId(req, svc)) ?? "";
        if (!clinicId) return fail("缺少品牌設定", 500);
        let lineUserId: string | null = null;
        let browserPatientId: string | null = null;
        if (body.idToken) {
          try {
            lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
          } catch {
            return fail("LINE 身分驗證失敗", 401);
          }
        } else if (body.browser_token) {
          const identity = verifyBrowserBookingToken(body.browser_token);
          if (!identity || identity.clinicId !== clinicId) return fail("瀏覽器預約憑證已失效", 401);
          browserPatientId = identity.patientId;
        }
        returnPath = safeReturnPath(body.return_path, body.browser_token ? "/book/browser" : "/book");
        const { data: appointment, error } = await svc
          .from("appointments")
          .select("id, clinic_id, patient_id, deposit_amount, deposit_status, deposit_expires_at, status, patients(line_user_id)")
          .eq("id", appointmentId)
          .eq("clinic_id", clinicId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        publicAppointment = appointment as unknown as PublicAppointment;
        if (!publicAppointment) return fail("付款憑證無效", 404);
        const appointmentPatient = Array.isArray(publicAppointment.patients) ? publicAppointment.patients[0] : publicAppointment.patients;
        if ((browserPatientId && publicAppointment.patient_id !== browserPatientId) || (lineUserId && appointmentPatient?.line_user_id !== lineUserId)) {
          return fail("付款身分不符", 403);
        }
      } else {
        const member = await requireOperator();
        clinicId = member.clinicId;
      }
      const appointment = publicAppointment ?? (await svc
        .from("appointments")
        .select("id, clinic_id, deposit_amount, deposit_status, deposit_expires_at, status")
        .eq("id", appointmentId)
        .eq("clinic_id", clinicId)
        .maybeSingle()).data;
      if (!appointment) return fail("查無預約", 404);
      if (appointment.deposit_status !== "pending" || Number(appointment.deposit_amount) <= 0) return fail("此預約目前不需要付款");
      if (appointment.status === "cancelled") return fail("已取消的預約不可付款");
      if (appointment.deposit_expires_at && new Date(appointment.deposit_expires_at) <= new Date()) return fail("付款期限已過");
      amount = Number(appointment.deposit_amount);
      paymentExpiresAt = appointment.deposit_expires_at ?? null;
      const { data: found, error: foundError } = await svc
        .from("payment_orders")
        .select("id, merchant_order_no, amount, registration_id, appointment_id, provider, status, expires_at, return_path")
        .eq("appointment_id", appointment.id)
        .eq("status", "pending")
        .maybeSingle();
      if (foundError) throw new Error(foundError.message);
      existingOrder = found;
    }

    if (!Number.isInteger(amount) || amount <= 0) return fail("付款金額錯誤", 400);
    const settings = await getPaymentSettings(svc, clinicId);
    if (!settings) return fail("此品牌尚未啟用標準金流", 503);
    if (existingOrder && existingOrder.provider !== settings.provider) {
      return fail("原付款訂單使用的金流商已變更，請重新建立付款訂單", 409);
    }
    if (existingOrder && Number(existingOrder.amount) !== amount) {
      return fail("付款訂單金額已變更，請重新建立付款訂單", 409);
    }

    const order = existingOrder ?? {
      id: "",
      merchant_order_no: createMerchantOrderNo(registrationId ? "REG" : "APT"),
      amount,
      registration_id: registrationId,
      appointment_id: appointmentId,
      expires_at: paymentExpiresAt,
      return_path: returnPath,
      status: "pending",
    };
    if (existingOrder?.expires_at && new Date(existingOrder.expires_at) <= new Date()) return fail("付款期限已過");
    if (!existingOrder) {
      const { data: inserted, error } = await svc
        .from("payment_orders")
        .insert({
          clinic_id: clinicId,
          registration_id: registrationId,
          appointment_id: appointmentId,
          provider: settings.provider,
          merchant_order_no: order.merchant_order_no,
          amount,
          expires_at: paymentExpiresAt,
          return_path: returnPath,
          status: "pending",
          provider_payload: {},
        })
        .select("id, merchant_order_no, amount, registration_id, appointment_id, provider, status, expires_at, return_path")
        .single();
      if (error) {
        // 多個付款頁同時開啟時，partial unique index 只允許同一對象保留一筆 pending 訂單；競爭輸入改用已存在的訂單。
        if (error.code !== "23505") throw new Error(error.message);
        const { data: concurrent, error: concurrentError } = await svc
          .from("payment_orders")
          .select("id, merchant_order_no, amount, registration_id, appointment_id, provider, status, expires_at, return_path")
          .eq(registrationId ? "registration_id" : "appointment_id", registrationId ?? appointmentId)
          .eq("status", "pending")
          .maybeSingle();
        if (concurrentError || !concurrent) throw new Error(concurrentError?.message ?? "建立付款訂單失敗");
        Object.assign(order, concurrent);
      } else if (!inserted) {
        throw new Error("建立付款訂單失敗");
      } else {
        Object.assign(order, inserted);
      }
    }

    const { data: clinic, error: clinicError } = await svc.from("clinics").select("slug").eq("id", clinicId).maybeSingle();
    if (clinicError) throw new Error(clinicError.message);
    const form = await formForOrder(
      settings,
      { ...order, return_path: order.return_path || returnPath },
      requestBaseUrl(req),
      (clinic?.slug as string | null | undefined) ?? null,
    );
    return ok({ order_id: order.id, provider: settings.provider, form });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "建立付款失敗", 500);
  }
}
