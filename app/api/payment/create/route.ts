import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase";
import { requireOperator } from "@/lib/admin";
import { verifyBrowserBookingToken } from "@/lib/browser-booking";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
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
  order: { merchant_order_no: string; amount: number; registration_id: string | null; appointment_id: string | null; membership_plan_id: string | null; return_path: string },
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
    itemName: isRegistration ? "課程／活動報名" : order.membership_plan_id ? "會員套票" : "預約訂金",
    returnUrl,
    notifyUrl,
    clientBackUrl,
  };
  return settings.provider === "ecpay" ? createEcpayForm(args) : createNewebpayForm(args);
}

export async function POST(req: NextRequest) {
  const rate = await checkRateLimit(req, "payment:create", 12);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  const body = (await req.json().catch(() => null)) as {
    registration_id?: string;
    checkin_token?: string;
    appointment_id?: string;
    membership_plan_id?: string;
    idToken?: string;
    browser_token?: string;
    return_path?: string;
  } | null;
  if (!body?.registration_id && !body?.appointment_id && !body?.membership_plan_id) return fail("缺少付款對象");
  if ([body.registration_id, body.appointment_id, body.membership_plan_id].filter(Boolean).length > 1) return fail("付款對象不唯一");
  if (body.idToken && body.browser_token) return fail("付款身分不唯一");

  const svc = createServiceClient();
  let clinicId: string;
  let registrationId: string | null = null;
  let appointmentId: string | null = null;
  let membershipPlanId: string | null = null;
  let patientId: string | null = null;
  let amount = 0;
  let publicAppointment: PublicAppointment | null = null;
  let paymentExpiresAt: string | null = null;
  let returnPath = body.registration_id ? "/register" : body.membership_plan_id ? "/membership" : "/admin";
  let existingOrder: { id: string; merchant_order_no: string; amount: number; registration_id: string | null; appointment_id: string | null; membership_plan_id: string | null; patient_id: string | null; provider: string; status: string; expires_at: string | null; return_path: string | null } | null = null;

  try {
    if (body.registration_id) {
      const publicClinicId = await resolvePublicClinicId(req, svc);
      if (!publicClinicId) return fail("缺少品牌設定", 500);
      const customerIdentity = !body.checkin_token && body.browser_token ? verifyBrowserBookingToken(body.browser_token) : null;
      if (!body.checkin_token && (!customerIdentity || customerIdentity.clinicId !== publicClinicId)) return fail("缺少付款憑證", 401);
      let registrationQuery = svc
        .from("registrations")
        .select("id, clinic_id, patient_id, amount, status, payment_status, checkin_token_hash, expires_at")
        .eq("id", body.registration_id)
        .eq("clinic_id", publicClinicId);
      registrationQuery = body.checkin_token
        ? registrationQuery.eq("checkin_token_hash", tokenHash(body.checkin_token))
        : registrationQuery.eq("patient_id", customerIdentity!.patientId);
      const { data: registration, error } = await registrationQuery.maybeSingle();
      if (error) throw new Error(error.message);
      if (!registration) return fail("付款憑證無效", 404);
      if (registration.payment_status !== "pending" || registration.status !== "pending") return fail("此報名目前不需要付款");
      if (registration.expires_at && new Date(registration.expires_at) <= new Date()) return fail("付款期限已過");
      paymentExpiresAt = registration.expires_at;
      returnPath = safeReturnPath(body.return_path, "/register");
      clinicId = registration.clinic_id;
      const { data: publicSettings, error: publicSettingsError } = await svc
        .from("clinic_settings")
        .select("events_enabled, public_registration_enabled")
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (publicSettingsError) throw new Error(publicSettingsError.message);
      if (!publicSettings) return fail("公開報名設定尚未完成", 503);
      if (publicSettings.events_enabled !== true || publicSettings.public_registration_enabled === false) return fail("目前暫停公開報名付款", 403);
      registrationId = registration.id;
      amount = Number(registration.amount);
      const { data: found, error: foundError } = await svc
        .from("payment_orders")
        .select("id, merchant_order_no, amount, registration_id, appointment_id, membership_plan_id, patient_id, provider, status, expires_at, return_path")
        .eq("registration_id", registration.id)
        .eq("status", "pending")
        .maybeSingle();
      if (foundError) throw new Error(foundError.message);
      existingOrder = found;
    } else if (body.membership_plan_id) {
      if (!body.browser_token) return fail("缺少會員身分憑證");
      const publicClinicId = await resolvePublicClinicId(req, svc);
      if (!publicClinicId) return fail("缺少品牌設定", 500);
      const { data: membershipSettings, error: membershipSettingsError } = await svc
        .from("clinic_settings")
        .select("memberships_enabled")
        .eq("clinic_id", publicClinicId)
        .maybeSingle();
      if (membershipSettingsError) throw new Error(membershipSettingsError.message);
      if (membershipSettings?.memberships_enabled !== true) return fail("此品牌目前未啟用會員與套票", 403);
      const identity = verifyBrowserBookingToken(body.browser_token);
      if (!identity || identity.clinicId !== publicClinicId) return fail("會員身分憑證已失效", 401);
      clinicId = publicClinicId;
      const [{ data: patient, error: patientError }, { data: plan, error: planError }] = await Promise.all([
        svc.from("patients").select("id").eq("id", identity.patientId).eq("clinic_id", clinicId).eq("active", true).maybeSingle(),
        svc.from("membership_plans").select("id, active").eq("id", body.membership_plan_id).eq("clinic_id", clinicId).eq("active", true).maybeSingle(),
      ]);
      if (patientError) throw new Error(patientError.message);
      if (planError) throw new Error(planError.message);
      if (!patient || !plan) return fail("會員方案不存在或已停用", 404);
      const { data: price, error: priceError } = await svc.rpc("get_membership_plan_price", { p_clinic_id: clinicId, p_plan_id: plan.id, p_patient_id: patient.id });
      if (priceError) throw new Error(priceError.message);
      const priceRow = Array.isArray(price) ? price[0] : price;
      amount = Number((priceRow as { price?: number } | null)?.price ?? 0);
      if (!Number.isInteger(amount) || amount <= 0) return fail("此方案目前不提供公開付款", 409);
      paymentExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      returnPath = safeReturnPath(body.return_path, "/membership");
      membershipPlanId = plan.id;
      patientId = patient.id;
      const { data: found, error: foundError } = await svc
        .from("payment_orders")
        .select("id, merchant_order_no, amount, registration_id, appointment_id, membership_plan_id, patient_id, provider, status, expires_at, return_path")
        .eq("membership_plan_id", plan.id)
        .eq("patient_id", patient.id)
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
            lineUserId = (await verifyClinicLiffIdToken(svc, clinicId, body.idToken)).sub;
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
      const { data: activeWaitlistOffer, error: waitlistError } = await svc
        .from("appointment_waitlist_entries")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("appointment_id", appointment.id)
        .eq("status", "offered")
        .maybeSingle();
      if (waitlistError) throw new Error(waitlistError.message);
      if (activeWaitlistOffer) return fail("請先在我的預約接受候補名額，再進行付款", 409);
      if (appointment.deposit_status !== "pending" || Number(appointment.deposit_amount) <= 0) return fail("此預約目前不需要付款");
      if (appointment.status === "cancelled") return fail("已取消的預約不可付款");
      if (appointment.deposit_expires_at && new Date(appointment.deposit_expires_at) <= new Date()) return fail("付款期限已過");
      amount = Number(appointment.deposit_amount);
      paymentExpiresAt = appointment.deposit_expires_at ?? null;
      const { data: found, error: foundError } = await svc
        .from("payment_orders")
        .select("id, merchant_order_no, amount, registration_id, appointment_id, membership_plan_id, patient_id, provider, status, expires_at, return_path")
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
      merchant_order_no: createMerchantOrderNo(registrationId ? "REG" : membershipPlanId ? "MEM" : "APT"),
      amount,
      registration_id: registrationId,
      appointment_id: appointmentId,
      membership_plan_id: membershipPlanId,
      patient_id: patientId,
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
          membership_plan_id: membershipPlanId,
          patient_id: patientId,
          provider: settings.provider,
          merchant_order_no: order.merchant_order_no,
          amount,
          expires_at: paymentExpiresAt,
          return_path: returnPath,
          status: "pending",
          provider_payload: {},
        })
        .select("id, merchant_order_no, amount, registration_id, appointment_id, membership_plan_id, patient_id, provider, status, expires_at, return_path")
        .single();
      if (error) {
        // 多個付款頁同時開啟時，partial unique index 只允許同一對象保留一筆 pending 訂單；競爭輸入改用已存在的訂單。
        if (error.code !== "23505") throw new Error(error.message);
        let concurrentQuery = svc
          .from("payment_orders")
          .select("id, merchant_order_no, amount, registration_id, appointment_id, membership_plan_id, patient_id, provider, status, expires_at, return_path")
          .eq("status", "pending");
        if (registrationId) concurrentQuery = concurrentQuery.eq("registration_id", registrationId);
        else if (membershipPlanId && patientId) concurrentQuery = concurrentQuery.eq("membership_plan_id", membershipPlanId).eq("patient_id", patientId);
        else if (appointmentId) concurrentQuery = concurrentQuery.eq("appointment_id", appointmentId);
        const { data: concurrent, error: concurrentError } = await concurrentQuery.maybeSingle();
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
