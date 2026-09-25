export type CustomerEntryKey =
  | "home"
  | "booking"
  | "appointments"
  | "events"
  | "tickets"
  | "membership"
  | "support"
  | "brand";

export interface CustomerEntryDefinition {
  key: CustomerEntryKey;
  label: string;
  accessibilityLabel: string;
  browserPath: string;
  liffView: string;
  requires: "booking" | "events" | "tickets" | "memberships" | "line" | "always";
}

export interface CustomerEntryAvailability {
  booking: boolean;
  events: boolean;
  tickets: boolean;
  memberships: boolean;
  line: boolean;
}

export interface CustomerEntryUrlContext {
  baseUrl: string;
  clinicSlug: string | null;
  clinicId?: string | null;
  liffId: string | null;
  preferLiff?: boolean;
  /** Focused LIFF task parameters such as service/date/event. */
  extraParams?: Record<string, string | null | undefined>;
}

export const CUSTOMER_ENTRY_DEFINITIONS: readonly CustomerEntryDefinition[] = [
  { key: "home", label: "服務首頁", accessibilityLabel: "回到顧客服務首頁", browserPath: "/", liffView: "home", requires: "always" },
  { key: "booking", label: "立即預約", accessibilityLabel: "開啟線上預約", browserPath: "/book/browser", liffView: "booking", requires: "booking" },
  { key: "appointments", label: "我的預約", accessibilityLabel: "查詢、取消或改期我的預約", browserPath: "/my", liffView: "appointments", requires: "always" },
  { key: "events", label: "活動／課程", accessibilityLabel: "瀏覽活動與課程報名", browserPath: "/register", liffView: "events", requires: "events" },
  { key: "tickets", label: "我的票券", accessibilityLabel: "查看我的報名與票券 QR", browserPath: "/my", liffView: "tickets", requires: "tickets" },
  { key: "membership", label: "會員／套票", accessibilityLabel: "查看會員方案、套票與剩餘堂數", browserPath: "/membership", liffView: "membership", requires: "memberships" },
  { key: "support", label: "LINE 客服", accessibilityLabel: "開啟品牌 LINE 客服", browserPath: "/", liffView: "support", requires: "line" },
  { key: "brand", label: "品牌資訊", accessibilityLabel: "查看品牌資訊與聯絡方式", browserPath: "/", liffView: "brand", requires: "always" },
] as const;

export function customerEntryDefinition(key: CustomerEntryKey): CustomerEntryDefinition {
  const definition = CUSTOMER_ENTRY_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`unknown customer entry: ${key}`);
  return definition;
}

export function enabledCustomerEntries(availability: CustomerEntryAvailability): CustomerEntryDefinition[] {
  return CUSTOMER_ENTRY_DEFINITIONS.filter((item) => item.requires === "always" || availability[item.requires]);
}

export function customerEntryUrl(key: CustomerEntryKey, context: CustomerEntryUrlContext): string {
  const definition = customerEntryDefinition(key);
  const useLiff = context.preferLiff !== false && Boolean(context.liffId);
  const url = useLiff
    ? new URL(`https://liff.line.me/${context.liffId}`)
    : new URL(definition.browserPath, context.baseUrl);
  if (context.clinicSlug) url.searchParams.set("clinic_slug", context.clinicSlug);
  else if (context.clinicId) url.searchParams.set("clinic_id", context.clinicId);
  if (useLiff) url.searchParams.set("view", definition.liffView);
  for (const [key, value] of Object.entries(context.extraParams ?? {})) {
    const normalized = value?.trim();
    if (normalized) url.searchParams.set(key, normalized);
  }
  return url.toString();
}

/** Website actions use a configured brand LINE entry, with a local browser fallback. */
export function publicCustomerEntryUrl(
  key: CustomerEntryKey,
  context: { clinicSlug: string | null; clinicId: string; enabled: boolean; liffId: string | null; loginChannelId: string | null },
  extraParams?: Record<string, string>,
): string {
  const liffId = context.enabled && context.loginChannelId ? context.liffId : null;
  const url = new URL(customerEntryUrl(key, {
    baseUrl: "https://customer-entry.invalid", clinicSlug: context.clinicSlug,
    clinicId: context.clinicId, liffId, extraParams: { ...extraParams, ...(liffId ? { task: "1" } : {}) },
  }));
  return liffId ? url.toString() : `${url.pathname}${url.search}`;
}

/** Carry only public task context into the browser; never copy LINE identity tokens. */
export function customerBrowserFallbackUrl(key: CustomerEntryKey, source: URLSearchParams): string {
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "rm_version", "rm_slot"];
  if (key === "booking") keys.push("service_id", "doctor_id", "date", "visit_type");
  if (key === "events") keys.push("event");
  for (const name of keys) {
    const value = source.get(name)?.trim();
    if (value) params.set(name, value);
  }
  if (key === "events") {
    // On the primary redirect, the top-level access_token belongs to LINE.
    // Only an invitation inside the original task state may be carried over.
    let invitation = source.get("access_token")?.trim();
    if (source.has("liff.state")) {
      invitation = undefined;
      try {
        invitation = new URL(source.get("liff.state") ?? "", "https://customer-entry.invalid").searchParams.get("access_token")?.trim();
      } catch { /* Invalid state cannot authorize a private event. */ }
    }
    if (invitation) params.set("access_token", invitation);
  }
  const path = customerEntryDefinition(key).browserPath;
  return `${path}${params.size ? `?${params.toString()}` : ""}`;
}

export function bookingLiffHandoffUrl(source: URLSearchParams, selection: { serviceId: string; doctorId: string; date: string; visitType: "first" | "return" }): string {
  const url = new URL(customerBrowserFallbackUrl("booking", source), "https://customer-entry.invalid");
  url.pathname = "/book";
  url.searchParams.set("view", "booking");
  url.searchParams.set("task", "1");
  for (const [key, value] of Object.entries({ service_id: selection.serviceId, doctor_id: selection.doctorId, date: selection.date, visit_type: selection.visitType })) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}`;
}
