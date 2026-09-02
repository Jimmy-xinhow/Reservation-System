"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLiff } from "@/lib/useLiff";
import { formatTime, formatDateSession } from "@/lib/slots";
import ChatTab from "./ChatTab";
import { CustomerEntryNav, CustomerHomeView, CustomerLiffView, type CustomerView } from "./CustomerEntry";
import { trackFunnelEvent } from "@/lib/funnel-client";
import MyAppointments, { type MyAppt } from "./MyAppointments";
import { bookingApi as api } from "./client-api";
import { getBookingFlowState } from "./booking-flow-state";
import {
  CalendarButtons,
  Centered,
  Shell,
  bookingFieldsReady,
  browserFallbackUrl,
} from "./BookingFlowUi";
import {
  BookingCustomerStep,
  BookingIdentityChoice,
  BookingServiceStep,
  BookingTimeStep,
} from "./BookingSteps";
import type {
  BoundPatient,
  Config,
  EntryConfig,
  ReserveResult,
  Session,
  Slot,
  WaitlistResult,
} from "./types";

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

  const [view, setView] = useState<CustomerView>("home");
  const trackedViews = useRef(new Set<string>());

  // 所有 Rich Menu 都進同一個 LIFF，再由 view 分流；保留舊 tab 參數相容。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (["home", "booking", "appointments", "events", "tickets", "membership", "support", "brand"].includes(requested ?? "")) {
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
  const bookingFlow = getBookingFlowState({
    customerLookupComplete: bound !== null,
    customerChoiceComplete: forWhom !== "",
    customerDetailsComplete: patientReady,
    serviceComplete: serviceReady,
    bookingFieldsComplete: fieldsReady,
    timeComplete: slotPicked,
    identityReady: ready,
    submitting,
    joiningWaitlist,
    membershipCode,
  });

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
  if (view === "home") return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<CustomerHomeView availability={entryConfig.availability} bookingMode={entryConfig.booking_mode} brand={{ clinicName: entryConfig.clinic_name, clinicSlug: entryConfig.clinic_slug, phone: entryConfig.phone, address: entryConfig.address, intro: entryConfig.intro, lineBasicId: entryConfig.line_basic_id, pageEnabled: entryConfig.brand_page_enabled }} onChange={changeView} /></Shell>;
  if (view === "appointments") return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<MyAppointments idToken={idToken} mode={entryConfig.booking_mode} onRebook={rebook} /></Shell>;
  if (view === "events" && !entryConfig.availability.events) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前沒有開放中的活動報名。</div></Shell>;
  if (view === "tickets" && !entryConfig.availability.tickets) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前未啟用活動票券。</div></Shell>;
  if (view === "membership" && !entryConfig.availability.memberships) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌目前未啟用會員與套票。</div></Shell>;
  if (view === "support" && !entryConfig.availability.line) return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<div className="card p-6 text-center text-sm text-slate-500">此品牌的 LINE 客服尚未完成啟用。</div></Shell>;
  if (view === "support") return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<ChatTab idToken={idToken} /></Shell>;
  if (["events", "tickets", "membership", "brand"].includes(view)) {
    return <Shell clinicName={entryConfig.clinic_name}>{entryNav}<CustomerLiffView view={view as "events" | "tickets" | "membership" | "brand"} idToken={idToken} brand={{ clinicName: entryConfig.clinic_name, clinicSlug: entryConfig.clinic_slug, phone: entryConfig.phone, address: entryConfig.address, intro: entryConfig.intro, lineBasicId: entryConfig.line_basic_id, pageEnabled: entryConfig.brand_page_enabled }} /></Shell>;
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
              提醒：無法前來請務必提前取消。<strong>累計三次未提前取消而未出席，將暫停一個月的線上預約資格。</strong>
            </p>
            <button onClick={bookAnother} className="btn btn-secondary w-full">
              再預約一筆
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell clinicName={config.clinic_name}>
      {entryNav}
      {bound === null ? (
        <div className="card p-6 text-center text-sm text-slate-400">確認身分中…</div>
      ) : forWhom === "" ? (
        <BookingIdentityChoice
          onChooseSelf={() => {
            setForWhom("self");
            setSelectedPatientId(bound[0]?.id ?? "__new__");
          }}
          onChooseOther={() => {
            setForWhom("other");
            setSelectedPatientId("__new__");
          }}
        />
      ) : (
      <>
      <div className="space-y-4" data-booking-stage={bookingFlow.stage}>
        <BookingCustomerStep
          config={config}
          bound={bound}
          selectedPatientId={selectedPatientId}
          selectedBlocked={selectedBlocked}
          addingNew={addingNew}
          complete={bookingFlow.completed.customer}
          email={email}
          name={name}
          phone={phone}
          birthday={birthday}
          today={todayStr()}
          membershipCode={membershipCode}
          onResetChoice={() => setForWhom("")}
          onPatientChange={setSelectedPatientId}
          onEmailChange={setEmail}
          onNameChange={setName}
          onPhoneChange={setPhone}
          onBirthdayChange={setBirthday}
          onMembershipCodeChange={setMembershipCode}
        />
        <BookingServiceStep
          config={config}
          selectedService={selectedService}
          serviceId={serviceId}
          visitType={visitType}
          bookingAnswers={bookingAnswers}
          selectedAddonIds={selectedAddonIds}
          complete={bookingFlow.completed.service}
          onServiceChange={setServiceId}
          onVisitTypeChange={setVisitType}
          onBookingAnswerChange={(key, value) => setBookingAnswers((current) => ({ ...current, [key]: value }))}
          onAddonIdsChange={setSelectedAddonIds}
        />
        <BookingTimeStep
          config={config}
          selectedService={selectedService}
          providerRequired={providerRequired}
          canChooseTime={bookingFlow.canChooseTime}
          complete={bookingFlow.completed.time}
          doctorId={doctorId}
          date={date}
          minDate={todayStr()}
          maxDate={maxDate}
          loading={availLoading}
          message={availMsg}
          slots={slots}
          waitlistSlots={waitlistSlots}
          sessions={sessions}
          waitlistSessions={waitlistSessions}
          pickedStart={pickedStart}
          pickedTemplate={pickedTemplate}
          joiningWaitlist={joiningWaitlist}
          recurrenceCount={recurrenceCount}
          onDoctorChange={setDoctorId}
          onDateChange={setDate}
          onPickTime={(value, waitlist) => {
            setPickedStart(value);
            setJoiningWaitlist(waitlist);
          }}
          onPickSession={(value, waitlist) => {
            setPickedTemplate(value);
            setJoiningWaitlist(waitlist);
          }}
          onRecurrenceChange={setRecurrenceCount}
        />
        {submitErr && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitErr}</p>
        )}
        {bookingFlow.submitBlock === "waitlist_membership_conflict" && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">候補不會預先保留或扣除套票堂數；請先清空套票序號再加入候補。</p>}
      </div>

      {/* 固定底部送出列 */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-200 bg-white/90 p-4 backdrop-blur">
        <button type="button" disabled={!bookingFlow.canSubmit} onClick={handleSubmit} className="btn btn-primary w-full">
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
