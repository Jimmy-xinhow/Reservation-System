export const LINE_FLEX_TEMPLATE_KEYS = [
  "welcome",
  "service_hub",
  "brand_story",
  "booking_service_select",
  "booking_date_select",
  "booking_confirmed",
  "payment_pending",
  "appointment_reminder",
  "appointment_changed",
  "waitlist_joined",
  "waitlist_offer",
  "quick_rebook",
  "registration_confirmed",
  "event_feature",
  "ticket_ready",
  "membership_balance",
  "account_link",
  "campaign",
  "support_handoff",
  "support_active",
  "staff_today",
] as const;

export type LineFlexTemplateKey = (typeof LINE_FLEX_TEMPLATE_KEYS)[number];

export const LINE_FLEX_STYLE_KEYS = [
  "signature",
  "editorial",
  "concierge",
  "action_grid",
  "soft_panel",
  "poster",
  "minimal",
  "ticket",
  "timeline",
  "member_pass",
  "split_panel",
  "framed_note",
  "spotlight",
  "magazine_strip",
  "bold_notice",
  "compact_list",
  "dark_luxe",
  "seasonal_card",
] as const;

export type LineFlexStyleKey = (typeof LINE_FLEX_STYLE_KEYS)[number];

export const LINE_FLEX_STYLE_GROUPS = [
  { key: "brand", label: "品牌形象", description: "照片、故事與品牌第一印象" },
  { key: "service", label: "服務導覽", description: "清楚帶顧客完成下一步" },
  { key: "refined", label: "專業質感", description: "留白、秩序與高信任感" },
  { key: "status", label: "狀態功能", description: "金額、票券、進度與會員資訊" },
] as const;

export type LineFlexStyleGroup = (typeof LINE_FLEX_STYLE_GROUPS)[number]["key"];

export interface LineFlexStylePreset {
  key: LineFlexStyleKey;
  name: string;
  description: string;
  swatch: [string, string];
  imageFirst: boolean;
  group: LineFlexStyleGroup;
  structure: string;
}

export const LINE_FLEX_STYLE_PRESETS: LineFlexStylePreset[] = [
  { key: "editorial", name: "封面編輯誌", description: "大圖先行，標題像雜誌封面壓在影像下緣。", swatch: ["#2E2622", "#C69A78"], imageFirst: true, group: "brand", structure: "滿版影像＋覆疊標題" },
  { key: "poster", name: "主題海報", description: "以活動主視覺為主角，文字收斂成一個焦點。", swatch: ["#26352F", "#E5B65E"], imageFirst: true, group: "brand", structure: "直幅主視覺＋底部行動" },
  { key: "split_panel", name: "左右分鏡", description: "色塊與文字左右切開，畫面有明確閱讀方向。", swatch: ["#284B43", "#E7D9C8"], imageFirst: false, group: "brand", structure: "左側識別＋右側內容" },
  { key: "magazine_strip", name: "雜誌色帶", description: "窄版色帶搭配大標，適合新品與品牌公告。", swatch: ["#8B3E2F", "#F1E7D4"], imageFirst: false, group: "brand", structure: "側邊標籤＋不對稱標題" },
  { key: "seasonal_card", name: "季節主題卡", description: "柔和弧角與浮動標籤，適合節慶與期間企劃。", swatch: ["#6E7560", "#E9D9C3"], imageFirst: true, group: "brand", structure: "圓角影像＋浮動標籤" },

  { key: "signature", name: "品牌標幟", description: "品牌色表頭、重點摘要與清楚的主要行動。", swatch: ["#173F35", "#D9B86C"], imageFirst: false, group: "service", structure: "識別表頭＋重點摘要" },
  { key: "action_grid", name: "快捷三格", description: "三個動作同層排列，適合常用服務入口。", swatch: ["#173F48", "#73B7A6"], imageFirst: false, group: "service", structure: "標題區＋三欄操作" },
  { key: "compact_list", name: "緊湊清單", description: "減少裝飾與高度，快速掃讀多筆服務資訊。", swatch: ["#334842", "#DDE7E2"], imageFirst: false, group: "service", structure: "窄表頭＋密集資訊列" },
  { key: "soft_panel", name: "柔和導引", description: "低對比區塊逐步引導，適合照護與親子服務。", swatch: ["#614B42", "#E8D8CB"], imageFirst: false, group: "service", structure: "柔色標題＋分段內容" },

  { key: "concierge", name: "精品禮賓", description: "細線、暖白與精簡層級，呈現專業服務感。", swatch: ["#27332E", "#C8A76B"], imageFirst: false, group: "refined", structure: "金色側線＋暖白留白" },
  { key: "minimal", name: "極簡細線", description: "只保留必要文字與一道品牌線，閱讀最安靜。", swatch: ["#F7F5EF", "#31584D"], imageFirst: false, group: "refined", structure: "頂部細線＋純文字" },
  { key: "framed_note", name: "相框短箋", description: "內容置於雙層邊框內，像一張品牌邀請函。", swatch: ["#40554B", "#D7C9AE"], imageFirst: false, group: "refined", structure: "雙層框線＋置中短文" },
  { key: "spotlight", name: "中心焦點", description: "標籤、標題與動作全部置中，適合單一訴求。", swatch: ["#48645B", "#E6DCCB"], imageFirst: false, group: "refined", structure: "置中標題＋單一行動" },
  { key: "dark_luxe", name: "深色精品", description: "深底與低調金色建立高單價、夜間感的層次。", swatch: ["#181B1A", "#BDA36B"], imageFirst: false, group: "refined", structure: "深色滿版＋金色細節" },

  { key: "ticket", name: "票券憑證", description: "編號、狀態與使用入口優先，方便現場辨識。", swatch: ["#352F55", "#A998E5"], imageFirst: false, group: "status", structure: "票根切口＋憑證資訊" },
  { key: "timeline", name: "流程時間軸", description: "突出目前進度與下一步，適合付款、改期與客服。", swatch: ["#286675", "#D9EEF1"], imageFirst: false, group: "status", structure: "進度節點＋下一步" },
  { key: "member_pass", name: "會員識別卡", description: "會員身份、權益與餘額集中在一張深色卡片。", swatch: ["#24332D", "#D7BB7D"], imageFirst: false, group: "status", structure: "會員識別＋權益數字" },
  { key: "bold_notice", name: "高對比公告", description: "大型狀態字與高反差色塊，重要通知不會被略過。", swatch: ["#1D2723", "#F0C75E"], imageFirst: false, group: "status", structure: "大型狀態＋高反差行動" },
];

export interface LineFlexDesignConfig {
  templateKey: LineFlexTemplateKey;
  styleKey: LineFlexStyleKey;
  name: string;
  badge: string;
  title: string;
  body: string;
  imageUrl: string;
  accent: string;
  markerColor: string;
  showImage: boolean;
  showDetails: boolean;
  detailLabels: string[];
  primaryActionLabel: string;
  secondaryActionLabel: string;
}

export interface LineFlexDesignState {
  draft?: LineFlexDesignConfig;
  published?: LineFlexDesignConfig;
  updatedAt?: string;
  publishedAt?: string;
  version?: number;
}

export type LineFlexDesignSettings = Partial<Record<LineFlexTemplateKey, LineFlexDesignState>>;

export interface LineFlexWelcomePreset {
  key: string;
  name: string;
  description: string;
  design: Pick<LineFlexDesignConfig, "badge" | "title" | "body">;
}

export const LINE_FLEX_WELCOME_PRESETS: LineFlexWelcomePreset[] = [
  {
    key: "welcome-signature",
    name: "品牌迎賓",
    description: "清楚交代品牌、會員與立即預約三個入口。",
    design: { badge: "歡迎加入", title: "很高興在 LINE 與你見面", body: "認識品牌、連結會員，或直接查看目前可以預約的日期。" },
  },
  {
    key: "welcome-editorial",
    name: "主理人誌",
    description: "使用一張代表品牌的照片，建立有溫度的第一印象。",
    design: { badge: "主理人歡迎你", title: "從今天開始，讓每一次安排更靠近你", body: "先看看我們重視的事，再選擇適合你的服務與時間。" },
  },
  {
    key: "welcome-concierge",
    name: "精品禮賓",
    description: "低彩度與精簡文字，適合顧問、保養與預約制品牌。",
    design: { badge: "專屬服務", title: "需要安排什麼，我們從這裡開始", body: "可直接預約、綁定既有會員，或先認識品牌服務。" },
  },
  {
    key: "welcome-actions",
    name: "三步直達",
    description: "把常用功能提前，適合回訪頻率高的品牌。",
    design: { badge: "快速入口", title: "今天想先完成哪一件事？", body: "三個入口都留在 LINE 對話內，不需要先找網站選單。" },
  },
  {
    key: "welcome-poster",
    name: "本月主題",
    description: "歡迎訊息同時承接品牌活動或主打服務。",
    design: { badge: "本月推薦", title: "本月新朋友體驗，從這裡開始", body: "查看主打內容，也可以直接選擇日期完成預約。" },
  },
  {
    key: "welcome-minimal",
    name: "純粹留白",
    description: "以精準文字與品牌色建立安靜、可信任的第一印象。",
    design: { badge: "WELCOME", title: "歡迎，這裡是你的品牌服務入口", body: "會員、預約與品牌資訊都會集中在這段 LINE 對話。" },
  },
  {
    key: "welcome-course",
    name: "課程學習",
    description: "適合補教、顧問與線上學習品牌。",
    design: { badge: "開始學習", title: "把下一步學習，安排在最適合你的時間", body: "查看近期課程、完成會員連結，或直接選擇可以參加的場次。" },
  },
  {
    key: "welcome-beauty",
    name: "美業諮詢",
    description: "先建立安心感，再引導顧客預約。",
    design: { badge: "專屬諮詢", title: "先了解你的需要，再安排剛好的服務", body: "可以先認識服務方式、連結會員資料，或直接選擇預約時間。" },
  },
  {
    key: "welcome-member",
    name: "熟客回訪",
    description: "讓既有會員快速回到常用功能。",
    design: { badge: "歡迎回來", title: "你的預約、票券與會員權益都在這裡", body: "連結既有會員後，即可快速查看紀錄、使用套票與再次預約。" },
  },
  {
    key: "welcome-event",
    name: "活動主打",
    description: "適合展演、講座與期間限定活動。",
    design: { badge: "近期活動", title: "從一場值得期待的體驗開始", body: "查看目前開放場次與名額，也可以先完成會員連結，保存報名紀錄。" },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function limitedText(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function safeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : fallback;
}

function safeImageUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidate = value.trim().slice(0, 1000);
  if (!candidate) return "";
  if (candidate.startsWith("/")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? candidate : "";
  } catch {
    return "";
  }
}

export function isLineFlexTemplateKey(value: unknown): value is LineFlexTemplateKey {
  return typeof value === "string" && (LINE_FLEX_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function isLineFlexStyleKey(value: unknown): value is LineFlexStyleKey {
  return typeof value === "string" && (LINE_FLEX_STYLE_KEYS as readonly string[]).includes(value);
}

function safeFallback(templateKey: LineFlexTemplateKey): LineFlexDesignConfig {
  return {
    templateKey,
    styleKey: "signature",
    name: "品牌 Flex",
    badge: "品牌通知",
    title: "最新消息",
    body: "請查看這則訊息的內容與下一步。",
    imageUrl: "",
    accent: "#31584D",
    markerColor: "#D8B26A",
    showImage: false,
    showDetails: true,
    detailLabels: [],
    primaryActionLabel: "查看內容",
    secondaryActionLabel: "",
  };
}

export function sanitizeLineFlexDesign(value: unknown, fallback: LineFlexDesignConfig): LineFlexDesignConfig {
  const input = isRecord(value) ? value : {};
  const labels = Array.isArray(input.detailLabels)
    ? input.detailLabels.map((item) => limitedText(item, "", 30)).filter(Boolean).slice(0, 6)
    : fallback.detailLabels;
  return {
    templateKey: isLineFlexTemplateKey(input.templateKey) ? input.templateKey : fallback.templateKey,
    styleKey: isLineFlexStyleKey(input.styleKey) ? input.styleKey : fallback.styleKey,
    name: limitedText(input.name, fallback.name, 60),
    badge: limitedText(input.badge, fallback.badge, 30),
    title: limitedText(input.title, fallback.title, 100),
    body: limitedText(input.body, fallback.body, 300),
    imageUrl: safeImageUrl(input.imageUrl),
    accent: safeHex(input.accent, fallback.accent),
    markerColor: safeHex(input.markerColor, fallback.markerColor),
    showImage: input.showImage === true,
    showDetails: input.showDetails !== false,
    detailLabels: labels,
    primaryActionLabel: limitedText(input.primaryActionLabel, fallback.primaryActionLabel, 40),
    secondaryActionLabel: limitedText(input.secondaryActionLabel, fallback.secondaryActionLabel, 40),
  };
}

export function parseLineFlexDesignSettings(value: unknown): LineFlexDesignSettings {
  if (!isRecord(value)) return {};
  const result: LineFlexDesignSettings = {};
  for (const templateKey of LINE_FLEX_TEMPLATE_KEYS) {
    const rawState = value[templateKey];
    if (!isRecord(rawState)) continue;
    const state: LineFlexDesignState = {};
    if (typeof rawState.updatedAt === "string") state.updatedAt = rawState.updatedAt;
    if (typeof rawState.publishedAt === "string") state.publishedAt = rawState.publishedAt;
    if (typeof rawState.version === "number" && Number.isInteger(rawState.version) && rawState.version > 0) state.version = rawState.version;
    if (isRecord(rawState.draft) && rawState.draft.templateKey === templateKey) state.draft = sanitizeLineFlexDesign(rawState.draft, safeFallback(templateKey));
    if (isRecord(rawState.published) && rawState.published.templateKey === templateKey) state.published = sanitizeLineFlexDesign(rawState.published, safeFallback(templateKey));
    result[templateKey] = state;
  }
  return result;
}

export function publishedLineFlexDesign(settings: unknown, templateKey: LineFlexTemplateKey): LineFlexDesignConfig | undefined {
  const state = parseLineFlexDesignSettings(settings)[templateKey];
  return state?.published;
}

export function lineFlexDesignForDelivery(settings: unknown, templateKey: LineFlexTemplateKey, baseUrl: string): LineFlexDesignConfig | undefined {
  const design = publishedLineFlexDesign(settings, templateKey);
  if (!design || !design.imageUrl.startsWith("/")) return design;
  try {
    return { ...design, imageUrl: new URL(design.imageUrl, baseUrl).toString() };
  } catch {
    return { ...design, imageUrl: "", showImage: false };
  }
}
