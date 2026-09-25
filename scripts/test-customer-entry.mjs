import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

async function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { customerBrowserFallbackUrl, customerEntryUrl, publicCustomerEntryUrl, bookingLiffHandoffUrl } = await load("../lib/customer-entry.ts");
const { bookingDoctorSelection, bookingPatientSelection } = await load("../lib/booking-selection.ts");
const { paymentResultState } = await load("../lib/payment-result-state.ts");
const { tryCloseLiffWindow } = await load("../lib/liff-window.ts");
const { liffEntryParams, bookingEntryDate } = await load("../lib/liff-entry-state.ts");
const parse = (path) => new URL(path, "https://brand.example");
const { parsePublicPatientInput } = await load("../lib/public-patient-input.ts");
test("patient identity accepts real leap days and rejects malformed fields without coercion", () => {
  const valid = { name: " 顧客 ", phone: " 0912345678 ", birthday: "2000-02-29" };
  assert.deepEqual(parsePublicPatientInput(valid), { ok: true, name: "顧客", phone: "0912345678", birthday: "2000-02-29" });
  for (const body of [null, [], "text", { ...valid, name: 123 }, { ...valid, phone: {} }, { ...valid, birthday: [] }, { ...valid, name: "a".repeat(101) }, { ...valid, phone: "1".repeat(41) }]) assert.equal(parsePublicPatientInput(body).ok, false);
  for (const birthday of ["2025-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2000-2-29"]) assert.equal(parsePublicPatientInput({ ...valid, birthday }).ok, false);
});
const { registrationStoredToken, registrationRecordWithToken } = await load("../lib/registration-storage.ts");

test("damaged registration storage produces no token and valid records preserve their metadata", () => {
  for (const raw of [null, "broken-json", "[]", "null", '{"checkin_token":42}']) assert.equal(registrationStoredToken(raw), "");
  const raw = JSON.stringify({ registration_no: "R001", checkin_token: "old", event_title: "課程" });
  assert.equal(registrationStoredToken(raw), "old");
  assert.deepEqual(JSON.parse(registrationRecordWithToken(raw, " new ")), { registration_no: "R001", checkin_token: "new", event_title: "課程" });
  assert.equal(registrationRecordWithToken(raw, "  "), null);
});
const { safeLocalStorageRemoveMatching } = await load("../lib/browser-storage.ts");

test("expired-session cleanup preserves other brands and a session replaced by another tab", () => {
  const previous = globalThis.window;
  const entries = new Map([["brand-a", "expired"], ["brand-b", "other"], ["new-session", "fresh"]]);
  try {
    globalThis.window = { localStorage: { getItem: (key) => entries.get(key), removeItem: (key) => entries.delete(key) } };
    assert.equal(safeLocalStorageRemoveMatching(["brand-a", "new-session"], "expired"), true);
    assert.equal(entries.has("brand-a"), false);
    assert.equal(entries.get("brand-b"), "other");
    assert.equal(entries.get("new-session"), "fresh");
    globalThis.window = { get localStorage() { throw new Error("blocked"); } };
    assert.equal(safeLocalStorageRemoveMatching(["brand-a"], "expired"), false);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("rebooking preserves the original authorized customer instead of the first family member", () => {
  const patients = [{ id: "parent" }, { id: "child" }];
  assert.equal(bookingPatientSelection(patients, "parent", "child"), "child");
  assert.equal(bookingPatientSelection(patients, "parent", "removed-or-other-brand"), "");
  assert.equal(bookingPatientSelection([], "parent", "child"), "");
});

test("customer refresh preserves explicit choices and never replaces a removed customer", () => {
  const patients = [{ id: "parent" }, { id: "child" }];
  assert.equal(bookingPatientSelection(patients, "child", null), "child");
  assert.equal(bookingPatientSelection(patients, "__new__", null), "__new__");
  assert.equal(bookingPatientSelection(patients, "removed", null), "");
  assert.equal(bookingPatientSelection(patients, "", null), "parent");
  assert.equal(bookingPatientSelection([], "", null), "__new__");
});

test("optional providers stay selected while resources never require fictional staff", () => {
  const doctors = [{ id: "a" }, { id: "b" }];
  assert.equal(bookingDoctorSelection("provider_optional", "b", doctors), "b");
  assert.equal(bookingDoctorSelection("provider_optional", "", [{ id: "a" }]), "");
  assert.equal(bookingDoctorSelection("provider_optional", "other-brand", doctors), "");
  assert.equal(bookingDoctorSelection("resource_only", "a", doctors), "");
  assert.equal(bookingDoctorSelection("provider_required", "b", doctors), "b");
  assert.equal(bookingDoctorSelection("provider_required", "", doctors), "");
  assert.equal(bookingDoctorSelection("provider_required", "", [{ id: "a" }]), "a");
});

test("browser-to-LINE handoff uses current choices, discards stale choices and excludes personal fields", () => {
  const source = new URLSearchParams("clinic_slug=brand-a&service_id=old&doctor_id=old&date=2026-09-14&phone=0912345678&idToken=secret&utm_source=web");
  const href = bookingLiffHandoffUrl(source, { serviceId: "new", doctorId: "", date: "2026-09-20", visitType: "first" });
  const url = parse(href);
  assert.equal(url.pathname, "/book");
  assert.equal(url.searchParams.get("view"), "booking");
  assert.equal(url.searchParams.get("task"), "1");
  assert.equal(url.searchParams.get("service_id"), "new");
  assert.equal(url.searchParams.has("doctor_id"), false);
  assert.equal(url.searchParams.get("visit_type"), "first");
  assert.equal(url.searchParams.get("clinic_slug"), "brand-a");
  assert.equal(url.searchParams.has("phone"), false);
  assert.equal(url.searchParams.has("idToken"), false);
  const fallback = parse(customerBrowserFallbackUrl("booking", url.searchParams));
  assert.equal(fallback.searchParams.get("date"), "2026-09-20");
  assert.equal(fallback.searchParams.get("visit_type"), "first");
});

test("return-to-LINE handles unsupported browsers and SDK failures without crashing", () => {
  let closes = 0;
  assert.equal(tryCloseLiffWindow(), false);
  assert.equal(tryCloseLiffWindow({ isInClient: () => false, closeWindow: () => { closes += 1; } }), false);
  assert.equal(tryCloseLiffWindow({ isInClient: () => true }), false);
  assert.equal(tryCloseLiffWindow({ isInClient: () => { throw new Error("unavailable"); } }), false);
  assert.equal(tryCloseLiffWindow({ isInClient: () => true, closeWindow: () => { throw new Error("close failed"); } }), false);
  assert.equal(closes, 0);
  assert.equal(tryCloseLiffWindow({ isInClient: () => true, closeWindow: () => { closes += 1; } }), true);
  assert.equal(closes, 1);
});

test("website service and event actions enter the configured LINE task without reselecting", () => {
  const brand = { clinicId: "brand-id", clinicSlug: "brand-a", enabled: true, liffId: "123-brand", loginChannelId: "123" };
  for (const [key, extra] of [["booking", { service_id: "service-a" }], ["events", { event: "event-a" }]]) {
    const result = new URL(publicCustomerEntryUrl(key, brand, extra));
    assert.equal(result.origin, "https://liff.line.me");
    assert.equal(result.pathname, "/123-brand");
    assert.equal(result.searchParams.get("view"), key);
    assert.equal(result.searchParams.get("task"), "1");
    assert.equal(result.searchParams.get("clinic_slug"), "brand-a");
    for (const [name, value] of Object.entries(extra)) assert.equal(result.searchParams.get(name), value);
  }
});

test("disabled or incomplete brand LINE settings keep working browser actions", () => {
  const brand = { clinicId: "brand-id", clinicSlug: null, enabled: true, liffId: "123-brand", loginChannelId: "123" };
  for (const change of [{ enabled: false }, { liffId: null }, { loginChannelId: null }]) {
    assert.equal(publicCustomerEntryUrl("booking", { ...brand, ...change }, { service_id: "service-a" }), "/book/browser?clinic_id=brand-id&service_id=service-a");
    assert.equal(publicCustomerEntryUrl("events", { ...brand, ...change }, { event: "event-a" }), "/register?clinic_id=brand-id&event=event-a");
  }
});

const paid = { status: "paid", target: "appointment", appointment_status: "confirmed", registration_status: null, registration_payment_status: null, membership_id: null };
test("delayed payment confirmation progresses without treating payment alone as completion", () => {
  assert.equal(paymentResultState({ ...paid, status: "pending", appointment_status: "booked" }), "processing");
  assert.equal(paymentResultState({ ...paid, appointment_status: "booked" }), "processing");
  assert.equal(paymentResultState(paid), "completed");
  for (const status of ["done", "no_show"]) assert.equal(paymentResultState({ ...paid, appointment_status: status }), "completed");
});

test("paid cancelled appointments and registrations require review instead of claiming success", () => {
  assert.equal(paymentResultState({ ...paid, appointment_status: "cancelled" }), "needs_review");
  assert.equal(paymentResultState({ ...paid, target: "registration", registration_status: "cancelled", registration_payment_status: "paid" }), "needs_review");
  for (const status of ["failed", "expired", "cancelled"]) assert.equal(paymentResultState({ ...paid, status }), "incomplete");
  assert.equal(paymentResultState({ ...paid, status: "refunded" }), "refunded");
});

test("registration and membership completion waits for the corresponding entitlement", () => {
  assert.equal(paymentResultState({ ...paid, target: "registration", registration_payment_status: "paid", registration_status: "pending" }), "processing");
  assert.equal(paymentResultState({ ...paid, target: "registration", registration_payment_status: "paid", registration_status: "confirmed" }), "completed");
  assert.equal(paymentResultState({ ...paid, target: "membership" }), "processing");
  assert.equal(paymentResultState({ ...paid, target: "membership", membership_id: "membership-a" }), "completed");
});

test("LINE selection survives primary redirect and browser fallback", () => {
  const link = new URL(customerEntryUrl("booking", {
    baseUrl: "https://brand.example", clinicSlug: "brand-a", liffId: "123-app",
    extraParams: { service_id: "service-a", doctor_id: "doctor-a", date: "2026-09-20", task: "1", utm_source: "line" },
  }));
  const primary = new URLSearchParams({ "liff.state": `/${link.search}` });
  const fallback = parse(customerBrowserFallbackUrl("booking", liffEntryParams(primary.toString())));
  assert.equal(fallback.pathname, "/book/browser");
  for (const key of ["clinic_slug", "service_id", "doctor_id", "date", "utm_source"]) {
    assert.equal(fallback.searchParams.get(key), link.searchParams.get(key));
  }
  assert.equal(fallback.searchParams.has("task"), false);
  assert.equal(fallback.searchParams.has("liff.state"), false);
});

test("fallback never copies identity, payment tokens, personal data or redirects", () => {
  const source = new URLSearchParams({ clinic_slug: "brand-a", clinic_id: "other", idToken: "secret", access_token: "secret", browser_token: "secret", line_user_id: "person", phone: "0912345678", name: "private", redirect: "https://other.example", payment_token: "secret" });
  assert.equal(customerBrowserFallbackUrl("booking", source), "/book/browser?clinic_slug=brand-a");
});

test("event fallback keeps the selected private event, but no LINE login", () => {
  const source = new URLSearchParams({ clinic_id: "brand-id", event: "event-a", access_token: "event-invitation", liff: "1", idToken: "secret", service_id: "irrelevant" });
  assert.equal(customerBrowserFallbackUrl("events", source), "/register?clinic_id=brand-id&event=event-a&access_token=event-invitation");
  assert.equal(customerBrowserFallbackUrl("membership", source), "/membership?clinic_id=brand-id");
});

test("LIFF primary redirect never confuses LINE access tokens with private event invitations", () => {
  for (const invitation of [null, "private-event-invitation"]) {
    const task = new URLSearchParams({ clinic_slug: "brand-a", event: "event-a", view: "events" });
    if (invitation) task.set("access_token", invitation);
    const primary = new URLSearchParams({ access_token: "LINE-SECRET", "liff.state": `/?${task}` });
    const fallback = parse(customerBrowserFallbackUrl("events", liffEntryParams(primary.toString())));
    assert.equal(fallback.searchParams.get("access_token"), invitation);
    assert.equal(fallback.toString().includes("LINE-SECRET"), false);
  }
});

test("browser routes stay local for every view and preserve campaign attribution", () => {
  const paths = { home: "/", booking: "/book/browser", appointments: "/my", events: "/register", tickets: "/my", membership: "/membership", support: "/", brand: "/" };
  for (const [key, path] of Object.entries(paths)) {
    const result = parse(customerBrowserFallbackUrl(key, new URLSearchParams("utm_source=line&utm_campaign=launch&utm_medium=menu&rm_slot=2")));
    assert.equal(result.origin, "https://brand.example");
    assert.equal(result.pathname, path);
    assert.equal(result.searchParams.get("utm_campaign"), "launch");
  }
});

test("direct scope wins over nested LIFF state and the source remains untouched", () => {
  const query = new URLSearchParams({ clinic_slug: "brand-a", "liff.state": "/?clinic_slug=brand-b&service_id=s" }).toString();
  const source = liffEntryParams(query);
  assert.equal(source.get("clinic_slug"), "brand-a");
  const before = source.toString();
  customerBrowserFallbackUrl("booking", source);
  assert.equal(source.toString(), before);
});

test("only real calendar dates inside the brand booking window are restored", () => {
  const date = (value, start = "2026-09-14", end = "2026-10-14") => bookingEntryDate(new URLSearchParams({ date: value }), start, end);
  assert.equal(date("2026-09-14"), "2026-09-14");
  assert.equal(date("2026-10-14"), "2026-10-14");
  for (const value of ["", "2026-09-13", "2026-10-15", "2026-09-31", "2026-9-20", "invalid"]) assert.equal(date(value), null);
  assert.equal(date("2028-02-29", "2028-02-01", "2028-03-01"), "2028-02-29");
  assert.equal(date("2027-02-29", "2027-02-01", "2027-03-01"), null);
});
