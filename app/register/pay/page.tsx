"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

interface PaymentFormResponse {
  form: { action: string; fields: Record<string, string> };
}

async function readApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? "伺服器回應異常");
  return body.data as T;
}

function validRegistrationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function RegistrationPaymentPage() {
  const [registrationId, setRegistrationId] = useState("");
  const [clinicScope, setClinicScope] = useState("");
  const [token, setToken] = useState("");
  const [browserToken, setBrowserToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const id = query.get("registration_id")?.trim() ?? "";
    const scope = new URLSearchParams();
    const clinicSlug = query.get("clinic_slug")?.trim();
    const clinicId = query.get("clinic_id")?.trim();
    if (clinicSlug) scope.set("clinic_slug", clinicSlug);
    else if (clinicId) scope.set("clinic_id", clinicId);
    setRegistrationId(id);
    setClinicScope(scope.toString() ? `?${scope.toString()}` : "");
    if (!validRegistrationId(id)) {
      setError("付款連結無效，請回到報名完成頁重新操作。");
      setReady(true);
      return;
    }
    try {
      const saved = window.localStorage.getItem(`registration:${id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { checkin_token?: unknown };
        if (typeof parsed.checkin_token === "string") setToken(parsed.checkin_token);
      }
      const scopeKey = clinicSlug || clinicId || "default";
      setBrowserToken(window.localStorage.getItem(`customer_browser_token:${scopeKey}`) || window.localStorage.getItem(`booking_browser_token:${scopeKey}`) || "");
    } catch {
      // 私密瀏覽或瀏覽器禁用儲存時，改由使用者貼上憑證。
    }
    setReady(true);
  }, []);

  async function pay() {
    if (!validRegistrationId(registrationId) || (!token.trim() && !browserToken.trim())) {
      setError("找不到此筆報名的付款身分，請重新從報名完成頁或我的紀錄操作。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      try {
        window.localStorage.setItem(`registration:${registrationId}`, JSON.stringify({ checkin_token: token.trim() }));
      } catch {
        // 不影響付款請求。
      }
      const data = await readApi<PaymentFormResponse>(`/api/payment/create${clinicScope}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: registrationId, checkin_token: token.trim() || undefined, browser_token: browserToken.trim() || undefined, return_path: `/register/pay?registration_id=${encodeURIComponent(registrationId)}${clinicScope.replace("?", "&")}` }),
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "付款頁開啟失敗");
      setSubmitting(false);
    }
  }

  const backHref = clinicScope ? `/register${clinicScope}` : "/register";
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6"><Brand subtitle="報名付款" /></header>
      <section className="card space-y-5 p-6 sm:p-8">
        <div><div className="eyebrow">報名付款</div><h1 className="text-xl font-bold text-slate-900">完成報名付款</h1><p className="mt-2 text-sm leading-6 text-slate-500">候補遞補或離開原頁後，可用報名完成頁的報到憑證繼續付款。憑證只用於驗證這一筆報名，不會顯示顧客個資。</p></div>
        {!ready ? <p className="text-sm text-slate-400">載入付款資料中…</p> : <>
          <label className="block text-sm"><span className="label">報到憑證</span><input className="input font-mono" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="請貼上報名完成頁的憑證" /></label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => void pay()} disabled={submitting || !validRegistrationId(registrationId) || (!token.trim() && !browserToken.trim())} className="btn btn-primary flex-1">{submitting ? "正在前往付款…" : "前往付款"}</button><Link href={backHref} className="btn btn-secondary flex-1">返回活動列表</Link></div>
        </>}
      </section>
    </main>
  );
}
