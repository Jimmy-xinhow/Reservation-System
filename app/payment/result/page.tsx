"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createQrSvg } from "@/lib/qr";
import { Shell as CustomerAppShell } from "@/app/book/BookingFlowUi";
import { paymentResultState } from "@/lib/payment-result-state";
import { customerEntryUrl } from "@/lib/customer-entry";

interface PaymentStatus {
  status: string;
  amount: number;
  target: "registration" | "appointment" | "membership";
  registration_id: string | null;
  registration_status: string | null;
  registration_payment_status: string | null;
  appointment_status: string | null;
  membership_id: string | null;
}

export default function PaymentResultPage() {
  return <Suspense fallback={<CustomerAppShell><p role="status">正在確認付款結果…</p></CustomerAppShell>}><PaymentResultContent /></Suspense>;
}

function PaymentResultContent() {
  const [data, setData] = useState<PaymentStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [entry, setEntry] = useState<{ clinic_slug: string | null; liff_id: string | null } | null>(null);

  const query = useSearchParams();
  const order = query?.get("order") ?? "";
  const provider = query?.get("provider") ?? "";
  const clinicSlug = query?.get("clinic_slug") ?? "";
  const clinicId = query?.get("clinic_id") ?? "";

  useEffect(() => {
    const controller = new AbortController();
    const scope = new URLSearchParams();
    if (clinicSlug) scope.set("clinic_slug", clinicSlug);
    else if (clinicId) scope.set("clinic_id", clinicId);
    void fetch(`/api/customer/entry-config?${scope}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { ok?: boolean; data?: { clinic_slug: string | null; liff_id: string | null } };
        if (!controller.signal.aborted && response.ok && body.ok && body.data) setEntry(body.data);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [clinicSlug, clinicId]);

  useEffect(() => {
    if (!order || !provider) {
      setError("付款結果連結不完整");
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setError(null);
    setWaiting(false);
    const params = new URLSearchParams({ order, provider });
    if (clinicSlug) params.set("clinic_slug", clinicSlug);
    else if (clinicId) params.set("clinic_id", clinicId);
    const check = () => {
      if (controller.signal.aborted) return;
      setChecking(true);
      attempts += 1;
      void fetch(`/api/payment/status?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: PaymentStatus; error?: string } | null;
        if (!response.ok || !body?.ok || !body.data) throw new Error(body?.error ?? "付款狀態讀取失敗");
        if (controller.signal.aborted) return;
        setData(body.data);
        setToken(null);
        if (body.data.registration_id) {
          try {
            const raw = window.localStorage.getItem(`registration:${body.data.registration_id}`);
            if (raw) {
              const saved = JSON.parse(raw) as { checkin_token?: string };
              if (saved.checkin_token) setToken(saved.checkin_token);
            }
          } catch {
            // localStorage 不可用時仍顯示付款結果。
          }
        }
        if (paymentResultState(body.data) === "processing") {
          if (attempts < 10) timer = setTimeout(check, 3000);
          else setWaiting(true);
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "付款狀態讀取失敗");
      })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    };
    check();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [clinicSlug, clinicId, order, provider, refresh]);

  const state = paymentResultState(data);
  const succeeded = state === "completed";
  const qr = succeeded && token && data?.target === "registration" && data.registration_status === "confirmed" ? createQrSvg(token) : null;
  const scope = clinicSlug ? `?clinic_slug=${encodeURIComponent(clinicSlug)}` : clinicId ? `?clinic_id=${encodeURIComponent(clinicId)}` : "";
  const backHref = `/${scope}`;
  const recordKey = data?.target === "membership" ? "membership" : data?.target === "registration" ? "tickets" : "appointments";
  const recordUrl = new URL(customerEntryUrl(recordKey, {
    baseUrl: "https://customer-entry.invalid",
    clinicSlug: entry?.clinic_slug ?? clinicSlug, clinicId,
    liffId: entry?.liff_id ?? null,
    extraParams: entry?.liff_id ? { task: "1" } : undefined,
  }));
  const recordHref = entry?.liff_id ? recordUrl.toString() : `${recordUrl.pathname}${recordUrl.search}`;
  const title = error ? "暫時無法確認付款結果" : succeeded ? "付款完成" : state === "refunded" ? "付款已退款" : state === "needs_review" ? "已付款，預約／報名狀態待確認" : state === "incomplete" ? "付款未完成" : waiting ? "付款結果尚待確認" : "付款處理中";

  return (
    <CustomerAppShell>
      <section className="card w-full space-y-5 p-6 text-center">
        <div className={`text-4xl ${succeeded ? "text-emerald-600" : "text-amber-600"}`}>{succeeded ? "✓" : "…"}</div>
        <h1 className="text-xl font-bold text-slate-900" aria-live="polite">{title}</h1>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : data && <p className="text-sm text-slate-600">{data.target === "registration" ? `報名付款金額 NT$${data.amount.toLocaleString("zh-TW")}` : data.target === "membership" ? `會員套票付款金額 NT$${data.amount.toLocaleString("zh-TW")}` : `預約訂金 NT$${data.amount.toLocaleString("zh-TW")}`}</p>}
        {qr && <div className="mx-auto w-52 rounded-xl border border-slate-200 bg-white p-3" dangerouslySetInnerHTML={{ __html: qr }} />}
        {qr && <p className="text-xs text-slate-500">報到 QR 已從本裝置的報名資料恢復，請勿轉傳。</p>}
        {(waiting || error || state === "needs_review") && <p className="text-sm text-slate-600">若已完成扣款，請勿重複付款。可重新查詢，或聯絡品牌協助確認。</p>}
        {(state === "processing" || error) && order && provider && <button type="button" disabled={checking} className="btn btn-secondary w-full" onClick={() => setRefresh((value) => value + 1)}>{checking ? "查詢中…" : "重新查詢付款結果"}</button>}
        {data && <a href={recordHref} className="btn btn-primary w-full">{data.target === "membership" ? "查看會員與套票" : data.target === "registration" ? "查看我的票券" : "查看我的預約"}</a>}
        <Link href={backHref} className="btn btn-secondary w-full">返回品牌首頁</Link>
      </section>
    </CustomerAppShell>
  );
}
