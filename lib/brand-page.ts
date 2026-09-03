import type { ShowcaseSlug } from "@/lib/showcase-templates";

export const BRAND_PAGE_TEMPLATE_KEYS = [
  "beauty",
  "wellness",
  "fitness",
  "education",
  "consulting",
  "pet-care",
  "venue",
  "event",
] as const satisfies readonly ShowcaseSlug[];

export type BrandPageTemplate = (typeof BRAND_PAGE_TEMPLATE_KEYS)[number];

export interface BrandPageContent {
  primary_entry: "auto" | "booking" | "registration";
  hero_eyebrow: string;
  hero_title: string;
  hero_highlight: string;
  hero_description: string;
  primary_cta_label: string;
  secondary_cta_label: string;
  section_title: string;
  section_description: string;
  about_title: string;
  about_description: string;
  trust_point_1: string;
  trust_point_2: string;
  trust_point_3: string;
  faq_1_question: string;
  faq_1_answer: string;
  faq_2_question: string;
  faq_2_answer: string;
  hero_image_url: string;
  detail_image_url: string;
  gallery_image_url: string;
}

export interface BrandPageService {
  id: string;
  name: string;
  description: string | null;
}

export interface BrandPageEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  registrationCloseAt: string | null;
  nextSessionName: string | null;
  nextSessionAt: string | null;
  nextSessionCapacity: number | null;
}

export interface BrandPageLinks {
  booking: string | null;
  registration: string | null;
  membership: string | null;
  records: string;
  learning: string | null;
  line: string | null;
  phone: string | null;
  primary: string;
  secondary: string | null;
}

export interface PublicBrandPageData {
  template: BrandPageTemplate;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
  content: BrandPageContent;
  services: BrandPageService[];
  events: BrandPageEvent[];
  links: BrandPageLinks;
}

export const DEFAULT_BRAND_PAGE_CONTENT: Record<BrandPageTemplate, BrandPageContent> = {
  beauty: {
    primary_entry: "booking",
    hero_eyebrow: "BY APPOINTMENT · TAIPEI",
    hero_title: "為你的日常，",
    hero_highlight: "留下剛好的風格。",
    hero_description: "從剪裁、色彩到日常整理，讓每一次服務都從真正理解你開始。",
    primary_cta_label: "查看服務與時段",
    secondary_cta_label: "認識我們",
    section_title: "不是選一個品項，而是找到適合你的輪廓。",
    section_description: "選擇服務後，即可查看真實可預約時段與服務內容。",
    about_title: "從第一次諮詢開始，留下真正適合你的照護節奏。",
    about_description: "把需求、服務內容、時間與後續照護說清楚，讓每一次預約都能安心開始。",
    trust_point_1: "專業服務人員",
    trust_point_2: "即時可約時段",
    trust_point_3: "預約紀錄可查",
    faq_1_question: "第一次預約要準備什麼？",
    faq_1_answer: "選擇服務後填寫基本需求即可；品牌可依服務加上膚況、偏好或注意事項。",
    faq_2_question: "預約後可以改期或取消嗎？",
    faq_2_answer: "可以，請從我的紀錄依品牌設定的期限完成改期或取消。",
    hero_image_url: "/showcase/beauty-hero.jpg",
    detail_image_url: "/showcase/beauty-detail.jpg",
    gallery_image_url: "/showcase/beauty-hero.jpg",
  },
  wellness: {
    primary_entry: "booking",
    hero_eyebrow: "INTEGRATED CARE · TAIPEI",
    hero_title: "把身體的訊號，",
    hero_highlight: "重新連成完整故事。",
    hero_description: "保留理解你的時間，從專業評估到日常計畫，每一步都知道現在為什麼做。",
    primary_cta_label: "開始初次評估",
    secondary_cta_label: "了解照護方式",
    section_title: "每一步，都有清楚的下一步。",
    section_description: "選擇適合的服務，再依你的時間完成預約。",
    about_title: "理解需求，再安排合適的服務與下一步。",
    about_description: "從初次評估、服務安排到後續追蹤，都能在同一個品牌入口查詢。",
    trust_point_1: "清楚服務說明",
    trust_point_2: "安全保存資料",
    trust_point_3: "後續紀錄可查",
    faq_1_question: "如何選擇適合的服務？",
    faq_1_answer: "先閱讀服務說明；不確定時可透過品牌聯絡方式確認後再預約。",
    faq_2_question: "資料會提供給其他品牌嗎？",
    faq_2_answer: "不會，顧客與預約資料只會保留在目前品牌的授權範圍內。",
    hero_image_url: "/showcase/wellness-hero.jpg",
    detail_image_url: "/showcase/wellness-detail.jpg",
    gallery_image_url: "/showcase/wellness-hero.jpg",
  },
  fitness: {
    primary_entry: "auto",
    hero_eyebrow: "COACH LED · YOUR PACE",
    hero_title: "MOVE PAST",
    hero_highlight: "AVERAGE.",
    hero_description: "教練掌握節奏，你掌握強度。選擇課程後，直接查看可預約時段。",
    primary_cta_label: "預約第一堂課",
    secondary_cta_label: "查看訓練內容",
    section_title: "一半心肺。一半力量。全部由你決定。",
    section_description: "第一次來也能清楚跟上，不需要先成為厲害的人。",
    about_title: "私人課與團體課，都從適合你的節奏開始。",
    about_description: "私人課可直接查看教練時段，團體課則依場次、名額與票種完成報名。",
    trust_point_1: "私人課線上預約",
    trust_point_2: "團體課即時名額",
    trust_point_3: "套票與紀錄整合",
    faq_1_question: "第一次上課適合哪一種？",
    faq_1_answer: "希望獲得個別評估可選私人課；想體驗固定主題與同儕練習可選團體課。",
    faq_2_question: "課程額滿後怎麼辦？",
    faq_2_answer: "開放候補的場次可依序登記；有名額釋出時，系統會依設定通知。",
    hero_image_url: "/showcase/fitness-hero.jpg",
    detail_image_url: "/showcase/fitness-detail.jpg",
    gallery_image_url: "/showcase/fitness-hero.jpg",
  },
  education: {
    primary_entry: "registration",
    hero_eyebrow: "LEARNING, WIDE OPEN.",
    hero_title: "好奇心沒有",
    hero_highlight: "標準答案。",
    hero_description: "讓課程不只是填滿時間，而是讓興趣有地方繼續長大。",
    primary_cta_label: "探索課程",
    secondary_cta_label: "查看近期活動",
    section_title: "這一期，可以從這裡開始。",
    section_description: "公開課程與活動會直接帶入報名系統，不必重複維護資料。",
    about_title: "從選課、報名到課後內容，學習路徑保持清楚。",
    about_description: "學員可查看課程場次、付款狀態與已開放教材，管理者則在同一套後台維護內容。",
    trust_point_1: "課程與場次同步",
    trust_point_2: "付費狀態可追蹤",
    trust_point_3: "教材依資格開放",
    faq_1_question: "報名後如何取得課程內容？",
    faq_1_answer: "符合課程開放條件後，可從我的紀錄進入學習專區查看教材與外部上課連結。",
    faq_2_question: "可以查看自己的學習進度嗎？",
    faq_2_answer: "可以，學習專區會保留每個單元的完成狀態。",
    hero_image_url: "/showcase/education-hero.jpg",
    detail_image_url: "/showcase/education-detail.jpg",
    gallery_image_url: "/showcase/education-hero.jpg",
  },
  consulting: {
    primary_entry: "booking",
    hero_eyebrow: "STRATEGY · PRACTICE · GROWTH",
    hero_title: "Make the complex",
    hero_highlight: "clear.",
    hero_description: "把複雜問題整理成可理解、可執行，也能真正進入組織的下一步。",
    primary_cta_label: "預約初次諮詢",
    secondary_cta_label: "了解合作方式",
    section_title: "不同問題，需要不同深度的合作。",
    section_description: "從公開服務中選擇合作起點，後續再由團隊確認需求與時段。",
    about_title: "先把問題定義清楚，再進入適合的合作方式。",
    about_description: "從需求表單、諮詢時段到後續紀錄，讓每一次合作都有清楚脈絡。",
    trust_point_1: "需求先行",
    trust_point_2: "專人確認",
    trust_point_3: "紀錄可追蹤",
    faq_1_question: "第一次應該預約哪一項？",
    faq_1_answer: "可先選擇初次諮詢，由團隊確認需求後再安排適合的合作內容。",
    faq_2_question: "可以改期嗎？",
    faq_2_answer: "可依品牌設定的期限，從我的紀錄完成改期或取消。",
    hero_image_url: "/showcase/consulting-hero.jpg",
    detail_image_url: "/showcase/consulting-detail.jpg",
    gallery_image_url: "/showcase/consulting-hero.jpg",
  },
  "pet-care": {
    primary_entry: "booking",
    hero_eyebrow: "CARE THAT FEELS CLOSER",
    hero_title: "好好照顧，",
    hero_highlight: "也好好對待牠的感受。",
    hero_description: "有時間聽你說，也讓毛孩慢慢適應。從少一點緊張開始，找到適合的照護。",
    primary_cta_label: "查看最近時段",
    secondary_cta_label: "了解照護服務",
    section_title: "最快可以什麼時候來？",
    section_description: "選擇服務後，預約系統會顯示仍有名額的真實時段。",
    about_title: "讓照護資訊、時間與後續安排都更清楚。",
    about_description: "先選擇服務並留下必要資訊，品牌團隊即可依預約內容準備。",
    trust_point_1: "線上查看時段",
    trust_point_2: "必要資訊先填寫",
    trust_point_3: "服務紀錄可查",
    faq_1_question: "預約時需要提供哪些資料？",
    faq_1_answer: "依服務需求填寫顧客與照護對象的必要資訊即可。",
    faq_2_question: "臨時無法前往怎麼辦？",
    faq_2_answer: "請在品牌允許的期限內從我的紀錄取消或改期。",
    hero_image_url: "/showcase/pet-hero.jpg",
    detail_image_url: "/showcase/pet-detail.jpg",
    gallery_image_url: "/showcase/pet-hero.jpg",
  },
  venue: {
    primary_entry: "booking",
    hero_eyebrow: "PRIVATE CREATIVE SPACE · TAIPEI",
    hero_title: "A space built",
    hero_highlight: "for almost anything.",
    hero_description: "讓拍攝、課程與聚會，在預約前就看懂空間、用途與下一步。",
    primary_cta_label: "查看可預約時段",
    secondary_cta_label: "瀏覽空間資訊",
    section_title: "自然光、完整設備，以及不被打擾的時間。",
    section_description: "選擇服務或用途後，即可進入既有預約流程。",
    about_title: "先看懂空間，再確認用途、設備與可用時間。",
    about_description: "公開資訊與真實預約時段同步，避免詢問後才發現空間或設備不可用。",
    trust_point_1: "即時可用時段",
    trust_point_2: "場地設備清楚",
    trust_point_3: "預約狀態可查",
    faq_1_question: "如何確認空間是否適合？",
    faq_1_answer: "可先查看用途與設備說明，再依需要透過品牌聯絡方式確認。",
    faq_2_question: "預約會保留設備嗎？",
    faq_2_answer: "服務已綁定的場地與設備會一併檢查可用容量。",
    hero_image_url: "/showcase/space-detail.jpg",
    detail_image_url: "/showcase/space-hero.jpg",
    gallery_image_url: "/showcase/space-detail.jpg",
  },
  event: {
    primary_entry: "registration",
    hero_eyebrow: "LIVE · TAIPEI",
    hero_title: "WHEN THE LIGHTS GO DOWN",
    hero_highlight: "WE OPEN EVERYTHING.",
    hero_description: "活動資訊、公開場次與票種會直接連接報名系統，避免形象頁與售票資料不同步。",
    primary_cta_label: "查看活動與票種",
    secondary_cta_label: "瀏覽節目資訊",
    section_title: "不只是一場活動，而是一個只在此刻成立的世界。",
    section_description: "選擇活動後即可查看真實場次、票價、名額與付款狀態。",
    about_title: "活動資訊、票種、付款與入場憑證保持同步。",
    about_description: "顧客從同一個入口完成報名並查看狀態，現場人員則能用 QR 或名單報到。",
    trust_point_1: "即時票種名額",
    trust_point_2: "付款狀態可追蹤",
    trust_point_3: "QR 報到",
    faq_1_question: "報名後在哪裡看票券？",
    faq_1_answer: "完成必要付款後，可從我的紀錄查看報名狀態與報到資訊。",
    faq_2_question: "活動額滿還能登記嗎？",
    faq_2_answer: "若主辦方開啟候補，可先登記並等待名額釋出通知。",
    hero_image_url: "/showcase/event-detail.jpg",
    detail_image_url: "/showcase/event-hero.jpg",
    gallery_image_url: "/showcase/event-detail.jpg",
  },
};

export function isBrandPageTemplate(value: unknown): value is BrandPageTemplate {
  return typeof value === "string" && BRAND_PAGE_TEMPLATE_KEYS.includes(value as BrandPageTemplate);
}

export function normalizeBrandPageContent(value: unknown, template: BrandPageTemplate): BrandPageContent {
  const defaults = DEFAULT_BRAND_PAGE_CONTENT[template];
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const candidate = input[key];
      return [key, typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback];
    }),
  ) as unknown as BrandPageContent;
}

export function brandPagePreferredEntry(content: BrandPageContent, template: BrandPageTemplate): "booking" | "registration" {
  if (content.primary_entry === "booking" || content.primary_entry === "registration") return content.primary_entry;
  return template === "education" || template === "event" ? "registration" : "booking";
}
