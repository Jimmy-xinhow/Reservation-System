import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase staging environment variables");
if (environmentName.toLowerCase() !== "staging") throw new Error(`Refusing to run outside staging: ${environmentName || "unknown"}`);

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const qaSlug = `qa-commerce-${suffix}`;
const qaEmail = `qa-commerce-${suffix}@example.invalid`;
const qaPassword = `${randomBytes(18).toString("base64url")}!Aa1`;
let clinicId = null;
let adminUserId = null;
let failed = false;

function pass(message) { console.log(`[PASS] ${message}`); }
function fail(message) { failed = true; console.error(`[FAIL] ${message}`); }
function assert(message, condition) { condition ? pass(message) : fail(message); }
async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function rpcRow(data) { return Array.isArray(data) ? data[0] : data; }
function relationOne(value) { return Array.isArray(value) ? value[0] : value; }

async function cleanupClinic(targetClinicId) {
  const errors = [];
  async function remove(label, query) {
    const { error } = await query;
    if (error) errors.push(`${label}: ${error.message}`);
  }
  if (!targetClinicId) return;

  for (const table of [
    "registration_notification_logs",
    "registration_status_events",
    "checkins",
    "registration_answers",
    "waitlist_entries",
    "discount_redemptions",
    "payment_transactions",
    "payment_status_events",
    "payment_webhook_events",
  ]) await remove(table, service.from(table).delete().eq("clinic_id", targetClinicId));

  const registrationOrders = await service.from("payment_orders").delete()
    .eq("clinic_id", targetClinicId).not("registration_id", "is", null);
  if (registrationOrders.error) errors.push(`registration payment orders: ${registrationOrders.error.message}`);
  await remove("registrations", service.from("registrations").delete().eq("clinic_id", targetClinicId));
  await remove("membership ledger", service.from("membership_ledger").delete().eq("clinic_id", targetClinicId));
  await remove("patient memberships", service.from("patient_memberships").delete().eq("clinic_id", targetClinicId));
  await remove("payment orders", service.from("payment_orders").delete().eq("clinic_id", targetClinicId));
  await remove("form fields", service.from("registration_form_fields").delete().eq("clinic_id", targetClinicId));
  await remove("forms", service.from("registration_forms").delete().eq("clinic_id", targetClinicId));
  await remove("ticket types", service.from("event_ticket_types").delete().eq("clinic_id", targetClinicId));
  await remove("event sessions", service.from("event_sessions").delete().eq("clinic_id", targetClinicId));
  await remove("events", service.from("events").delete().eq("clinic_id", targetClinicId));
  await remove("discount codes", service.from("discount_codes").delete().eq("clinic_id", targetClinicId));
  await remove("membership plan prices", service.from("membership_plan_level_prices").delete().eq("clinic_id", targetClinicId));
  await remove("membership levels", service.from("membership_levels").delete().eq("clinic_id", targetClinicId));
  await remove("membership plans", service.from("membership_plans").delete().eq("clinic_id", targetClinicId));
  await remove("patients", service.from("patients").delete().eq("clinic_id", targetClinicId));
  await remove("members", service.from("clinic_members").delete().eq("clinic_id", targetClinicId));
  await remove("LINE channels", service.from("clinic_line_channels").delete().eq("clinic_id", targetClinicId));
  await remove("entitlements", service.from("brand_entitlements").delete().eq("clinic_id", targetClinicId));
  await remove("settings", service.from("clinic_settings").delete().eq("clinic_id", targetClinicId));
  await remove("clinic", service.from("clinics").delete().eq("id", targetClinicId));
  if (errors.length) throw new Error(errors.join("; "));
}

async function cleanup() {
  const errors = [];
  if (clinicId) {
    try { await cleanupClinic(clinicId); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (adminUserId) {
    const { error } = await service.auth.admin.deleteUser(adminUserId);
    if (error) errors.push(`admin auth user: ${error.message}`);
  }
  if (errors.length) throw new Error(errors.join("; "));
}

function registrationParams({ eventId, sessionId, ticketId, patient, name, answers, termsVersion, formId, discountCode = null, membershipCode = null, accessToken = null }) {
  return {
    p_clinic_id: clinicId,
    p_event_id: eventId,
    p_session_id: sessionId,
    p_ticket_type_id: ticketId,
    p_name: name,
    p_phone: patient.phone,
    p_email: `${patient.phone}@example.invalid`,
    p_line_user_id: null,
    p_marketing_opt_in: true,
    p_answers: answers,
    p_access_token: accessToken,
    p_discount_code: discountCode,
    p_membership_code: membershipCode,
    p_form_id: formId,
    p_form_version: 1,
    p_terms_version: termsVersion,
    p_terms_accepted_at: new Date().toISOString(),
    p_patient_id: patient.id,
  };
}

try {
  const staleClinics = await must("find stale QA clinics", service.from("clinics").select("id").like("slug", "qa-commerce-%"));
  for (const staleClinic of staleClinics ?? []) await cleanupClinic(staleClinic.id);
  if ((staleClinics ?? []).length) pass(`Removed ${staleClinics.length} stale commerce QA clinic(s)`);

  const createdUser = await service.auth.admin.createUser({ email: qaEmail, password: qaPassword, email_confirm: true });
  if (createdUser.error || !createdUser.data.user) throw new Error(`create admin auth: ${createdUser.error?.message ?? "missing user"}`);
  adminUserId = createdUser.data.user.id;

  const clinic = await must("create clinic", service.from("clinics").insert({
    name: "QA Commerce Lifecycle", slug: qaSlug, active: true,
  }).select("id").single());
  clinicId = clinic.id;
  await must("configure commerce features", service.from("clinic_settings").update({
    events_enabled: true,
    public_registration_enabled: true,
    memberships_enabled: true,
  }).eq("clinic_id", clinicId));
  await must("create brand administrator", service.from("clinic_members").insert({
    clinic_id: clinicId,
    user_id: adminUserId,
    role: "owner",
    access_type: "brand_admin",
    permissions: ["brand.manage", "operations.manage"],
  }));

  const phoneBase = suffix.replace(/\D/g, "").slice(-7).padStart(7, "0");
  const patients = await must("create patients", service.from("patients").insert(
    [1, 2, 3, 4, 5, 6].map((index) => ({
      clinic_id: clinicId,
      name: `QA Attendee ${index}`,
      phone: `09${index}${phoneBase}`.slice(0, 10),
      marketing_opt_in: true,
    })),
  ).select("id,name,phone"));

  const membershipPlan = await must("create registration membership plan", service.from("membership_plans").insert({
    clinic_id: clinicId,
    name: "QA Event Pass",
    price: 500,
    credits_total: 2,
    valid_days: 30,
    usage_scope: "registration",
    active: true,
  }).select("id").single());
  const purchasePlan = await must("create purchase membership plan", service.from("membership_plans").insert({
    clinic_id: clinicId,
    name: "QA Purchase Pass",
    price: 600,
    credits_total: 3,
    valid_days: 60,
    usage_scope: "both",
    active: true,
  }).select("id").single());
  const granted = rpcRow(await must("grant membership", service.rpc("grant_patient_membership", {
    p_clinic_id: clinicId,
    p_patient_id: patients[0].id,
    p_plan_id: membershipPlan.id,
    p_actor_user_id: adminUserId,
    p_source: "manual",
    p_note: "staging commerce audit",
  })));
  assert("manual membership starts with two credits", granted?.credits_remaining === 2 && Boolean(granted?.membership_code));

  const startAt = new Date(Date.now() + 7 * 86_400_000);
  const endAt = new Date(startAt.getTime() + 2 * 60 * 60_000);
  const event = await must("create event", service.from("events").insert({
    clinic_id: clinicId,
    slug: `qa-event-${suffix}`,
    title: "QA Event",
    description: "Staging commerce audit",
    status: "published",
    access_mode: "public",
    registration_open_at: new Date(Date.now() - 60_000).toISOString(),
    registration_close_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    terms_version: 3,
    terms_text: "QA terms",
    created_by: adminUserId,
  }).select("id").single());
  const sessions = await must("create sessions", service.from("event_sessions").insert([
    {
      clinic_id: clinicId, event_id: event.id, name: "Capacity Session",
      start_at: startAt.toISOString(), end_at: endAt.toISOString(), capacity: 1, waitlist_enabled: true,
    },
    {
      clinic_id: clinicId, event_id: event.id, name: "Benefits Session",
      start_at: new Date(startAt.getTime() + 86_400_000).toISOString(),
      end_at: new Date(endAt.getTime() + 86_400_000).toISOString(), capacity: 5, waitlist_enabled: true,
    },
  ]).select("id,name"));
  const capacitySession = sessions.find((row) => row.name === "Capacity Session");
  const benefitsSession = sessions.find((row) => row.name === "Benefits Session");
  const tickets = await must("create ticket types", service.from("event_ticket_types").insert([
    { clinic_id: clinicId, event_id: event.id, name: "Free", price: 0, capacity: 1, active: true },
    { clinic_id: clinicId, event_id: event.id, name: "Paid", price: 100, capacity: 5, membership_plan_id: membershipPlan.id, active: true },
  ]).select("id,name"));
  const freeTicket = tickets.find((row) => row.name === "Free");
  const paidTicket = tickets.find((row) => row.name === "Paid");
  const form = await must("create published form", service.from("registration_forms").insert({
    clinic_id: clinicId, event_id: event.id, version: 1, status: "published",
  }).select("id").single());
  await must("create form field", service.from("registration_form_fields").insert({
    clinic_id: clinicId, form_id: form.id, field_key: "diet", label: "Diet", field_type: "text", required: true,
  }));

  const privateAccessToken = `private-${suffix}`;
  const privateEvent = await must("create private event", service.from("events").insert({
    clinic_id: clinicId,
    slug: `qa-private-event-${suffix}`,
    title: "QA Private Event",
    description: "Private link audit",
    status: "published",
    access_mode: "private",
    access_token_hash: createHash("sha256").update(privateAccessToken).digest("hex"),
    registration_open_at: new Date(Date.now() - 60_000).toISOString(),
    registration_close_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    terms_version: 1,
    terms_text: "Private QA terms",
    created_by: adminUserId,
  }).select("id").single());
  const privateSession = await must("create private event session", service.from("event_sessions").insert({
    clinic_id: clinicId, event_id: privateEvent.id, name: "Private Session",
    start_at: new Date(startAt.getTime() + 2 * 86_400_000).toISOString(),
    end_at: new Date(endAt.getTime() + 2 * 86_400_000).toISOString(), capacity: 3, waitlist_enabled: false,
  }).select("id").single());
  const privateTicket = await must("create private event ticket", service.from("event_ticket_types").insert({
    clinic_id: clinicId, event_id: privateEvent.id, name: "Invitation", price: 0, capacity: 3, active: true,
  }).select("id").single());
  const privateForm = await must("create private event form", service.from("registration_forms").insert({
    clinic_id: clinicId, event_id: privateEvent.id, version: 1, status: "published",
  }).select("id").single());
  await must("create private event form field", service.from("registration_form_fields").insert({
    clinic_id: clinicId, form_id: privateForm.id, field_key: "note", label: "Note", field_type: "text", required: false,
  }));
  const rejectedPrivateRegistration = await service.rpc("register_for_event_with_terms", registrationParams({
    eventId: privateEvent.id, sessionId: privateSession.id, ticketId: privateTicket.id,
    patient: patients[4], name: patients[4].name, answers: { note: "wrong link" }, termsVersion: 1,
    formId: privateForm.id, accessToken: "wrong-private-token",
  }));
  assert("私人活動會拒絕缺少或錯誤的連結憑證", Boolean(rejectedPrivateRegistration.error));
  const acceptedPrivateRegistration = rpcRow(await must("register through valid private event link", service.rpc("register_for_event_with_terms", registrationParams({
    eventId: privateEvent.id, sessionId: privateSession.id, ticketId: privateTicket.id,
    patient: patients[4], name: patients[4].name, answers: { note: "valid link" }, termsVersion: 1,
    formId: privateForm.id, accessToken: privateAccessToken,
  }))));
  assert("正確的私人活動連結可完成報名", acceptedPrivateRegistration?.registration_status === "confirmed" &&
    acceptedPrivateRegistration?.payment_status === "not_required");

  const capacityResults = await Promise.all([
    service.rpc("register_for_event_with_terms", registrationParams({
      eventId: event.id, sessionId: capacitySession.id, ticketId: freeTicket.id,
      patient: patients[1], name: patients[1].name, answers: { diet: "none" }, termsVersion: 3, formId: form.id,
    })),
    service.rpc("register_for_event_with_terms", registrationParams({
      eventId: event.id, sessionId: capacitySession.id, ticketId: freeTicket.id,
      patient: patients[2], name: patients[2].name, answers: { diet: "vegetarian" }, termsVersion: 3, formId: form.id,
    })),
  ]);
  if (capacityResults.some((result) => result.error)) throw new Error(`capacity registrations: ${capacityResults.map((r) => r.error?.message ?? "success").join(" | ")}`);
  const capacityRows = capacityResults.map((result) => rpcRow(result.data));
  const confirmed = capacityRows.find((row) => row.registration_status === "confirmed");
  const waitlisted = capacityRows.find((row) => row.registration_status === "waitlisted");
  assert("concurrent event capacity yields one confirmed and one waitlisted", Boolean(confirmed) && Boolean(waitlisted));
  console.log(`[INFO] capacity registration numbers: ${capacityRows.map((row) => row.registration_no).join(", ")}`);

  const snapshots = await must("read answer and terms snapshots", service.from("registrations")
    .select("id,terms_version,terms_accepted_at,form_id,form_version,registration_answers(answers)")
    .in("id", capacityRows.map((row) => row.registration_id)));
  assert("registration answers, form version and terms consent are persisted", snapshots.length === 2 && snapshots.every((row) =>
    row.terms_version === 3 && Boolean(row.terms_accepted_at) && row.form_id === form.id && row.form_version === 1 && Boolean(relationOne(row.registration_answers)?.answers?.diet)));

  await must("cancel confirmed registration", service.rpc("cancel_registration", {
    p_clinic_id: clinicId, p_token: confirmed.checkin_token,
  }));
  const promoted = await must("read promoted waitlist", service.from("registrations")
    .select("status,payment_status,waitlist_entries(status)").eq("id", waitlisted.registration_id).single());
  assert("cancellation atomically promotes first event waitlist entry", promoted.status === "confirmed" && promoted.payment_status === "not_required" && relationOne(promoted.waitlist_entries)?.status === "promoted");

  const firstCheckin = rpcRow(await must("accept QR check-in", service.rpc("checkin_registration", {
    p_clinic_id: clinicId, p_token: waitlisted.checkin_token, p_user_id: adminUserId,
  })));
  const duplicateCheckin = rpcRow(await must("repeat QR check-in", service.rpc("checkin_registration", {
    p_clinic_id: clinicId, p_token: waitlisted.checkin_token, p_user_id: adminUserId,
  })));
  const checkinCount = await must("count QR check-ins", service.from("checkins")
    .select("id", { count: "exact" }).eq("registration_id", waitlisted.registration_id));
  assert("QR check-in accepts once and reports duplicate without a second row", firstCheckin?.result === "accepted" && duplicateCheckin?.result === "duplicate" && checkinCount.length === 1);
  const rejectedCheckin = await service.rpc("checkin_registration", {
    p_clinic_id: clinicId, p_token: `invalid-${suffix}`, p_user_id: adminUserId,
  });
  const totalCheckinsAfterRejected = await must("count check-ins after invalid QR", service.from("checkins")
    .select("id").eq("clinic_id", clinicId));
  assert("錯誤 QR 憑證會被拒絕且不新增報到紀錄", Boolean(rejectedCheckin.error) && totalCheckinsAfterRejected.length === 1);

  const membershipRegistration = rpcRow(await must("register with membership", service.rpc("register_for_event_with_terms", registrationParams({
    eventId: event.id, sessionId: benefitsSession.id, ticketId: paidTicket.id,
    patient: patients[0], name: patients[0].name, answers: { diet: "none" }, termsVersion: 3, formId: form.id,
    membershipCode: granted.membership_code,
  }))));
  assert("membership replaces one paid ticket and confirms registration", membershipRegistration?.membership_applied === true && membershipRegistration?.amount === 0 && membershipRegistration?.registration_status === "confirmed");
  const afterConsume = await must("read consumed membership", service.from("patient_memberships")
    .select("credits_remaining").eq("id", granted.membership_id).single());
  assert("membership consumes exactly one credit", afterConsume.credits_remaining === 1);
  await must("cancel membership registration", service.rpc("cancel_registration", {
    p_clinic_id: clinicId, p_token: membershipRegistration.checkin_token,
  }));
  await must("repeat membership cancellation", service.rpc("cancel_registration", {
    p_clinic_id: clinicId, p_token: membershipRegistration.checkin_token,
  }));
  const restored = await must("read restored membership", service.from("patient_memberships")
    .select("credits_remaining").eq("id", granted.membership_id).single());
  const membershipLedger = await must("read membership ledger", service.from("membership_ledger")
    .select("kind").eq("membership_id", granted.membership_id));
  assert("membership cancellation restores once and remains idempotent", restored.credits_remaining === 2 && membershipLedger.filter((row) => row.kind === "consume").length === 1 && membershipLedger.filter((row) => row.kind === "restore").length === 1);

  const discount = await must("create discount code", service.from("discount_codes").insert({
    clinic_id: clinicId, code: `QA${suffix.replace(/\D/g, "").slice(-8)}`, kind: "percent", value: 20,
    min_amount: 0, max_uses: 10, active: true,
  }).select("id,code").single());
  const stackedBenefits = await service.rpc("register_for_event_with_terms", registrationParams({
    eventId: event.id, sessionId: benefitsSession.id, ticketId: paidTicket.id,
    patient: patients[0], name: patients[0].name, answers: { diet: "none" }, termsVersion: 3, formId: form.id,
    discountCode: discount.code, membershipCode: granted.membership_code,
  }));
  assert("優惠碼與套票不可疊加", Boolean(stackedBenefits.error));
  const couponRegistration = rpcRow(await must("register with coupon", service.rpc("register_for_event_with_terms", registrationParams({
    eventId: event.id, sessionId: benefitsSession.id, ticketId: paidTicket.id,
    patient: patients[3], name: patients[3].name, answers: { diet: "none" }, termsVersion: 3, formId: form.id,
    discountCode: discount.code,
  }))));
  assert("20 percent coupon reserves a pending TWD 80 registration", couponRegistration?.amount === 80 && couponRegistration?.discount_amount === 20 && couponRegistration?.registration_status === "pending" && couponRegistration?.payment_status === "pending");
  const reservedRedemption = await must("read reserved redemption", service.from("discount_redemptions")
    .select("status").eq("registration_id", couponRegistration.registration_id).single());
  const discountReserved = await must("read reserved discount count", service.from("discount_codes").select("used_count").eq("id", discount.id).single());
  assert("coupon reservation increments usage once", reservedRedemption.status === "reserved" && discountReserved.used_count === 1);
  const couponPaymentOrder = await must("create pending registration payment order", service.from("payment_orders").insert({
    clinic_id: clinicId, registration_id: couponRegistration.registration_id, provider: "newebpay",
    merchant_order_no: `QAREG${Date.now()}`, amount: couponRegistration.amount,
    expires_at: new Date(Date.now() - 60_000).toISOString(), return_path: "/register", status: "pending",
  }).select("id").single());
  await must("force registration payment expiry", service.from("registrations").update({
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq("id", couponRegistration.registration_id));
  const expiredRegistrationCount = await must("expire pending registration payments", service.rpc("expire_registration_payments"));
  const releasedBenefitCount = await must("release expired registration benefits", service.rpc("release_expired_registration_benefits"));
  const expiredRegistration = await must("read expired registration", service.from("registrations")
    .select("status,payment_status,expires_at").eq("id", couponRegistration.registration_id).single());
  const expiredRegistrationOrder = await must("read expired registration order", service.from("payment_orders")
    .select("status").eq("id", couponPaymentOrder.id).single());
  const registrationPaymentEvent = await must("read registration payment status event", service.from("payment_status_events")
    .select("from_status,to_status,source").eq("payment_order_id", couponPaymentOrder.id).single());
  const releasedRedemption = await must("read released redemption", service.from("discount_redemptions")
    .select("status").eq("registration_id", couponRegistration.registration_id).single());
  const discountReleased = await must("read released discount count", service.from("discount_codes").select("used_count").eq("id", discount.id).single());
  assert("報名付款逾時會取消報名、逾期訂單並釋放優惠名額", expiredRegistrationCount >= 1 && releasedBenefitCount >= 1 &&
    expiredRegistration.status === "cancelled" && expiredRegistration.payment_status === "expired" && expiredRegistration.expires_at === null &&
    expiredRegistrationOrder.status === "expired" && registrationPaymentEvent.from_status === "pending" &&
    registrationPaymentEvent.to_status === "expired" && registrationPaymentEvent.source === "registration_expiry" &&
    releasedRedemption.status === "released" && discountReleased.used_count === 0);

  const merchantOrderNo = `QA${Date.now()}`;
  const paymentOrder = await must("create paid membership order", service.from("payment_orders").insert({
    clinic_id: clinicId,
    membership_plan_id: purchasePlan.id,
    patient_id: patients[3].id,
    provider: "ecpay",
    merchant_order_no: merchantOrderNo,
    amount: 600,
    currency: "TWD",
    return_path: "/admin/memberships",
    status: "paid",
  }).select("id").single());
  await must("record accepted provider event", service.from("payment_transactions").insert({
    clinic_id: clinicId,
    payment_order_id: paymentOrder.id,
    provider_transaction_no: `TX-${suffix}`,
    event_key: `paid-${suffix}`,
    status: "accepted",
    payload: { audit: true },
  }));
  const duplicateTransaction = await service.from("payment_transactions").insert({
    clinic_id: clinicId,
    payment_order_id: paymentOrder.id,
    provider_transaction_no: `TX-${suffix}`,
    event_key: `paid-${suffix}`,
    status: "accepted",
    payload: { audit: true },
  });
  assert("payment provider event key rejects duplicate delivery", Boolean(duplicateTransaction.error));

  const firstPaidGrant = rpcRow(await must("grant paid membership", service.rpc("grant_paid_membership_from_order", {
    p_clinic_id: clinicId, p_payment_order_id: paymentOrder.id,
  })));
  const secondPaidGrant = rpcRow(await must("repeat paid membership grant", service.rpc("grant_paid_membership_from_order", {
    p_clinic_id: clinicId, p_payment_order_id: paymentOrder.id,
  })));
  const paidMemberships = await must("read paid membership result", service.from("patient_memberships")
    .select("id,credits_remaining,membership_ledger(kind)").eq("payment_order_id", paymentOrder.id));
  assert("paid membership grant is idempotent", firstPaidGrant?.membership_id === secondPaidGrant?.membership_id && paidMemberships.length === 1 && paidMemberships[0].credits_remaining === 3 && paidMemberships[0].membership_ledger.filter((row) => row.kind === "grant").length === 1);

  const statusEvents = await must("read registration audit history", service.from("registration_status_events")
    .select("to_status").eq("clinic_id", clinicId));
  assert("registration lifecycle writes auditable status history", ["waitlisted", "confirmed", "cancelled", "attended"].every((status) => statusEvents.some((row) => row.to_status === status)));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try { await cleanup(); pass("Temporary commerce data and Auth user cleaned"); }
  catch (error) { fail(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
}

if (failed) process.exit(1);
console.log("Staging commerce lifecycle audit passed.");
