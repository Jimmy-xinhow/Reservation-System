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
  hero_eyebrow: string;
  hero_title: string;
  hero_highlight: string;
  hero_description: string;
  primary_cta_label: string;
  secondary_cta_label: string;
  section_title: string;
  section_description: string;
  hero_image_url: string;
  detail_image_url: string;
}

export interface BrandPageService {
  id: string;
  name: string;
  description: string | null;
}

export interface BrandPageEvent {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  registrationCloseAt: string | null;
}

export interface BrandPageLinks {
  booking: string | null;
  registration: string | null;
  membership: string | null;
  records: string;
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
    hero_eyebrow: "BY APPOINTMENT · TAIPEI",
    hero_title: "為你的日常，",
    hero_highlight: "留下剛好的風格。",
    hero_description: "從剪裁、色彩到日常整理，讓每一次服務都從真正理解你開始。",
    primary_cta_label: "查看服務與時段",
    secondary_cta_label: "認識我們",
    section_title: "不是選一個品項，而是找到適合你的輪廓。",
    section_description: "選擇服務後，即可查看真實可預約時段與服務內容。",
    hero_image_url: "/showcase/beauty-hero.jpg",
    detail_image_url: "/showcase/beauty-detail.jpg",
  },
  wellness: {
    hero_eyebrow: "INTEGRATED CARE · TAIPEI",
    hero_title: "把身體的訊號，",
    hero_highlight: "重新連成完整故事。",
    hero_description: "保留理解你的時間，從專業評估到日常計畫，每一步都知道現在為什麼做。",
    primary_cta_label: "開始初次評估",
    secondary_cta_label: "了解照護方式",
    section_title: "每一步，都有清楚的下一步。",
    section_description: "選擇適合的服務，再依你的時間完成預約。",
    hero_image_url: "/showcase/wellness-hero.jpg",
    detail_image_url: "/showcase/wellness-detail.jpg",
  },
  fitness: {
    hero_eyebrow: "COACH LED · YOUR PACE",
    hero_title: "MOVE PAST",
    hero_highlight: "AVERAGE.",
    hero_description: "教練掌握節奏，你掌握強度。選擇課程後，直接查看可預約時段。",
    primary_cta_label: "預約第一堂課",
    secondary_cta_label: "查看訓練內容",
    section_title: "一半心肺。一半力量。全部由你決定。",
    section_description: "第一次來也能清楚跟上，不需要先成為厲害的人。",
    hero_image_url: "/showcase/fitness-hero.jpg",
    detail_image_url: "/showcase/fitness-detail.jpg",
  },
  education: {
    hero_eyebrow: "LEARNING, WIDE OPEN.",
    hero_title: "好奇心沒有",
    hero_highlight: "標準答案。",
    hero_description: "讓課程不只是填滿時間，而是讓興趣有地方繼續長大。",
    primary_cta_label: "探索課程",
    secondary_cta_label: "查看近期活動",
    section_title: "這一期，可以從這裡開始。",
    section_description: "公開課程與活動會直接帶入報名系統，不必重複維護資料。",
    hero_image_url: "/showcase/education-hero.jpg",
    detail_image_url: "/showcase/education-detail.jpg",
  },
  consulting: {
    hero_eyebrow: "STRATEGY · PRACTICE · GROWTH",
    hero_title: "Make the complex",
    hero_highlight: "clear.",
    hero_description: "把複雜問題整理成可理解、可執行，也能真正進入組織的下一步。",
    primary_cta_label: "預約初次諮詢",
    secondary_cta_label: "了解合作方式",
    section_title: "不同問題，需要不同深度的合作。",
    section_description: "從公開服務中選擇合作起點，後續再由團隊確認需求與時段。",
    hero_image_url: "/showcase/consulting-hero.jpg",
    detail_image_url: "/showcase/consulting-detail.jpg",
  },
  "pet-care": {
    hero_eyebrow: "CARE THAT FEELS CLOSER",
    hero_title: "好好照顧，",
    hero_highlight: "也好好對待牠的感受。",
    hero_description: "有時間聽你說，也讓毛孩慢慢適應。從少一點緊張開始，找到適合的照護。",
    primary_cta_label: "查看最近時段",
    secondary_cta_label: "了解照護服務",
    section_title: "最快可以什麼時候來？",
    section_description: "選擇服務後，預約系統會顯示仍有名額的真實時段。",
    hero_image_url: "/showcase/pet-hero.jpg",
    detail_image_url: "/showcase/pet-detail.jpg",
  },
  venue: {
    hero_eyebrow: "PRIVATE CREATIVE SPACE · TAIPEI",
    hero_title: "A space built",
    hero_highlight: "for almost anything.",
    hero_description: "讓拍攝、課程與聚會，在預約前就看懂空間、用途與下一步。",
    primary_cta_label: "查看可預約時段",
    secondary_cta_label: "瀏覽空間資訊",
    section_title: "自然光、完整設備，以及不被打擾的時間。",
    section_description: "選擇服務或用途後，即可進入既有預約流程。",
    hero_image_url: "/showcase/space-detail.jpg",
    detail_image_url: "/showcase/space-hero.jpg",
  },
  event: {
    hero_eyebrow: "LIVE · TAIPEI",
    hero_title: "WHEN THE LIGHTS GO DOWN",
    hero_highlight: "WE OPEN EVERYTHING.",
    hero_description: "活動資訊、公開場次與票種會直接連接報名系統，避免形象頁與售票資料不同步。",
    primary_cta_label: "查看活動與票種",
    secondary_cta_label: "瀏覽節目資訊",
    section_title: "不只是一場活動，而是一個只在此刻成立的世界。",
    section_description: "選擇活動後即可查看真實場次、票價、名額與付款狀態。",
    hero_image_url: "/showcase/event-detail.jpg",
    detail_image_url: "/showcase/event-hero.jpg",
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

export function brandPagePreferredEntry(template: BrandPageTemplate): "booking" | "registration" {
  return template === "education" || template === "event" ? "registration" : "booking";
}
