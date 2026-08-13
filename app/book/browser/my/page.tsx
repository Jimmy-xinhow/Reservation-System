"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatDateSession, formatTime } from "@/lib/slots";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/browser-storage";

interface Appointment {
  id: string;
  doctor_id: string | null;
  service_id: string | null;
  start_at: string;
  queue_number: number | null;
  status: string;
  visit_type: "first" | "return";
  deposit_status: string;
  deposit_amount: number;
  doctors: { name: string } | null;
  patients: { name: string } | null;
}
interface Waitlist {
  id: string;
  patient_id: string;
  requested_date: string;
  requested_start_at: string | null;
  position: number;
  status: "waiting" | "offered";
  offer_expires_at: string | null;
  doctors: { name: string } | null;
  services: { name: string } | null;
  patients: { name: string } | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(scopeApi(url), init);
  const body = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!body) throw new Error("無法取得伺服器回應");
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

function scopeApi(url: string): string {
  if (typeof window === "undefined") return url;
  const source = new URLSearchParams(window.location.search);
  const scope = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) scope.set("clinic_slug", slug);
  else if (clinicId) scope.set("clinic_id", clinicId);
  if (!scope.toString()) return url;
  const target = new URL(url, window.location.origin);
  scope.forEach((value, key) => target.searchParams.set(key, value));
  return `${target.pathname}${target.search}`;
}

function scopePage(path: string): string {
  if (typeof window === "undefined") return path;
  const source = new URLSearchParams(window.location.search);
  const target = new URL(path, window.location.origin);
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) target.searchParams.set("clinic_slug", slug);
  else if (clinicId) target.searchParams.set("clinic_id", clinicId);
  return `${target.pathname}${target.search}`;
}

function tokenKey(): string {
  if (typeof window === "undefined") return "booking_browser_token";
  const source = new URLSearchParams(window.location.search);
  return `booking_browser_token:${source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default"}`;
}

function customerTokenKey(): string {
  if (typeof window === "undefined") return "customer_browser_token";
  const source = new URLSearchParams(window.location.search);
  return `customer_browser_token:${source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default"}`;
}

export default function BrowserMyAppointmentsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [waitlists, setWaitlists] = useState<Waitlist[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (browserToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ appointments: Appointment[]; waitlists: Waitlist[] }>("/api/booking/browser/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser_token: browserToken }),
      });
      setAppointments(data.appointments);
      setWaitlists(data.waitlists ?? []);
    } catch (loadError) {
      setAppointments(null);
      setError(loadError instanceof Error ? loadError.message : "載入預約失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const source = new URLSearchParams(window.location.search);
    const scope = source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default";
    const stored = safeLocalStorageGet(
      customerTokenKey(),
      tokenKey(),
      `booking_browser_token:${scope}`,
      "membership_browser_token",
    );
    if (stored) {
      setToken(stored);
      void load(stored);
    }
  }, [load]);

  async function identify() {
    if (!name.trim() || !phone.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      setError("請填寫姓名、電話與生日");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ browser_token: string }>("/api/booking/browser/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), birthday }),
      });
      safeLocalStorageSet([[tokenKey(), data.browser_token], [customerTokenKey(), data.browser_token]]);
      setToken(data.browser_token);
      await load(data.browser_token);
    } catch (identifyError) {
      setError(identifyError instanceof Error ? identifyError.message : "身分驗證失敗");
      setLoading(false);
    }
  }

  async function cancel(appointmentId: string) {
    if (!token) return;
    setWorking(appointmentId);
    setError(null);
    try {
      await api("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser_token: token, appointment_id: appointmentId }),
      });
      await load(token);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消失敗");
    } finally {
      setWorking(null);
    }
  }

  async function waitlistAction(waitlistId: string, action: "accept" | "cancel") {
    if (!token) return;
    setWorking(waitlistId);
    setError(null);
    try {
      await api("/api/booking/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser_token: token, waitlist_id: waitlistId, action }) });
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "候補操作失敗");
    } finally {
      setWorking(null);
    }
  }

  async function pay(appointmentId: string) {
    if (!token) return;
    setWorking(appointmentId);
    setError(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser_token: token, appointment_id: appointmentId, return_path: window.location.pathname + window.location.search }) });
      const form = document.createElement("form");
      form.method = "POST"; form.action = data.form.action; form.style.display = "none";
      for (const [name, value] of Object.entries(data.form.fields)) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input); }
      document.body.appendChild(form); form.submit();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "付款頁開啟失敗");
      setWorking(null);
    }
  }

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><p className="eyebrow">Browser fallback</p><h1 className="text-2xl font-bold text-slate-900">我的預約</h1></div>
        <Link href={scopePage("/book/browser")} className="text-sm text-brand-700">新增預約</Link>
      </div>
      {!token && (
        <div className="card mb-4 space-y-4 p-5">
          <p className="text-sm text-slate-600">請輸入預約時使用的資料，以查看預約。</p>
          <label className="block text-sm"><span className="label">姓名</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label className="block text-sm"><span className="label">電話</span><input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></label>
          <label className="block text-sm"><span className="label">生日</span><input type="date" className="input" value={birthday} onChange={(event) => setBirthday(event.target.value)} /></label>
          <button type="button" className="btn btn-primary w-full" disabled={loading} onClick={() => void identify()}>{loading ? "驗證中…" : "查看預約"}</button>
        </div>
      )}
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {token && loading && <p className="card p-6 text-center text-sm text-slate-500">載入中…</p>}
      {token && !loading && waitlists.length > 0 && <section className="mb-4 space-y-3"><h2 className="px-1 text-sm font-medium text-slate-600">我的候補</h2>{waitlists.map((item) => <div key={item.id} className={`card space-y-3 p-4 ${item.status === "offered" ? "border-amber-300 bg-amber-50" : ""}`}><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{item.requested_start_at ? `${formatDateSession(item.requested_start_at)} ${formatTime(item.requested_start_at)}` : item.requested_date}</p><p className="mt-1 text-xs text-slate-500">{item.services?.name ?? item.doctors?.name ?? "預約候補"}</p></div><span className="badge bg-amber-100 text-amber-800">{item.status === "offered" ? "名額保留中" : `第 ${item.position} 位`}</span></div><div className="flex gap-2">{item.status === "offered" && <button type="button" className="btn btn-primary min-h-11 flex-1" disabled={working === item.id} onClick={() => void waitlistAction(item.id, "accept")}>接受名額</button>}<button type="button" className="btn btn-secondary min-h-11 flex-1" disabled={working === item.id} onClick={() => void waitlistAction(item.id, "cancel")}>取消候補</button></div></div>)}</section>}
      {token && !loading && appointments && (
        appointments.length === 0 ? (waitlists.length === 0 ? <p className="card p-6 text-center text-sm text-slate-500">目前沒有可管理的未來預約或候補。</p> : null) :
          <div className="space-y-3">{appointments.map((appointment) => <div key={appointment.id} className="card flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center"><div><p className="font-medium text-slate-900">{formatDateSession(appointment.start_at)} {formatTime(appointment.start_at)}</p><p className="mt-1 text-xs text-slate-500">{appointment.doctors?.name ?? ""}{appointment.patients?.name ? `・${appointment.patients.name}` : ""}・{appointment.visit_type === "first" ? "首次服務" : "再次服務"}</p></div><div className="flex flex-wrap gap-2">{appointment.deposit_status === "pending" && <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={working === appointment.id} onClick={() => void pay(appointment.id)}>{`付訂金 $${appointment.deposit_amount}`}</button>}{appointment.service_id && <Link href={scopePage(`/book/browser?service_id=${encodeURIComponent(appointment.service_id)}${appointment.doctor_id ? `&doctor_id=${encodeURIComponent(appointment.doctor_id)}` : ""}`)} className="btn btn-secondary px-3 py-1.5 text-xs">再次預約</Link>}<Link href={scopePage(`/book/browser/reschedule?appointment_id=${encodeURIComponent(appointment.id)}`)} className="btn btn-secondary px-3 py-1.5 text-xs">改期</Link><button type="button" className="btn btn-danger px-3 py-1.5 text-xs" disabled={working === appointment.id} onClick={() => void cancel(appointment.id)}>{working === appointment.id ? "取消中…" : "取消"}</button></div></div>)}</div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10"><header className="mb-6 flex items-center justify-between gap-3"><Brand subtitle="我的預約" /><Link href={scopePage("/my")} className="text-sm text-brand-700">我的紀錄</Link></header>{children}</main>;
}
