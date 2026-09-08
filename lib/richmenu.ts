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
  icon?: RichMenuIconKey;
  action: "booking" | "appointments" | "query" | "events" | "tickets" | "membership" | "support" | "brand" | "progress" | "info" | "uri" | "message" | "richmenuswitch" | "none";
  value?: string; // uri=網址;message=訊息素材 id;richmenuswitch=alias id
}

export const RICH_MENU_ICON_KEYS = [
  "calendar", "clock", "book", "ticket", "heart", "chat",
  "profile", "sparkles", "bag", "gift", "location", "info",
] as const;
export type RichMenuIconKey = typeof RICH_MENU_ICON_KEYS[number];
export const RICH_MENU_ICON_OPTIONS: ReadonlyArray<{ value: RichMenuIconKey; label: string }> = [
  { value: "calendar", label: "行事曆" },
  { value: "clock", label: "時間／紀錄" },
  { value: "book", label: "課程／內容" },
  { value: "ticket", label: "票券" },
  { value: "heart", label: "會員／收藏" },
  { value: "chat", label: "客服／對話" },
  { value: "profile", label: "品牌／人物" },
  { value: "sparkles", label: "美容／精選" },
  { value: "bag", label: "商品／購物" },
  { value: "gift", label: "優惠／贈禮" },
  { value: "location", label: "門市／地點" },
  { value: "info", label: "資訊" },
];

export function isRichMenuIconKey(value: string): value is RichMenuIconKey {
  return (RICH_MENU_ICON_KEYS as readonly string[]).includes(value);
}

export function richMenuIconForAction(action: Slot["action"]): RichMenuIconKey {
  switch (action) {
    case "booking": return "calendar";
    case "appointments":
    case "query": return "clock";
    case "events": return "book";
    case "tickets": return "ticket";
    case "membership": return "heart";
    case "support": return "chat";
    case "brand":
    case "info": return "profile";
    default: return "info";
  }
}

export const RICH_MENU_ALIAS_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

export const RICH_MENU_TEMPLATE_KEYS = [
  "booking", "events", "mixed", "clay-atelier", "course-paper", "event-cobalt",
  "member-oxblood", "retail-monochrome", "mineral-wellness", "family-coral",
  "swiss-editorial", "seasonal-burgundy",
] as const;
export type BuiltInRichMenuTemplateKey = typeof RICH_MENU_TEMPLATE_KEYS[number];
export type RichMenuTemplateKey = BuiltInRichMenuTemplateKey | "custom";
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

interface RichMenuTemplateDefinition {
  label: string;
  category: string;
  description: string;
  layout: Layout;
  artwork: string;
  ink: string;
  panel: string;
  accent: string;
  slots: Slot[];
}

const bookingSlots: Slot[] = [
  { label: "立即預約", accessibilityLabel: "開啟線上預約", icon: "sparkles", action: "booking" },
  { label: "我的預約", accessibilityLabel: "查詢取消或改期預約", icon: "clock", action: "appointments" },
  { label: "服務方案", accessibilityLabel: "查看品牌服務與方案", icon: "profile", action: "brand" },
  { label: "活動課程", accessibilityLabel: "瀏覽活動與課程報名", icon: "calendar", action: "events" },
  { label: "會員套票", accessibilityLabel: "查看會員套票與堂數", icon: "heart", action: "membership" },
  { label: "聯絡我們", accessibilityLabel: "開啟品牌客服", icon: "chat", action: "support" },
];
const eventSlots: Slot[] = [
  { label: "最新課程", accessibilityLabel: "瀏覽活動與課程報名", icon: "book", action: "events" },
  { label: "我的票券", accessibilityLabel: "查看報名與票券", icon: "ticket", action: "tickets" },
  { label: "預約諮詢", accessibilityLabel: "開啟預約諮詢", icon: "calendar", action: "booking" },
  { label: "學習紀錄", accessibilityLabel: "查看會員與學習權益", icon: "clock", action: "membership" },
  { label: "品牌介紹", accessibilityLabel: "查看品牌資訊", icon: "profile", action: "brand" },
  { label: "課程客服", accessibilityLabel: "開啟品牌客服", icon: "chat", action: "support" },
];
const mixedSlots: Slot[] = [
  { label: "立即預約", accessibilityLabel: "開啟線上預約", icon: "calendar", action: "booking" },
  { label: "我的預約", accessibilityLabel: "查詢取消或改期預約", icon: "clock", action: "appointments" },
  { label: "課程報名", accessibilityLabel: "瀏覽活動與課程報名", icon: "book", action: "events" },
  { label: "我的票券", accessibilityLabel: "查看報名與票券", icon: "ticket", action: "tickets" },
  { label: "會員套票", accessibilityLabel: "查看會員套票與堂數", icon: "heart", action: "membership" },
  { label: "LINE 客服", accessibilityLabel: "開啟品牌客服", icon: "chat", action: "support" },
];

export const RICH_MENU_TEMPLATES: Record<BuiltInRichMenuTemplateKey, RichMenuTemplateDefinition> = {
  booking: { label: "瓷白鼠尾草", category: "美業／保養", description: "柔霧瓷白、鼠尾草綠與香檳金，適合美容、護膚與髮藝。", layout: "full-6", artwork: "/richmenu/themes/porcelain-sage-editorial.webp", ink: "#24342f", panel: "#f9f6ef", accent: "#9c7a43", slots: bookingSlots },
  events: { label: "靛藍學院", category: "課程／知識", description: "沉穩靛藍與紙白層次，適合線上課程、補教與顧問。", layout: "full-6", artwork: "/richmenu/themes/indigo-academy-editorial.webp", ink: "#f7f3ea", panel: "#172848", accent: "#d6a94f", slots: eventSlots },
  mixed: { label: "深林黃銅", category: "運動／身心", description: "深綠與黃銅質感，適合皮拉提斯、瑜珈與精品健身。", layout: "full-6", artwork: "/richmenu/themes/forest-brass-editorial.webp", ink: "#f8f2e4", panel: "#14352d", accent: "#caa84a", slots: mixedSlots },
  "clay-atelier": { label: "陶土工作室", category: "手作／沙龍", description: "陶土、亞麻與暖灰，適合手作課、攝影與生活風格品牌。", layout: "full-6", artwork: "/richmenu/themes/clay-linen-editorial.webp", ink: "#382c27", panel: "#eee2d5", accent: "#a45e42", slots: bookingSlots },
  "course-paper": { label: "編輯紙本", category: "教育／出版", description: "米色紙感與墨黑排版，適合講座、閱讀與專業培訓。", layout: "full-6", artwork: "/richmenu/themes/parchment-course-editorial.webp", ink: "#22211e", panel: "#f0e7d5", accent: "#b03b31", slots: eventSlots },
  "event-cobalt": { label: "鈷藍節慶", category: "展演／活動", description: "鮮明鈷藍與柑橘色，適合展演、快閃與大型活動。", layout: "full-6", artwork: "/richmenu/themes/festival-cobalt-editorial.webp", ink: "#ffffff", panel: "#174cad", accent: "#ff8a33", slots: eventSlots },
  "member-oxblood": { label: "勃根地會員", category: "會員／會所", description: "酒紅、奶油與金屬細節，適合高端會員與俱樂部。", layout: "full-6", artwork: "/richmenu/themes/membership-oxblood-editorial.webp", ink: "#f7eee3", panel: "#5c1f2d", accent: "#c3a264", slots: mixedSlots },
  "retail-monochrome": { label: "黑白選品", category: "零售／選物", description: "高對比黑白與俐落網格，適合選物、服飾與商品販售。", layout: "full-6", artwork: "/richmenu/themes/retail-monochrome-editorial.webp", ink: "#f7f7f5", panel: "#202020", accent: "#b5b5ad", slots: bookingSlots },
  "mineral-wellness": { label: "礦物療癒", category: "健康／療癒", description: "石灰灰、礦物藍與安靜留白，適合身心療癒與健康服務。", layout: "full-6", artwork: "/richmenu/themes/mineral-wellness-editorial.webp", ink: "#23323a", panel: "#dce2df", accent: "#6e8f91", slots: mixedSlots },
  "family-coral": { label: "珊瑚親子", category: "親子／社群", description: "溫暖珊瑚與奶油黃，適合親子、社群與家庭服務。", layout: "full-6", artwork: "/richmenu/themes/family-coral-editorial.webp", ink: "#3b2b2b", panel: "#fff1df", accent: "#e96e5d", slots: mixedSlots },
  "swiss-editorial": { label: "瑞士編輯", category: "商務／顧問", description: "理性灰白、精準紅點與編輯格線，適合 B2B 與專業服務。", layout: "full-6", artwork: "/richmenu/themes/swiss-monochrome-editorial.webp", ink: "#181818", panel: "#f1f0eb", accent: "#d64636", slots: bookingSlots },
  "seasonal-burgundy": { label: "節慶酒紅", category: "節慶／限定", description: "深酒紅與柔金光澤，適合週年、年節與檔期限定選單。", layout: "full-6", artwork: "/richmenu/themes/seasonal-burgundy-editorial.webp", ink: "#fff6e7", panel: "#652b38", accent: "#d6b66f", slots: mixedSlots },
};

export function isBuiltInRichMenuTemplate(value: string): value is BuiltInRichMenuTemplateKey {
  return (RICH_MENU_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function richMenuTemplateLabel(key: RichMenuTemplateKey): string {
  return key === "custom" ? "自訂" : RICH_MENU_TEMPLATES[key].label;
}

export function richMenuTemplate(key: BuiltInRichMenuTemplateKey, availability: RichMenuModuleAvailability) {
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
    return allowed ? { ...slot } : { label: "品牌資訊", accessibilityLabel: "查看品牌資訊與聯絡方式", icon: "profile" as const, action: "brand" as const };
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
    if (slot.icon && !isRichMenuIconKey(slot.icon)) errors.push(`${prefix}圖示不正確`);
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
