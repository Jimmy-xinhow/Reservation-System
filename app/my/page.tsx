"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { formatEventDate } from "@/lib/registration";
import { formatDateSession, formatTime } from "@/lib/slots";

interface PortalData {
  patient: { name: string };
  appointments: Array<{ id: string; start_at: string; end_at: string | null; status: string; visit_type: "first" | "return"; queue_number: number | null; doctors: { name: string } | null; services: { name: string } | null }>;
  registrations: Array<{ registration_no: string; status: string; payment_status: string; amount: number; created_at: string; events: { title: string } | { title: string }[] | null; event_sessions: { name: string; start_at: string; end_at: string } | { name: string; start_at: string; end_at: string }[] | null }>;
  memberships: Array<{ membership_code: string; status: string; credits_total: number; credits_remaining: number; starts_at: string; expires_at: string | null; membership_plans: { name: string; description: string | null; usage_scope: string } | { name: string; description: string | null; usage_scope: string }[] | null }>;
}

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

function scopeSuffix(): string {
  if (typeof window === "undefined") return "";
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  return params.toString() ? `?${params.toString()}` : "";
}

function tokenKey(): string {
  if (typeof window === "undefined") return "customer_browser_token";
  const source = new URLSearchParams(window.location.search);
  return `customer_browser_token:${source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default"}`;
}

function storedToken(): string | null {
  const key = tokenKey();
  const source = new URLSearchParams(window.location.search);
  const scope = source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default";
  return window.localStorage.getItem(key)
    || window.localStorage.getItem(`booking_browser_token:${scope}`)
    || window.localStorage.getItem("membership_browser_token");
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { booked: "已預約", confirmed: "已確認", done: "已完成", no_show: "未到", cancelled: "已取消", pending: "待付款", waitlisted: "候補中", attended: "已報到", active: "使用中", expired: "已到期", refunded: "已退款", not_required: "免付款", paid: "已付款", failed: "付款失敗" };
  return labels[status] ?? status;
}

export default function MyCustomerPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (browserToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customer/portal${scopeSuffix()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser_token: browserToken }), cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: PortalData; error?: string };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error ?? "顧客資料載入失敗");
      setData(body.data);
      window.localStorage.setItem(tokenKey(), browserToken);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "顧客資料載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = storedToken();
    if (stored) void load(stored);
    else setLoading(false);
  }, [load]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Brand subtitle="我的紀錄" />
        <Link href={`/${scopeSuffix()}`} className="text-sm text-brand-700 hover:underline">返回品牌首頁</Link>
      </header>
      {loading && <p className="card p-6 text-center text-sm text-slate-500">載入我的紀錄…</p>}
      {!loading && error && (
        <section className="card space-y-4 p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">需要重新驗證</h1>
          <p className="text-sm leading-6 text-slate-500">{error}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center"><Link href={`/book/browser${scopeSuffix()}`} className="btn btn-primary">重新預約／驗證</Link><Link href={`/membership${scopeSuffix()}`} className="btn btn-secondary">查詢會員資料</Link></div>
        </section>
      )}
      {!loading && data && (
        <div className="space-y-6">
          <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-accent-600 p-6 text-white"><p className="text-sm text-white/75">歡迎回來</p><h1 className="mt-1 text-2xl font-bold">{data.patient.name}</h1><p className="mt-2 text-sm text-white/80">預約、活動報名與套票都集中在這裡。</p></section>
          <section className="grid gap-3 sm:grid-cols-3"><Summary label="未來預約" value={data.appointments.filter((item) => ["booked", "confirmed"].includes(item.status)).length} /><Summary label="活動報名" value={data.registrations.length} /><Summary label="使用中套票" value={data.memberships.filter((item) => item.status === "active").length} /></section>
          <section className="card space-y-3 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">我的預約</h2><Link href={`/book/browser${scopeSuffix()}`} className="text-sm text-brand-700">新增預約</Link></div>{data.appointments.length === 0 ? <Empty text="目前沒有預約紀錄。" /> : <div className="space-y-2">{data.appointments.slice(0, 8).map((item) => <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-slate-900">{formatDateSession(item.start_at)} {formatTime(item.start_at)}</p><p className="mt-1 text-sm text-slate-500">{item.services?.name ?? "服務"} · {item.doctors?.name ?? "服務提供者"} · {item.visit_type === "first" ? "初次" : "回訪"}</p></div><span className="badge bg-slate-100 text-slate-600">{statusLabel(item.status)}</span></div>)}</div>}</section>
          <section className="card space-y-3 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">我的活動報名</h2><Link href={`/register${scopeSuffix()}`} className="text-sm text-brand-700">查看活動</Link></div>{data.registrations.length === 0 ? <Empty text="目前沒有活動報名。" /> : <div className="space-y-2">{data.registrations.slice(0, 8).map((item) => { const event = one(item.events); const session = one(item.event_sessions); return <div key={item.registration_no} className="flex flex-col gap-2 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-slate-900">{event?.title ?? "活動"}</p><p className="mt-1 text-sm text-slate-500">{session ? `${session.name} · ${formatEventDate(session.start_at)}` : item.registration_no} · {statusLabel(item.payment_status)}</p></div><span className="badge bg-slate-100 text-slate-600">{statusLabel(item.status)}</span></div>; })}</div>}</section>
          <section className="card space-y-3 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">我的套票</h2><Link href={`/membership${scopeSuffix()}`} className="text-sm text-brand-700">購買套票</Link></div>{data.memberships.length === 0 ? <Empty text="目前沒有套票。" /> : <div className="space-y-2">{data.memberships.slice(0, 8).map((item) => { const plan = one(item.membership_plans); return <div key={item.membership_code} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-4"><div><p className="font-medium text-slate-900">{plan?.name ?? "會員方案"}</p><p className="mt-1 text-sm text-slate-500">剩餘 {item.credits_remaining}／{item.credits_total} 堂{item.expires_at ? ` · 到期 ${new Date(item.expires_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}` : ""}</p></div><span className="badge bg-slate-100 text-slate-600">{statusLabel(item.status)}</span></div>; })}</div>}</section>
        </div>
      )}
      {!loading && !data && !error && <p className="card p-6 text-center text-sm text-slate-500">完成一次預約、報名或會員查詢後，就能在這裡查看紀錄。</p>}
    </main>
  );
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="card p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">{text}</p>; }
