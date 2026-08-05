"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { formatTime, formatDateSession } from "@/lib/slots";

interface Config {
  clinic_name: string | null;
  booking_mode: "time" | "number";
  max_advance_days: number;
  doctors: Array<{ id: string; name: string; specialty: string | null }>;
  services: Array<{ id: string; name: string; description: string | null }>;
}
interface Slot { slot_start: string; slot_end: string; remaining: number }
interface Session { template_id: string; session_start: string; session_end: string; total: number; taken: number; remaining: number }
interface Result { appointment_id: string; queue_number: number | null; deposit_status: string; deposit_amount: number; start_at: string | null; end_at: string | null; doctor_name: string | null; service_name: string | null }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(scopeUrl(url), init);
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? "伺服器回應異常");
  return body.data as T;
}

function scopeUrl(url: string): string {
  if (typeof window === "undefined" || (!url.startsWith("/api/booking") && !url.startsWith("/api/payment/create"))) return url;
  const source = new URLSearchParams(window.location.search);
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (!slug && !clinicId) return url;
  const target = new URL(url, window.location.origin);
  if (slug) target.searchParams.set("clinic_slug", slug);
  else target.searchParams.set("clinic_id", clinicId!);
  return `${target.pathname}${target.search}`;
}

function scopePageUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  return params.toString() ? `${path}?${params.toString()}` : path;
}

function browserTokenKey(): string {
  if (typeof window === "undefined") return "booking_browser_token";
  const source = new URLSearchParams(window.location.search);
  return `booking_browser_token:${source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default"}`;
}

function todayStr(offset = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
}

export default function BrowserBookingPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pickedStart, setPickedStart] = useState("");
  const [pickedTemplate, setPickedTemplate] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [email, setEmail] = useState("");
  const [membershipCode, setMembershipCode] = useState("");
  const [visitType, setVisitType] = useState<"first" | "return">("return");
  const [token, setToken] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const maxDate = useMemo(() => todayStr(config?.max_advance_days ?? 30), [config?.max_advance_days]);

  useEffect(() => {
    void api<Config>("/api/booking/config").then((value) => {
      setConfig(value);
      setDoctorId(value.doctors[0]?.id ?? "");
      setServiceId(value.services[0]?.id ?? "");
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "載入失敗"));
  }, []);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(browserTokenKey());
    if (storedToken) setToken(storedToken);
    const value = new URLSearchParams(window.location.search).get("membership_code");
    if (value) setMembershipCode(value.trim().toUpperCase());
  }, []);

  useEffect(() => {
    if (!config || !doctorId || !date) return;
    setSlots([]); setSessions([]); setPickedStart(""); setPickedTemplate("");
    void api<{ slots?: Slot[]; sessions?: Session[] }>(`/api/booking/availability?doctor_id=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}&visit_type=${visitType}`)
      .then((value) => { setSlots(value.slots ?? []); setSessions(value.sessions ?? []); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "查詢時段失敗"));
  }, [config, doctorId, date, visitType]);

  async function submit() {
    if (!config || !doctorId || !date || (!pickedStart && !pickedTemplate) || !name.trim() || !phone.trim() || !birthday) {
      setError("請完成基本資料與時段選擇");
      return;
    }
    setLoading(true); setError(null);
    try {
      const browserToken = token ?? (await api<{ browser_token: string }>("/api/booking/browser/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone, birthday }) })).browser_token;
      setToken(browserToken);
      window.localStorage.setItem(browserTokenKey(), browserToken);
      const body: Record<string, unknown> = { browser_token: browserToken, doctor_id: doctorId, service_id: serviceId || undefined, visit_type: visitType, is_self_pay: false, email: email.trim() || undefined, membership_code: membershipCode.trim().toUpperCase() || undefined };
      if (config.booking_mode === "time") body.start_at = pickedStart;
      else { body.template_id = pickedTemplate; body.date = date; }
      setResult(await api<Result>("/api/booking/reserve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "預約失敗");
    } finally { setLoading(false); }
  }

  async function payDeposit() {
    if (!result?.appointment_id || !token) return;
    setPaying(true);
    setPaymentError(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: result.appointment_id, browser_token: token, return_path: window.location.pathname + window.location.search }),
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

  if (result) return <Shell><div className="card space-y-5 p-6 text-center"><div className="text-4xl text-emerald-600">✓</div><h1 className="text-xl font-bold text-slate-900">{result.deposit_status === "pending" ? "預約已建立，待付款" : "預約成功"}</h1><p className="text-sm text-slate-600">{result.start_at ? `${formatDateSession(result.start_at)} ${formatTime(result.start_at)}` : "已完成掛號"}</p>{result.queue_number !== null && <p className="text-3xl font-bold text-brand-700">{result.queue_number} 號</p>}{result.deposit_status === "pending" && <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p>需繳訂金 NT${result.deposit_amount}；完成付款後才確認名額。</p><button type="button" onClick={() => void payDeposit()} disabled={paying} className="btn btn-primary w-full">{paying ? "正在前往付款…" : `前往付款（NT$${result.deposit_amount}）`}</button>{paymentError && <p className="rounded-lg bg-red-50 p-2 text-left text-xs text-red-700">{paymentError}</p>}</div>}<p className="text-xs text-slate-400">請保留此瀏覽器頁面，之後可使用同一裝置查看預約。</p><Link href={scopePageUrl("/book/browser/my")} className="btn btn-primary w-full">查看我的預約</Link><Link href={scopeUrl("/")} className="btn btn-secondary w-full">返回品牌首頁</Link></div></Shell>;
  if (!config) return <Shell><p className="card p-8 text-center text-sm text-slate-500">{error ?? "載入中…"}</p></Shell>;
  return <Shell><div className="mb-4 flex items-center justify-between gap-3"><div><div className="eyebrow">Browser fallback</div><h1 className="text-2xl font-bold text-slate-900">瀏覽器預約</h1><p className="mt-1 text-sm text-slate-500">不使用 LINE 也可完成預約。</p></div><Link href={scopeUrl("/book")} className="text-sm text-brand-700">改用 LINE</Link></div><div className="card space-y-5 p-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm"><span className="label">姓名</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label><label className="text-sm"><span className="label">電話</span><input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></label></div><label className="block text-sm"><span className="label">Email（選填，用於提醒）</span><input type="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" /></label><label className="block text-sm"><span className="label">出生年月日</span><input type="date" className="input" value={birthday} onChange={(event) => setBirthday(event.target.value)} /></label><label className="block text-sm"><span className="label">套票序號（選填）</span><input className="input uppercase" value={membershipCode} onChange={(event) => setMembershipCode(event.target.value.toUpperCase())} autoComplete="off" /></label><div><span className="label">就診類型</span><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setVisitType("return")} className={`rounded-xl border p-3 text-sm ${visitType === "return" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>複診</button><button type="button" onClick={() => setVisitType("first")} className={`rounded-xl border p-3 text-sm ${visitType === "first" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>初診</button></div></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm"><span className="label">服務提供者</span><select className="input" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>{config.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ""}</option>)}</select></label>{config.services.length > 0 && <label className="text-sm"><span className="label">服務</span><select className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{config.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>}</div><label className="block text-sm"><span className="label">日期</span><input type="date" className="input" min={todayStr()} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} /></label>{date && <div className="space-y-2"><div className="label">可預約時段</div>{config.booking_mode === "time" ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <button type="button" key={slot.slot_start} onClick={() => setPickedStart(slot.slot_start)} className={`rounded-xl border p-3 text-sm ${pickedStart === slot.slot_start ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatTime(slot.slot_start)}<span className="mt-1 block text-xs text-slate-400">剩 {slot.remaining}</span></button>)}</div> : <div className="grid grid-cols-1 gap-2">{sessions.map((session) => <button type="button" key={session.template_id} onClick={() => setPickedTemplate(session.template_id)} className={`rounded-xl border p-3 text-left text-sm ${pickedTemplate === session.template_id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatDateSession(session.session_start)}<span className="ml-2 text-xs text-slate-400">剩 {session.remaining}</span></button>)}</div>}{(config.booking_mode === "time" ? slots.length === 0 : sessions.length === 0) && <p className="text-sm text-slate-400">目前沒有可預約時段。</p>}</div>}{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button type="button" className="btn btn-primary w-full" disabled={loading} onClick={() => void submit()}>{loading ? "送出中…" : "確認預約"}</button></div></Shell>;
}

function Shell({ children, clinicName }: { children: React.ReactNode; clinicName?: string | null }) { return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10"><header className="mb-6"><Brand name={clinicName} subtitle="瀏覽器預約備援" /></header>{children}</main>; }
