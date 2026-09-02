"use client";

import { useState } from "react";
import { formatAmount, formatEventDate, paymentStatusLabel, registrationStatusLabel } from "@/lib/registration";

interface QueryResult { registration_no: string; status: string; payment_status: string; amount: number; name: string; created_at: string; events: { title: string } | { title: string }[] | null; event_sessions: { name: string; start_at: string; end_at: string } | { name: string; start_at: string; end_at: string }[] | null; }
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default function MyRegistrationPage() {
  const [registrationNo, setRegistrationNo] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null); setResult(null);
    try {
      const params = new URLSearchParams({ registration_no: registrationNo.trim(), phone: phone.trim() });
      const currentSearch = new URLSearchParams(window.location.search);
      const clinicSlug = currentSearch.get("clinic_slug"); const clinicId = currentSearch.get("clinic_id");
      if (clinicSlug) params.set("clinic_slug", clinicSlug); else if (clinicId) params.set("clinic_id", clinicId);
      const response = await fetch(`/api/registration/my?${params.toString()}`);
      const body = await response.json() as { ok: boolean; data?: QueryResult; error?: string };
      if (!body.ok || !body.data) throw new Error(body.error ?? "查詢失敗");
      setResult(body.data);
    } catch (queryError) { setError(queryError instanceof Error ? queryError.message : "查詢失敗"); }
    finally { setLoading(false); }
  }
  const eventRow = result ? one(result.events) : null; const session = result ? one(result.event_sessions) : null;
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6"><div><p className="eyebrow">報名查詢</p><h1 className="text-2xl font-bold text-slate-900">查詢我的報名</h1><p className="mt-2 text-sm leading-6 text-slate-500">以報名編號與送出報名時使用的電話查詢，不需要登入。</p></div><form onSubmit={submit} className="card space-y-4 p-5"><label className="block text-sm"><span className="label">報名編號</span><input className="input uppercase" value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} required /></label><label className="block text-sm"><span className="label">報名電話</span><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label><button className="btn btn-primary w-full" disabled={loading}>{loading ? "查詢中…" : "查詢報名"}</button>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</form>{result && <section className="card space-y-3 p-5"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-slate-900">{eventRow?.title ?? "活動報名"}</h2><span className="badge bg-brand-50 text-brand-700">{registrationStatusLabel(result.status)}</span></div><p className="text-sm text-slate-600">{result.name} · {result.registration_no}</p>{session && <p className="text-sm text-slate-600">{session.name} · {formatEventDate(session.start_at)}</p>}<p className="text-sm text-slate-600">付款狀態：{paymentStatusLabel(result.payment_status)} · {formatAmount(result.amount)}</p></section>}</main>;
}
