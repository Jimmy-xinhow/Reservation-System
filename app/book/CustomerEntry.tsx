"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createQrSvg } from "@/lib/qr";
import { formatEventDate } from "@/lib/registration";
import { safeLocalStorageSet } from "@/lib/browser-storage";
import {
  enabledCustomerEntries,
  type CustomerEntryAvailability,
  type CustomerEntryKey,
} from "@/lib/customer-entry";

export type CustomerView = CustomerEntryKey;

export interface CustomerEntryBrand {
  clinicName: string | null;
  clinicSlug: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
  lineBasicId: string | null;
  pageEnabled: boolean;
}

const SHORT_LABELS: Record<CustomerView, string> = {
  home: "首頁",
  booking: "預約",
  appointments: "我的預約",
  events: "活動",
  tickets: "票券",
  membership: "會員",
  support: "客服",
  brand: "品牌",
};

function EntryIcon({ entry }: { entry: CustomerView }) {
  const shared = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mx-auto h-5 w-5" {...shared}>
      {entry === "home" && <><path d="M3.5 10.5 12 3l8.5 7.5" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" /></>}
      {entry === "booking" && <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5" /></>}
      {entry === "appointments" && <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4" /></>}
      {entry === "events" && <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4" /><path d="m5.6 5.6 2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" /></>}
      {entry === "tickets" && <><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Z" /><path d="M12 8.5v7" /></>}
      {entry === "membership" && <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5.5 16c.6-1.5 1.4-2.2 2.5-2.2s1.9.7 2.5 2.2M13.5 10H18M13.5 14H18" /></>}
      {entry === "support" && <><path d="M4 5.5h16v11H9l-5 4v-15Z" /><path d="M8 10h8M8 13h5" /></>}
      {entry === "brand" && <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>}
    </svg>
  );
}

export function CustomerEntryNav({ view, availability, onChange }: { view: CustomerView; availability: CustomerEntryAvailability; onChange: (view: CustomerView) => void }) {
  const entries = enabledCustomerEntries(availability);
  return (
    <nav aria-label="顧客服務" className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1 sm:grid-cols-8">
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => onChange(entry.key)}
          aria-current={view === entry.key ? "page" : undefined}
          className={`min-h-14 rounded-xl px-1 py-2 text-xs font-medium transition ${view === entry.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-800"}`}
        >
          <EntryIcon entry={entry.key} />
          <span className="mt-1 block">{SHORT_LABELS[entry.key]}</span>
        </button>
      ))}
    </nav>
  );
}

const HOME_DESCRIPTIONS: Record<Exclude<CustomerView, "home">, string> = {
  booking: "選擇服務與可預約時間",
  appointments: "查詢、取消、改期與候補",
  events: "瀏覽活動與開放場次",
  tickets: "查看報名狀態與報到條碼",
  membership: "查看套票、剩餘堂數與到期日",
  support: "直接聯絡品牌客服",
  brand: "查看電話、地址與品牌介紹",
};

export function CustomerHomeView({
  availability,
  bookingMode,
  brand,
  onChange,
}: {
  availability: CustomerEntryAvailability;
  bookingMode: "time" | "number";
  brand: CustomerEntryBrand;
  onChange: (view: CustomerView) => void;
}) {
  const enabled = enabledCustomerEntries(availability).filter((entry) => entry.key !== "home");
  const primary = enabled.find((entry) => entry.key === "booking") ?? enabled.find((entry) => entry.key === "appointments") ?? enabled[0];
  const secondary = enabled.filter((entry) => entry.key !== primary?.key);
  const bookingDescription = bookingMode === "number" ? "選擇服務與開放場次" : HOME_DESCRIPTIONS.booking;

  return (
    <section className="space-y-5">
      <div className="card p-5 sm:p-6">
        <p className="eyebrow">顧客服務中心</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          {brand.clinicName ?? "歡迎使用線上服務"}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          預約、活動報名、票券與會員資料集中在同一個入口，選擇要辦理的事項即可開始。
        </p>
        {primary && (
          <button type="button" onClick={() => onChange(primary.key)} className="btn btn-primary mt-5 w-full sm:w-auto">
            <EntryIcon entry={primary.key} />
            {primary.label}
          </button>
        )}
      </div>

      {secondary.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-900">常用服務</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {secondary.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => onChange(entry.key)}
                className="card flex min-h-20 items-center gap-4 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <EntryIcon entry={entry.key} />
                </span>
                <span>
                  <span className="block font-semibold text-slate-900">{entry.label}</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">
                    {entry.key === "booking" ? bookingDescription : entry.key === "home" ? "" : HOME_DESCRIPTIONS[entry.key]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        查看個人預約、票券或會員資料時，系統會透過 LINE 確認身分，避免其他人看到您的資料。
      </p>
    </section>
  );
}

interface EventSummary {
  id: string;
  title: string;
  description: string | null;
  registration_close_at: string | null;
}

interface PortalData {
  patient: { id: string; name: string } | null;
  patients: Array<{ id: string; name: string }>;
  browser_token: string | null;
  registrations: Array<{
    id: string;
    registration_no: string;
    status: string;
    payment_status: string;
    amount: number;
    checkin_token: string | null;
    events: { title: string } | { title: string }[] | null;
    event_sessions: { name: string; start_at: string; end_at: string } | { name: string; start_at: string; end_at: string }[] | null;
  }>;
  memberships: Array<{
    membership_code: string;
    status: string;
    credits_total: number;
    credits_remaining: number;
    expires_at: string | null;
    membership_plans: { name: string; description: string | null; usage_scope: string } | { name: string; description: string | null; usage_scope: string }[] | null;
  }>;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function scopedPath(path: string, extra?: Record<string, string>): string {
  if (typeof window === "undefined") return path;
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams(extra);
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  for (const key of ["utm_source", "rm_version", "rm_slot"] as const) {
    const value = source.get(key)?.trim();
    if (value) params.set(key, value);
  }
  return `${path}${params.toString() ? `?${params.toString()}` : ""}`;
}

function statusLabel(value: string): string {
  return ({ pending: "待付款", confirmed: "已確認", waitlisted: "候補中", attended: "已報到", no_show: "未到", cancelled: "已取消", active: "使用中", expired: "已到期", paid: "已付款", failed: "付款失敗", not_required: "免付款" } as Record<string, string>)[value] ?? value;
}

export function CustomerLiffView({ view, idToken, brand }: { view: "events" | "tickets" | "membership" | "brand"; idToken: string | null; brand: CustomerEntryBrand }) {
  if (view === "events") return <EventsView />;
  if (view === "brand") return <BrandView brand={brand} />;
  return <PrivatePortalView view={view} idToken={idToken} />;
}

function EventsView() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(scopedPath("/api/registration/events"), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { ok?: boolean; data?: { events: EventSummary[] }; error?: string };
        if (!response.ok || !body.ok || !body.data) throw new Error(body.error ?? "活動載入失敗");
        setEvents(body.data.events);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "活動載入失敗"));
  }, []);
  if (error) return <Message tone="error">{error}</Message>;
  if (!events) return <Message>載入活動中…</Message>;
  if (events.length === 0) return <Message>目前沒有開放報名的活動。</Message>;
  return <section className="space-y-3"><header><h1 className="text-xl font-bold text-slate-900">活動與課程</h1><p className="mt-1 text-sm text-slate-500">LINE 身分會在報名時自動驗證，不必重複綁定。</p></header>{events.map((event) => <Link key={event.id} href={scopedPath("/register", { event: event.id, liff: "1" })} className="card block p-5 transition hover:border-brand-300 hover:bg-brand-50"><h2 className="font-semibold text-slate-900">{event.title}</h2>{event.description && <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{event.description}</p>}<p className="mt-3 text-xs text-slate-400">{event.registration_close_at ? `報名至 ${formatEventDate(event.registration_close_at)}` : "報名時間依活動公告"}</p></Link>)}</section>;
}

function PrivatePortalView({ view, idToken }: { view: "tickets" | "membership"; idToken: string | null }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (patientId?: string) => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(scopedPath("/api/customer/portal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, patient_id: patientId || undefined }),
        cache: "no-store",
      });
      const body = await response.json() as { ok?: boolean; data?: PortalData; error?: string };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error ?? "顧客資料載入失敗");
      setData(body.data);
      setSelectedPatientId(body.data.patient?.id ?? "");
      if (body.data.browser_token) {
        const source = new URLSearchParams(window.location.search);
        const scope = source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default";
        safeLocalStorageSet([
          [`customer_browser_token:${scope}`, body.data.browser_token],
          ["membership_browser_token", body.data.browser_token],
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "顧客資料載入失敗");
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => { if (idToken) void load(); }, [idToken, load]);
  if (!idToken || loading) return <Message>確認 LINE 身分並載入資料中…</Message>;
  if (error) return <Message tone="error">{error}</Message>;
  if (!data?.patient) return <Message>尚未綁定顧客資料；完成一次預約或報名後即可在這裡查看。</Message>;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">LINE 顧客專區</p><h1 className="text-xl font-bold text-slate-900">{view === "tickets" ? "我的票券" : "會員與套票"}</h1></div>
        {data.patients.length > 1 && <label className="text-sm"><span className="label">查看顧客</span><select className="input min-w-44" value={selectedPatientId} onChange={(event) => void load(event.target.value)}>{data.patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}
      </div>
      {view === "tickets" ? <TicketList data={data} /> : <MembershipList data={data} />}
    </section>
  );
}

function TicketList({ data }: { data: PortalData }) {
  const active = useMemo(() => data.registrations.filter((item) => item.status !== "cancelled"), [data.registrations]);
  if (active.length === 0) return <Message>目前沒有活動票券。</Message>;
  return <div className="space-y-3">{active.map((registration) => { const event = one(registration.events); const session = one(registration.event_sessions); const qr = registration.checkin_token ? createQrSvg(registration.checkin_token) : null; return <article key={registration.id} className="card space-y-4 p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{event?.title ?? "活動票券"}</h2><p className="mt-1 text-sm text-slate-500">{session ? `${session.name} · ${formatEventDate(session.start_at)}` : registration.registration_no}</p></div><span className="badge bg-slate-100 text-slate-600">{statusLabel(registration.status)}</span></div>{qr && registration.payment_status !== "pending" && <div className="mx-auto w-48 rounded-xl border border-slate-200 bg-white p-3" aria-label={`${registration.registration_no} 報到 QR Code`} dangerouslySetInnerHTML={{ __html: qr }} />}<div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-mono text-slate-500">{registration.registration_no}</span>{registration.payment_status === "pending" && <Link href={scopedPath("/register/pay", { registration_id: registration.id })} className="btn btn-primary px-3 py-1.5 text-xs">前往付款</Link>}</div>{!registration.checkin_token && registration.status === "confirmed" && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">此筆舊資料尚無可還原的 QR 憑證，請洽品牌人員重新發送。</p>}</article>; })}</div>;
}

function MembershipList({ data }: { data: PortalData }) {
  return <div className="space-y-3"><Link href={scopedPath("/membership")} className="btn btn-primary w-full">查看可購買方案</Link>{data.memberships.length === 0 ? <Message>目前沒有會員套票。</Message> : data.memberships.map((membership) => { const plan = one(membership.membership_plans); return <article key={membership.membership_code} className="card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{plan?.name ?? "會員方案"}</h2><p className="mt-1 font-mono text-xs text-slate-400">{membership.membership_code}</p></div><span className="badge bg-slate-100 text-slate-600">{statusLabel(membership.status)}</span></div><div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-xs text-slate-500">剩餘堂數</p><p className="mt-1 text-2xl font-bold text-slate-900">{membership.credits_remaining}<span className="ml-1 text-sm font-normal text-slate-400">/ {membership.credits_total}</span></p></div><p className="text-right text-xs text-slate-500">{membership.expires_at ? `到期 ${new Date(membership.expires_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}` : "不限期"}</p></div></article>; })}</div>;
}

function BrandView({ brand }: { brand: CustomerEntryBrand }) {
  const lineUrl = brand.lineBasicId ? `https://line.me/R/ti/p/${encodeURIComponent(brand.lineBasicId)}` : null;
  return <section className="card overflow-hidden"><div className="bg-gradient-to-br from-brand-600 to-accent-600 p-6 text-white"><p className="text-sm text-white/75">品牌資訊</p><h1 className="mt-1 text-2xl font-bold">{brand.clinicName ?? "服務品牌"}</h1>{brand.intro && <p className="mt-3 text-sm leading-6 text-white/85">{brand.intro}</p>}</div><div className="space-y-3 p-5 text-sm text-slate-600">{brand.pageEnabled && <Link href={scopedPath("/")} className="btn btn-primary w-full">瀏覽品牌形象頁</Link>}{brand.phone && <a href={`tel:${brand.phone}`} className="block rounded-xl bg-slate-50 p-4">電話：{brand.phone}</a>}{brand.address && <p className="rounded-xl bg-slate-50 p-4">地址：{brand.address}</p>}{lineUrl && <a href={lineUrl} target="_blank" rel="noreferrer" className="btn w-full bg-[#06C755] text-white hover:opacity-90">開啟品牌 LINE</a>}</div></section>;
}

function Message({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  return <div className={`card p-6 text-center text-sm ${tone === "error" ? "text-red-700" : "text-slate-500"}`}>{children}</div>;
}
