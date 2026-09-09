"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { googleCalendarUrl, type CalEvent } from "@/lib/calendar";
import type { CustomerEntryKey as CustomerView } from "@/lib/customer-entry";
import { liffEntryParams } from "@/lib/liff-entry-state";
import styles from "./CustomerApp.module.css";

export interface ServiceAddon {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
}

export interface BookingField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "checkbox" | "consent";
  required: boolean;
  options: string[];
}

export function bookingFieldsReady(fields: BookingField[], answers: Record<string, unknown>): boolean {
  return fields.every((field) => {
    const value = answers[field.key];
    return !field.required || (field.type === "checkbox" || field.type === "consent"
      ? value === true
      : typeof value === "string" && value.trim().length > 0);
  });
}

export function BookingFields({
  fields,
  answers,
  onChange,
}: {
  fields: BookingField[];
  answers: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-800">預約前資料</p>
      {fields.map((field) => {
        const label = `${field.label}${field.required ? " *" : ""}`;
        const value = answers[field.key];
        if (field.type === "checkbox" || field.type === "consent") {
          return (
            <label key={field.key} className={`flex items-start gap-2 rounded-lg p-2 text-sm ${field.type === "consent" ? "border border-brand-100 bg-white text-slate-700" : "text-slate-600"}`}>
              <input type="checkbox" className="mt-1 h-4 w-4" checked={value === true} onChange={(event) => onChange(field.key, event.target.checked)} />
              <span>{label}</span>
            </label>
          );
        }
        if (field.type === "textarea") {
          return (
            <label key={field.key} className="block text-sm">
              <span className="label">{label}</span>
              <textarea className="input" rows={3} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key, event.target.value)} />
            </label>
          );
        }
        if (field.type === "select") {
          return (
            <label key={field.key} className="block text-sm">
              <span className="label">{label}</span>
              <select className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key, event.target.value)}>
                <option value="">請選擇</option>
                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={field.key} className="block text-sm">
            <span className="label">{label}</span>
            <input type={field.type === "date" ? "date" : "text"} className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key, event.target.value)} />
          </label>
        );
      })}
    </div>
  );
}

export function ServiceAddons({
  addons,
  selectedIds,
  onChange,
}: {
  addons: ServiceAddon[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (addons.length === 0) return null;
  const total = addons
    .filter((addon) => selectedIds.includes(addon.id))
    .reduce((sum, addon) => sum + addon.price, 0);

  return (
    <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-800">加購服務</p>
        {total > 0 && <span className="text-xs font-medium text-brand-700">加購 NT${total}</span>}
      </div>
      {addons.map((addon) => {
        const checked = selectedIds.includes(addon.id);
        return (
          <label key={addon.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${checked ? "border-brand-300 bg-white" : "border-slate-200 bg-white/70"}`}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={checked}
              onChange={() => onChange(checked ? selectedIds.filter((id) => id !== addon.id) : [...selectedIds, addon.id])}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-800">{addon.name}</span>
              {addon.description && <span className="mt-0.5 block text-xs text-slate-500">{addon.description}</span>}
            </span>
            <span className="shrink-0 text-right text-xs text-slate-600">
              {addon.duration_minutes > 0 && <span className="block">+{addon.duration_minutes} 分</span>}
              {addon.price > 0 && <span className="block">NT${addon.price}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export interface CustomerAppBranding {
  clinicName?: string | null;
  logoUrl?: string | null;
  primary?: string | null;
  accent?: string | null;
  soft?: string | null;
  ink?: string | null;
}

function safeHex(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

export function Shell({ children, clinicName, logoUrl, primary, accent, soft, ink }: { children: ReactNode } & CustomerAppBranding) {
  const [resolvedBranding, setResolvedBranding] = useState<CustomerAppBranding>({});
  useEffect(() => {
    if (logoUrl || primary) return;
    const source = new URLSearchParams(window.location.search);
    const scope = new URLSearchParams();
    const clinicSlug = source.get("clinic_slug")?.trim();
    const clinicId = source.get("clinic_id")?.trim();
    if (clinicSlug) scope.set("clinic_slug", clinicSlug);
    else if (clinicId) scope.set("clinic_id", clinicId);
    if (!scope.toString()) return;
    const controller = new AbortController();
    void fetch(`/api/customer/entry-config?${scope.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as {
          ok?: boolean;
          data?: {
            clinic_name: string | null;
            brand_logo_url: string | null;
            brand_primary_color: string;
            brand_accent_color: string;
            brand_soft_color: string;
            brand_ink_color: string;
          };
        };
        if (!response.ok || !body.ok || !body.data) return;
        setResolvedBranding({
          clinicName: body.data.clinic_name,
          logoUrl: body.data.brand_logo_url,
          primary: body.data.brand_primary_color,
          accent: body.data.brand_accent_color,
          soft: body.data.brand_soft_color,
          ink: body.data.brand_ink_color,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [clinicName, logoUrl, primary]);
  const displayedName = clinicName ?? resolvedBranding.clinicName;
  const displayedLogo = logoUrl ?? resolvedBranding.logoUrl;
  const appStyle = {
    "--customer-primary": safeHex(primary ?? resolvedBranding.primary, "#31584D"),
    "--customer-accent": safeHex(accent ?? resolvedBranding.accent, "#B89C68"),
    "--customer-soft": safeHex(soft ?? resolvedBranding.soft, "#EEF4F1"),
    "--customer-ink": safeHex(ink ?? resolvedBranding.ink, "#1D302A"),
  } as CSSProperties;
  return (
    <main className={`${styles.viewport} ${styles.shell}`} style={appStyle}>
      <div className={styles.appFrame}>
        <header className={styles.appHeader}>
          <div className={styles.brandLockup}>
            <span className={styles.logoFrame}>
              {displayedLogo ? (
                <>
                  {/* Tenant-owned logo URLs are validated when saved and intentionally bypass Next image hosts. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={displayedLogo} alt="" />
                </>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 7.5A1.5 1.5 0 0 1 7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5z" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M8.5 12h7M12 8.5v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span className="min-w-0">
              <span className={styles.brandName}>{displayedName?.trim() || "品牌線上服務"}</span>
              <span className={styles.brandSubtitle}>專屬服務 App</span>
            </span>
          </div>
          <span className={styles.secureState}>LINE 安全連線</span>
        </header>
        <div className={styles.appContent}>{children}</div>
      </div>
    </main>
  );
}

export function SectionTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-accent-600 text-white" : "bg-brand-100 text-brand-700"}`}>
        {done ? "✓" : n}
      </span>
      <h2 className="font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

export function TypeToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`pill text-center ${active ? "pill-active" : ""}`}>
      {children}
    </button>
  );
}

export function CalendarButtons({
  start,
  end,
  doctor,
  service,
  clinicName,
}: {
  start: string;
  end: string;
  doctor: string | null;
  service: string | null;
  clinicName: string | null;
}) {
  const endIso = end && end !== start ? end : new Date(new Date(start).getTime() + 30 * 60000).toISOString();
  const details = [doctor ? `服務提供者:${doctor}` : "", service ? `服務:${service}` : "", "服務開始前請提前準備;無法前來請提前取消。"]
    .filter(Boolean)
    .join("\n");
  const displayName = clinicName?.trim() || "預約與報名平台";
  const event: CalEvent = {
    title: `${displayName} 預約`,
    startIso: start,
    endIso,
    details,
    location: displayName,
  };

  function openUrl(url: string) {
    const liff = typeof window !== "undefined" ? window.liff : undefined;
    if (liff?.openWindow) liff.openWindow({ url, external: true });
    else window.open(url, "_blank");
  }

  const icsUrl =
    `/api/booking/ics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(endIso)}` +
    `&title=${encodeURIComponent(event.title)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(displayName)}`;
  const absoluteIcsUrl = typeof window !== "undefined"
    ? new URL(icsUrl, window.location.origin).toString()
    : icsUrl;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">加入行事曆後，手機會在服務開始前自動提醒您。</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => openUrl(googleCalendarUrl(event))} className="btn btn-secondary text-sm">
          Google 日曆
        </button>
        <button type="button" onClick={() => openUrl(absoluteIcsUrl)} className="btn btn-secondary text-sm">
          加入行事曆
        </button>
      </div>
    </div>
  );
}

export function Centered({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <p className={tone === "error" ? "text-red-600" : "text-slate-500"}>{children}</p>
    </main>
  );
}

export function browserFallbackUrl(view: CustomerView): string {
  const path = view === "booking"
    ? "/book/browser"
    : view === "events"
      ? "/register"
      : view === "membership"
        ? "/membership"
        : view === "home" || view === "brand" || view === "support"
          ? "/"
          : "/my";
  if (typeof window === "undefined") return path;
  const source = liffEntryParams(window.location.search);
  const params = new URLSearchParams();
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
