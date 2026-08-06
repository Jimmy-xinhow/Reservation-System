"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatDateSession, formatTime } from "@/lib/slots";

interface Appointment {
  id: string;
  start_at: string;
  queue_number: number | null;
  status: string;
  visit_type: "first" | "return";
  doctors: { name: string } | null;
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
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  return params.toString() ? `${path}?${params.toString()}` : path;
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
      const data = await api<{ appointments: Appointment[] }>("/api/booking/browser/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser_token: browserToken }),
      });
      setAppointments(data.appointments);
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
    const stored = window.localStorage.getItem(customerTokenKey())
      || window.localStorage.getItem(tokenKey())
      || window.localStorage.getItem(`booking_browser_token:${scope}`)
      || window.localStorage.getItem("membership_browser_token");
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
      window.localStorage.setItem(tokenKey(), data.browser_token);
      window.localStorage.setItem(customerTokenKey(), data.browser_token);
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
      {token && !loading && appointments && (
        appointments.length === 0 ? <p className="card p-6 text-center text-sm text-slate-500">目前沒有可管理的未來預約。</p> :
          <div className="space-y-3">{appointments.map((appointment) => <div key={appointment.id} className="card flex items-center justify-between gap-3 p-4"><div><p className="font-medium text-slate-900">{formatDateSession(appointment.start_at)} {formatTime(appointment.start_at)}</p><p className="mt-1 text-xs text-slate-500">{appointment.doctors?.name ?? ""}{appointment.patients?.name ? `・${appointment.patients.name}` : ""}・{appointment.visit_type === "first" ? "首次服務" : "再次服務"}</p></div><div className="flex shrink-0 gap-2"><Link href={scopePage(`/book/browser/reschedule?appointment_id=${encodeURIComponent(appointment.id)}`)} className="btn btn-secondary px-3 py-1.5 text-xs">改期</Link><button type="button" className="btn btn-danger px-3 py-1.5 text-xs" disabled={working === appointment.id} onClick={() => void cancel(appointment.id)}>{working === appointment.id ? "取消中…" : "取消"}</button></div></div>)}</div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10"><header className="mb-6 flex items-center justify-between gap-3"><Brand subtitle="我的預約" /><Link href={scopePage("/my")} className="text-sm text-brand-700">我的紀錄</Link></header>{children}</main>;
}
