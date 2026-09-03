"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { formatTime, formatDateSession } from "@/lib/slots";
import { trackFunnelEvent } from "@/lib/funnel-client";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/browser-storage";

interface BookingField { key: string; label: string; type: "text" | "textarea" | "date" | "select" | "checkbox" | "consent"; required: boolean; options: string[]; }
interface ServiceAddon { id: string; name: string; description: string | null; duration_minutes: number; price: number; }
interface Config {
  clinic_name: string | null;
  booking_mode: "time" | "number";
  max_advance_days: number;
  recurring_booking_enabled: boolean;
  max_recurring_occurrences: number;
  deposit_enabled: boolean;
  doctors: Array<{ id: string; name: string; specialty: string | null }>;
  services: Array<{ id: string; name: string; description: string | null; booking_target: "provider_required" | "provider_optional" | "resource_only"; booking_fields: BookingField[]; service_addons: ServiceAddon[] }>;
}
interface Slot { slot_start: string; slot_end: string; remaining: number }
interface Session { template_id: string; session_start: string; session_end: string; total: number; taken: number; remaining: number }
interface Result { appointment_id: string; queue_number: number | null; deposit_status: string; deposit_amount: number; start_at: string | null; end_at: string | null; doctor_name: string | null; service_name: string | null; addons_amount: number; series_count: number; appointment_ids: string[] }
interface WaitlistResult { waitlist_id: string; position: number }

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

function customerTokenKey(): string {
  if (typeof window === "undefined") return "customer_browser_token";
  const source = new URLSearchParams(window.location.search);
  return `customer_browser_token:${source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default"}`;
}

function rememberBrowserToken(value: string): void {
  safeLocalStorageSet([[browserTokenKey(), value], [customerTokenKey(), value]]);
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
  const [waitlistSlots, setWaitlistSlots] = useState<Slot[]>([]);
  const [waitlistSessions, setWaitlistSessions] = useState<Session[]>([]);
  const [pickedStart, setPickedStart] = useState("");
  const [pickedTemplate, setPickedTemplate] = useState("");
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
  const [token, setToken] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [waitlistResult, setWaitlistResult] = useState<WaitlistResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const maxDate = useMemo(() => todayStr(config?.max_advance_days ?? 30), [config?.max_advance_days]);

  useEffect(() => {
    trackFunnelEvent("booking_view");
    void api<Config>("/api/booking/config").then((value) => {
      setConfig(value);
      const source = new URLSearchParams(window.location.search);
      const requestedDoctor = source.get("doctor_id")?.trim() ?? "";
      const requestedService = source.get("service_id")?.trim() ?? "";
      setDoctorId(value.doctors.some((doctor) => doctor.id === requestedDoctor) ? requestedDoctor : value.doctors[0]?.id ?? "");
      setServiceId(value.services.some((service) => service.id === requestedService) ? requestedService : value.services[0]?.id ?? "");
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "載入失敗"));
  }, []);

  useEffect(() => {
    const source = new URLSearchParams(window.location.search);
    const scope = source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default";
    const storedToken = safeLocalStorageGet(
      customerTokenKey(),
      browserTokenKey(),
      `booking_browser_token:${scope}`,
      "membership_browser_token",
    );
    if (storedToken) setToken(storedToken);
    const value = new URLSearchParams(window.location.search).get("membership_code");
    if (value) setMembershipCode(value.trim().toUpperCase());
  }, []);

  const selectedService = config?.services.find((service) => service.id === serviceId) ?? null;
  const providerRequired = !selectedService || selectedService.booking_target === "provider_required";

  useEffect(() => {
    if (!config) return;
    if (selectedService && !providerRequired) setDoctorId("");
    else if (selectedService && providerRequired && !doctorId) setDoctorId(config.doctors[0]?.id ?? "");
    setBookingAnswers({});
    setSelectedAddonIds([]);
    setRecurrenceCount(1);
  }, [config, selectedService, providerRequired, doctorId]);

  useEffect(() => {
    if (!config || !date || (providerRequired && !doctorId) || (config.services.length > 0 && !serviceId)) return;
    setSlots([]); setSessions([]); setWaitlistSlots([]); setWaitlistSessions([]); setPickedStart(""); setPickedTemplate(""); setJoiningWaitlist(false);
    const params = new URLSearchParams({ date, visit_type: visitType, service_id: serviceId });
    if (doctorId) params.set("doctor_id", doctorId);
    if (selectedAddonIds.length > 0) params.set("addon_ids", selectedAddonIds.join(","));
    void api<{ slots?: Slot[]; sessions?: Session[]; waitlist_slots?: Slot[]; waitlist_sessions?: Session[] }>(`/api/booking/availability?${params.toString()}`)
      .then((value) => { setSlots(value.slots ?? []); setSessions(value.sessions ?? []); setWaitlistSlots(value.waitlist_slots ?? []); setWaitlistSessions(value.waitlist_sessions ?? []); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "查詢時段失敗"));
  }, [config, doctorId, date, visitType, serviceId, providerRequired, selectedAddonIds]);

  async function submit() {
    if (!config || (providerRequired && !doctorId) || (config.services.length > 0 && !serviceId) || !date || (!pickedStart && !pickedTemplate) || !name.trim() || !phone.trim() || !birthday || !bookingFieldsReady(selectedService?.booking_fields ?? [], bookingAnswers)) {
      setError("請完成基本資料與時段選擇");
      return;
    }
    if (joiningWaitlist && membershipCode.trim()) {
      setError("候補不會預先保留或扣除套票堂數，請先清空套票序號");
      return;
    }
    setLoading(true); setError(null);
    trackFunnelEvent("booking_start", { booking_mode: config.booking_mode });
    try {
      const browserToken = token ?? (await api<{ browser_token: string }>("/api/booking/browser/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone, birthday }) })).browser_token;
      setToken(browserToken);
      rememberBrowserToken(browserToken);
      const body: Record<string, unknown> = { browser_token: browserToken, doctor_id: doctorId || undefined, service_id: serviceId || undefined, visit_type: visitType, is_self_pay: false, email: email.trim() || undefined, membership_code: membershipCode.trim().toUpperCase() || undefined, booking_answers: bookingAnswers, addon_ids: selectedAddonIds, recurrence_count: recurrenceCount };
      if (config.booking_mode === "time") body.start_at = pickedStart;
      else { body.template_id = pickedTemplate; body.date = date; }
      if (joiningWaitlist) setWaitlistResult(await api<WaitlistResult>("/api/booking/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action: "join" }) }));
      else setResult(await api<Result>("/api/booking/reserve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      trackFunnelEvent("booking_success", { booking_mode: config.booking_mode, series_count: recurrenceCount });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "預約失敗");
    } finally { setLoading(false); }
  }

  function updateIdentity(setter: (value: string) => void, value: string) {
    // 修改姓名、電話或生日後，不能繼續沿用原本瀏覽器身分，避免畫面資料與實際預約顧客不一致。
    if (token) setToken(null);
    setter(value);
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

  if (result) return <Shell><div className="card space-y-5 p-6 text-center"><div className="text-4xl text-emerald-600">✓</div><h1 className="text-xl font-bold text-slate-900">{result.deposit_status === "pending" ? "預約已建立，待付款" : result.series_count > 1 ? `已建立 ${result.series_count} 週預約` : "預約成功"}</h1><p className="text-sm text-slate-600">{result.start_at ? `${formatDateSession(result.start_at)} ${formatTime(result.start_at)}` : "已完成預約"}</p>{result.queue_number !== null && <p className="text-3xl font-bold text-brand-700">{result.queue_number} 號</p>}{result.addons_amount > 0 && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">本次加購金額 NT${result.addons_amount}</p>}{result.deposit_status === "pending" && <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p>需繳訂金 NT${result.deposit_amount}；完成付款後才確認名額。</p><button type="button" onClick={() => void payDeposit()} disabled={paying} className="btn btn-primary w-full">{paying ? "正在前往付款…" : `前往付款（NT$${result.deposit_amount}）`}</button>{paymentError && <p className="rounded-lg bg-red-50 p-2 text-left text-xs text-red-700">{paymentError}</p>}</div>}<p className="text-xs text-slate-400">請保留此瀏覽器頁面，之後可使用同一裝置查看預約。</p><Link href={scopePageUrl("/book/browser/my")} className="btn btn-primary w-full">查看我的預約</Link><Link href={scopeUrl("/")} className="btn btn-secondary w-full">返回品牌首頁</Link></div></Shell>;
  if (waitlistResult) return <Shell><div className="card space-y-4 p-6 text-center"><div className="text-4xl text-amber-600">✓</div><h1 className="text-xl font-bold text-slate-900">候補登記完成</h1><p className="text-sm text-slate-600">目前順位：第 {waitlistResult.position} 位；名額釋出後會以 Email 通知。</p><Link href={scopePageUrl("/book/browser/my")} className="btn btn-primary w-full">查看我的候補</Link></div></Shell>;
  if (!config) return <Shell><p className="card p-8 text-center text-sm text-slate-500">{error ?? "載入中…"}</p></Shell>;
  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between gap-3"><div><div className="eyebrow">一般瀏覽器入口</div><h1 className="text-2xl font-bold text-slate-900">瀏覽器預約</h1><p className="mt-1 text-sm text-slate-500">不使用 LINE 也可完成預約。</p></div><Link href={scopeUrl("/book")} className="text-sm text-brand-700">改用 LINE</Link></div>
      <div className="card space-y-5 p-5">
        {token && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">目前沿用此裝置的預約身分；若修改姓名、電話或出生年月日，送出時會重新驗證新的身分。</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm"><span className="label">姓名</span><input className="input" value={name} onChange={(event) => updateIdentity(setName, event.target.value)} autoComplete="name" /></label><label className="text-sm"><span className="label">電話</span><input className="input" value={phone} onChange={(event) => updateIdentity(setPhone, event.target.value)} inputMode="tel" autoComplete="tel" /></label></div>
        <label className="block text-sm"><span className="label">Email（選填，用於提醒）</span><input type="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" /></label>
        <label className="block text-sm"><span className="label">出生年月日</span><input type="date" className="input" value={birthday} onChange={(event) => updateIdentity(setBirthday, event.target.value)} /></label>
        <label className="block text-sm"><span className="label">套票序號（選填）</span><input className="input uppercase" value={membershipCode} onChange={(event) => setMembershipCode(event.target.value.toUpperCase())} autoComplete="off" /></label>
        <div><span className="label">預約類型</span><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setVisitType("return")} className={`rounded-xl border p-3 text-sm ${visitType === "return" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>再次服務</button><button type="button" onClick={() => setVisitType("first")} className={`rounded-xl border p-3 text-sm ${visitType === "first" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>首次服務</button></div></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(providerRequired || selectedService?.booking_target === "provider_optional") && <label className="text-sm"><span className="label">服務提供者</span><select className="input" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">不指定</option>{config.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ""}</option>)}</select></label>}
          {config.services.length > 0 && <label className="text-sm"><span className="label">服務</span><select className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{config.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>}
        </div>
        {selectedService?.booking_target === "resource_only" && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">此服務依場地／設備容量安排，不需要指定服務提供者。</p>}
        <BookingFields fields={selectedService?.booking_fields ?? []} answers={bookingAnswers} onChange={(key, value) => setBookingAnswers((current) => ({ ...current, [key]: value }))} />
        <ServiceAddons addons={selectedService?.service_addons ?? []} selectedIds={selectedAddonIds} onChange={setSelectedAddonIds} />
        <label className="block text-sm"><span className="label">日期</span><input type="date" className="input" min={todayStr()} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {date && (!providerRequired || !!doctorId) && <div className="space-y-2"><div className="label">可預約時段</div>{config.booking_mode === "time" ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <button type="button" key={slot.slot_start} onClick={() => { setPickedStart(slot.slot_start); setJoiningWaitlist(false); }} className={`rounded-xl border p-3 text-sm ${!joiningWaitlist && pickedStart === slot.slot_start ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatTime(slot.slot_start)}<span className="mt-1 block text-xs text-slate-400">剩 {slot.remaining}</span></button>)}</div> : <div className="grid grid-cols-1 gap-2">{sessions.map((session) => <button type="button" key={session.template_id} onClick={() => { setPickedTemplate(session.template_id); setJoiningWaitlist(false); }} className={`rounded-xl border p-3 text-left text-sm ${!joiningWaitlist && pickedTemplate === session.template_id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{formatDateSession(session.session_start)}<span className="ml-2 text-xs text-slate-400">剩 {session.remaining}</span></button>)}</div>}{config.booking_mode === "time" && waitlistSlots.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{waitlistSlots.map((slot) => <button type="button" key={slot.slot_start} onClick={() => { setPickedStart(slot.slot_start); setJoiningWaitlist(true); }} className={`min-h-11 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 ${joiningWaitlist && pickedStart === slot.slot_start ? "ring-2 ring-amber-400" : ""}`}>{formatTime(slot.slot_start)}<span className="block text-xs">加入候補</span></button>)}</div>}{config.booking_mode === "number" && waitlistSessions.length > 0 && <div className="mt-4 space-y-2">{waitlistSessions.map((session) => <button type="button" key={session.template_id} onClick={() => { setPickedTemplate(session.template_id); setJoiningWaitlist(true); }} className={`min-h-11 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-800 ${joiningWaitlist && pickedTemplate === session.template_id ? "ring-2 ring-amber-400" : ""}`}>{formatDateSession(session.session_start)}<span className="ml-2 text-xs">加入候補</span></button>)}</div>}{(config.booking_mode === "time" ? slots.length + waitlistSlots.length === 0 : sessions.length + waitlistSessions.length === 0) && <p className="text-sm text-slate-400">目前沒有可預約或候補時段。</p>}</div>}
        {(pickedStart || pickedTemplate) && config.recurring_booking_enabled && selectedService && !joiningWaitlist && <label className="block rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm"><span className="label">每週重複預約</span><select className="input" value={recurrenceCount} disabled={config.deposit_enabled} onChange={(event) => setRecurrenceCount(Number(event.target.value))}>{Array.from({ length: config.max_recurring_occurrences }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count === 1 ? "只預約本次" : `連續 ${count} 週`}</option>)}</select><span className="mt-2 block text-xs text-slate-500">{config.deposit_enabled ? "啟用訂金時，請逐筆完成預約與付款。" : "系統會先確認每一週都有名額，再一次建立全部預約。"}</span></label>}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button type="button" className="btn btn-primary w-full" disabled={loading} onClick={() => void submit()}>{loading ? "送出中…" : joiningWaitlist ? "確認加入候補" : recurrenceCount > 1 ? `確認建立 ${recurrenceCount} 週預約` : "確認預約"}</button>
      </div>
    </Shell>
  );
}

function Shell({ children, clinicName }: { children: React.ReactNode; clinicName?: string | null }) { return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10"><header className="mb-6"><Brand name={clinicName} subtitle="瀏覽器預約備援" /></header>{children}</main>; }

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
  return <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-800">加購服務</p>{total > 0 && <span className="text-xs font-medium text-brand-700">加購 NT${total}</span>}</div>{addons.map((addon) => { const checked = selectedIds.includes(addon.id); return <label key={addon.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 text-sm ${checked ? "border-brand-300" : "border-slate-200"}`}><input type="checkbox" className="mt-0.5 h-4 w-4" checked={checked} onChange={() => onChange(checked ? selectedIds.filter((id) => id !== addon.id) : [...selectedIds, addon.id])} /><span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{addon.name}</span>{addon.description && <span className="block text-xs text-slate-500">{addon.description}</span>}</span><span className="shrink-0 text-right text-xs text-slate-600">{addon.duration_minutes > 0 && <span className="block">+{addon.duration_minutes} 分</span>}{addon.price > 0 && <span className="block">NT${addon.price}</span>}</span></label>; })}</div>;
}
