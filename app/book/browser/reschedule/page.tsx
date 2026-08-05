"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatDateSession, formatTime } from "@/lib/slots";

interface Config { booking_mode: "time" | "number"; max_advance_days: number; doctors: Array<{ id: string; name: string; specialty: string | null }>; services: Array<{ id: string; name: string; description: string | null }> }
interface Slot { slot_start: string; slot_end: string; remaining: number }
interface Session { template_id: string; session_start: string; session_end: string; remaining: number }
interface Appointment { id: string; start_at: string; end_at: string | null; queue_number: number | null; status: string; doctor_id: string; service_id: string | null; visit_type: "first" | "return"; doctors: { name: string } | null; patients: { name: string } | null }
interface Result { appointment_id: string; start_at: string | null; end_at: string | null; queue_number: number | null; deposit_status: string; deposit_amount: number; doctor_name: string | null; service_name: string | null }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(scopeApi(url), init);
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? "無法取得伺服器回應");
  return body.data as T;
}

function scopeApi(url: string): string {
  if (typeof window === "undefined") return url;
  const source = new URLSearchParams(window.location.search);
  const scope = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) scope.set("clinic_slug", slug); else if (clinicId) scope.set("clinic_id", clinicId);
  if (!scope.toString()) return url;
  const target = new URL(url, window.location.origin);
  scope.forEach((value, key) => target.searchParams.set(key, value));
  return `${target.pathname}${target.search}`;
}

function scopePage(path: string): string {
  if (typeof window === "undefined") return path;
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug); else if (clinicId) params.set("clinic_id", clinicId);
  return params.toString() ? `${path}${path.includes("?") ? "&" : "?"}${params.toString()}` : path;
}

function tokenKey(): string {
  if (typeof window === "undefined") return "booking_browser_token";
  const source = new URLSearchParams(window.location.search);
  return `booking_browser_token:${source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default"}`;
}

function taipeiDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(value));
}

function todayStr(offset = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + offset * 86400000));
}

export default function BrowserReschedulePage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [appointmentId, setAppointmentId] = useState("");
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pickedStart, setPickedStart] = useState("");
  const [pickedTemplate, setPickedTemplate] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("appointment_id")?.trim() ?? "";
    const stored = window.localStorage.getItem(tokenKey());
    setAppointmentId(id);
    setToken(stored);
    setIdentityReady(true);
    void api<Config>("/api/booking/config").then(setConfig).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "載入設定失敗"));
  }, []);

  useEffect(() => {
    if (!identityReady) return;
    if (!token || !appointmentId) {
      setLoading(false);
      setError("請先在我的預約完成身分驗證");
      return;
    }
    void api<{ appointments: Appointment[] }>("/api/booking/browser/my", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser_token: token }),
    }).then(({ appointments }) => {
      const current = appointments.find((item) => item.id === appointmentId);
      if (!current) throw new Error("找不到可改期的預約，請重新從我的預約進入");
      setAppointment(current); setDoctorId(current.doctor_id); setServiceId(current.service_id ?? ""); setDate(taipeiDate(current.start_at));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "載入預約失敗")).finally(() => setLoading(false));
  }, [appointmentId, identityReady, token]);

  const maxDate = useMemo(() => todayStr(config?.max_advance_days ?? 30), [config?.max_advance_days]);

  const loadAvailability = useCallback(async () => {
    if (!config || !doctorId || !date || !appointment) return;
    setAvailabilityLoading(true); setError(null); setSlots([]); setSessions([]); setPickedStart(""); setPickedTemplate("");
    try {
      const query = new URLSearchParams({ doctor_id: doctorId, date });
      if (config.booking_mode === "time") query.set("visit_type", appointment.visit_type);
      const data = await api<{ slots?: Slot[]; sessions?: Session[] }>(`/api/booking/availability?${query.toString()}`);
      setSlots(data.slots ?? []); setSessions(data.sessions ?? []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "載入時段失敗"); }
    finally { setAvailabilityLoading(false); }
  }, [appointment, config, date, doctorId]);

  useEffect(() => { if (config && appointment && doctorId && date) void loadAvailability(); }, [appointment, config, date, doctorId, loadAvailability]);

  async function submit() {
    if (!token || !appointment || !config || !doctorId) return;
    if (config.booking_mode === "time" && !pickedStart) { setError("請選擇新的時段"); return; }
    if (config.booking_mode === "number" && !pickedTemplate) { setError("請選擇新的看診時段"); return; }
    setSubmitting(true); setError(null);
    try {
      const body: Record<string, unknown> = { browser_token: token, appointment_id: appointment.id, doctor_id: doctorId, service_id: serviceId || undefined };
      if (config.booking_mode === "time") body.start_at = pickedStart; else { body.template_id = pickedTemplate; body.date = date; }
      setResult(await api<Result>("/api/booking/reschedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "改期失敗"); }
    finally { setSubmitting(false); }
  }

  async function payDeposit() {
    if (!token || !result?.appointment_id) return;
    setPaying(true); setPaymentError(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointment_id: result.appointment_id, browser_token: token, return_path: window.location.pathname + window.location.search }) });
      const form = document.createElement("form"); form.method = "POST"; form.action = data.form.action; form.style.display = "none";
      for (const [name, value] of Object.entries(data.form.fields)) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input); }
      document.body.appendChild(form); form.submit();
    } catch (payError) { setPaymentError(payError instanceof Error ? payError.message : "付款建立失敗"); setPaying(false); }
  }

  if (result) return <Shell><div className="card space-y-5 p-6 text-center"><div className="text-4xl text-emerald-600">✓</div><h1 className="text-xl font-bold text-slate-900">預約已完成改期</h1>{result.start_at && <p className="rounded-xl bg-slate-50 p-3 text-slate-700">{formatDateSession(result.start_at)} {formatTime(result.start_at)}</p>}{result.queue_number !== null && <p className="text-3xl font-bold text-brand-700">號碼 {result.queue_number}</p>}{result.deposit_status === "pending" && <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p>此預約需要繳交訂金 NT${result.deposit_amount}。</p><button type="button" onClick={() => void payDeposit()} disabled={paying} className="btn btn-primary w-full">{paying ? "前往付款中…" : `繳交訂金 NT$${result.deposit_amount}`}</button>{paymentError && <p className="rounded-lg bg-red-50 p-2 text-left text-xs text-red-700">{paymentError}</p>}</div>}<Link href={scopePage("/book/browser/my")} className="btn btn-secondary w-full">返回我的預約</Link></div></Shell>;
  if (loading || !config) return <Shell><Message tone={error ? "error" : undefined}>{error ?? "載入中…"}</Message></Shell>;
  if (error && !appointment) return <Shell><Message tone="error">{error}<Link href={scopePage("/book/browser/my")} className="btn btn-secondary mt-3 inline-flex">返回</Link></Message></Shell>;
  if (!appointment || !token) return <Shell><Message tone="error">請先在我的預約完成身分驗證<Link href={scopePage("/book/browser/my")} className="btn btn-secondary mt-3 inline-flex">前往我的預約</Link></Message></Shell>;

  return <Shell><div className="mb-4 flex items-center justify-between gap-3"><div><p className="eyebrow">Browser fallback</p><h1 className="text-2xl font-bold text-slate-900">預約改期</h1></div><Link href={scopePage("/book/browser/my")} className="text-sm text-brand-700">返回</Link></div><div className="card mb-4 space-y-2 p-4 text-sm text-slate-600"><p className="font-medium text-slate-900">目前預約</p><p>{formatDateSession(appointment.start_at)} {formatTime(appointment.start_at)}</p><p>{appointment.doctors?.name ?? ""}{appointment.patients?.name ? `・${appointment.patients.name}` : ""}</p></div><div className="card space-y-4 p-5"><label className="block text-sm"><span className="label">醫師</span><select className="input" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>{config.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? `・${doctor.specialty}` : ""}</option>)}</select></label>{config.services.length > 0 && <label className="block text-sm"><span className="label">服務項目</span><select className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">沿用原服務</option>{config.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>}<label className="block text-sm"><span className="label">日期</span><input type="date" className="input" min={todayStr()} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} /></label><div><span className="label">新的可預約時段</span>{availabilityLoading ? <p className="text-sm text-slate-400">載入時段中…</p> : config.booking_mode === "time" ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <button type="button" key={slot.slot_start} onClick={() => setPickedStart(slot.slot_start)} className={`rounded-xl border p-3 text-sm ${pickedStart === slot.slot_start ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatTime(slot.slot_start)}<span className="mt-1 block text-xs text-slate-400">剩餘 {slot.remaining}</span></button>)}</div> : <div className="grid grid-cols-1 gap-2">{sessions.map((session) => <button type="button" key={session.template_id} onClick={() => setPickedTemplate(session.template_id)} className={`rounded-xl border p-3 text-left text-sm ${pickedTemplate === session.template_id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatDateSession(session.session_start)}<span className="ml-2 text-xs text-slate-400">剩餘 {session.remaining}</span></button>)}</div>}{!availabilityLoading && (config.booking_mode === "time" ? slots.length === 0 : sessions.length === 0) && <p className="mt-2 text-sm text-slate-400">這天沒有可用時段，請更換日期或醫師。</p>}</div>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button type="button" className="btn btn-primary w-full" disabled={submitting || availabilityLoading} onClick={() => void submit()}>{submitting ? "改期處理中…" : "確認改期"}</button></div></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) { return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10"><header className="mb-6"><Brand subtitle="預約改期" /></header>{children}</main>; }
function Message({ children, tone }: { children: React.ReactNode; tone?: "error" }) { return <div className={`card p-6 text-center text-sm ${tone === "error" ? "text-red-700" : "text-slate-500"}`}>{children}</div>; }
