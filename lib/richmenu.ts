// Rich Menu 版型與動作 → LINE areas 計算。

export type Layout = "full-3" | "full-6" | "compact-2" | "compact-3";

export interface LayoutSpec {
  label: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  slots: number;
}

export const LAYOUTS: Record<Layout, LayoutSpec> = {
  "full-3": { label: "完整・3 格(橫排)", width: 2500, height: 1686, cols: 3, rows: 1, slots: 3 },
  "full-6": { label: "完整・6 格(2 排×3)", width: 2500, height: 1686, cols: 3, rows: 2, slots: 6 },
  "compact-2": { label: "精簡・2 格", width: 2500, height: 843, cols: 2, rows: 1, slots: 2 },
  "compact-3": { label: "精簡・3 格", width: 2500, height: 843, cols: 3, rows: 1, slots: 3 },
};

export interface Slot {
  label: string;
  accessibilityLabel?: string;
  action: "booking" | "appointments" | "query" | "events" | "tickets" | "membership" | "support" | "brand" | "progress" | "info" | "uri" | "message" | "richmenuswitch" | "none";
  value?: string; // uri=網址;message=訊息素材 id;richmenuswitch=alias id
}

export const RICH_MENU_ALIAS_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

export type RichMenuTemplateKey = "booking" | "events" | "mixed" | "custom";
export interface RichMenuModuleAvailability { booking: boolean; events: boolean; tickets: boolean; memberships: boolean; line: boolean; legacyProgress: boolean; }
export interface RichMenuEntryUrls {
  booking: string;
  appointments: string;
  events: string;
  tickets: string;
  membership: string;
  support: string;
  brand: string;
}

export const RICH_MENU_TEMPLATES: Record<Exclude<RichMenuTemplateKey, "custom">, { label: string; layout: Layout; slots: Slot[] }> = {
  booking: { label: "預約型", layout: "full-3", slots: [
    { label: "立即預約", accessibilityLabel: "開啟線上預約", action: "booking" },
    { label: "我的預約", accessibilityLabel: "查詢、取消或改期我的預約", action: "appointments" },
    { label: "品牌資訊", accessibilityLabel: "查看品牌資訊與聯絡方式", action: "brand" },
  ] },
  events: { label: "活動型", layout: "full-3", slots: [
    { label: "活動／課程", accessibilityLabel: "瀏覽活動與課程報名", action: "events" },
    { label: "我的票券", accessibilityLabel: "查看我的報名與票券 QR", action: "tickets" },
    { label: "品牌資訊", accessibilityLabel: "查看品牌資訊與聯絡方式", action: "brand" },
  ] },
  mixed: { label: "綜合型", layout: "full-6", slots: [
    { label: "立即預約", accessibilityLabel: "開啟線上預約", action: "booking" },
    { label: "我的預約", accessibilityLabel: "查詢、取消或改期我的預約", action: "appointments" },
    { label: "活動／課程", accessibilityLabel: "瀏覽活動與課程報名", action: "events" },
    { label: "我的票券", accessibilityLabel: "查看我的報名與票券 QR", action: "tickets" },
    { label: "會員／套票", accessibilityLabel: "查看會員方案、套票與剩餘堂數", action: "membership" },
    { label: "LINE 客服", accessibilityLabel: "開啟品牌 LINE 客服", action: "support" },
  ] },
};

export function richMenuTemplate(key: Exclude<RichMenuTemplateKey, "custom">, availability: RichMenuModuleAvailability) {
  const template = RICH_MENU_TEMPLATES[key];
  const slots = template.slots.map((slot) => {
    const allowed = slot.action === "booking"
      ? availability.booking
      : slot.action === "events"
        ? availability.events
        : slot.action === "tickets"
          ? availability.tickets
        : slot.action === "membership"
          ? availability.memberships
          : slot.action === "support"
            ? availability.line
            : slot.action !== "progress" || availability.legacyProgress;
    return allowed ? { ...slot } : { label: "品牌資訊", accessibilityLabel: "查看品牌資訊與聯絡方式", action: "brand" as const };
  });
  return { ...template, slots };
}

export function validateRichMenuSlots(layout: Layout, slots: Slot[], availability: RichMenuModuleAvailability): string[] {
  const errors: string[] = [];
  const expected = LAYOUTS[layout].slots;
  if (slots.length !== expected) errors.push(`版型需要 ${expected} 個區塊`);
  slots.slice(0, expected).forEach((slot, index) => {
    const prefix = `第 ${index + 1} 格`;
    if (!slot.label?.trim()) errors.push(`${prefix}缺少顯示名稱`);
    if (!slot.accessibilityLabel?.trim()) errors.push(`${prefix}缺少無障礙標籤`);
    if ((slot.accessibilityLabel ?? "").trim().length > 20) errors.push(`${prefix}無障礙標籤不可超過 20 字`);
    if (slot.action === "none") errors.push(`${prefix}沒有有效動作`);
    if (slot.action === "booking" && !availability.booking) errors.push(`${prefix}使用了未開放的預約入口`);
    if (slot.action === "events" && !availability.events) errors.push(`${prefix}使用了未開放的活動入口`);
    if (slot.action === "tickets" && !availability.tickets) errors.push(`${prefix}使用了未啟用的票券入口`);
    if (slot.action === "membership" && !availability.memberships) errors.push(`${prefix}使用了未啟用的會員入口`);
    if (slot.action === "support" && !availability.line) errors.push(`${prefix}使用了未啟用的 LINE 客服入口`);
    if (slot.action === "progress" && !availability.legacyProgress) errors.push(`${prefix}不可使用已停用的舊版服務進度`);
    if (slot.action === "uri") {
      try {
        const url = new URL(slot.value ?? "");
        if (url.protocol !== "https:") errors.push(`${prefix}自訂連結必須使用 HTTPS`);
      } catch {
        errors.push(`${prefix}自訂連結格式不正確`);
      }
    }
    if (slot.action === "message" && !slot.value) errors.push(`${prefix}尚未選擇訊息素材`);
    if (slot.action === "richmenuswitch" && !RICH_MENU_ALIAS_ID_PATTERN.test(slot.value ?? "")) errors.push(`${prefix}尚未選擇有效的 Rich Menu Alias`);
  });
  return errors;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 依版型算出每一格的方框(填滿整張圖,末格補齊餘數)。 */
export function slotBounds(layout: Layout): Bounds[] {
  const spec = LAYOUTS[layout];
  const cellW = Math.floor(spec.width / spec.cols);
  const cellH = Math.floor(spec.height / spec.rows);
  const out: Bounds[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const isLastCol = c === spec.cols - 1;
      const isLastRow = r === spec.rows - 1;
      out.push({
        x: c * cellW,
        y: r * cellH,
        width: isLastCol ? spec.width - c * cellW : cellW,
        height: isLastRow ? spec.height - r * cellH : cellH,
      });
    }
  }
  return out;
}

/** 把一格的動作轉成 LINE action 物件。label 空白則省略(LINE 不接受空字串 label)。 */
export function slotAction(
  slot: Slot,
  urls: RichMenuEntryUrls,
  tracking?: { versionId: string; slotIndex: number },
): Record<string, unknown> | null {
  const lbl = (slot.accessibilityLabel ?? slot.label ?? "").trim();
  const withLabel = (a: Record<string, unknown>) => (lbl ? { ...a, label: lbl } : a);
  const trackedUri = (value: string): string => {
    if (!tracking) return value;
    const url = new URL(value);
    url.searchParams.set("utm_source", "richmenu");
    url.searchParams.set("rm_version", tracking.versionId);
    url.searchParams.set("rm_slot", String(tracking.slotIndex + 1));
    return url.toString();
  };
  // 內建動作改用 postback:點了由 webhook 直接回覆,不需另設關鍵字規則
  switch (slot.action) {
    case "booking":
      return withLabel({ type: "uri", uri: trackedUri(urls.booking) });
    case "appointments":
    case "query":
      return withLabel({ type: "uri", uri: trackedUri(urls.appointments) });
    case "events":
      return withLabel({ type: "uri", uri: trackedUri(urls.events) });
    case "tickets":
      return withLabel({ type: "uri", uri: trackedUri(urls.tickets) });
    case "membership":
      return withLabel({ type: "uri", uri: trackedUri(urls.membership) });
    case "support":
      return withLabel({ type: "uri", uri: trackedUri(urls.support) });
    case "progress":
      return withLabel({ type: "postback", data: "action=progress", displayText: "服務進度" });
    case "brand":
    case "info":
      return withLabel({ type: "uri", uri: trackedUri(urls.brand) });
    case "uri":
      return slot.value ? withLabel({ type: "uri", uri: trackedUri(slot.value) }) : null;
    case "message":
      // 值 = 訊息素材 id;點了直接回覆該訊息
      return slot.value ? withLabel({ type: "postback", data: `action=msg&id=${slot.value}` }) : null;
    case "richmenuswitch":
      return slot.value ? withLabel({
        type: "richmenuswitch",
        richMenuAliasId: slot.value,
        data: `action=richmenu_switch&alias=${encodeURIComponent(slot.value)}`,
      }) : null;
    default:
      return null;
  }
}

export const ACTION_OPTIONS: { value: Slot["action"]; label: string }[] = [
  { value: "booking", label: "立即預約" },
  { value: "appointments", label: "我的預約" },
  { value: "events", label: "活動／課程" },
  { value: "tickets", label: "我的票券" },
  { value: "membership", label: "會員／套票" },
  { value: "support", label: "LINE 客服" },
  { value: "brand", label: "品牌資訊" },
  { value: "progress", label: "服務進度（舊版）" },
  { value: "uri", label: "自訂連結" },
  { value: "message", label: "回覆訊息素材" },
  { value: "richmenuswitch", label: "切換 Rich Menu 頁籤" },
  { value: "none", label: "(不設定)" },
];
