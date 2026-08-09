import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export type IconName =
  | "calendar"
  | "ticket"
  | "message"
  | "layers"
  | "chart"
  | "users"
  | "globe"
  | "spark"
  | "phone"
  | "mail"
  | "line"
  | "settings"
  | "check";

export type ModuleKind =
  | "booking"
  | "registration"
  | "entrance"
  | "crm"
  | "brand"
  | "reports";

type ShowcaseVariant = ModuleKind | "overview" | "marketing";

const iconPaths: Record<Exclude<IconName, "line">, ReactNode> = {
  calendar: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9h18" /></>,
  ticket: <><path d="M4 7a2 2 0 0 0 0 4v2a2 2 0 0 0 0 4h16v-3a2 2 0 0 1 0-4V7H4Z" /><path d="M12 8v8" /></>,
  message: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.1-.6L4 20l1.6-3.5A7.3 7.3 0 0 1 4.5 12 7.5 7.5 0 0 1 12 4.5a7.5 7.5 0 0 1 8 7Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
  layers: <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
  chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /><circle cx="7" cy="15" r="1" /><circle cx="11" cy="11" r="1" /><circle cx="14" cy="13" r="1" /><circle cx="19" cy="7" r="1" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 4 5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></>,
  phone: <><path d="M7 3h3l1.5 4-2 1.5a14 14 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4 5.2 2 2 0 0 1 7 3Z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.5-1H6v-2.4h.2a1.7 1.7 0 0 1 1.5-1A1.7 1.7 0 0 0 7 8.7L7 8.6 8.7 7l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
};

function cleanHeading(text: string) {
  return text.replace(/[，。！？：；、,.!?;:]/g, "");
}

function iconForLabel(label: string): IconName {
  if (label.includes("入口") || label.includes("LINE")) return "line";
  if (label.includes("安排") || label.includes("服務") || label.includes("流程") || label.includes("預約")) return "calendar";
  if (label.includes("報名") || label.includes("場次")) return "ticket";
  if (label.includes("CRM") || label.includes("互動") || label.includes("聯絡")) return "message";
  if (label.includes("回訪") || label.includes("資料") || label.includes("報表")) return "chart";
  if (label.includes("品牌") || label.includes("多品牌")) return "globe";
  if (label.includes("設定")) return "settings";
  if (label.includes("電話")) return "phone";
  if (label.includes("Email")) return "mail";
  return "spark";
}

export function FeatureIcon({ name, dark = false, compact = false }: { name: IconName; dark?: boolean; compact?: boolean }) {
  const shell = `inline-flex shrink-0 items-center justify-center rounded-xl border ${compact ? "h-10 w-10" : "h-12 w-12"} ${dark ? "border-[#f1ca5b]/40 bg-[#f1ca5b] text-[#193b43]" : "border-[#d8d2c5] bg-[#fffaf0] text-[#1f4550]"}`;
  if (name === "line") {
    return <span className={shell} aria-hidden="true"><Image src="/brand/line-brand-icon.png" alt="" width={compact ? 22 : 26} height={compact ? 22 : 26} className="object-contain" /></span>;
  }
  return <span className={shell} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={compact ? "h-4 w-4" : "h-5 w-5"}>{iconPaths[name]}</svg></span>;
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return <main className="marketing-shell min-h-screen overflow-x-clip text-[#193b43]"><div className="pointer-events-none fixed inset-0 z-0 opacity-40" aria-hidden="true"><div className="absolute left-[-12rem] top-[18rem] h-[26rem] w-[26rem] rounded-full bg-[#e2b644]/12 blur-3xl" /><div className="absolute right-[-14rem] top-[72rem] h-[30rem] w-[30rem] rounded-full bg-[#2f7780]/10 blur-3xl" /></div><div className="relative z-10"><MarketingHeader />{children}<MarketingFooter /></div></main>;
}

export function MarketingHeader() {
  return <header className="sticky top-0 z-30 border-b border-[#d9d2c5]/80 bg-[#f8f4ec]/95 backdrop-blur-xl"><div className="mx-auto flex min-h-20 max-w-7xl items-center gap-5 px-5 sm:px-8 lg:px-10"><Link href="/" className="flex min-h-11 shrink-0 items-center" aria-label="回到星昊科技首頁"><Image src="/brand/xinhao-horizontal.png" alt="星昊科技 XINHOW" width={2048} height={1024} className="h-11 w-28 object-contain" priority /></Link><nav className="ml-auto hidden items-center gap-1 text-sm font-semibold text-[#536864] md:flex" aria-label="行銷網站主選單"><NavLink href="/product">產品能力</NavLink><NavLink href="/solutions">產業場景</NavLink><NavLink href="/pricing">方案與服務</NavLink><NavLink href="/contact">聯絡導入</NavLink></nav><div className="ml-auto hidden items-center gap-2 md:flex"><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-bold text-[#087f4e] transition hover:bg-[#d9f5e4]"><FeatureIcon name="line" compact />官方 LINE</a><Link href="/contact" className="inline-flex min-h-11 items-center rounded-full bg-[#e2b644] px-5 text-sm font-bold text-[#193b43] transition hover:bg-[#f1ca5b]">預約導入</Link><Link href="/admin/login" className="inline-flex min-h-11 items-center rounded-full border border-[#c7d0c9] px-4 text-sm font-semibold text-[#536864] transition hover:border-[#1f4550] hover:text-[#1f4550]">登入</Link></div><div className="ml-auto flex items-center gap-2 md:hidden"><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#cfd8d1] bg-white/70 text-[#087f4e] transition hover:bg-white" aria-label="開啟官方 LINE"><FeatureIcon name="line" compact /></a><details className="relative"><summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-[#cfd8d1] bg-white/70 text-[#1f4550] transition hover:bg-white [&::-webkit-details-marker]:hidden" aria-label="開啟網站選單"><span className="flex flex-col gap-1" aria-hidden="true"><i className="h-0.5 w-4 bg-current" /><i className="h-0.5 w-4 bg-current" /><i className="h-0.5 w-4 bg-current" /></span></summary><div className="absolute right-0 top-12 z-50 w-56 rounded-2xl border border-[#d8d2c5] bg-[#fffaf0] p-3 shadow-[0_18px_40px_rgba(31,69,80,.16)]"><p className="border-b border-[#d8d2c5] px-3 pb-3 text-[11px] font-bold tracking-[.12em] text-[#b08116]">網站選單</p><div className="grid gap-1 pt-2"><MobileNavLink href="/product" icon="layers">產品能力</MobileNavLink><MobileNavLink href="/solutions" icon="globe">產業場景</MobileNavLink><MobileNavLink href="/pricing" icon="chart">方案與服務</MobileNavLink><MobileNavLink href="/contact" icon="message">聯絡導入</MobileNavLink><MobileNavLink href="/admin/login" icon="settings">後台登入</MobileNavLink></div></div></details></div></div></header>;
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center rounded-full px-4 transition hover:bg-white hover:text-[#b08116]">{children}</Link>;
}

function MobileNavLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  return <Link href={href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-[#1f4550] transition hover:bg-white"><FeatureIcon name={icon} compact />{children}<span className="ml-auto text-[#b08116]" aria-hidden="true">↗</span></Link>;
}

export function MarketingFooter() {
  return <footer className="bg-[#173f48] px-5 py-14 text-[#dfe9e5] sm:px-8 lg:px-10"><div className="mx-auto grid max-w-7xl gap-10 border-b border-white/15 pb-10 md:grid-cols-[1.4fr_.7fr_.9fr] md:items-start"><div><div className="flex items-center gap-3"><Image src="/brand/xinhao-gold-dark.png" alt="星昊科技 XINHOW" width={1536} height={1536} className="h-12 w-12 object-contain" /><div><p className="font-display font-bold tracking-[0.1em]">星昊科技 XINHOW</p><p className="mt-1 text-xs text-[#a9c2be]">服務流程的營運基礎</p></div></div><p className="mt-5 max-w-md text-sm leading-7 text-[#a9c2be]">多品牌預約與報名 SaaS 從顧客入口到日常經營讓團隊在同一條工作流程上協作</p></div><div><p className="text-xs font-bold tracking-[0.16em] text-[#e2b644]">NAVIGATE</p><div className="mt-4 grid gap-3 text-sm text-[#c5d5d1]"><Link href="/product" className="hover:text-white">產品能力</Link><Link href="/solutions" className="hover:text-white">產業場景</Link><Link href="/pricing" className="hover:text-white">方案與服務</Link><Link href="/contact" className="hover:text-white">聯絡導入</Link></div></div><div><p className="text-xs font-bold tracking-[0.16em] text-[#e2b644]">CONTACT</p><div className="mt-4 grid gap-3 text-sm text-[#c5d5d1]"><a href="tel:079721612" className="hover:text-white">07-9721612</a><a href="mailto:service@xinhow.com.tw" className="break-all hover:text-white">service@xinhow.com.tw</a><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="hover:text-white">官方 LINE @xinhow</a><Link href="/admin/login" className="hover:text-white">管理後台登入</Link></div></div></div><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 pt-5 text-xs text-[#86a39e]"><span>© 星昊科技 XINHOW · 多品牌預約與報名 SaaS</span><span>以真實流程開始 以可驗收結果交付</span></div></footer>;
}

export function PageIntro({ eyebrow, title, description, children, visual, dark = false, backgroundSrc }: { eyebrow: string; title: string; description: string; children?: ReactNode; visual?: ReactNode; dark?: boolean; backgroundSrc?: string }) {
  return <section className={`marketing-hero relative isolate overflow-hidden border-b ${dark ? "border-[#35616a] text-white" : "border-[#dfd8ca] text-[#173f48]"}`}>
    {backgroundSrc && <Image src={backgroundSrc} alt="" fill priority sizes="100vw" className="absolute inset-0 -z-20 object-cover object-center" />}
    <div className={`absolute inset-0 -z-10 ${dark ? "bg-[linear-gradient(90deg,rgba(6,28,39,.96),rgba(7,34,43,.83)_45%,rgba(8,39,48,.52))]" : "bg-[linear-gradient(90deg,rgba(246,242,234,.96),rgba(246,242,234,.82)_45%,rgba(246,242,234,.35))]"}`} />
    <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 sm:py-18 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:gap-14 lg:px-10 lg:py-20">
      <div className="max-w-2xl">
        <p className={`eyebrow ${dark ? "!text-[#f1ca5b]" : "!text-[#b08116]"}`}>{eyebrow}</p>
        <h1 className={`font-display mt-4 max-w-2xl text-[clamp(2.15rem,4vw,3.55rem)] font-black leading-[1.08] tracking-[-0.05em] ${dark ? "text-white" : "text-[#173f48]"}`}>{cleanHeading(title)}</h1>
        <p className={`mt-6 max-w-xl text-base leading-8 sm:text-lg ${dark ? "text-[#d7e6e2]" : "text-[#5d706d]"}`}>{description}</p>
        {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
      </div>
      <div className="relative">{visual ?? <div className={`border-l-2 pl-6 text-sm leading-7 ${dark ? "border-[#f1ca5b] text-[#d7e6e2]" : "border-[#b08116] text-[#6d7b76]"}`}>把服務入口、排程、通知與後續經營放在同一條可理解的工作流程裡</div>}</div>
    </div>
  </section>;
}

export function SectionHeading({ eyebrow, title, description, align = "left" }: { eyebrow: string; title: string; description?: string; align?: "left" | "center" }) {
  return <div className={`${align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}`}><div className={`mb-4 flex items-center gap-3 ${align === "center" ? "justify-center" : ""}`} aria-hidden="true"><span className="h-px w-10 bg-[#b08116]" /><span className="h-2 w-2 rounded-full bg-[#e2b644]" /></div><p className="eyebrow !mb-0 !text-[#b08116]">{eyebrow}</p><h2 className="mt-3 text-[clamp(1.8rem,3vw,2.65rem)] font-black leading-[1.16] tracking-[-0.04em] text-[#173f48]">{cleanHeading(title)}</h2>{description && <p className="mt-4 text-base leading-7 text-[#5d706d]">{description}</p>}</div>;
}

export function ArrowLink({ href, children, dark = false }: { href: string; children: ReactNode; dark?: boolean }) {
  return <Link href={href} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold transition ${dark ? "bg-[#f1ca5b] text-[#193b43] hover:bg-white" : "bg-[#173f48] text-white hover:bg-[#b08116]"}`}>{children}<span aria-hidden="true">↗</span></Link>;
}

const moduleTheme: Record<ModuleKind, { accent: string; soft: string; label: string }> = {
  booking: { accent: "#c79217", soft: "#fff0bd", label: "預約工作畫面" },
  registration: { accent: "#d56e4d", soft: "#fde4dc", label: "活動工作畫面" },
  entrance: { accent: "#2b9d78", soft: "#d9f5e4", label: "顧客入口畫面" },
  crm: { accent: "#7859b8", soft: "#ece4ff", label: "顧客經營畫面" },
  brand: { accent: "#2c7594", soft: "#dceef5", label: "品牌設定畫面" },
  reports: { accent: "#c06b25", soft: "#f7e4d1", label: "營運分析畫面" },
};

const showcaseData: Record<ShowcaseVariant, { section: string; title: string; subtitle: string; tabs: string[] }> = {
  overview: { section: "品牌營運", title: "今日工作總覽", subtitle: "從入口到回訪，把狀態放在同一個工作畫面", tabs: ["今日安排", "服務作業", "營運分析"] },
  booking: { section: "預約與服務", title: "服務排程", subtitle: "時間制與場次制依品牌設定切換", tabs: ["預約日曆", "預約列表", "服務排程"] },
  registration: { section: "活動與課程", title: "報名作業", subtitle: "活動、場次、票種與報到一路接續", tabs: ["活動與課程", "報名名單", "報到管理"] },
  entrance: { section: "入口與通知", title: "顧客入口", subtitle: "LINE Rich Menu、瀏覽器與品牌網址", tabs: ["LINE → LIFF", "瀏覽器備援", "Email 通知"] },
  crm: { section: "顧客經營", title: "CRM Lite", subtitle: "分眾、互動時間軸與下一個動作", tabs: ["顧客清單", "互動時間軸", "分眾與自動化"] },
  brand: { section: "品牌設定", title: "品牌營運設定", subtitle: "品牌入口、成員角色與資料範圍", tabs: ["品牌資料", "成員與權限", "資料範圍"] },
  reports: { section: "營運分析", title: "營運報表", subtitle: "從預約、報名到付款與出席回看", tabs: ["預約統計", "報名統計", "付款與出席"] },
  marketing: { section: "規則式行銷", title: "行銷流程", subtitle: "依條件觸發 LINE 與 Email 投遞", tabs: ["自動化規則", "投遞紀錄", "阻擋名單"] },
};

function showcaseKind(variant: ShowcaseVariant): ModuleKind {
  if (variant === "overview") return "brand";
  if (variant === "marketing") return "crm";
  return variant;
}

const previewGroups = [
  { label: "營運中心", items: ["總覽", "預約日曆", "預約列表"] },
  { label: "排程與服務", items: ["服務排程", "服務與方案", "資源配置"] },
  { label: "客戶與成長", items: ["顧客管理", "CRM Lite", "會員與方案"] },
  { label: "活動報名", items: ["活動與課程", "報名名單", "報名報到"] },
  { label: "報表與分析", items: ["營運報表"] },
];

export function ProductShowcase({ variant = "overview", compact = false }: { variant?: ShowcaseVariant; compact?: boolean }) {
  const data = showcaseData[variant];
  const theme = moduleTheme[showcaseKind(variant)];
  return <div className={`${compact ? "admin-preview-compact" : "admin-preview"} product-showcase overflow-hidden border border-[#b9c7d0] bg-[#f5f8fb]`} aria-label={`${data.title}後台介面預覽`}>
    <div className="flex items-center justify-between gap-3 border-b border-[#d5e0e6] bg-white px-3 py-2.5 sm:px-4"><div className="flex items-center gap-2.5"><span className="flex gap-1" aria-hidden="true"><i className="h-2 w-2 rounded-full bg-[#ec7667]" /><i className="h-2 w-2 rounded-full bg-[#efc34d]" /><i className="h-2 w-2 rounded-full bg-[#55b887]" /></span><span className="text-[9px] font-bold tracking-[.16em] text-[#19384a]">XINHOW ADMIN PREVIEW</span></div><span className="rounded-md border border-[#d5e0e6] bg-[#f7fafc] px-2 py-1 text-[9px] font-semibold text-[#607586]">依既有後台版型</span></div>
    <div className="admin-preview-shell grid grid-cols-[7.4rem_minmax(0,1fr)] sm:grid-cols-[10.8rem_minmax(0,1fr)]">
      <PreviewSidebar active={data.tabs[0]} />
      <div className="admin-preview-main">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-[#dfe7ec] bg-white px-3 sm:px-4"><div className="min-w-0"><p className="truncate text-[10px] font-bold text-[#172b3b] sm:text-xs">品牌工作區 · {data.section}</p><p className="mt-0.5 text-[9px] text-[#8393a0]">示範資料｜品牌資料隔離</p></div><span className="hidden rounded-md bg-[#eef4f8] px-2 py-1 text-[9px] font-semibold text-[#536c7b] sm:inline">管理者</span></div>
        <div className="p-2.5 sm:p-4"><div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#dfe7ec] pb-3"><div><p className="text-[9px] font-bold tracking-[.15em]" style={{ color: theme.accent }}>{theme.label}</p><h3 className="mt-1 text-base font-bold tracking-[-0.02em] text-[#172b3b] sm:text-xl">{data.title}</h3><p className="mt-1 text-[10px] leading-5 text-[#758795]">{data.subtitle}</p></div><span className="rounded-md px-2 py-1 text-[9px] font-bold" style={{ backgroundColor: theme.soft, color: theme.accent }}>介面預覽</span></div><PreviewBody variant={variant} accent={theme.accent} soft={theme.soft} /></div>
      </div>
    </div>
  </div>;
}

function PreviewSidebar({ active }: { active: string }) {
  return <aside className="admin-preview-sidebar min-h-[18rem] overflow-hidden p-2 text-[9px] text-slate-300 sm:min-h-[22rem] sm:p-2.5"><div className="border-b border-white/10 px-1.5 pb-3"><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1f79d1] text-[9px] font-bold text-white">XH</span><span className="truncate text-[9px] font-semibold tracking-wide text-white">XINHOW</span></div><p className="mt-2 text-[8px] text-slate-500">品牌營運後台</p></div><div className="mt-3 space-y-2">{previewGroups.map((group) => <div key={group.label}><p className="mb-1 px-1.5 text-[8px] font-semibold tracking-[.08em] text-slate-500">{group.label}</p><div className="space-y-0.5">{group.items.map((item) => <p key={item} className={`truncate rounded px-1.5 py-1.5 ${item === active ? "bg-[#1f79d1] font-semibold text-white" : "text-slate-400"}`}>{item}</p>)}</div></div>)}</div></aside>;
}

function PreviewBody({ variant, accent, soft }: { variant: ShowcaseVariant; accent: string; soft: string }) {
  if (variant === "booking") return <PreviewBooking accent={accent} soft={soft} />;
  if (variant === "registration") return <PreviewRegistration accent={accent} />;
  if (variant === "entrance") return <PreviewEntrance accent={accent} soft={soft} />;
  if (variant === "crm" || variant === "marketing") return <PreviewCrm accent={accent} marketing={variant === "marketing"} />;
  if (variant === "brand") return <PreviewBrand accent={accent} />;
  if (variant === "reports") return <PreviewReports accent={accent} />;
  return <PreviewOverview accent={accent} soft={soft} />;
}

function PreviewOverview({ accent, soft }: { accent: string; soft: string }) {
  return <div className="mt-3 space-y-3"><div className="grid gap-2 sm:grid-cols-3"><PreviewMetric label="今日工作" value="已排程" accent={accent} soft={soft} /><PreviewMetric label="待處理事項" value="需要查看" accent="#c79217" soft="#fff4cf" /><PreviewMetric label="資料狀態" value="可回看" accent="#2b9d78" soft="#e2f5eb" /></div><div className="grid gap-3 sm:grid-cols-[1.15fr_.85fr]"><PreviewPanel title="今天的工作安排"><PreviewList rows={[["預約日曆", "查看服務安排"], ["報名名單", "確認活動資料"], ["訊息投遞", "檢查通知狀態"]]} accent={accent} /></PreviewPanel><PreviewPanel title="營運提醒"><PreviewList rows={[["品牌設定", "入口與權限"], ["CRM Lite", "顧客下一步"], ["營運報表", "日期範圍"]]} accent="#5e7890" /></PreviewPanel></div></div>;
}

function PreviewBooking({ accent, soft }: { accent: string; soft: string }) {
  return <div className="mt-3 overflow-hidden border border-[#dfe7ec] bg-white"><div className="grid grid-cols-[3.4rem_repeat(2,minmax(0,1fr))] bg-[#f7fafc] text-[9px] font-semibold text-[#657988]"><span className="border-r border-[#dfe7ec] px-2 py-2">時間</span><span className="border-r border-[#dfe7ec] px-2 py-2">服務人員</span><span className="px-2 py-2">共用資源</span></div>{[["09:00", "可預約", "場地 A"], ["11:30", "已確認", "設備 01"], ["15:00", "待確認", "場地 B"]].map(([time, status, resource], index) => <div key={time} className="grid min-h-12 grid-cols-[3.4rem_repeat(2,minmax(0,1fr))] border-t border-[#e8eef2] text-[9px]"><span className="border-r border-[#e8eef2] px-2 py-3 font-semibold text-[#7a8c98]">{time}</span><span className="border-r border-[#e8eef2] px-2 py-2"><span className="block border-l-2 px-2 py-1 font-semibold text-[#334d5e]" style={{ borderColor: index === 1 ? "#2b9d78" : accent, backgroundColor: index === 0 ? soft : "#f7fafc" }}>{status}</span></span><span className="px-2 py-3 text-[#667b89]">{resource}</span></div>)}</div>;
}

function PreviewRegistration({ accent }: { accent: string }) {
  return <div className="mt-3 overflow-hidden border border-[#dfe7ec] bg-white"><div className="grid grid-cols-[1.2fr_.8fr_.8fr] gap-2 bg-[#f7fafc] px-3 py-2 text-[9px] font-semibold text-[#657988]"><span>活動與場次</span><span>報名狀態</span><span>現場作業</span></div>{[["週末工作坊", "已確認", "QR 報到"], ["入門課程 A", "候補中", "候補名單"], ["主題講座", "待付款", "付款狀態"]].map(([event, status, action]) => <div key={event} className="grid grid-cols-[1.2fr_.8fr_.8fr] gap-2 border-t border-[#e8eef2] px-3 py-3 text-[9px] text-[#536b7a]"><strong className="truncate text-[#223c4d]">{event}</strong><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />{status}</span><span className="truncate">{action}</span></div>)}</div>;
}

function PreviewEntrance({ accent, soft }: { accent: string; soft: string }) {
  return <div className="mt-3 grid gap-3 sm:grid-cols-[.72fr_1.28fr]"><div className="mx-auto w-full max-w-[8rem] border-[4px] border-[#1b3443] bg-[#f4f8fa] p-2 shadow-sm"><div className="flex items-center justify-between text-[8px] font-bold text-[#1b3443]"><span>品牌入口</span><span className="h-1.5 w-1.5 rounded-full bg-[#2b9d78]" /></div><div className="mt-3 border border-[#d9e5ea] bg-white p-2"><p className="text-[9px] font-bold text-[#223c4d]">選擇服務</p><div className="mt-2 grid gap-1.5"><span className="border-l-2 px-2 py-1.5 text-[8px] text-[#4d6676]" style={{ borderColor: accent, backgroundColor: soft }}>一對一服務</span><span className="border-l-2 border-[#d9e5ea] px-2 py-1.5 text-[8px] text-[#708391]">活動報名</span></div></div><div className="mt-2 h-1.5 w-2/3 rounded bg-[#d9e5ea]" /></div><PreviewPanel title="顧客入口設定"><PreviewList rows={[["主要入口", "LINE Rich Menu → LIFF"], ["備援入口", "瀏覽器與品牌網址"], ["通知渠道", "LINE／Email"]]} accent={accent} /></PreviewPanel></div>;
}

function PreviewCrm({ accent, marketing }: { accent: string; marketing: boolean }) {
  return <div className="mt-3 grid gap-3 sm:grid-cols-[.82fr_1.18fr]"><PreviewPanel title={marketing ? "自動化規則" : "顧客清單"}><PreviewList rows={marketing ? [["完成服務後", "LINE 提醒"], ["一段時間未回訪", "Email 關懷"], ["活動報名完成", "加入分眾"]] : [["顧客資料", "依權限查看"], ["互動時間軸", "預約／報名紀錄"], ["分眾標籤", "下一個動作"]]} accent={accent} /></PreviewPanel><PreviewPanel title={marketing ? "投遞狀態" : "互動時間軸"}><div className="space-y-2.5 text-[9px] text-[#536b7a]">{(marketing ? ["待執行 · LINE", "已去重 · Email", "符合 opt-in"] : ["完成服務 · 已記錄", "通知投遞 · 已記錄", "下一步 · 待處理"]).map((item, index) => <div key={item} className="flex items-center gap-2 border-b border-[#e8eef2] pb-2 last:border-0"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: index === 2 ? accent : "#b8cbd2" }} /><span>{item}</span><span className="ml-auto text-[#8b9ba4]">{index === 2 ? "查看" : "已記錄"}</span></div>)}</div></PreviewPanel></div>;
}

function PreviewBrand({ accent }: { accent: string }) {
  return <div className="mt-3 grid gap-2 sm:grid-cols-2"><PreviewSetting label="品牌名稱" value="品牌工作區" accent={accent} /><PreviewSetting label="公開入口" value="已啟用" accent="#2b9d78" /><PreviewSetting label="成員與權限" value="依角色管理" accent="#5e7890" /><PreviewSetting label="資料範圍" value="目前品牌" accent={accent} /></div>;
}

function PreviewReports({ accent }: { accent: string }) {
  return <div className="mt-3 grid gap-3 sm:grid-cols-[1.1fr_.9fr]"><PreviewPanel title="日期範圍內的營運趨勢"><div className="flex h-24 items-end gap-2 border-b border-l border-[#d9e4e9] px-3 pb-2">{[28, 46, 38, 62, 50, 74, 58, 82].map((height, index) => <span key={index} className="flex-1 rounded-t-sm" style={{ height: `${height}%`, backgroundColor: index === 6 ? accent : "#c8dbe1" }} />)}</div><div className="mt-2 flex justify-between text-[8px] text-[#80919b]"><span>預約</span><span>報名</span><span>付款</span><span>出席</span></div></PreviewPanel><div className="grid gap-2"><PreviewSetting label="預約統計" value="依品牌日期範圍" accent={accent} /><PreviewSetting label="報名與出席" value="可匯出明細" accent="#d56e4d" /><PreviewSetting label="通知投遞" value="成功／失敗／跳過" accent="#2b9d78" /></div></div>;
}

function PreviewPanel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="border border-[#dfe7ec] bg-white p-3"><div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-[10px] font-bold text-[#223c4d]">{title}</h4><span className="text-[8px] text-[#8b9ba4]">查看</span></div>{children}</div>;
}

function PreviewList({ rows, accent }: { rows: ReadonlyArray<readonly [string, string]>; accent: string }) {
  return <div className="space-y-2">{rows.map(([label, detail]) => <div key={label} className="flex items-center gap-2 border-b border-[#e8eef2] pb-2 last:border-0"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} /><span className="min-w-0 truncate text-[9px] font-semibold text-[#425b6b]">{label}</span><span className="ml-auto truncate text-[8px] text-[#8797a0]">{detail}</span></div>)}</div>;
}

function PreviewMetric({ label, value, accent, soft }: { label: string; value: string; accent: string; soft: string }) {
  return <div className="border border-[#dfe7ec] p-3" style={{ borderTop: `3px solid ${accent}`, backgroundColor: soft }}><p className="text-[9px] text-[#607586]">{label}</p><p className="mt-2 text-xs font-bold text-[#223c4d]">{value}</p></div>;
}

function PreviewSetting({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className="flex items-center gap-2 border border-[#dfe7ec] bg-white p-3"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} /><div className="min-w-0"><p className="text-[8px] text-[#80919b]">{label}</p><p className="mt-1 truncate text-[9px] font-semibold text-[#334d5e]">{value}</p></div></div>;
}

function moduleKindForTitle(title: string): ModuleKind {
  if (title.includes("預約") || title.includes("服務")) return "booking";
  if (title.includes("報名") || title.includes("活動") || title.includes("場次")) return "registration";
  if (title.includes("入口") || title.includes("LINE") || title.includes("通知")) return "entrance";
  if (title.includes("CRM") || title.includes("顧客") || title.includes("互動")) return "crm";
  if (title.includes("品牌") || title.includes("權限")) return "brand";
  return "reports";
}

export function ModuleInterface({ kind, compact = false }: { kind: ModuleKind; compact?: boolean }) {
  return <ProductShowcase variant={kind} compact={compact} />;
}

export function DashboardMockup({ variant = "operations" }: { variant?: "operations" | "customer" | "marketing" }) {
  return <ProductShowcase variant={variant === "operations" ? "overview" : variant === "customer" ? "crm" : "marketing"} />;
}

export function CapabilityCard({ number, title, description, href = "/product" }: { number: string; title: string; description: string; href?: string }) {
  return <article className="module-card"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><FeatureIcon name={iconForLabel(title)} compact /><span className="text-xs font-bold tracking-[.12em] text-[#b08116]">{number}</span></div><Link href={href} className="text-xs font-bold text-[#b08116] hover:text-[#173f48]">查看介面 ↗</Link></div><h3 className="mt-5 text-xl font-black tracking-[-0.035em] text-[#173f48]">{cleanHeading(title)}</h3><p className="mt-2 text-sm leading-7 text-[#5d706d]">{description}</p><ModuleInterface kind={moduleKindForTitle(title)} compact /></article>;
}

export function Callout({ title, description, href = "/contact", label = "開始規劃" }: { title: string; description: string; href?: string; label?: string }) {
  return <section className="border-y border-[#d2be76] bg-[#f1d36f] px-5 py-14 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow !text-[#856313]">Next step</p><h2 className="max-w-2xl text-[clamp(1.85rem,3vw,2.65rem)] font-black leading-[1.14] tracking-[-0.04em] text-[#173f48]">{cleanHeading(title)}</h2><p className="mt-4 max-w-2xl text-base leading-7 text-[#536864]">{description}</p></div><Link href={href} className="btn min-h-12 w-fit rounded-full bg-[#173f48] px-6 font-bold text-white hover:bg-[#2d6871]">{label} <span aria-hidden="true">↗</span></Link></div></section>;
}

export function MarketingPhoto({ src, alt, caption, priority = false }: { src: string; alt: string; caption: string; priority?: boolean }) {
  const safeCaption = caption.replace("實際工作情境", "情境示意");
  return <figure className="overflow-hidden border border-[#d8d2c5] bg-[#fffdf8] shadow-[0_14px_35px_rgba(23,63,72,.1)]"><div className="relative aspect-[16/9] overflow-hidden"><Image src={src} alt={alt} fill sizes="(max-width: 1024px) 100vw, 44vw" className="object-cover transition duration-700 hover:scale-[1.03]" priority={priority} /><span className="absolute bottom-3 left-3 rounded-full bg-[#fffdf8]/90 px-3 py-1.5 text-[10px] font-bold tracking-[.08em] text-[#173f48]">情境示意</span></div><figcaption className="border-t border-[#eee7d9] px-4 py-3 text-xs leading-5 text-[#6d7b76]">{safeCaption}</figcaption></figure>;
}

export function PhotoBand({ src, alt, eyebrow, title, description, children, dark = true }: { src: string; alt: string; eyebrow: string; title: string; description: string; children?: ReactNode; dark?: boolean }) {
  return <section className="relative isolate overflow-hidden border-y border-[#d8d2c5]"><Image src={src} alt={alt} fill sizes="100vw" className="object-cover" /><div className={`absolute inset-0 ${dark ? "bg-[linear-gradient(90deg,rgba(20,54,62,.91),rgba(20,54,62,.68)_48%,rgba(20,54,62,.18))]" : "bg-[linear-gradient(90deg,rgba(248,244,236,.94),rgba(248,244,236,.62)_52%,rgba(248,244,236,.18))]"}`} /><div className="relative mx-auto min-h-[24rem] max-w-7xl px-5 py-14 sm:px-8 sm:py-16 lg:px-10"><div className="flex min-h-[20rem] max-w-xl flex-col justify-end"><p className={`eyebrow ${dark ? "!text-[#f1ca5b]" : "!text-[#b08116]"}`}>{eyebrow}</p><h2 className={`mt-3 text-[clamp(1.9rem,3.5vw,3.1rem)] font-black leading-[1.1] tracking-[-0.045em] ${dark ? "text-white" : "text-[#173f48]"}`}>{cleanHeading(title)}</h2><p className={`mt-5 text-base leading-8 ${dark ? "text-[#dce9e6]" : "text-[#536864]"}`}>{description}</p>{children && <div className="mt-7 flex flex-wrap gap-3">{children}</div>}</div></div></section>;
}

type IntroVisualVariant = "product" | "solutions" | "pricing" | "contact";

export function PageIntroVisual({ variant, dark = false, photoSrc, photoCaption }: { variant: IntroVisualVariant; dark?: boolean; photoSrc?: string; photoAlt?: string; photoCaption?: string }) {
  const visualVariant: ShowcaseVariant = variant === "product" ? "booking" : variant === "solutions" ? "registration" : variant === "contact" ? "entrance" : "reports";
  const photo = photoSrc && photoCaption ? <div className="mt-3 flex items-start gap-2 border-t border-white/15 pt-3 text-[10px] leading-5 text-[#d7e6e2]"><span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-[#f1ca5b]" /><p><strong className="font-bold text-[#f1ca5b]">情境示意</strong>｜{photoCaption.replace("實際工作情境", "現場情境")}</p></div> : null;
  const onboarding = variant === "contact" ? <div className="mt-3 grid grid-cols-2 gap-2"><OnboardingStep number="01" title="說明現況" detail="入口與排程" done /><OnboardingStep number="02" title="確認範圍" detail="交付與驗收" active /></div> : null;
  return <div className={`border ${dark ? "border-white/25 bg-[#f8f4ec]/95" : "border-[#d8d2c5] bg-[#fffdf8]"} p-2 shadow-[0_24px_60px_rgba(23,63,72,.15)]`}>{variant === "pricing" ? <PricingVisual /> : <ProductShowcase variant={visualVariant} compact />}{photo}{onboarding}</div>;
}

export function JourneyDiagram() {
  const steps = [{ number: "01", title: "顧客入口", detail: "LINE Rich Menu · LIFF · 瀏覽器", icon: "line" as IconName }, { number: "02", title: "品牌服務作業", detail: "時段 · 場次 · 付款 · 報到", icon: "calendar" as IconName }, { number: "03", title: "CRM Lite 與報表", detail: "提醒 · 分眾 · 回訪 · 營運分析", icon: "chart" as IconName }];
  return <div className="border border-[#d8d2c5] bg-[#fffdf8] p-5 shadow-[0_16px_35px_rgba(23,63,72,.08)] sm:p-7"><p className="eyebrow !text-[#b08116]">Operational flow</p><h3 className="mt-2 text-2xl font-black text-[#173f48]">一條可追蹤的服務路徑</h3><div className="mt-7 grid gap-3">{steps.map((step, index) => <div key={step.number} className="relative flex gap-4 border-t border-[#eee7d9] pt-4 first:border-t-0 first:pt-0"><FeatureIcon name={step.icon} compact /><div><p className="text-[10px] font-bold text-[#b08116]">{step.number}</p><p className="font-bold text-[#173f48]">{step.title}</p><p className="mt-1 text-sm leading-6 text-[#6d7b76]">{step.detail}</p></div>{index < steps.length - 1 && <span className="absolute bottom-[-.8rem] left-5 h-4 border-l border-dashed border-[#e2b644]" aria-hidden="true" />}</div>)}</div></div>;
}

export function SignalStrip({ items, dark = false }: { items: ReadonlyArray<{ label: string; value: string; detail: string; icon?: IconName }>; dark?: boolean }) {
  return <div className={`grid gap-0 border-y ${dark ? "border-white/15 text-white" : "border-[#d8d2c5] text-[#173f48]"} sm:grid-cols-2 lg:grid-cols-4`}>{items.map((item) => <div key={item.label} className={`flex gap-3 border-b p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0 ${dark ? "border-white/15" : "border-[#d8d2c5]"}`}><FeatureIcon name={item.icon ?? iconForLabel(item.label)} dark={dark} compact /><div><p className={`text-[10px] font-bold tracking-[.12em] ${dark ? "text-[#f1ca5b]" : "text-[#b08116]"}`}>{item.label}</p><p className="mt-1 text-lg font-black tracking-tight">{item.value}</p><p className={`mt-1 text-xs leading-5 ${dark ? "text-[#c9dcda]" : "text-[#6d706d]"}`}>{item.detail}</p></div></div>)}</div>;
}

export function WorkflowRail({ steps, dark = false }: { steps: ReadonlyArray<{ label: string; title: string; detail: string }>; dark?: boolean }) {
  return <div className="overflow-x-auto pb-2"><div className={`grid min-w-[700px] grid-cols-4 border-y ${dark ? "border-white/15" : "border-[#d8d2c5]"}`}>{steps.map((step, index) => <div key={step.label} className={`relative border-r p-5 last:border-r-0 ${dark ? "border-white/15" : "border-[#d8d2c5]"}`}><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${index === steps.length - 1 ? "bg-[#f1ca5b]" : dark ? "bg-white/70" : "bg-[#1f505b]"}`} /><span className={`text-[10px] font-bold tracking-[.12em] ${dark ? "text-[#f1ca5b]" : "text-[#b08116]"}`}>{step.label}</span></div><h3 className={`mt-4 text-lg font-black ${dark ? "text-white" : "text-[#173f48]"}`}>{cleanHeading(step.title)}</h3><p className={`mt-2 text-sm leading-6 ${dark ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{step.detail}</p></div>)}</div></div>;
}

export function ScenarioMatrix() {
  const rows = [["入口", "LINE → LIFF", "活動連結", "品牌網址", "嵌入元件"], ["安排", "時間／人員", "場次／票種", "設備／場地", "共用資源"], ["完成", "提醒／回訪", "QR 報到", "付款／收據", "報表／分析"]];
  return <div className="overflow-x-auto border-y border-[#d8d2c5] bg-[#fffdf8] py-4"><div className="min-w-[720px]"><div className="grid grid-cols-[110px_repeat(4,1fr)] gap-2 px-2 pb-3 text-[10px] font-bold tracking-[.12em] text-[#7a8782]"><span>工作層</span><span>一對一服務</span><span>課程活動</span><span>場地設備</span><span>品牌入口</span></div>{rows.map(([label, ...values]) => <div key={label} className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-2"><span className="flex items-center border-l-2 border-[#b08116] px-3 text-xs font-black text-[#173f48]">{label}</span>{values.map((value, index) => <span key={value} className={`px-3 py-3 text-xs font-bold ${index === 0 ? "bg-[#fff0bd] text-[#8a6816]" : "bg-[#f2f5f0] text-[#1f505b]"}`}>{value}</span>)}</div>)}</div></div>;
}

export function PricingVisual() {
  return <div className="grid gap-2 sm:grid-cols-2"><div className="bg-[#173f48] p-6 text-white"><p className="eyebrow !text-[#f1ca5b]">標準交付</p><p className="font-display mt-3 text-6xl font-black">70</p><p className="mt-2 text-sm leading-6 text-[#c9dcda]">項標準功能全部開放</p><p className="mt-7 border-t border-white/15 pt-4 text-xs leading-5 text-[#a9c2be]">預約 報名 金流 CRM Lite 通知與報表</p></div><div className="bg-[#fff7dc] p-6 text-[#173f48]"><p className="eyebrow !text-[#b08116]">另行確認</p><p className="font-display mt-3 text-6xl font-black">07</p><p className="mt-2 text-sm leading-6 text-[#6d7b76]">項加值或清單外需求</p><p className="mt-7 border-t border-[#e3dccd] pt-4 text-xs leading-5 text-[#6d7b76]">先確認範圍 交付內容與時程再進入開發</p></div></div>;
}

function SceneChip({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={`rounded-full px-3 py-2 text-sm font-semibold ${active ? "bg-[#173f48] text-white" : "bg-[#f2f5f0] text-[#6d7b76]"}`}>{label}</span>;
}

function OnboardingStep({ number, title, detail, done = false, active = false }: { number: string; title: string; detail: string; done?: boolean; active?: boolean }) {
  return <div className={`border p-3 ${active ? "border-[#d2be76] bg-[#fff0bd]" : "border-[#eee7d9] bg-[#fffdf8]"}`}><div className="flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[#173f48] text-white" : active ? "bg-[#b08116] text-white" : "bg-[#e7e2d8] text-[#7a8782]"}`}>{done ? "✓" : number}</span><div><p className="text-[10px] font-bold text-[#173f48]">{title}</p><p className="mt-0.5 text-[9px] text-[#6d706d]">{detail}</p></div></div></div>;
}

function SceneLine({ label, text, accent = false }: { label: string; text: string; accent?: boolean }) {
  return <div className="grid gap-2 border-t border-[#eee7d9] pt-3 sm:grid-cols-[auto_1fr] sm:gap-3"><FeatureIcon name={label === "現場情況" ? "users" : label === "系統怎麼接" ? "settings" : "chart"} compact /><div><p className={`text-xs font-bold ${accent ? "text-[#b08116]" : "text-[#7a8782]"}`}>{label}</p><p className={`mt-1 leading-6 ${accent ? "font-bold text-[#1f505b]" : "text-[#5d706d]"}`}>{text}</p></div></div>;
}

function ConfigPill({ title, value }: { title: string; value: string }) {
  return <div className="flex gap-3 border border-white/15 bg-white/10 p-4"><FeatureIcon name={title === "預約模式" ? "calendar" : title === "服務目標" ? "users" : title === "顧客入口" ? "line" : "layers"} dark compact /><div><p className="text-xs text-[#a9c2be]">{title}</p><p className="mt-2 font-bold text-white">{value}</p></div></div>;
}

export { ConfigPill, SceneChip, SceneLine };
