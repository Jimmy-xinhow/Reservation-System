"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLiff } from "@/lib/useLiff";
import { formatTime, formatDateSession } from "@/lib/slots";
import { Brand } from "@/components/Brand";
import { googleCalendarUrl, type CalEvent } from "@/lib/calendar";
import ChatTab from "./ChatTab";
import { CustomerEntryNav, CustomerLiffView, type CustomerEntryAvailability, type CustomerView } from "./CustomerEntry";
import { trackFunnelEvent } from "@/lib/funnel-client";

interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
}
interface Service {
  id: string;
  name: string;
  description: string | null;
  booking_target: "provider_required" | "provider_optional" | "resource_only";
  booking_fields: BookingField[];
  service_addons: ServiceAddon[];
}
interface ServiceAddon { id: string; name: string; description: string | null; duration_minutes: number; price: number; }
interface BookingField { key: string; label: string; type: "text" | "textarea" | "date" | "select" | "checkbox" | "consent"; required: boolean; options: string[]; }
interface Config {
  clinic_name: string | null;
  liff_id: string | null;
  booking_mode: "time" | "number";
  deposit_enabled: boolean;
  max_advance_days: number;
  recurring_booking_enabled: boolean;
  max_recurring_occurrences: number;
  allow_multi_patient_per_phone: boolean;
  max_patients_per_phone: number;
  doctors: Doctor[];
  services: Service[];
}
interface EntryConfig {
  clinic_name: string | null;
  clinic_slug: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
  line_basic_id: string | null;
  liff_id: string | null;
  booking_mode: "time" | "number";
  availability: CustomerEntryAvailability;
}
interface BoundPatient {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  blocked_until: string | null;
}
interface Slot {
  slot_start: string;
  slot_end: string;
  remaining: number;
}
interface Session {
  template_id: string;
  session_start: string;
  session_end: string;
  total: number;
  taken: number;
  remaining: number;
}
interface ReserveResult {
  appointment_id: string;
  queue_number: number | null;
  deposit_status: string;
  deposit_amount: number;
  start_at: string | null;
  end_at: string | null;
  doctor_name: string | null;
  service_name: string | null;
  addons_amount: number;
  series_count: number;
  appointment_ids: string[];
}
interface WaitlistResult {
  waitlist_id: string;
  position: number;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBookingBrandScope(url), init);
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!json) throw new Error("伺服器回應異常");
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function withBookingBrandScope(url: string): string {
  if (typeof window === "undefined" || !url.startsWith("/api/")) return url;
  const source = new URLSearchParams(window.location.search);
  const scope = new URLSearchParams();
  const clinicSlug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (clinicSlug) scope.set("clinic_slug", clinicSlug);
  else if (clinicId) scope.set("clinic_id", clinicId);
  if (!scope.toString()) return url;
  const target = new URL(url, window.location.origin);
  scope.forEach((value, key) => target.searchParams.set(key, value));
  return `${target.pathname}${target.search}`;
}

function todayStr(offset = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
}

export default function BookPage() {
  const [entryConfig, setEntryConfig] = useState<EntryConfig | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const { ready, idToken, error: liffError } = useLiff(entryConfig === null ? undefined : entryConfig.liff_id);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [doctorId, setDoctorId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [waitlistSlots, setWaitlistSlots] = useState<Slot[]>([]);
  const [waitlistSessions, setWaitlistSessions] = useState<Session[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [availMsg, setAvailMsg] = useState<string | null>(null);

  const [pickedStart, setPickedStart] = useState<string | null>(null);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [email, setEmail] = useState("");
  const [membershipCode, setMembershipCode] = useState("");
  const [bookingAnswers, setBookingAnswers] = useState<Record<string, unknown>>({});
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [recurrenceCount, setRecurrenceCount] = useState(1);
  const [visitType, setVisitType] = useState<"first" | "return">("return");

  // 綁定:此 LINE 身分已綁定的顧客(null = 載入中)
  const [bound, setBound] = useState<BoundPatient[] | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState(""); // 顧客 id 或 "__new__"
  const [forWhom, setForWhom] = useState<"" | "self" | "other">(""); // 為自己 / 幫別人

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReserveResult | null>(null);
  const [waitlistResult, setWaitlistResult] = useState<WaitlistResult | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [view, setView] = useState<CustomerView>("booking");
  const trackedViews = useRef(new Set<string>());

  // 所有 Rich Menu 都進同一個 LIFF，再由 view 分流；保留舊 tab 參數相容。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (["booking", "appointments", "events", "tickets", "membership", "support", "brand"].includes(requested ?? "")) {
      setView(requested as CustomerView);
      return;
    }
    const legacyTab = params.get("tab");
    if (legacyTab === "chat") setView("support");
    if (legacyTab === "my") setView("appointments");
  }, []);

  useEffect(() => {
    api<EntryConfig>("/api/customer/entry-config")
      .then(setEntryConfig)
      .catch((e) => setEntryError(e instanceof Error ? e.message : "入口載入失敗"));
  }, []);

  useEffect(() => {
    if (!entryConfig) return;
    if (!trackedViews.current.has("portal")) {
      trackFunnelEvent("portal_view");
      trackedViews.current.add("portal");
    }
    if (trackedViews.current.has(view)) return;
    if (view === "booking") trackFunnelEvent("booking_view");
    if (view === "events") trackFunnelEvent("registration_view");
    if (view === "membership") trackFunnelEvent("membership_view");
    trackedViews.current.add(view);
  }, [entryConfig, view]);

  useEffect(() => {
    if (!entryConfig?.availability.booking || view !== "booking" || config) return;
    api<Config>("/api/booking/config")
      .then(setConfig)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "預約設定載入失敗"));
  }, [entryConfig, view, config]);

  // 取得此 LINE 身分已綁定的顧客
  const loadBound = useCallback(async () => {
    if (!idToken) return;
    try {
      const data = await api<{ patients: BoundPatient[] }>("/api/booking/patients-of-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      setBound(data.patients);
      setSelectedPatientId(data.patients[0]?.id ?? "__new__");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "讀取綁定失敗");
    }
  }, [idToken]);

  useEffect(() => {
    if (ready && idToken && view === "booking") loadBound();
  }, [ready, idToken, view, loadBound]);

  useEffect(() => {
    if (selectedPatientId === "__new__") {
      setEmail("");
      return;
    }
    const patient = (bound ?? []).find((item) => item.id === selectedPatientId);
    setEmail(patient?.email ?? "");
  }, [bound, selectedPatientId]);

  const maxDate = useMemo(
    () => (config ? todayStr(config.max_advance_days) : todayStr(30)),
    [config],
  );

  const selectedService = config?.services.find((service) => service.id === serviceId) ?? null;
  const providerRequired = !selectedService || selectedService.booking_target === "provider_required";

  // 需要指定人員的服務自動帶入唯一人員；資源型服務不強迫選人員。
  const singleDoctor = config?.doctors.length === 1 ? config.doctors[0] : null;
  useEffect(() => {
    if (!selectedService) return;
    if (providerRequired) {
      if (singleDoctor && doctorId !== singleDoctor.id) setDoctorId(singleDoctor.id);
    } else if (doctorId) {
      setDoctorId("");
    }
    setBookingAnswers({});
    setSelectedAddonIds([]);
    setRecurrenceCount(1);
  }, [selectedService, providerRequired, singleDoctor, doctorId]);

  const loadAvailability = useCallback(async () => {
    if (!config || !date || (providerRequired && !doctorId) || (config.services.length > 0 && !serviceId)) return;
    setAvailLoading(true);
    setAvailMsg(null);
    setSlots([]);
    setSessions([]);
    setWaitlistSlots([]);
    setWaitlistSessions([]);
    setPickedStart(null);
    setPickedTemplate(null);
    setJoiningWaitlist(false);
    try {
      if (config.booking_mode === "time") {
        const data = await api<{ slots: Slot[]; waitlist_slots?: Slot[] }>(
          `/api/booking/availability?${new URLSearchParams({ ...(doctorId ? { doctor_id: doctorId } : {}), date, visit_type: visitType, ...(serviceId ? { service_id: serviceId } : {}), ...(selectedAddonIds.length ? { addon_ids: selectedAddonIds.join(",") } : {}) }).toString()}`,
        );
        setSlots(data.slots);
        setWaitlistSlots(data.waitlist_slots ?? []);
        if (data.slots.length === 0) setAvailMsg((data.waitlist_slots ?? []).length > 0 ? "目前時段已額滿，可選擇候補。" : "這天沒有可預約的時段（未開放或已超過可預約時間）");
      } else {
        const data = await api<{ sessions: Session[]; waitlist_sessions?: Session[] }>(
          `/api/booking/availability?${new URLSearchParams({ ...(doctorId ? { doctor_id: doctorId } : {}), date, ...(serviceId ? { service_id: serviceId } : {}), ...(selectedAddonIds.length ? { addon_ids: selectedAddonIds.join(",") } : {}) }).toString()}`,
        );
        setSessions(data.sessions);
        setWaitlistSessions(data.waitlist_sessions ?? []);
        if (data.sessions.length === 0) setAvailMsg((data.waitlist_sessions ?? []).length > 0 ? "目前場次已額滿，可選擇候補。" : "這天沒有可預約的場次（未開放或已超過可預約時間）");
      }
    } catch (e) {
      setAvailMsg(e instanceof Error ? e.message : "查詢失敗");
    } finally {
      setAvailLoading(false);
    }
  }, [config, doctorId, date, visitType, serviceId, providerRequired, selectedAddonIds]);

  useEffect(() => {
    if (date && (!providerRequired || doctorId)) loadAvailability();
  }, [doctorId, date, loadAvailability, providerRequired]);

  const slotPicked = config?.booking_mode === "time" ? !!pickedStart : !!pickedTemplate;
  const addingNew = selectedPatientId === "__new__";
  const selectedBound = (bound ?? []).find((p) => p.id === selectedPatientId) ?? null;
  const selectedBlocked =
    !!selectedBound?.blocked_until && new Date(selectedBound.blocked_until) > new Date();
  const patientReady = addingNew
    ? !!name.trim() && !!phone.trim() && /^\d{4}-\d{2}-\d{2}$/.test(birthday)
    : !!selectedPatientId && !selectedBlocked;
  const serviceReady = config ? config.services.length === 0 || !!serviceId : false;
  const fieldsReady = bookingFieldsReady(selectedService?.booking_fields ?? [], bookingAnswers);
  const canSubmit = ready && patientReady && serviceReady && fieldsReady && slotPicked && !submitting && (!joiningWaitlist || !membershipCode.trim());

  async function handleSubmit() {
    if (!config || !idToken) return;
    trackFunnelEvent("booking_start", { booking_mode: config.booking_mode, waitlist: joiningWaitlist });
    setSubmitting(true);
    setSubmitErr(null);
    try {
      // 已綁定顧客直接用其 id;選「新增同行者」才建立新顧客
      let patient_id = selectedPatientId;
      if (addingNew) {
        const created = await api<{ patient_id: string }>("/api/booking/patient", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, name: name.trim(), phone: phone.trim(), birthday }),
        });
        patient_id = created.patient_id;
      }

      const payload: Record<string, unknown> = {
        idToken,
        patient_id,
        doctor_id: doctorId || undefined,
        service_id: serviceId || undefined,
        visit_type: visitType,
        is_self_pay: false,
        email: email.trim() || undefined,
        membership_code: membershipCode.trim().toUpperCase() || undefined,
        booking_answers: bookingAnswers,
        addon_ids: selectedAddonIds,
        recurrence_count: recurrenceCount,
      };
      if (config.booking_mode === "time") {
        payload.start_at = pickedStart;
      } else {
        payload.template_id = pickedTemplate;
        payload.date = date;
      }
      if (joiningWaitlist) {
        const waitlist = await api<WaitlistResult>("/api/booking/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, action: "join" }),
        });
        setWaitlistResult(waitlist);
      } else {
        const res = await api<ReserveResult>("/api/booking/reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setResult(res);
        trackFunnelEvent("booking_success", { booking_mode: config.booking_mode, deposit_pending: res.deposit_status === "pending", series_count: res.series_count });
      }
      loadBound(); // 若剛新增就診者,刷新綁定清單
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "預約失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function payDeposit() {
    if (!result?.appointment_id || !idToken) return;
    setPaying(true);
    setPaymentError(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: result.appointment_id, idToken, return_path: window.location.pathname + window.location.search }),
      });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.form.action;
      form.style.display = "none";
      for (const [name, value] of Object.entries(data.form.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "付款頁開啟失敗");
      setPaying(false);
    }
  }

  // 再預約一筆:回到最初「為自己/為他人」選擇,並清空選擇
  function bookAnother() {
    setResult(null);
    setWaitlistResult(null);
    setForWhom("");
    setSelectedPatientId("");
    setName("");
    setPhone("");
    setBirthday("");
    setMembershipCode("");
    setSelectedAddonIds([]);
    setRecurrenceCount(1);
    setServiceId("");
    setDate("");
    setPickedStart(null);
    setPickedTemplate(null);
    setJoiningWaitlist(false);
    setVisitType("return");
    setSubmitErr(null);
  }

  function changeView(nextView: CustomerView) {
    setView(nextView);
    const params = new URLSearchParams(window.location.search);
    params.delete("tab");
    params.set("view", nextView);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function rebook(appointment: MyAppt) {
    setServiceId(appointment.service_id ?? "");
    setDoctorId(appointment.doctor_id ?? "");
    setVisitType("return");
    setDate("");
    setResult(null);
    setWaitlistResult(null);
    changeView("booking");
  }

  // ── 畫面 ──
  if (entryError) return <Centered tone="error">{entryError}</Centered>;
  if (!entryConfig) return <Centered>載入顧客入口中…</Centered>;
  if (liffError) return <Centered tone="error"><span className="space-y-3"><span className="block">{liffError}</span><Link href={browserFallbackUrl(view)} className="btn btn-secondary inline-flex">改用瀏覽器入口</Link></span></Centered>;

  const entryNav = <CustomerEntryNav view={view} availability={entryConfig.availability} onChange={changeView} />;
  if (view === "appointments") return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<MyAppointments idToken={idToken} mode={entryConfig.booking_mode} onRebook={rebook} /></Shell>;
  if (view === "events" && !entryConfig.availability.events) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前沒有開放中的活動報名。</div></Shell>;
  if (view === "tickets" && !entryConfig.availability.tickets) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前未啟用活動票券。</div></Shell>;
  if (view === "membership" && !entryConfig.availability.memberships) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前未啟用會員與套票。</div></Shell>;
  if (view === "support" && !entryConfig.availability.line) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌的 LINE 客服尚未完成啟用。</div></Shell>;
  if (view === "support") return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<ChatTab idToken={idToken} /></Shell>;
  if (["events", "tickets", "membership", "brand"].includes(view)) {
    return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<CustomerLiffView view={view as "events" | "tickets" | "membership" | "brand"} idToken={idToken} brand={{ clinicName: entryConfig.clinic_name, clinicSlug: entryConfig.clinic_slug, phone: entryConfig.phone, address: entryConfig.address, intro: entryConfig.intro, lineBasicId: entryConfig.line_basic_id }} /></Shell>;
  }
  if (!entryConfig.availability.booking) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前暫停線上預約，仍可使用上方其他服務。</div></Shell>;
  if (loadErr) return <Centered tone="error">{loadErr}</Centered>;
  if (!config) return <Centered>載入預約設定中…</Centered>;

  if (waitlistResult) {
    return (
      <Shell clinicName={config.clinic_name}>
        {entryNav}
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 p-6 text-center text-white">
            <div className="text-4xl">✓</div>
            <h1 className="mt-2 text-xl font-bold">候補登記完成</h1>
            <p className="mt-1 text-sm text-white/85">目前順位：第 {waitlistResult.position} 位</p>
          </div>
          <div className="space-y-3 p-6 text-sm text-slate-600">
            <p>名額釋出後，系統會依順位暫時保留名額並透過 LINE／Email 通知；請在通知期限內至「我的預約」接受。</p>
            <button type="button" onClick={() => changeView("appointments")} className="btn btn-primary w-full">查看我的候補</button>
            <button type="button" onClick={bookAnother} className="btn btn-secondary w-full">登記其他時段</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (result) {
    return (
              <Shell clinicName={config.clinic_name}>
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-500 to-accent-600 p-6 text-center text-white">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold">{result.deposit_status === "pending" ? "預約已建立，待付款" : "預約成功"}</h1>
            <p className="mt-1 text-sm text-white/80">{result.series_count > 1 ? `已一次建立 ${result.series_count} 週預約` : "服務開始前會以 LINE 提醒您"}</p>
          </div>

          <div className="space-y-4 p-6 text-center">
            {result.queue_number != null && (
              <div>
                <div className="text-sm text-slate-500">您的號次</div>
                <div className="text-4xl font-bold text-brand-700">
                  {result.queue_number}
                  <span className="ml-1 text-lg">號</span>
                </div>
              </div>
            )}
            {result.start_at && (
              <div className="rounded-xl bg-slate-50 p-3 text-slate-700">
                {config.booking_mode === "time"
                  ? `${formatDateSession(result.start_at)} ${formatTime(result.start_at)}`
                  : formatDateSession(result.start_at)}
              </div>
            )}
            {result.deposit_status === "pending" && (
              <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                <p>需繳訂金 NT${result.deposit_amount}；完成標準金流付款後才確認名額。</p>
                <button type="button" onClick={() => void payDeposit()} disabled={paying} className="btn btn-primary w-full">{paying ? "正在前往付款…" : `前往付款（NT$${result.deposit_amount}）`}</button>
                {paymentError && <p className="rounded-lg bg-red-50 p-2 text-left text-xs text-red-700">{paymentError}</p>}
              </div>
            )}
            {result.start_at && result.deposit_status !== "pending" && (
              <CalendarButtons
                start={result.start_at}
                end={result.end_at ?? result.start_at}
                doctor={result.doctor_name}
                service={result.service_name}
                clinicName={config.clinic_name}
              />
            )}
            <p className="rounded-xl bg-red-50 p-3 text-left text-xs leading-relaxed text-red-700">
              ⚠️ 提醒:無法前來請務必提前取消。<strong>累計三次未提前取消而未出席,將暫停一個月的線上預約資格。</strong>
            </p>
            <button onClick={bookAnother} className="btn btn-secondary w-full">
              再預約一筆
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const stepDone = { doctor: !providerRequired || !!doctorId, date: !!date, slot: slotPicked };

  return (
    <Shell clinicName={config.clinic_name}>
      {entryNav}
      {bound === null ? (
        <div className="card p-6 text-center text-sm text-slate-400">確認身分中…</div>
      ) : forWhom === "" ? (
        // 先選:為自己 / 幫別人
        <div className="space-y-3">
          <p className="px-1 text-sm font-medium text-slate-600">請問這次要為誰預約?</p>
          <button
            type="button"
            onClick={() => {
              setForWhom("self");
              setSelectedPatientId(bound[0]?.id ?? "__new__");
            }}
            className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="text-2xl">🧑</span>
            <span>
              <span className="block font-semibold text-slate-900">為我自己</span>
              <span className="block text-xs text-slate-400">用本人資料預約</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setForWhom("other");
              setSelectedPatientId("__new__");
            }}
            className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="text-2xl">👪</span>
            <span>
              <span className="block font-semibold text-slate-900">幫別人預約</span>
              <span className="block text-xs text-slate-400">家人 / 朋友(填寫對方資料)</span>
            </span>
          </button>
        </div>
      ) : (
      <>
      <div className="space-y-4">
        {/* 步驟 1:顧客資料 */}
        <section className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle n={1} title="顧客資料" done={patientReady} />
            <button
              type="button"
              onClick={() => setForWhom("")}
              className="text-xs text-slate-400 hover:text-brand-600"
            >
              重新選擇
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="label">預約對象</label>
              <select
                className="input"
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
              >
                {(bound ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}({p.phone})
                  </option>
                ))}
                {config.allow_multi_patient_per_phone &&
                  (bound?.length ?? 0) < config.max_patients_per_phone && (
                    <option value="__new__">+ 新增顧客</option>
                  )}
              </select>
            </div>
            {selectedBlocked && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                此顧客目前暫停線上預約,請洽服務人員。
              </p>
            )}
            <div>
              <label className="label">Email（選填，用於提醒）</label>
              <input
                type="email"
                name="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </div>
            {addingNew && (
              <>
                <div>
                  <label className="label">姓名</label>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="顧客姓名"
                  />
                </div>
                <div>
                  <label className="label">電話</label>
                  <input
                    className="input"
                    value={phone}
                    inputMode="tel"
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="聯絡電話"
                  />
                </div>
                <div>
                  <label className="label">出生年月日</label>
                  <input
                    type="date"
                    className="input"
                    value={birthday}
                    max={todayStr()}
                    onChange={(e) => setBirthday(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-2"><label className="label">套票序號（選填）</label><input className="input uppercase" value={membershipCode} onChange={(e) => setMembershipCode(e.target.value.toUpperCase())} autoComplete="off" placeholder="使用套票時輸入序號" /></div>
          <p className="text-xs leading-5 text-slate-500">符合方案時會在成功預約後扣除一堂額度；套票限本人電話綁定的會員使用。</p>
        </section>

        {/* 步驟 2:服務與預約類型 */}
        <section className="card p-5">
          <SectionTitle n={2} title="服務項目" done={serviceReady} />
          <div className="space-y-4">
            {config.services.length > 0 && (
              <div>
                <label className="label">服務項目</label>
                <select
                  className="input"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">請選擇服務</option>
                  {config.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">預約類型(請確認)</label>
              <div className="grid grid-cols-2 gap-2">
                <TypeToggle active={visitType === "return"} onClick={() => setVisitType("return")}>
                  再次服務
                </TypeToggle>
                <TypeToggle active={visitType === "first"} onClick={() => setVisitType("first")}>
                  首次服務
                </TypeToggle>
              </div>
              {visitType === "first" && (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                  🕒 首次服務可能需要較完整的資料確認,所需時間可能比再次服務長,請預留充足時間。
                </p>
              )}
            </div>
            <BookingFields fields={selectedService?.booking_fields ?? []} answers={bookingAnswers} onChange={(key, value) => setBookingAnswers((current) => ({ ...current, [key]: value }))} />
            <ServiceAddons
              addons={selectedService?.service_addons ?? []}
              selectedIds={selectedAddonIds}
              onChange={setSelectedAddonIds}
            />
          </div>
        </section>

        {/* 步驟 3:選服務提供者、日期與時段(資料填妥後) */}
        <section className={`card p-5 ${!patientReady || !serviceReady ? "pointer-events-none opacity-50" : ""}`}>
          <SectionTitle n={3} title="選擇時間" done={stepDone.slot} />
          {(!patientReady || !serviceReady) && (
            <p className="mb-3 text-sm text-slate-400">請先完成上方顧客資料與服務,再選擇時間。</p>
          )}
          <div className="space-y-4">
            {(providerRequired || selectedService?.booking_target === "provider_optional") && (
              <div>
                <label className="label">服務提供者</label>
                <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">{selectedService?.booking_target === "provider_optional" ? "不指定,由系統安排" : "請選擇服務提供者"}</option>
                  {config.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.specialty ? `(${d.specialty})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selectedService?.booking_target === "resource_only" && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">此服務依場地／設備容量安排，不需要指定服務提供者。</p>}
            <div>
              <label className="label">日期</label>
              <input
                type="date"
                className="input"
                value={date}
                min={todayStr()}
                max={maxDate}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {date && (!providerRequired || !!doctorId) && (
              <div>
                <p className="label">{config.booking_mode === "time" ? "時段" : "場次"}</p>
                {availLoading && <p className="text-sm text-slate-400">查詢中…</p>}
                {availMsg && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{availMsg}</p>
                )}
                {config.booking_mode === "time" && !availLoading && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((s) => (
                      <button
                        key={s.slot_start}
                        type="button"
                        onClick={() => { setPickedStart(s.slot_start); setJoiningWaitlist(false); }}
                        className={`pill flex flex-col items-center ${pickedStart === s.slot_start ? "pill-active" : ""}`}
                      >
                        <span className="font-medium">{formatTime(s.slot_start)}</span>
                        <span className="text-[11px] opacity-70">剩 {s.remaining}</span>
                      </button>
                    ))}
                  </div>
                )}
                {config.booking_mode === "time" && !availLoading && waitlistSlots.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-amber-700">額滿可候補</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {waitlistSlots.map((slot) => <button key={slot.slot_start} type="button" onClick={() => { setPickedStart(slot.slot_start); setJoiningWaitlist(true); }} className={`pill flex min-h-11 flex-col items-center border-amber-200 ${joiningWaitlist && pickedStart === slot.slot_start ? "bg-amber-100 text-amber-900 ring-2 ring-amber-400" : "bg-amber-50 text-amber-800"}`}><span className="font-medium">{formatTime(slot.slot_start)}</span><span className="text-[11px]">加入候補</span></button>)}
                    </div>
                  </div>
                )}
                {config.booking_mode === "number" && !availLoading && (
                  <div className="space-y-2">
                    {sessions.map((s) => {
                      const full = s.remaining <= 0;
                      return (
                        <button
                          key={s.template_id}
                          type="button"
                          disabled={full}
                          onClick={() => !full && (setPickedTemplate(s.template_id), setJoiningWaitlist(false))}
                          className={`pill flex w-full items-center justify-between ${
                            full
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                              : pickedTemplate === s.template_id
                                ? "pill-active"
                                : ""
                          }`}
                        >
                          <span className="font-medium">
                            {formatDateSession(s.session_start)}　{formatTime(s.session_start)}–
                            {formatTime(s.session_end)}
                          </span>
                          {full ? (
                            <span className="text-xs font-medium text-red-500">名額已滿</span>
                          ) : (
                            <span className="text-xs opacity-70">剩 {s.remaining} 號</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {config.booking_mode === "number" && !availLoading && waitlistSessions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-amber-700">額滿可候補</p>
                    {waitlistSessions.map((session) => <button key={session.template_id} type="button" onClick={() => { setPickedTemplate(session.template_id); setJoiningWaitlist(true); }} className={`pill flex min-h-11 w-full items-center justify-between border-amber-200 ${joiningWaitlist && pickedTemplate === session.template_id ? "bg-amber-100 text-amber-900 ring-2 ring-amber-400" : "bg-amber-50 text-amber-800"}`}><span>{formatDateSession(session.session_start)}　{formatTime(session.session_start)}–{formatTime(session.session_end)}</span><span className="text-xs font-medium">加入候補</span></button>)}
                  </div>
                )}
              </div>
            )}
            {slotPicked && config.recurring_booking_enabled && selectedService && !joiningWaitlist && (
              <label className="block rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm">
                <span className="label">每週重複預約</span>
                <select
                  className="input"
                  value={recurrenceCount}
                  onChange={(event) => setRecurrenceCount(Number(event.target.value))}
                  disabled={config.deposit_enabled}
                >
                  {Array.from({ length: config.max_recurring_occurrences }, (_, index) => index + 1).map((count) => (
                    <option key={count} value={count}>{count === 1 ? "只預約本次" : `連續 ${count} 週`}</option>
                  ))}
                </select>
                <span className="mt-2 block text-xs text-slate-500">
                  {config.deposit_enabled ? "啟用訂金時，請逐筆完成預約與付款。" : "系統會先確認每一週都有名額，再一次建立全部預約。"}
                </span>
              </label>
            )}
          </div>
        </section>

        {submitErr && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitErr}</p>
        )}
        {joiningWaitlist && membershipCode.trim() && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">候補不會預先保留或扣除套票堂數；請先清空套票序號再加入候補。</p>}
      </div>

      {/* 固定底部送出列 */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-200 bg-white/90 p-4 backdrop-blur">
        <button type="button" disabled={!canSubmit} onClick={handleSubmit} className="btn btn-primary w-full">
          {submitting ? "送出中…" : joiningWaitlist ? "確認加入候補" : recurrenceCount > 1 ? `確認建立 ${recurrenceCount} 週預約` : "確認預約"}
        </button>
        {!ready && !liffError && (
          <p className="mt-2 text-center text-xs text-slate-400">正在確認 LINE 身分…</p>
        )}
      </div>
      </>
      )}
    </Shell>
  );
}

interface MyAppt {
  id: string;
  start_at: string;
  end_at: string | null;
  queue_number: number | null;
  status: string;
  doctor_id: string | null;
  service_id: string | null;
  visit_type: "first" | "return";
  deposit_status: string;
  deposit_amount: number;
  doctors: { name: string } | null;
  services: { name: string } | null;
  patients: { name: string } | null;
}
interface MyWaitlist {
  id: string;
  patient_id: string;
  booking_mode: "time" | "number";
  requested_date: string;
  requested_start_at: string | null;
  position: number;
  status: "waiting" | "offered";
  offer_expires_at: string | null;
  appointment_id: string | null;
  doctors: { name: string } | null;
  services: { name: string } | null;
  patients: { name: string } | null;
}
interface ProgressItem {
  doctorName: string;
  label: string;
  yourNumber: number;
  current: number;
  status: string;
  source: "online" | "offline";
}

function MyAppointments({ idToken, mode, onRebook }: { idToken: string | null; mode: "time" | "number"; onRebook: (appointment: MyAppt) => void }) {
  const [list, setList] = useState<MyAppt[] | null>(null);
  const [waitlists, setWaitlists] = useState<MyWaitlist[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!idToken) return;
    setErr(null);
    try {
      const data = await api<{ appointments: MyAppt[]; waitlists: MyWaitlist[]; progress: ProgressItem[] }>("/api/booking/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      setList(data.appointments);
      setWaitlists(data.waitlists ?? []);
      setProgress(data.progress ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "查詢失敗");
    }
  }, [idToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(id: string) {
    if (!idToken) return;
    setCancelling(id);
    setErr(null);
    try {
      await api("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, appointment_id: id }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "取消失敗");
    } finally {
      setCancelling(null);
    }
  }

  async function waitlistAction(id: string, action: "accept" | "cancel", patientId: string) {
    if (!idToken) return;
    setCancelling(id);
    setErr(null);
    try {
      await api("/api/booking/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, patient_id: patientId, waitlist_id: id, action }),
      });
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "候補操作失敗");
    } finally {
      setCancelling(null);
    }
  }

  async function payAppointment(appointmentId: string) {
    if (!idToken) return;
    setCancelling(appointmentId);
    setErr(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appointmentId, idToken, return_path: window.location.pathname + window.location.search }),
      });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.form.action;
      form.style.display = "none";
      for (const [name, value] of Object.entries(data.form.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "付款頁開啟失敗");
      setCancelling(null);
    }
  }

  function openReschedule(id: string) {
    const source = new URLSearchParams(window.location.search);
    const params = new URLSearchParams({ appointment_id: id });
    const clinicSlug = source.get("clinic_slug")?.trim();
    const clinicId = source.get("clinic_id")?.trim();
    if (clinicSlug) params.set("clinic_slug", clinicSlug);
    else if (clinicId) params.set("clinic_id", clinicId);
    window.location.assign(`/book/reschedule?${params.toString()}`);
  }

  if (err) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>;
  if (list === null) return <p className="px-1 text-sm text-slate-400">載入中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-medium text-slate-600">
          {progress.length > 0 ? "今日服務進度" : "我的預約"}
        </p>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 text-sm text-brand-600 hover:underline"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.311h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
          </svg>
          重新整理
        </button>
      </div>

      {/* 今日服務進度 */}
      {progress.length > 0 && (
        <div className="space-y-2">
          {progress.map((pr, i) => (
            <div
              key={i}
              className="card flex items-center justify-between bg-gradient-to-br from-brand-500 to-accent-600 p-4 text-white"
            >
              <div>
                <div className="text-sm">{pr.doctorName} · {pr.label}</div>
                <div className="text-xs text-white/80">
                  您的號碼:{pr.source === "offline" ? "現場" : "線上"} {pr.yourNumber} 號
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-white/80">目前服務號次</div>
                <div className="text-3xl font-bold">{pr.current || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {waitlists.length > 0 && (
        <section className="space-y-2">
          <p className="px-1 text-sm font-medium text-slate-600">我的候補</p>
          {waitlists.map((item) => {
            const offered = item.status === "offered";
            const when = item.requested_start_at ? `${formatDateSession(item.requested_start_at)} ${formatTime(item.requested_start_at)}` : item.requested_date;
            return <div key={item.id} className={`card space-y-3 border p-4 ${offered ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{when}</p><p className="mt-1 text-xs text-slate-500">{item.services?.name ?? item.doctors?.name ?? "預約候補"}{item.patients?.name ? ` · ${item.patients.name}` : ""}</p></div><span className={`badge ${offered ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-600"}`}>{offered ? "名額保留中" : `第 ${item.position} 位`}</span></div>{offered && <p className="text-xs text-amber-800">請於 {item.offer_expires_at ? formatDateSession(item.offer_expires_at) + " " + formatTime(item.offer_expires_at) : "通知期限內"} 接受，逾時會自動提供給下一位。</p>}<div className="flex gap-2">{offered && <button type="button" disabled={cancelling === item.id} onClick={() => void waitlistAction(item.id, "accept", item.patient_id)} className="btn btn-primary min-h-11 flex-1">{cancelling === item.id ? "處理中…" : "接受名額"}</button>}<button type="button" disabled={cancelling === item.id} onClick={() => void waitlistAction(item.id, "cancel", item.patient_id)} className="btn btn-secondary min-h-11 flex-1">取消候補</button></div></div>;
          })}
        </section>
      )}

      {list.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-400">目前沒有未來的預約。</div>
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
        <div key={a.id} className="card flex flex-col items-stretch justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div>
            <div className="font-medium text-slate-900">
              {mode === "time"
                ? `${formatDateSession(a.start_at)} ${formatTime(a.start_at)}`
                : `${formatDateSession(a.start_at)} 第 ${a.queue_number} 號`}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {a.doctors?.name}
              {a.patients?.name ? ` · ${a.patients.name}` : ""} · 預約成功
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
          {a.deposit_status === "pending" && <button type="button" disabled={cancelling === a.id} onClick={() => void payAppointment(a.id)} className="btn btn-primary px-3 py-1.5 text-xs">{cancelling === a.id ? "處理中…" : `付訂金 $${a.deposit_amount}`}</button>}
          {a.service_id && <button type="button" onClick={() => onRebook(a)} className="btn btn-secondary px-3 py-1.5 text-xs">再次預約</button>}
          <button type="button" onClick={() => openReschedule(a.id)} className="btn btn-secondary px-3 py-1.5 text-xs">
            改期
          </button>
          <button
            type="button"
            disabled={cancelling === a.id}
            onClick={() => cancel(a.id)}
            className="btn btn-danger px-3 py-1.5 text-xs"
          >
            {cancelling === a.id ? "取消中…" : "取消"}
          </button>
          </div>
        </div>
          ))}
        </div>
      )}
    </div>
  );
}

function bookingFieldsReady(fields: BookingField[], answers: Record<string, unknown>): boolean {
  return fields.every((field) => {
    const value = answers[field.key];
    return !field.required || (field.type === "checkbox" || field.type === "consent" ? value === true : typeof value === "string" && value.trim().length > 0);
  });
}

function BookingFields({ fields, answers, onChange }: { fields: BookingField[]; answers: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  if (fields.length === 0) return null;
  return <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-800">預約前資料</p>{fields.map((field) => { const label = `${field.label}${field.required ? " *" : ""}`; const value = answers[field.key]; if (field.type === "checkbox" || field.type === "consent") return <label key={field.key} className={`flex items-start gap-2 rounded-lg p-2 text-sm ${field.type === "consent" ? "border border-brand-100 bg-white text-slate-700" : "text-slate-600"}`}><input type="checkbox" className="mt-1 h-4 w-4" checked={value === true} onChange={(event) => onChange(field.key, event.target.checked)} /><span>{label}</span></label>; if (field.type === "textarea") return <label key={field.key} className="block text-sm"><span className="label">{label}</span><textarea className="input" rows={3} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key, event.target.value)} /></label>; if (field.type === "select") return <label key={field.key} className="block text-sm"><span className="label">{label}</span><select className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key, event.target.value)}><option value="">請選擇</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; return <label key={field.key} className="block text-sm"><span className="label">{label}</span><input type={field.type === "date" ? "date" : "text"} className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key, event.target.value)} /></label>; })}</div>;
}

function ServiceAddons({ addons, selectedIds, onChange }: { addons: ServiceAddon[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  if (addons.length === 0) return null;
  const total = addons.filter((addon) => selectedIds.includes(addon.id)).reduce((sum, addon) => sum + addon.price, 0);
  return (
    <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-800">加購服務</p>
        {total > 0 && <span className="text-xs font-medium text-brand-700">加購 NT${total}</span>}
      </div>
      {addons.map((addon) => {
        const checked = selectedIds.includes(addon.id);
        return (
          <label key={addon.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${checked ? "border-brand-300 bg-white" : "border-slate-200 bg-white/70"}`}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={checked}
              onChange={() => onChange(checked ? selectedIds.filter((id) => id !== addon.id) : [...selectedIds, addon.id])}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-800">{addon.name}</span>
              {addon.description && <span className="mt-0.5 block text-xs text-slate-500">{addon.description}</span>}
            </span>
            <span className="shrink-0 text-right text-xs text-slate-600">
              {addon.duration_minutes > 0 && <span className="block">+{addon.duration_minutes} 分</span>}
              {addon.price > 0 && <span className="block">NT${addon.price}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Shell({ children, clinicName }: { children: React.ReactNode; clinicName?: string | null }) {
  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-4">
      <header className="flex items-center justify-between py-4">
        <Brand name={clinicName} subtitle="線上預約" />
      </header>
      {children}
    </main>
  );
}

function SectionTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-accent-600 text-white" : "bg-brand-100 text-brand-700"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <h2 className="font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function TypeToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`pill text-center ${active ? "pill-active" : ""}`}>
      {children}
    </button>
  );
}

function CalendarButtons({
  start,
  end,
  doctor,
  service,
  clinicName,
}: {
  start: string;
  end: string;
  doctor: string | null;
  service: string | null;
  clinicName: string | null;
}) {
  const endIso = end && end !== start ? end : new Date(new Date(start).getTime() + 30 * 60000).toISOString();
  const details = [doctor ? `服務提供者:${doctor}` : "", service ? `服務:${service}` : "", "服務開始前請提前準備;無法前來請提前取消。"]
    .filter(Boolean)
    .join("\n");
  const displayName = clinicName?.trim() || "預約與報名平台";
  const ev: CalEvent = { title: `${displayName} 預約`, startIso: start, endIso, details, location: displayName };

  // 在 LINE 內建瀏覽器,直接開連結(blob 下載常失效);有 LIFF 就用外部瀏覽器開
  function openUrl(url: string) {
    const liff = typeof window !== "undefined" ? window.liff : undefined;
    if (liff?.openWindow) {
      liff.openWindow({ url, external: true });
    } else {
      window.open(url, "_blank");
    }
  }

  const icsUrl =
    `/api/booking/ics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(endIso)}` +
    `&title=${encodeURIComponent(ev.title)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(displayName)}`;
  const absIcsUrl = typeof window !== "undefined" ? new URL(icsUrl, window.location.origin).toString() : icsUrl;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">加入行事曆,手機會在服務開始前自動提醒您</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => openUrl(googleCalendarUrl(ev))} className="btn btn-secondary text-sm">
          Google 日曆
        </button>
        <button type="button" onClick={() => openUrl(absIcsUrl)} className="btn btn-secondary text-sm">
          加入行事曆
        </button>
      </div>
    </div>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <p className={tone === "error" ? "text-red-600" : "text-slate-500"}>{children}</p>
    </main>
  );
}

function browserFallbackUrl(view: CustomerView): string {
  const path = view === "booking" ? "/book/browser" : view === "events" ? "/register" : view === "membership" ? "/membership" : view === "brand" || view === "support" ? "/" : "/my";
  if (typeof window === "undefined") return path;
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  for (const key of ["utm_source", "rm_version", "rm_slot"] as const) {
    const value = source.get(key)?.trim();
    if (value) params.set(key, value);
  }
  return `${path}${params.toString() ? `?${params.toString()}` : ""}`;
}
