import Image from "next/image";
import Link from "next/link";

export type IconName = "calendar" | "ticket" | "message" | "layers" | "chart" | "users" | "globe" | "spark" | "phone" | "mail" | "line" | "settings" | "check";

const iconPaths: Record<IconName, React.ReactNode> = {
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
  line: <><path d="M20 11c0 4-4 7-9 7-.8 0-1.6-.1-2.3-.2L5 20l.9-2.6C4.1 16.2 3 13.8 3 11c0-4 3.6-7 8-7s9 3 9 7Z" /><path d="M7 11h.01M11 11h.01M15 11h.01" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.5-1H6v-2.4h.2a1.7 1.7 0 0 0 1.5-1A1.7 1.7 0 0 0 7 8.7L7 8.6 8.7 7l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
};

function iconForLabel(label: string): IconName {
  if (label.includes("入口") || label.includes("LINE")) return "line";
  if (label.includes("安排") || label.includes("服務") || label.includes("流程") || label.includes("預約")) return "calendar";
  if (label.includes("報名") || label.includes("場次")) return "ticket";
  if (label.includes("CRM") || label.includes("互動") || label.includes("聯絡")) return "message";
  if (label.includes("治理") || label.includes("平台")) return "layers";
  if (label.includes("回訪") || label.includes("資料") || label.includes("報表")) return "chart";
  if (label.includes("品牌") || label.includes("多品牌")) return "globe";
  if (label.includes("設定")) return "settings";
  if (label.includes("電話")) return "phone";
  if (label.includes("Email")) return "mail";
  return "spark";
}

export function FeatureIcon({ name, dark = false, compact = false }: { name: IconName; dark?: boolean; compact?: boolean }) {
  return <span className={`inline-flex shrink-0 items-center justify-center border ${compact ? "h-9 w-9" : "h-11 w-11"} ${dark ? "border-[#e2b644]/35 bg-[#e2b644] text-[#193b43]" : "border-[#cddbd5] bg-[#e8f0ec] text-[#1f4550]"}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={compact ? "h-4 w-4" : "h-5 w-5"}>{iconPaths[name]}</svg></span>;
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen overflow-x-clip bg-[#f4f1ea] text-[#193b43]"><div className="pointer-events-none fixed inset-0 z-0 opacity-60" aria-hidden="true"><div className="absolute left-0 top-[34rem] h-px w-full bg-[#cfc8ba]/45" /><div className="absolute right-[-18rem] top-[68rem] h-[32rem] w-[32rem] rounded-full border border-[#b08116]/15" /></div><div className="relative z-10"><MarketingHeader />{children}<MarketingFooter /></div></main>;
}

export function MarketingHeader() {
  return <header className="sticky top-0 z-30 border-b border-[#d8d2c5] bg-[#f4f1ea]/95 backdrop-blur"><div className="mx-auto flex min-h-[4.5rem] max-w-7xl items-center gap-4 px-5 sm:px-8 lg:px-10"><Link href="/" className="flex min-h-11 shrink-0 items-center" aria-label="回到星昊科技首頁"><Image src="/brand/xinhao-horizontal.png" alt="星昊科技 XINHOW" width={2048} height={1024} className="h-11 w-28 object-contain" priority /></Link><nav className="ml-auto hidden items-center gap-1 text-sm font-medium text-[#536864] md:flex" aria-label="行銷網站主選單"><NavLink href="/product">產品能力</NavLink><NavLink href="/solutions">產業場景</NavLink><NavLink href="/pricing">方案與服務</NavLink><NavLink href="/contact">聯絡導入</NavLink><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="ml-2 inline-flex min-h-11 items-center gap-2 border-l border-[#d8d2c5] px-4 font-semibold text-[#1f4550] transition hover:text-[#b08116]"><FeatureIcon name="line" compact />官方 LINE</a></nav><div className="ml-auto flex items-center gap-2 md:hidden"><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="inline-flex h-11 w-11 items-center justify-center border border-[#cfd8d1] bg-white/70 text-[#1f4550] transition hover:bg-white" aria-label="開啟官方 LINE"><FeatureIcon name="line" compact /></a><details className="relative"><summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center border border-[#cfd8d1] bg-white/70 text-[#1f4550] transition hover:bg-white [&::-webkit-details-marker]:hidden" aria-label="開啟網站選單"><FeatureIcon name="layers" compact /></summary><div className="absolute right-0 top-12 z-50 w-56 border border-[#d8d2c5] bg-[#f4f1ea] p-3 shadow-[0_18px_40px_rgba(31,69,80,.16)]"><p className="border-b border-[#d8d2c5] px-3 pb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#b08116]">網站選單</p><div className="grid gap-1 pt-2"><MobileNavLink href="/product" icon="layers">產品能力</MobileNavLink><MobileNavLink href="/solutions" icon="globe">產業場景</MobileNavLink><MobileNavLink href="/pricing" icon="chart">方案與服務</MobileNavLink><MobileNavLink href="/contact" icon="message">聯絡導入</MobileNavLink></div></div></details></div><Link href="/admin/login" className="btn min-h-11 shrink-0 border border-[#1f4550] bg-[#1f4550] px-3 text-xs text-white hover:bg-[#193b43] sm:px-4 sm:text-sm">後台登入</Link></div></header>;
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center px-3 transition hover:text-[#b08116]">{children}</Link>;
}

function MobileNavLink({ href, icon, children }: { href: string; icon: IconName; children: React.ReactNode }) {
  return <Link href={href} className="flex min-h-11 items-center gap-3 px-3 text-sm font-semibold text-[#1f4550] transition hover:bg-white"><FeatureIcon name={icon} compact />{children}<span className="ml-auto text-[#b08116]" aria-hidden="true">↗</span></Link>;
}

export function MarketingFooter() {
  return <footer className="bg-[#193b43] px-5 py-12 text-[#dfe9e5] sm:px-8 lg:px-10"><div className="mx-auto grid max-w-7xl gap-10 border-b border-white/15 pb-10 md:grid-cols-[1.4fr_.7fr_.9fr] md:items-start"><div><div className="flex items-center gap-3"><Image src="/brand/xinhao-gold-dark.png" alt="星昊科技 XINHOW" width={1536} height={1536} className="h-12 w-12 object-contain" /><div><p className="font-semibold tracking-[0.12em]">星昊科技 XINHOW</p><p className="mt-1 text-xs text-[#a9c2be]">服務流程的營運基礎</p></div></div><p className="mt-5 max-w-md text-sm leading-7 text-[#a9c2be]">多品牌預約與報名 SaaS，從顧客入口、品牌後台到日常經營，讓團隊在正確的工作流程上協作。</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Navigate</p><div className="mt-4 grid gap-3 text-sm text-[#c5d5d1]"><Link href="/product" className="hover:text-white">產品能力</Link><Link href="/solutions" className="hover:text-white">產業場景</Link><Link href="/pricing" className="hover:text-white">方案與服務</Link><Link href="/contact" className="hover:text-white">聯絡導入</Link></div></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Contact</p><div className="mt-4 grid gap-3 text-sm text-[#c5d5d1]"><a href="tel:079721612" className="hover:text-white">07-9721612</a><a href="mailto:service@xinhow.com.tw" className="break-all hover:text-white">service@xinhow.com.tw</a><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="hover:text-white">官方 LINE · @xinhow</a><Link href="/admin/login" className="hover:text-white">管理後台登入</Link></div></div></div><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 pt-5 text-xs text-[#86a39e]"><span>© 星昊科技 XINHOW · 多品牌預約與報名 SaaS</span><span>以真實流程開始，以可驗收結果交付</span></div></footer>;
}

export function PageIntro({ eyebrow, title, description, children, visual, dark = false }: { eyebrow: string; title: string; description: string; children?: React.ReactNode; visual?: React.ReactNode; dark?: boolean }) {
  return <section className={`relative overflow-hidden border-b ${dark ? "border-[#35616a] bg-[#1f4550] text-white" : "border-[#d8d2c5] bg-[#f4f1ea]"}`}><div className="absolute right-0 top-0 h-full w-1/3 border-l border-white/10 opacity-30" aria-hidden="true" /><div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[.92fr_1.08fr] lg:items-center lg:gap-16 lg:px-10"><div className="max-w-2xl"><p className={`eyebrow ${dark ? "!text-[#e2b644]" : "!text-[#b08116]"}`}>{eyebrow}</p><h1 className={`max-w-2xl text-[clamp(2.15rem,4.8vw,4.2rem)] font-bold leading-[1.08] tracking-[-0.05em] ${dark ? "text-white" : "text-[#193b43]"}`}>{title}</h1><p className={`mt-6 max-w-xl text-base leading-8 sm:text-lg ${dark ? "text-[#c4d8d5]" : "text-[#5d6d6b]"}`}>{description}</p>{children && <div className="mt-7 flex flex-wrap gap-3">{children}</div>}</div><div>{visual ?? <div className={`border-l-2 pl-6 text-sm leading-7 ${dark ? "border-[#e2b644] text-[#c4d8d5]" : "border-[#b08116] text-[#6d7b76]"}`}>把服務入口、排程、通知與後續經營放在同一條可理解的工作流程裡。</div>}</div></div></section>;
}

export function SectionHeading({ eyebrow, title, description, align = "left" }: { eyebrow: string; title: string; description?: string; align?: "left" | "center" }) {
  return <div className={`${align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}`}><div className={`mb-4 flex items-center gap-3 ${align === "center" ? "justify-center" : ""}`} aria-hidden="true"><span className="h-px w-10 bg-[#b08116]" /><span className="h-2 w-2 bg-[#e2b644]" /></div><p className="eyebrow !mb-0 !text-[#b08116]">{eyebrow}</p><h2 className="mt-3 text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.04em] text-[#193b43]">{title}</h2>{description && <p className="mt-4 text-base leading-7 text-[#5d6d6b]">{description}</p>}</div>;
}

export function ArrowLink({ href, children, dark = false }: { href: string; children: React.ReactNode; dark?: boolean }) {
  return <Link href={href} className={`inline-flex min-h-11 items-center gap-2 border-b pb-1 text-sm font-semibold transition ${dark ? "border-[#e2b644] text-[#f1ca5b] hover:text-white" : "border-[#b08116] text-[#1f4550] hover:text-[#b08116]"}`}>{children}<span aria-hidden="true">↗</span></Link>;
}

export type ModuleKind = "booking" | "registration" | "entrance" | "crm" | "brand" | "reports";

function moduleKindForTitle(title: string): ModuleKind {
  if (title.includes("預約") || title.includes("服務")) return "booking";
  if (title.includes("報名") || title.includes("活動") || title.includes("場次")) return "registration";
  if (title.includes("入口") || title.includes("LINE") || title.includes("通知")) return "entrance";
  if (title.includes("CRM") || title.includes("顧客") || title.includes("互動")) return "crm";
  if (title.includes("品牌") || title.includes("權限")) return "brand";
  return "reports";
}

export function ModuleInterface({ kind, compact = false }: { kind: ModuleKind; compact?: boolean }) {
  const views: Record<ModuleKind, { section: string; title: string; tabs: string[]; rows: string[] }> = {
    booking: { section: "預約與服務", title: "服務排程", tabs: ["預約日曆", "預約列表", "服務排程"], rows: ["可用時段", "已確認", "待處理"] },
    registration: { section: "活動與課程", title: "報名作業", tabs: ["活動與課程", "報名名單", "報到管理"], rows: ["場次與票種", "候補名單", "QR 報到"] },
    entrance: { section: "入口與通知", title: "顧客入口", tabs: ["LINE → LIFF", "瀏覽器備援", "Email 通知"], rows: ["Rich Menu", "品牌網址", "訊息紀錄"] },
    crm: { section: "顧客經營", title: "CRM Lite", tabs: ["顧客清單", "互動時間軸", "分眾與自動化"], rows: ["標籤分眾", "預約與報名紀錄", "下一個動作"] },
    brand: { section: "品牌設定", title: "品牌營運設定", tabs: ["品牌資料", "成員與權限", "資料範圍"], rows: ["品牌入口", "角色權限", "操作稽核"] },
    reports: { section: "營運分析", title: "營運報表", tabs: ["預約統計", "報名統計", "付款與出席"], rows: ["日期範圍", "狀態分析", "匯出報表"] },
  };
  const view = views[kind];
  return <div className={`${compact ? "mt-5" : "mt-8"} overflow-hidden border border-[#d8d2c5] bg-[#fbfaf6]`} aria-label={`${view.title}介面示意`}><div className="flex items-center justify-between border-b border-[#e9e4da] bg-white px-3 py-2"><span className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#b08116]">{view.section}</span><span className="text-[9px] text-[#7a8782]">介面示意</span></div><div className="grid grid-cols-[5.5rem_1fr]"><aside className="bg-[#193b43] p-2 text-[9px] text-[#c4d8d5]">{view.tabs.map((tab, index) => <p key={tab} className={`border-l-2 px-2 py-2 ${index === 0 ? "border-[#e2b644] bg-white/10 text-white" : "border-transparent"}`}>{tab}</p>)}</aside><div className="p-3"><p className="text-sm font-bold text-[#193b43]">{view.title}</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{view.rows.map((row, index) => <div key={row} className={`border-t-2 p-2.5 ${index === 0 ? "border-[#b08116] bg-[#fbf1d9]" : "border-[#cddbd5] bg-white"}`}><p className="text-[10px] font-semibold text-[#193b43]">{row}</p><span className="mt-2 block h-1.5 w-3/4 bg-[#cddbd5]" /></div>)}</div></div></div></div>;
}

export function CapabilityCard({ number, title, description, href = "/product" }: { number: string; title: string; description: string; href?: string }) {
  return <Link href={href} className="group relative block border-t-2 border-[#c8d5cf] py-5 transition hover:border-[#b08116]"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><FeatureIcon name={iconForLabel(title)} compact /><span className="font-mono text-xs text-[#b08116]">{number}</span></div><span className="text-xl text-[#b08116] transition group-hover:translate-x-1" aria-hidden="true">↗</span></div><h3 className="mt-5 text-lg font-bold text-[#193b43]">{title}</h3><p className="mt-2 max-w-md text-sm leading-7 text-[#6d7b76]">{description}</p><ModuleInterface kind={moduleKindForTitle(title)} compact /><p className="mt-4 text-xs font-semibold tracking-[.12em] text-[#5d6d6b]">查看這個工作模組</p></Link>;
}

export function Callout({ title, description, href = "/contact", label = "開始規劃" }: { title: string; description: string; href?: string; label?: string }) {
  return <section className="border-y border-[#b8c9c0] bg-[#dfece7] px-5 py-14 sm:px-8 sm:py-18 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow !text-[#b08116]">Next step</p><h2 className="max-w-2xl text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.04em] text-[#193b43]">{title}</h2><p className="mt-4 max-w-2xl text-base leading-7 text-[#5d6d6b]">{description}</p></div><Link href={href} className="btn min-h-12 w-fit bg-[#1f4550] px-5 text-white hover:bg-[#193b43]">{label} <span aria-hidden="true">↗</span></Link></div></section>;
}

export function MarketingPhoto({ src, alt, caption, priority = false }: { src: string; alt: string; caption: string; priority?: boolean }) {
  return <figure className="border border-[#d8d2c5] bg-white"><div className="relative aspect-[5/3] overflow-hidden"><Image src={src} alt={alt} fill sizes="(max-width: 1024px) 100vw, 42vw" className="object-cover" priority={priority} /><span className="absolute bottom-3 left-3 bg-[#f4f1ea]/90 px-2.5 py-1 text-[10px] font-semibold tracking-[.12em] text-[#193b43]">實際工作情境</span></div><figcaption className="border-t border-[#e9e4da] px-4 py-3 text-xs leading-5 text-[#6d7b76]">{caption}</figcaption></figure>;
}

type IntroVisualVariant = "product" | "solutions" | "pricing" | "contact";

export function PageIntroVisual({ variant, dark = false, photoSrc, photoAlt, photoCaption }: { variant: IntroVisualVariant; dark?: boolean; photoSrc?: string; photoAlt?: string; photoCaption?: string }) {
  const photo = photoSrc && photoAlt && photoCaption ? <MarketingPhoto src={photoSrc} alt={photoAlt} caption={photoCaption} priority /> : null;
  const shell = dark ? "border-[#6f9695] bg-[#f4f1ea]" : "border-[#d8d2c5] bg-white";
  if (variant === "product") return <div className={`border shadow-[0_20px_50px_rgba(22,55,62,.18)] ${shell}`}>{photo}<div className="grid gap-px bg-[#d8d2c5] sm:grid-cols-2"><div className="bg-[#193b43] p-5 text-white"><p className="eyebrow !text-[#e2b644]">入口與排程</p><h3 className="mt-3 text-xl font-bold">把服務安排好</h3><p className="mt-3 text-sm leading-6 text-[#c9dcda]">LINE、預約、報名、時段與場次在同一條工作流程裡。</p></div><div className="bg-[#fbfaf6] p-5 text-[#193b43]"><p className="eyebrow !text-[#b08116]">顧客與報表</p><h3 className="mt-3 text-xl font-bold">讓後續接得上</h3><p className="mt-3 text-sm leading-6 text-[#6d7b76]">通知、CRM Lite、回訪與營運統計留在品牌後台。</p></div></div><p className="border-t border-[#e9e4da] px-5 py-3 text-xs font-semibold text-[#5d6d6b]">依品牌實際工作方式配置，不要求所有產業使用同一套流程</p></div>;
  if (variant === "solutions") return <div className={`border shadow-[0_20px_50px_rgba(22,55,62,.12)] ${shell}`}>{photo}<div className="p-5"><div className="flex items-end justify-between border-b border-[#e9e4da] pb-4"><div><p className="eyebrow !text-[#b08116]">工作方式</p><h3 className="mt-2 text-xl font-bold text-[#193b43]">依服務目標選擇流程</h3></div><span className="font-mono text-xs text-[#7a8782]">01—06</span></div><div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 text-sm text-[#5d6d6b]"><span className="border-l-2 border-[#b08116] pl-3 font-semibold text-[#193b43]">一對一服務</span><span>課程／活動</span><span>健身／教學</span><span>美容／生活</span><span>場地／設備</span><span>多品牌集團</span></div></div></div>;
  if (variant === "pricing") return <div className={`border shadow-[0_20px_50px_rgba(22,55,62,.18)] ${shell}`}>{photo}<div className="grid gap-px bg-[#d8d2c5] sm:grid-cols-2"><div className="bg-[#193b43] p-5 text-white"><p className="eyebrow !text-[#e2b644]">標準功能</p><p className="mt-3 text-4xl font-bold">70</p><p className="mt-2 text-sm text-[#c9dcda]">全部開放，不拆方案</p></div><div className="bg-[#fbfaf6] p-5 text-[#193b43]"><p className="eyebrow !text-[#b08116]">加值項目</p><p className="mt-3 text-4xl font-bold">07</p><p className="mt-2 text-sm text-[#6d7b76]">清單外需求另行確認</p></div></div><p className="border-t border-[#e9e4da] px-5 py-3 text-xs font-semibold text-[#5d6d6b]">先確認範圍，再開發與共同驗收</p></div>;
  return <div className={`border shadow-[0_20px_50px_rgba(22,55,62,.12)] ${shell}`}>{photo}<div className="p-5"><div className="flex items-end justify-between border-b border-[#e9e4da] pb-4"><div><p className="eyebrow !text-[#b08116]">導入路徑</p><h3 className="mt-2 text-xl font-bold text-[#193b43]">從現況到可驗收</h3></div><span className="font-mono text-xs text-[#7a8782]">4 steps</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><OnboardingStep number="01" title="說明現況" detail="入口、排程、收款與通知" done /><OnboardingStep number="02" title="拆解角色" detail="品牌、團隊與顧客" done /><OnboardingStep number="03" title="排列優先" detail="標準流程、加購與客製" active /><OnboardingStep number="04" title="準備驗收" detail="場景、權限、隔離與結果" /></div></div></div>;
}

export function JourneyDiagram() {
  const steps = [{ number: "01", title: "顧客入口", detail: "LINE Rich Menu · LIFF · 瀏覽器", icon: "line" as IconName }, { number: "02", title: "品牌服務作業", detail: "時段 · 場次 · 付款 · 報到", icon: "calendar" as IconName }, { number: "03", title: "CRM Lite 與報表", detail: "提醒 · 分眾 · 回訪 · 營運分析", icon: "chart" as IconName }];
  return <div className="border-l-2 border-[#b08116] pl-5 sm:pl-7"><p className="eyebrow !text-[#b08116]">Operational flow</p><h3 className="mt-2 text-2xl font-bold text-[#193b43]">一條可追蹤的服務路徑</h3><div className="mt-7 space-y-5">{steps.map((step, index) => <div key={step.number} className="relative flex gap-4"><span className="absolute -left-[1.95rem] top-1 h-3 w-3 bg-[#e2b644] ring-4 ring-[#f4f1ea] sm:-left-[2.45rem]" /><FeatureIcon name={step.icon} compact /><div><p className="text-xs font-mono text-[#b08116]">{step.number}</p><p className="mt-1 font-bold text-[#193b43]">{step.title}</p><p className="mt-1 text-sm leading-6 text-[#6d7b76]">{step.detail}</p></div>{index < steps.length - 1 && <span className="absolute left-4 top-12 h-5 border-l border-dashed border-[#b08116]/50" aria-hidden="true" />}</div>)}</div></div>;
}

function SceneChip({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={`border px-3 py-2.5 text-sm font-medium ${active ? "border-[#1f4550] bg-[#1f4550] text-white" : "border-[#d8d2c5] bg-[#fbfaf6] text-[#6d7b76]"}`}>{label}</span>;
}

function OnboardingStep({ number, title, detail, done = false, active = false }: { number: string; title: string; detail: string; done?: boolean; active?: boolean }) {
  return <div className={`border p-3 ${active ? "border-[#b08116] bg-[#fbf1d9]" : "border-[#e1ddd3] bg-[#fbfaf6]"}`}><div className="flex items-center gap-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center text-[10px] font-bold ${done ? "bg-[#193b43] text-white" : active ? "bg-[#b08116] text-white" : "bg-[#e7e2d8] text-[#7a8782]"}`}>{done ? "✓" : number}</span><div className="min-w-0"><p className="text-xs font-bold text-[#193b43]">{title}</p><p className="mt-0.5 text-[10px] leading-5 text-[#6d7b76]">{detail}</p></div></div></div>;
}

export function SignalStrip({ items, dark = false }: { items: ReadonlyArray<{ label: string; value: string; detail: string; icon?: IconName }>; dark?: boolean }) {
  return <div className={`grid divide-y border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 ${dark ? "divide-white/15 border-white/20 text-white" : "divide-[#d8d2c5] border-[#cfc8ba] text-[#193b43]"}`}>{items.map((item) => <div key={item.label} className="flex items-start gap-3 px-4 py-5 first:pl-0 sm:px-5 lg:first:pl-0"><FeatureIcon name={item.icon ?? iconForLabel(item.label)} dark={dark} compact /><div><p className={`text-[10px] font-semibold uppercase tracking-[.15em] ${dark ? "text-[#e2b644]" : "text-[#b08116]"}`}>{item.label}</p><p className="mt-2 text-lg font-bold tracking-tight">{item.value}</p><p className={`mt-1 text-xs leading-5 ${dark ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{item.detail}</p></div></div>)}</div>;
}

export function WorkflowRail({ steps, dark = false }: { steps: ReadonlyArray<{ label: string; title: string; detail: string }>; dark?: boolean }) {
  return <div className={`overflow-x-auto border-y py-5 ${dark ? "border-white/15" : "border-[#cfc8ba]"}`}><div className="grid min-w-[700px] grid-cols-4 gap-5">{steps.map((step, index) => <div key={step.label} className="relative pr-5"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 ${index === steps.length - 1 ? "bg-[#e2b644]" : dark ? "bg-white/70" : "bg-[#1f4550]"}`} /><span className={`text-[10px] font-semibold uppercase tracking-[.14em] ${dark ? "text-[#e2b644]" : "text-[#b08116]"}`}>{step.label}</span></div><h3 className={`mt-4 text-lg font-bold ${dark ? "text-white" : "text-[#193b43]"}`}>{step.title}</h3><p className={`mt-2 text-sm leading-6 ${dark ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{step.detail}</p>{index < steps.length - 1 && <span className={`absolute right-0 top-1 h-12 border-r ${dark ? "border-white/15" : "border-[#d8d2c5]"}`} aria-hidden="true" />}</div>)}</div></div>;
}

export function DashboardMockup({ variant = "operations" }: { variant?: "operations" | "customer" | "marketing" }) {
  const content = {
    operations: { eyebrow: "品牌後台 / 今日工作", title: "團隊營運總覽", rows: [["預約與報名", "查看今日安排"], ["待處理狀態", "確認付款與報到"], ["通知作業", "查看提醒紀錄"]] },
    customer: { eyebrow: "品牌後台 / 顧客經營", title: "顧客互動時間軸", rows: [["顧客分眾", "依標籤與來源查看"], ["互動時間軸", "回看預約與報名"], ["CRM Lite", "安排下一個動作"]] },
    marketing: { eyebrow: "品牌後台 / 行銷自動化", title: "規則式行銷流程", rows: [["觸發條件", "依服務與互動判斷"], ["訊息管道", "LINE／Email 投遞"], ["投遞紀錄", "去重、重試與阻擋"]] },
  }[variant];
  return <div className="overflow-hidden border border-[#d8d2c5] bg-white shadow-[0_20px_45px_rgba(31,69,80,.12)]"><div className="flex items-center justify-between border-b border-[#e9e4da] px-4 py-3 sm:px-5"><div><p className="text-[10px] font-bold tracking-[.1em] text-[#193b43]">XINHOW WORKSPACE</p><p className="mt-0.5 text-[9px] text-[#7a8782]">品牌營運後台 · 功能畫面示意</p></div><span className="font-mono text-[10px] text-[#b08116]">/admin</span></div><div className="grid sm:grid-cols-[10rem_1fr]"><aside className="hidden bg-[#193b43] p-4 text-[10px] text-[#c4d8d5] sm:block"><p className="mb-3 text-[9px] font-semibold uppercase tracking-[.16em] text-[#e2b644]">Workspace</p>{["總覽", "預約／報名", "顧客 CRM", "報表", "品牌設定"].map((item, index) => <p key={item} className={`px-2 py-2.5 ${index === 0 ? "bg-white/10 font-semibold text-white" : ""}`}>{item}</p>)}</aside><div className="bg-[#fbfaf6] p-4 sm:p-6"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#b08116]">{content.eyebrow}</p><div className="mt-2 flex flex-wrap items-end justify-between gap-3"><h3 className="text-2xl font-bold text-[#193b43]">{content.title}</h3><span className="border border-[#cddbd5] px-3 py-2 text-[10px] font-semibold text-[#1f4550]">依角色查看</span></div><div className="mt-6 grid gap-3 sm:grid-cols-3">{content.rows.map(([label, text], index) => <div key={label} className={`border-t-2 p-3 ${index === 0 ? "border-[#b08116] bg-[#fbf1d9]" : "border-[#cddbd5] bg-white"}`}><p className="text-xs font-bold text-[#193b43]">{label}</p><p className="mt-2 text-[10px] leading-5 text-[#6d7b76]">{text}</p><span className="mt-4 inline-flex text-[10px] font-semibold text-[#b08116]">查看 →</span></div>)}</div><div className="mt-5 border border-[#d8d2c5] bg-white p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-[#193b43]">工作流程</p><span className="text-[10px] text-[#7a8782]">狀態可追蹤</span></div><div className="mt-4 grid gap-2 sm:grid-cols-4">{["入口", "安排", "完成", "回訪"].map((step, index) => <div key={step} className="flex items-center gap-2 text-[10px] text-[#5d6d6b]"><span className={`h-2.5 w-2.5 ${index < 2 ? "bg-[#1f4550]" : index === 2 ? "bg-[#e2b644]" : "bg-[#cddbd5]"}`} />{step}{index < 3 && <span className="ml-auto text-[#b08116]">→</span>}</div>)}</div></div></div></div></div>;
}

export function ScenarioMatrix() {
  const rows = [["入口", "LINE → LIFF", "活動連結", "品牌網址", "嵌入元件"], ["安排", "時間／人員", "場次／票種", "設備／場地", "共用資源"], ["完成", "提醒／回訪", "QR 報到", "付款／收據", "報表／分析"]];
  return <div className="overflow-x-auto border-y border-[#cfc8ba] bg-[#fbfaf6] px-4 py-5 sm:px-6"><div className="min-w-[720px]"><div className="grid grid-cols-[110px_repeat(4,1fr)] gap-2 border-b border-[#e9e4da] pb-3 text-[10px] font-semibold uppercase tracking-[.14em] text-[#7a8782]"><span>工作層</span><span>一對一服務</span><span>課程活動</span><span>場地設備</span><span>品牌入口</span></div>{rows.map(([label, ...values]) => <div key={label} className="grid grid-cols-[110px_repeat(4,1fr)] gap-2 border-b border-[#e9e4da] py-3 last:border-b-0"><span className="flex items-center border-l-2 border-[#b08116] bg-[#193b43] px-3 text-xs font-bold text-white">{label}</span>{values.map((value, index) => <span key={value} className={`border-l-2 px-3 py-3 text-xs font-semibold ${index === 0 ? "border-[#b08116] bg-[#fbf1d9] text-[#8a6816]" : "border-[#cddbd5] bg-[#e8f0ec] text-[#1f4550]"}`}>{value}</span>)}</div>)}</div></div>;
}

export function PricingVisual() {
  return <div className="grid gap-px border border-[#d8d2c5] bg-[#d8d2c5] sm:grid-cols-2"><div className="bg-[#193b43] p-6 text-white"><p className="eyebrow !text-[#e2b644]">標準交付</p><p className="mt-5 text-5xl font-bold">70</p><p className="mt-2 text-sm leading-6 text-[#c9dcda]">項標準功能全部開放</p><p className="mt-8 border-t border-white/15 pt-4 text-xs leading-5 text-[#a9c2be]">預約、報名、金流、CRM Lite、通知與報表</p></div><div className="bg-[#fbfaf6] p-6 text-[#193b43]"><p className="eyebrow !text-[#b08116]">另行確認</p><p className="mt-5 text-5xl font-bold">07</p><p className="mt-2 text-sm leading-6 text-[#6d7b76]">項加值或清單外需求</p><p className="mt-8 border-t border-[#d8d2c5] pt-4 text-xs leading-5 text-[#6d7b76]">先確認範圍、交付內容與時程，再進入開發</p></div></div>;
}

function SceneLine({ label, text, accent = false }: { label: string; text: string; accent?: boolean }) {
  return <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-3"><FeatureIcon name={label === "現場情況" ? "users" : label === "系統怎麼接" ? "settings" : "chart"} compact /><div><p className={`text-xs font-semibold ${accent ? "text-[#b08116]" : "text-[#7a8782]"}`}>{label}</p><p className={`mt-1 leading-6 ${accent ? "font-medium text-[#1f4550]" : "text-[#5d6d6b]"}`}>{text}</p></div></div>;
}

function ConfigPill({ title, value }: { title: string; value: string }) {
  return <div className="flex gap-3 border-t border-white/20 py-4"><FeatureIcon name={title === "預約模式" ? "calendar" : title === "服務目標" ? "users" : title === "顧客入口" ? "line" : "layers"} dark compact /><div><p className="text-xs text-[#a9c2be]">{title}</p><p className="mt-2 font-semibold text-white">{value}</p></div></div>;
}

export { SceneChip, SceneLine, ConfigPill };
