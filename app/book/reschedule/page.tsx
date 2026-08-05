"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatDateSession, formatTime } from "@/lib/slots";
import { useLiff } from "@/lib/useLiff";

interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
}

interface Config {
  booking_mode: "time" | "number";
  max_advance_days: number;
  doctors: Doctor[];
  services: Service[];
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
  remaining: number;
}

interface Appointment {
  id: string;
  start_at: string;
  end_at: string | null;
  queue_number: number | null;
  status: string;
  doctor_id: string;
  service_id: string | null;
  visit_type: "first" | "return";
  doctors: { name: string } | null;
  patients: { name: string } | null;
}

interface RescheduleResult {
  appointment_id: string;
  start_at: string | null;
  end_at: string | null;
  queue_number: number | null;
  deposit_status: string;
  deposit_amount: number;
  doctor_name: string | null;
  service_name: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBookingBrandScope(url), init);
  const body = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!body) throw new Error("無法取得伺服器回應");
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

function withBookingBrandScope(url: string): string {
  if (typeof window === "undefined" || (!url.startsWith("/api/booking") && !url.startsWith("/api/payment/create"))) return url;
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

function taipeiDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(value));
}

function todayStr(offset = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(
    new Date(Date.now() + offset * 24 * 60 * 60 * 1000),
  );
}

export default function ReschedulePage() {
  const { ready, idToken, error: liffError } = useLiff();
  const [config, setConfig] = useState<Config | null>(null);
  const [appointmentId, setAppointmentId] = useState("");
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [visitType, setVisitType] = useState<"first" | "return">("return");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pickedStart, setPickedStart] = useState("");
  const [pickedTemplate, setPickedTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [result, setResult] = useState<RescheduleResult | null>(null);
  const [brandSuffix, setBrandSuffix] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("appointment_id")?.trim() ?? "";
    const clinicSlug = params.get("clinic_slug")?.trim();
    const clinicId = params.get("clinic_id")?.trim();
    setAppointmentId(id);
    if (clinicSlug) setBrandSuffix(`?clinic_slug=${encodeURIComponent(clinicSlug)}`);
    else if (clinicId) setBrandSuffix(`?clinic_id=${encodeURIComponent(clinicId)}`);
  }, []);

  useEffect(() => {
    void api<Config>("/api/booking/config")
      .then(setConfig)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "載入預約設定失敗"));
  }, []);

  useEffect(() => {
    if (!ready || !idToken || !appointmentId) return;
    setLoading(true);
    void api<{ appointments: Appointment[]; progress: unknown[] }>("/api/booking/my", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    })
      .then(({ appointments }) => {
        const current = appointments.find((item) => item.id === appointmentId) ?? null;
        if (!current) throw new Error("找不到可改期的預約，請重新從我的預約進入");
        setAppointment(current);
        setDoctorId(current.doctor_id);
        setServiceId(current.service_id ?? "");
        setDate(taipeiDate(current.start_at));
        setVisitType(current.visit_type);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "載入預約失敗"))
      .finally(() => setLoading(false));
  }, [appointmentId, idToken, ready]);

  const maxDate = useMemo(() => todayStr(config?.max_advance_days ?? 30), [config?.max_advance_days]);

  const loadAvailability = useCallback(async () => {
    if (!config || !doctorId || !date) return;
    setAvailabilityLoading(true);
    setError(null);
    setSlots([]);
    setSessions([]);
    setPickedStart("");
    setPickedTemplate("");
    try {
      const query = new URLSearchParams({ doctor_id: doctorId, date });
      if (config.booking_mode === "time") query.set("visit_type", visitType);
      const data = await api<{ slots?: Slot[]; sessions?: Session[] }>(
        `/api/booking/availability?${query.toString()}`,
      );
      setSlots(data.slots ?? []);
      setSessions(data.sessions ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "載入可預約時段失敗");
    } finally {
      setAvailabilityLoading(false);
    }
  }, [config, date, doctorId, visitType]);

  useEffect(() => {
    if (appointment && config && doctorId && date) void loadAvailability();
  }, [appointment, config, date, doctorId, loadAvailability]);

  async function submit() {
    if (!idToken || !appointment || !config || !doctorId) return;
    if (config.booking_mode === "time" && !pickedStart) {
      setError("請選擇新的時段");
      return;
    }
    if (config.booking_mode === "number" && !pickedTemplate) {
      setError("請選擇新的看診時段");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        idToken,
        appointment_id: appointment.id,
        doctor_id: doctorId,
        service_id: serviceId || undefined,
      };
      if (config.booking_mode === "time") body.start_at = pickedStart;
      else {
        body.template_id = pickedTemplate;
        body.date = date;
      }
      setResult(await api<RescheduleResult>("/api/booking/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "改期失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function payDeposit() {
    if (!idToken || !result?.appointment_id) return;
    setPaying(true);
    setPaymentError(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_id: result.appointment_id,
          idToken,
          return_path: window.location.pathname + window.location.search,
        }),
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
    } catch (payError) {
      setPaymentError(payError instanceof Error ? payError.message : "付款建立失敗");
      setPaying(false);
    }
  }

  if (liffError) {
    return <Shell><Message tone="error">{liffError}<Link className="btn btn-secondary mt-3 inline-flex" href={`/book/browser${brandSuffix}`}>改用瀏覽器預約</Link></Message></Shell>;
  }

  if (result) {
    return (
      <Shell>
        <div className="card space-y-5 p-6 text-center">
          <div className="text-4xl text-emerald-600">✓</div>
          <h1 className="text-xl font-bold text-slate-900">預約已完成改期</h1>
          {result.start_at && <p className="rounded-xl bg-slate-50 p-3 text-slate-700">{formatDateSession(result.start_at)} {formatTime(result.start_at)}</p>}
          {result.queue_number !== null && <p className="text-3xl font-bold text-brand-700">號碼 {result.queue_number}</p>}
          <p className="text-sm text-slate-500">{result.doctor_name ?? ""}{result.service_name ? `・${result.service_name}` : ""}</p>
          {result.deposit_status === "pending" && (
            <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <p>此預約需要繳交訂金 NT${result.deposit_amount}。</p>
              <button type="button" onClick={() => void payDeposit()} disabled={paying} className="btn btn-primary w-full">
                {paying ? "前往付款中…" : `繳交訂金 NT$${result.deposit_amount}`}
              </button>
              {paymentError && <p className="rounded-lg bg-red-50 p-2 text-left text-xs text-red-700">{paymentError}</p>}
            </div>
          )}
          <Link className="btn btn-secondary w-full" href={`/book${brandSuffix}`}>返回預約頁</Link>
        </div>
      </Shell>
    );
  }

  if (loading || !config) return <Shell><Message>{error ?? "載入中…"}</Message></Shell>;
  if (error && !appointment) return <Shell><Message tone="error">{error}<Link className="btn btn-secondary mt-3 inline-flex" href={`/book${brandSuffix}`}>返回</Link></Message></Shell>;
  if (!appointment) return <Shell><Message tone="error">找不到預約</Message></Shell>;

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">我的預約</p>
          <h1 className="text-2xl font-bold text-slate-900">預約改期</h1>
          <p className="mt-1 text-sm text-slate-500">請選擇新的醫師、日期與可用時段。</p>
        </div>
        <Link href={`/book${brandSuffix}`} className="text-sm text-brand-700">返回</Link>
      </div>

      <div className="card mb-4 space-y-2 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-900">目前預約</p>
        <p>{formatDateSession(appointment.start_at)} {formatTime(appointment.start_at)}</p>
        <p>{appointment.doctors?.name ?? ""}{appointment.patients?.name ? `・${appointment.patients.name}` : ""}</p>
      </div>

      <div className="card space-y-4 p-5">
        <label className="block text-sm"><span className="label">醫師</span><select className="input" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>{config.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? `・${doctor.specialty}` : ""}</option>)}</select></label>
        {config.services.length > 0 && <label className="block text-sm"><span className="label">服務項目</span><select className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">沿用原服務</option>{config.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>}
        <label className="block text-sm"><span className="label">日期</span><input type="date" className="input" min={todayStr()} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div>
          <span className="label">新的可預約時段</span>
          {availabilityLoading ? <p className="text-sm text-slate-400">載入時段中…</p> : config.booking_mode === "time" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <button type="button" key={slot.slot_start} onClick={() => setPickedStart(slot.slot_start)} className={`rounded-xl border p-3 text-sm ${pickedStart === slot.slot_start ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatTime(slot.slot_start)}<span className="mt-1 block text-xs text-slate-400">剩餘 {slot.remaining}</span></button>)}</div>
          ) : (
            <div className="grid grid-cols-1 gap-2">{sessions.map((session) => <button type="button" key={session.template_id} onClick={() => setPickedTemplate(session.template_id)} className={`rounded-xl border p-3 text-left text-sm ${pickedTemplate === session.template_id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatDateSession(session.session_start)}<span className="ml-2 text-xs text-slate-400">剩餘 {session.remaining}</span></button>)}</div>
          )}
          {!availabilityLoading && (config.booking_mode === "time" ? slots.length === 0 : sessions.length === 0) && <p className="mt-2 text-sm text-slate-400">這天沒有可用時段，請更換日期或醫師。</p>}
        </div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button type="button" className="btn btn-primary w-full" disabled={submitting || availabilityLoading} onClick={() => void submit()}>{submitting ? "改期處理中…" : "確認改期"}</button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-md px-4 pb-6"><header className="py-4"><Brand subtitle="預約改期" /></header>{children}</main>;
}

function Message({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <div className={`card p-6 text-center text-sm ${tone === "error" ? "text-red-700" : "text-slate-500"}`}>{children}</div>;
}
