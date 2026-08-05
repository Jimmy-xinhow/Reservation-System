"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createQrSvg } from "@/lib/qr";

interface PaymentStatus {
  status: string;
  amount: number;
  target: "registration" | "appointment";
  registration_id: string | null;
  registration_status: string | null;
  registration_payment_status: string | null;
  appointment_status: string | null;
}

export default function PaymentResultPage() {
  const [data, setData] = useState<PaymentStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search);
  }, []);
  const order = query?.get("order") ?? "";
  const provider = query?.get("provider") ?? "";
  const clinicSlug = query?.get("clinic_slug") ?? "";

  useEffect(() => {
    if (!order || !provider) {
      setError("付款結果連結不完整");
      return;
    }
    const params = new URLSearchParams({ order, provider });
    if (clinicSlug) params.set("clinic_slug", clinicSlug);
    void fetch(`/api/payment/status?${params.toString()}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: PaymentStatus; error?: string } | null;
        if (!response.ok || !body?.ok || !body.data) throw new Error(body?.error ?? "付款狀態讀取失敗");
        setData(body.data);
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
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "付款狀態讀取失敗"));
  }, [clinicSlug, order, provider]);

  const qr = token && data?.target === "registration" && data.registration_status === "confirmed" ? createQrSvg(token) : null;
  const succeeded = data?.status === "paid" && (data.target === "appointment" ? data.appointment_status === "confirmed" : data.registration_payment_status === "paid");
  const backHref = clinicSlug ? `/?clinic_slug=${encodeURIComponent(clinicSlug)}` : "/";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-8">
      <section className="card w-full space-y-5 p-6 text-center">
        <div className={`text-4xl ${succeeded ? "text-emerald-600" : "text-amber-600"}`}>{succeeded ? "✓" : "…"}</div>
        <h1 className="text-xl font-bold text-slate-900">{succeeded ? "付款完成" : data?.status === "failed" || data?.status === "expired" ? "付款未完成" : "付款處理中"}</h1>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : data && <p className="text-sm text-slate-600">{data.target === "registration" ? `報名付款金額 NT$${data.amount.toLocaleString("zh-TW")}` : `預約訂金 NT$${data.amount.toLocaleString("zh-TW")}`}</p>}
        {qr && <div className="mx-auto w-52 rounded-xl border border-slate-200 bg-white p-3" dangerouslySetInnerHTML={{ __html: qr }} />}
        {qr && <p className="text-xs text-slate-500">報到 QR 已從本裝置的報名資料恢復，請勿轉傳。</p>}
        <Link href={backHref} className="btn btn-secondary w-full">返回品牌首頁</Link>
      </section>
    </main>
  );
}
