import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/http";
import { verifyLiffIdToken } from "@/lib/line";
import { checkRateLimit } from "@/lib/rate-limit";
import { notificationKindForStatus, notifyRegistrationStatus } from "@/lib/registration-notifications";
import { encryptRegistrationToken } from "@/lib/registration-credentials";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { recordCrmInteraction } from "@/lib/crm-interactions";
import { createBrowserBookingToken } from "@/lib/browser-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  event_id?: string;
  session_id?: string;
  ticket_type_id?: string | null;
  name?: string;
  phone?: string;
  email?: string;
  idToken?: string;
  marketing_opt_in?: boolean;
  answers?: Record<string, unknown>;
  access_token?: string;
  discount_code?: string;
  membership_code?: string;
  terms_accepted?: boolean;
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, "registration:register", 12);
  if (!rate.allowed) {
    const response = fail("請稍後再試", 429);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.event_id || !body.session_id) return fail("缺少活動或場次");
    const name = body.name?.trim() ?? "";
    const phone = body.phone?.trim() ?? "";
    if (!name || !phone) return fail("請填寫姓名與電話");
    if (name.length > 100 || phone.length > 40) return fail("資料長度不正確");
    const email = body.email?.trim() || null;
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return fail("Email 格式不正確");

    const discountCode = body.discount_code?.trim().toUpperCase() || null;
    const membershipCode = body.membership_code?.trim().toUpperCase() || null;
    if (discountCode && discountCode.length > 40) return fail("優惠碼格式錯誤", 400);
    if (membershipCode && membershipCode.length > 40) return fail("套票序號格式錯誤", 400);
    if (discountCode && membershipCode) return fail("套票序號與優惠碼不可同時使用", 400);

    let lineUserId: string | null = null;
    if (body.idToken) {
      try {
        lineUserId = (await verifyLiffIdToken(body.idToken)).sub;
      } catch {
        return fail("LINE 身分驗證失敗", 401);
      }
    }

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("尚未設定公開品牌", 500);
    const { data: settings, error: settingsError } = await svc.from("clinic_settings").select("public_registration_enabled").eq("clinic_id", clinicId).maybeSingle();
    if (settingsError) return fail(settingsError.message, 500);
    if (!settings) return fail("公開報名設定尚未完成", 503);
    if (settings.public_registration_enabled === false) return fail("目前暫停線上報名", 403);
    const accessToken = body.access_token?.trim() ?? "";
    const accessTokenHash = accessToken ? createHash("sha256").update(accessToken).digest("hex") : "";
    const { data: publicEvent, error: publicEventError } = await svc
      .from("events")
      .select("id, clinic_id, access_mode, terms_version, terms_text")
      .eq("id", body.event_id)
      .eq("clinic_id", clinicId)
      .eq("status", "published")
      .eq("access_mode", "public")
      .maybeSingle();
    if (publicEventError) return fail(publicEventError.message, 500);
    let event = publicEvent;
    if (!event && accessTokenHash) {
      const { data: privateEvent, error: privateEventError } = await svc
        .from("events")
        .select("id, clinic_id, access_mode, terms_version, terms_text")
        .eq("id", body.event_id)
        .eq("clinic_id", clinicId)
        .eq("status", "published")
        .eq("access_mode", "private")
        .eq("access_token_hash", accessTokenHash)
        .maybeSingle();
      if (privateEventError) return fail(privateEventError.message, 500);
      event = privateEvent;
    }
    if (!event) return fail("活動不存在或尚未公開", 404);

    if (event.terms_text && body.terms_accepted !== true) return fail("請先閱讀並同意活動條款", 400);
    if (body.ticket_type_id) {
      const { data: ticket, error: ticketError } = await svc.from("event_ticket_types").select("id, sale_start_at, sale_end_at, active").eq("id", body.ticket_type_id).eq("event_id", event.id).eq("clinic_id", event.clinic_id).maybeSingle();
      if (ticketError) return fail(ticketError.message, 500);
      const now = Date.now();
      if (!ticket?.active || (ticket.sale_start_at && new Date(ticket.sale_start_at).getTime() > now) || (ticket.sale_end_at && new Date(ticket.sale_end_at).getTime() <= now)) return fail("此票種目前不在銷售期間", 409);
    }

    const { data: form } = await svc
      .from("registration_forms")
      .select("id, version")
      .eq("event_id", event.id)
      .eq("clinic_id", event.clinic_id)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: fields, error: fieldsError } = form
      ? await svc.from("registration_form_fields").select("field_key, field_type, required, options").eq("form_id", form.id).eq("clinic_id", event.clinic_id).order("sort_order")
      : { data: [], error: null };
    if (fieldsError) return fail(fieldsError.message, 500);
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    for (const field of fields ?? []) {
      const value = answers[field.field_key];
      const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || (field.field_type === "checkbox" && value === false);
      if (field.required && empty) return fail(`請填寫${field.field_key}`, 400);
      if (empty) continue;
      if (["text", "textarea"].includes(field.field_type) && typeof value !== "string") return fail("表單文字格式無效", 400);
      if (field.field_type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) return fail("表單日期格式無效", 400);
      if (field.field_type === "select" && (typeof value !== "string" || !Array.isArray(field.options) || !field.options.includes(value))) return fail("表單選項無效", 400);
      if (field.field_type === "checkbox" && typeof value !== "boolean") return fail("表單勾選格式無效", 400);
    }
    if (JSON.stringify(answers).length > 20000) return fail("表單資料過大");
    const { data: patientData, error: patientError } = await svc.rpc("create_or_get_public_patient_with_marketing_opt_in", {
      p_clinic_id: event.clinic_id,
      p_name: name,
      p_phone: phone,
      p_birthday: null,
      p_line_user_id: lineUserId,
      p_marketing_opt_in: body.marketing_opt_in === true,
    });
    if (patientError) return fail(patientError.message, 409);
    const patientRow = Array.isArray(patientData) ? patientData[0] : patientData;
    if (!patientRow?.patient_id) return fail("顧客身分建立失敗", 500);
    const { data, error } = await svc.rpc("register_for_event_with_terms", {
      p_clinic_id: event.clinic_id,
      p_event_id: body.event_id,
      p_session_id: body.session_id,
      p_ticket_type_id: body.ticket_type_id || null,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_line_user_id: lineUserId,
      p_marketing_opt_in: body.marketing_opt_in === true,
      p_answers: answers,
      p_access_token: accessToken || null,
      p_discount_code: discountCode,
      p_membership_code: membershipCode,
      p_form_id: form?.id ?? null,
      p_form_version: form?.version ?? null,
      p_terms_version: event.terms_text ? event.terms_version : null,
      p_terms_accepted_at: event.terms_text ? new Date().toISOString() : null,
      p_patient_id: patientRow.patient_id,
    });
    if (error) return fail(translateRegistrationError(error.message), 409);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail("報名失敗", 500);
    if (patientRow?.patient_id) {
      await recordCrmInteraction(svc, {
        clinicId: event.clinic_id,
        patientId: patientRow.patient_id as string,
        kind: "registration",
        channel: lineUserId ? "line" : "system",
        title: "建立活動報名",
        body: `報名已建立：${String(row.registration_no)}`,
        registrationId: String(row.registration_id),
      }).catch((interactionError: unknown) => console.error("CRM registration interaction failed", interactionError));
    }
    const encryptedToken = encryptRegistrationToken(String(row.checkin_token ?? ""));
    if (encryptedToken) {
      const { error: credentialError } = await svc
        .from("registrations")
        .update({ checkin_token_encrypted: encryptedToken })
        .eq("id", String(row.registration_id))
        .eq("clinic_id", event.clinic_id);
      if (credentialError) console.error("Registration credential persistence failed", credentialError.message);
    }
    const notificationKind = notificationKindForStatus(String(row.registration_status));
    if (notificationKind) {
      await notifyRegistrationStatus(svc, String(row.registration_id), notificationKind, String(row.checkin_token ?? "")).catch(() => undefined);
    }
    return ok({
      registration_id: row.registration_id,
      registration_no: row.registration_no,
      registration_status: row.registration_status,
      payment_status: row.payment_status,
      amount: row.amount,
      checkin_token: row.checkin_token,
      browser_token: createBrowserBookingToken(event.clinic_id, String(patientRow.patient_id)),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "報名失敗", 500);
  }
}

function translateRegistrationError(message: string): string {
  if (message.includes("membership") || message.includes("discount") || message.includes("benefits")) return "套票或優惠碼無法套用，請確認序號、適用範圍與有效期限";
  const known = ["請填寫姓名與電話", "找不到可報名的活動", "報名尚未開始", "報名已截止", "找不到可報名的場次", "找不到可選的票種", "此場次已額滿"];
  return known.find((item) => message.includes(item)) ?? "此活動目前無法報名,請稍後再試";
}
