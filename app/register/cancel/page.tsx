"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";

async function cancel(token: string, scopeSuffix: string): Promise<string> {
  const response = await fetch(`/api/registration/cancel${scopeSuffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: { registration_status?: string }; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? "取消報名失敗");
  return body.data?.registration_status === "cancelled" ? "已取消報名" : "此報名目前已是取消狀態";
}

export default function RegistrationCancelPage() {
  const [token, setToken] = useState("");
  const [scopeSuffix, setScopeSuffix] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const scope = new URLSearchParams();
    const clinicSlug = query.get("clinic_slug");
    const clinicId = query.get("clinic_id");
    if (clinicSlug) scope.set("clinic_slug", clinicSlug);
    if (clinicId) scope.set("clinic_id", clinicId);
    const encoded = scope.toString();
    setScopeSuffix(encoded ? `?${encoded}` : "");
  }, []);

  async function submit() {
    if (!token.trim()) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      setMessage(await cancel(token.trim(), scopeSuffix));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消報名失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6"><Brand subtitle="取消活動報名" /></header>
      <section className="card space-y-5 p-6 sm:p-8">
        <div><h1 className="text-xl font-bold text-slate-900">取消報名</h1><p className="mt-2 text-sm leading-6 text-slate-500">請輸入報名完成頁顯示的報到憑證。已付款項不會自動退款，請依合約與人工退款流程處理。</p></div>
        <label className="block text-sm"><span className="label">報到憑證</span><input className="input font-mono" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label>
        {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => void submit()} disabled={submitting || !token.trim()} className="btn btn-primary flex-1">{submitting ? "處理中…" : "確認取消"}</button><Link href={`/register${scopeSuffix}`} className="btn btn-secondary flex-1">返回活動列表</Link></div>
      </section>
    </main>
  );
}
