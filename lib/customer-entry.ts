export type CustomerEntryKey =
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
  liffId: string | null;
  preferLiff?: boolean;
}

export const CUSTOMER_ENTRY_DEFINITIONS: readonly CustomerEntryDefinition[] = [
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
  if (useLiff) url.searchParams.set("view", definition.liffView);
  return url.toString();
}
