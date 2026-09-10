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
] as const;

export type LineFlexStyleKey = (typeof LINE_FLEX_STYLE_KEYS)[number];

export interface LineFlexStylePreset {
  key: LineFlexStyleKey;
  name: string;
  description: string;
  swatch: [string, string];
  imageFirst: boolean;
}

export const LINE_FLEX_STYLE_PRESETS: LineFlexStylePreset[] = [
  { key: "signature", name: "品牌識別", description: "品牌色表頭與清楚資訊層級，適合多數狀態通知。", swatch: ["#173F35", "#D9B86C"], imageFirst: false },
  { key: "editorial", name: "形象編輯誌", description: "主視覺先行、短文收斂，適合歡迎、品牌與活動。", swatch: ["#2E2622", "#C69A78"], imageFirst: true },
  { key: "concierge", name: "精品禮賓", description: "留白、細線與低彩度，適合專業服務與高單價品牌。", swatch: ["#27332E", "#C8A76B"], imageFirst: false },
  { key: "action_grid", name: "快速行動", description: "把主要選項放在第一視線，適合加入好友與服務入口。", swatch: ["#173F48", "#73B7A6"], imageFirst: false },
  { key: "soft_panel", name: "柔和導引", description: "溫暖底色與柔和區塊，適合照護、美業與親子服務。", swatch: ["#614B42", "#E8D8CB"], imageFirst: false },
  { key: "poster", name: "主視覺海報", description: "滿版圖片與覆疊標題，適合課程、講座及期間活動。", swatch: ["#26352F", "#E5B65E"], imageFirst: true },
  { key: "minimal", name: "極簡公告", description: "不使用大色塊，以文字與細節建立清楚閱讀節奏。", swatch: ["#F7F5EF", "#31584D"], imageFirst: false },
  { key: "ticket", name: "票券憑證", description: "編號、狀態與使用入口優先，適合報名及電子票券。", swatch: ["#352F55", "#A998E5"], imageFirst: false },
  { key: "timeline", name: "進度時間軸", description: "突出現在位置與下一步，適合提醒、改期、付款及客服。", swatch: ["#286675", "#D9EEF1"], imageFirst: false },
  { key: "member_pass", name: "會員卡", description: "會員識別、權益與餘額集中呈現，適合會員與套票。", swatch: ["#24332D", "#D7BB7D"], imageFirst: false },
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
  design: Partial<LineFlexDesignConfig> & Pick<LineFlexDesignConfig, "styleKey">;
}

export const LINE_FLEX_WELCOME_PRESETS: LineFlexWelcomePreset[] = [
  {
    key: "welcome-signature",
    name: "品牌迎賓",
    description: "清楚交代品牌、會員與立即預約三個入口。",
    design: { styleKey: "signature", badge: "歡迎加入", title: "很高興在 LINE 與你見面", body: "認識品牌、連結會員，或直接查看目前可以預約的日期。", showImage: false },
  },
  {
    key: "welcome-editorial",
    name: "主理人誌",
    description: "使用一張代表品牌的照片，建立有溫度的第一印象。",
    design: { styleKey: "editorial", badge: "WELCOME", title: "從今天開始，讓每一次安排更靠近你", body: "先看看我們重視的事，再選擇適合你的服務與時間。", imageUrl: "/showcase/forme-pilates-detail-v2.webp", showImage: true },
  },
  {
    key: "welcome-concierge",
    name: "精品禮賓",
    description: "低彩度與精簡文字，適合顧問、保養與預約制品牌。",
    design: { styleKey: "concierge", badge: "專屬服務", title: "需要安排什麼，我們從這裡開始", body: "可直接預約、綁定既有會員，或先認識品牌服務。", showImage: false },
  },
  {
    key: "welcome-actions",
    name: "三步直達",
    description: "把常用功能提前，適合回訪頻率高的品牌。",
    design: { styleKey: "action_grid", badge: "快速入口", title: "今天想先完成哪一件事？", body: "三個入口都留在 LINE 對話內，不需要先找網站選單。", showImage: false },
  },
  {
    key: "welcome-poster",
    name: "本月主題",
    description: "歡迎訊息同時承接品牌活動或主打服務。",
    design: { styleKey: "poster", badge: "THIS MONTH", title: "本月新朋友體驗，從這裡開始", body: "查看主打內容，也可以直接選擇日期完成預約。", imageUrl: "/showcase/openroom-course-hero-v2.webp", showImage: true },
  },
  {
    key: "welcome-minimal",
    name: "純粹留白",
    description: "以精準文字與品牌色建立安靜、可信任的第一印象。",
    design: { styleKey: "minimal", badge: "WELCOME", title: "歡迎，這裡是你的品牌服務入口", body: "會員、預約與品牌資訊都會集中在這段 LINE 對話。", showImage: false },
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
