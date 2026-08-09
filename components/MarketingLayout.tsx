import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export type IconName = "calendar" | "ticket" | "message" | "layers" | "chart" | "users" | "globe" | "spark" | "phone" | "mail" | "line" | "settings" | "check";

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
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.5-1H6v-2.4h.2a1.7 1.7 0 0 0 1.5-1A1.7 1.7 0 0 0 7 8.7L7 8.6 8.7 7l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
};

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

function cleanHeading(text: string) {
  return text.replace(/[，。！？：；、,.!?;:]/g, "");
}

export function FeatureIcon({ name, dark = false, compact = false }: { name: IconName; dark?: boolean; compact?: boolean }) {
  const shell = `inline-flex shrink-0 items-center justify-center rounded-[1rem] border shadow-[0_8px_18px_rgba(31,69,80,.08)] ${compact ? "h-10 w-10" : "h-12 w-12"} ${dark ? "border-[#f1ca5b]/40 bg-[#f1ca5b] text-[#193b43]" : "border-[#d8d2c5] bg-[#fffaf0] text-[#1f4550]"}`;
  if (name === "line") return <span className={shell} aria-hidden="true"><Image src="/brand/line-brand-icon.png" alt="" width={compact ? 22 : 26} height={compact ? 22 : 26} className="object-contain" /></span>;
  return <span className={shell} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={compact ? "h-4 w-4" : "h-5 w-5"}>{iconPaths[name]}</svg></span>;
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return <main className="marketing-shell min-h-screen overflow-x-clip text-[#193b43]"><div className="pointer-events-none fixed inset-0 z-0 opacity-60" aria-hidden="true"><div className="absolute left-[-8rem] top-[20rem] h-[26rem] w-[26rem] rounded-full bg-[#e2b644]/10 blur-3xl" /><div className="absolute right-[-10rem] top-[72rem] h-[32rem] w-[32rem] rounded-full bg-[#1f4550]/10 blur-3xl" /></div><div className="relative z-10"><MarketingHeader />{children}<MarketingFooter /></div></main>;
}

export function MarketingHeader() {
  return <header className="sticky top-0 z-30 border-b border-[#e3dccd]/80 bg-[#f7f2e8]/90 backdrop-blur-xl"><div className="mx-auto flex min-h-[4.75rem] max-w-7xl items-center gap-4 px-5 sm:px-8 lg:px-10"><Link href="/" className="flex min-h-11 shrink-0 items-center" aria-label="回到星昊科技首頁"><Image src="/brand/xinhao-horizontal.png" alt="星昊科技 XINHOW" width={2048} height={1024} className="h-11 w-28 object-contain" priority /></Link><nav className="ml-auto hidden items-center gap-1 text-sm font-semibold text-[#536864] md:flex" aria-label="行銷網站主選單"><NavLink href="/product">產品能力</NavLink><NavLink href="/solutions">產業場景</NavLink><NavLink href="/pricing">方案與服務</NavLink><NavLink href="/contact">聯絡導入</NavLink><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="ml-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#d9f5e4] px-4 font-bold text-[#087f4e] transition hover:bg-[#c6efd6]"><FeatureIcon name="line" compact />官方 LINE</a></nav><div className="ml-auto flex items-center gap-2 md:hidden"><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#cfd8d1] bg-white/70 text-[#087f4e] transition hover:bg-white" aria-label="開啟官方 LINE"><FeatureIcon name="line" compact /></a><details className="relative"><summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-[#cfd8d1] bg-white/70 text-[#1f4550] transition hover:bg-white [&::-webkit-details-marker]:hidden" aria-label="開啟網站選單"><FeatureIcon name="layers" compact /></summary><div className="absolute right-0 top-12 z-50 w-56 rounded-[1.4rem] border border-[#d8d2c5] bg-[#fffaf0] p-3 shadow-[0_18px_40px_rgba(31,69,80,.16)]"><p className="border-b border-[#d8d2c5] px-3 pb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#b08116]">網站選單</p><div className="grid gap-1 pt-2"><MobileNavLink href="/product" icon="layers">產品能力</MobileNavLink><MobileNavLink href="/solutions" icon="globe">產業場景</MobileNavLink><MobileNavLink href="/pricing" icon="chart">方案與服務</MobileNavLink><MobileNavLink href="/contact" icon="message">聯絡導入</MobileNavLink></div></div></details></div><Link href="/admin/login" className="btn min-h-11 shrink-0 rounded-full border border-[#1f4550] bg-[#1f4550] px-4 text-xs font-bold text-white hover:bg-[#193b43] sm:px-5 sm:text-sm">後台登入</Link></div></header>;
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center rounded-full px-4 transition hover:bg-white hover:text-[#b08116]">{children}</Link>;
}

function MobileNavLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  return <Link href={href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-[#1f4550] transition hover:bg-white"><FeatureIcon name={icon} compact />{children}<span className="ml-auto text-[#b08116]" aria-hidden="true">↗</span></Link>;
}

export function MarketingFooter() {
  return <footer className="bg-[#193b43] px-5 py-14 text-[#dfe9e5] sm:px-8 lg:px-10"><div className="mx-auto grid max-w-7xl gap-10 border-b border-white/15 pb-10 md:grid-cols-[1.4fr_.7fr_.9fr] md:items-start"><div><div className="flex items-center gap-3"><Image src="/brand/xinhao-gold-dark.png" alt="星昊科技 XINHOW" width={1536} height={1536} className="h-12 w-12 object-contain" /><div><p className="font-display font-bold tracking-[0.1em]">星昊科技 XINHOW</p><p className="mt-1 text-xs text-[#a9c2be]">服務流程的營運基礎</p></div></div><p className="mt-5 max-w-md text-sm leading-7 text-[#a9c2be]">多品牌預約與報名 SaaS 從顧客入口到日常經營讓團隊在同一條工作流程上協作</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Navigate</p><div className="mt-4 grid gap-3 text-sm text-[#c5d5d1]"><Link href="/product" className="hover:text-white">產品能力</Link><Link href="/solutions" className="hover:text-white">產業場景</Link><Link href="/pricing" className="hover:text-white">方案與服務</Link><Link href="/contact" className="hover:text-white">聯絡導入</Link></div></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Contact</p><div className="mt-4 grid gap-3 text-sm text-[#c5d5d1]"><a href="tel:079721612" className="hover:text-white">07-9721612</a><a href="mailto:service@xinhow.com.tw" className="break-all hover:text-white">service@xinhow.com.tw</a><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="hover:text-white">官方 LINE @xinhow</a><Link href="/admin/login" className="hover:text-white">管理後台登入</Link></div></div></div><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 pt-5 text-xs text-[#86a39e]"><span>© 星昊科技 XINHOW · 多品牌預約與報名 SaaS</span><span>以真實流程開始 以可驗收結果交付</span></div></footer>;
}

export function PageIntro({ eyebrow, title, description, children, visual, dark = false }: { eyebrow: string; title: string; description: string; children?: ReactNode; visual?: ReactNode; dark?: boolean }) {
  return <section className={`relative overflow-hidden border-b ${dark ? "border-[#35616a] bg-[#1f4550] text-white" : "border-[#e3dccd] bg-[#f7f2e8]"}`}><div className="absolute right-0 top-0 h-full w-1/3 border-l border-white/10 opacity-30" aria-hidden="true" /><div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-16 lg:px-10"><div className="max-w-2xl"><p className={`eyebrow ${dark ? "!text-[#f1ca5b]" : "!text-[#b08116]"}`}>{eyebrow}</p><h1 className={`font-display max-w-2xl text-[clamp(2.2rem,4.5vw,4rem)] font-black leading-[1.08] tracking-[-0.055em] ${dark ? "text-white" : "text-[#193b43]"}`}>{cleanHeading(title)}</h1><p className={`mt-6 max-w-xl text-base leading-8 sm:text-lg ${dark ? "text-[#c4d8d5]" : "text-[#5d6d6b]"}`}>{description}</p>{children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}</div><div>{visual ?? <div className={`rounded-[2rem] border-l-4 pl-6 text-sm leading-7 ${dark ? "border-[#f1ca5b] text-[#c4d8d5]" : "border-[#b08116] text-[#6d7b76]"}`}>把服務入口 排程 通知與後續經營放在同一條可理解的工作流程裡</div>}</div></div></section>;
}

export function SectionHeading({ eyebrow, title, description, align = "left" }: { eyebrow: string; title: string; description?: string; align?: "left" | "center" }) {
  return <div className={`${align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}`}><div className={`mb-5 flex items-center gap-3 ${align === "center" ? "justify-center" : ""}`} aria-hidden="true"><span className="h-1.5 w-12 rounded-full bg-[#b08116]" /><span className="h-2.5 w-2.5 rounded-full bg-[#e2b644]" /></div><p className="eyebrow !mb-0 !text-[#b08116]">{eyebrow}</p><h2 className="font-display mt-3 text-[clamp(1.8rem,3.15vw,2.7rem)] font-black leading-[1.14] tracking-[-0.045em] text-[#193b43]">{cleanHeading(title)}</h2>{description && <p className="mt-4 text-base leading-7 text-[#5d6d6b]">{description}</p>}</div>;
}

export function ArrowLink({ href, children, dark = false }: { href: string; children: ReactNode; dark?: boolean }) {
  return <Link href={href} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold transition ${dark ? "bg-[#f1ca5b] text-[#193b43] hover:bg-white" : "bg-[#193b43] text-white hover:bg-[#b08116]"}`}>{children}<span aria-hidden="true">↗</span></Link>;
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

const moduleTheme: Record<ModuleKind, { accent: string; soft: string; label: string }> = {
  booking: { accent: "#e2b644", soft: "#fff2c9", label: "預約工作畫面" },
  registration: { accent: "#d56e4d", soft: "#fde4dc", label: "活動工作畫面" },
  entrance: { accent: "#2b9d78", soft: "#d9f5e4", label: "顧客入口畫面" },
  crm: { accent: "#8c6bd1", soft: "#ece4ff", label: "顧客經營畫面" },
  brand: { accent: "#2c7594", soft: "#dceef5", label: "品牌設定畫面" },
  reports: { accent: "#c06b25", soft: "#f7e4d1", label: "營運分析畫面" },
};

export function ModuleInterface({ kind, compact = false }: { kind: ModuleKind; compact?: boolean }) {
  const views: Record<ModuleKind, { section: string; title: string; tabs: string[]; rows: string[]; note: string }> = {
    booking: { section: "預約與服務", title: "服務排程", tabs: ["預約日曆", "預約列表", "服務排程"], rows: ["可用時段", "已確認", "待處理"], note: "依服務目標安排時段與容量" },
    registration: { section: "活動與課程", title: "報名作業", tabs: ["活動與課程", "報名名單", "報到管理"], rows: ["場次與票種", "候補名單", "QR 報到"], note: "從活動設定一路接到現場報到" },
    entrance: { section: "入口與通知", title: "顧客入口", tabs: ["LINE → LIFF", "瀏覽器備援", "Email 通知"], rows: ["Rich Menu", "品牌網址", "訊息紀錄"], note: "讓顧客用熟悉的方式進入" },
    crm: { section: "顧客經營", title: "CRM Lite", tabs: ["顧客清單", "互動時間軸", "分眾與自動化"], rows: ["標籤分眾", "預約與報名紀錄", "下一個動作"], note: "看懂互動脈絡再安排回訪" },
    brand: { section: "品牌設定", title: "品牌營運設定", tabs: ["品牌資料", "成員與權限", "資料範圍"], rows: ["品牌入口", "角色權限", "操作稽核"], note: "每個品牌依自己的工作方式設定" },
    reports: { section: "營運分析", title: "營運報表", tabs: ["預約統計", "報名統計", "付款與出席"], rows: ["日期範圍", "狀態分析", "匯出報表"], note: "把營運狀態整理成可回看的資料" },
  };
  const view = views[kind];
  const theme = moduleTheme[kind];
  return <div className={`${compact ? "mt-5" : "mt-8"} relative overflow-hidden rounded-[2rem] border border-white/80 bg-white p-2 shadow-[0_22px_55px_rgba(31,69,80,.16)]`} aria-label={`${view.title}介面示意`}><div className="rounded-[1.5rem] bg-[#f7f2e8] p-3 sm:p-4"><div className="flex items-center justify-between gap-3 border-b border-[#e3dccd] pb-3"><div className="flex items-center gap-2"><span className="flex gap-1" aria-hidden="true"><i className="h-2 w-2 rounded-full bg-[#d56e4d]" /><i className="h-2 w-2 rounded-full bg-[#e2b644]" /><i className="h-2 w-2 rounded-full bg-[#2b9d78]" /></span><span className="text-[10px] font-bold tracking-[.14em] text-[#193b43]">XINHOW WORKSPACE</span></div><span className="rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ backgroundColor: theme.soft, color: theme.accent }}>介面示意</span></div><div className="mt-3 grid gap-3 sm:grid-cols-[7.5rem_1fr]"><aside className="rounded-[1.1rem] bg-[#193b43] p-2 text-[10px] text-[#dce9e6]"><p className="px-2 pb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#f1ca5b]">{view.section}</p>{view.tabs.map((tab, index) => <p key={tab} className={`rounded-lg px-2 py-2 ${index === 0 ? "bg-white/15 font-bold text-white" : "text-[#a9c2be]"}`}>{tab}</p>)}</aside><div className="min-w-0 rounded-[1.1rem] bg-white p-3 sm:p-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.14em]" style={{ color: theme.accent }}>{theme.label}</p><p className="font-display mt-1 text-xl font-black tracking-[-0.035em] text-[#193b43]">{view.title}</p></div><span className="rounded-full border border-[#d8d2c5] px-2.5 py-1 text-[9px] font-semibold text-[#6d7b76]">品牌後台</span></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{view.rows.map((row, index) => <div key={row} className="rounded-xl border border-[#eee7d9] p-2.5" style={{ borderTopColor: theme.accent, backgroundColor: index === 0 ? theme.soft : "#fff" }}><p className="text-[10px] font-bold text-[#193b43]">{row}</p><div className="mt-3 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: theme.accent }} /><span className="h-1.5 w-12 rounded-full bg-[#dce4dd]" /><span className="h-1.5 w-5 rounded-full bg-[#edf0ea]" /></div></div>)}</div><div className="mt-3 flex items-center gap-2 rounded-xl bg-[#f7f2e8] px-3 py-2.5 text-[10px] font-semibold text-[#5d6d6b]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.accent }} />{view.note}<span className="ml-auto text-[#b08116]">查看 →</span></div></div></div></div></div>;
}

export function CapabilityCard({ number, title, description, href = "/product" }: { number: string; title: string; description: string; href?: string }) {
  return <Link href={href} className="group relative block overflow-hidden rounded-[2rem] border border-white/80 bg-[#fffaf0] p-4 shadow-[0_16px_40px_rgba(31,69,80,.08)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_55px_rgba(31,69,80,.16)] sm:p-5"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><FeatureIcon name={iconForLabel(title)} compact /><span className="rounded-full bg-[#f7ead0] px-2.5 py-1 font-mono text-[10px] font-bold text-[#a06e13]">{number}</span></div><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#193b43] text-sm text-white transition group-hover:rotate-45" aria-hidden="true">↗</span></div><h3 className="font-display mt-5 text-xl font-black tracking-[-0.035em] text-[#193b43]">{cleanHeading(title)}</h3><p className="mt-2 text-sm leading-7 text-[#6d7b76]">{description}</p><ModuleInterface kind={moduleKindForTitle(title)} compact /><p className="mt-4 text-[10px] font-bold tracking-[.12em] text-[#8a6816]">看這個工作模組</p></Link>;
}

export function Callout({ title, description, href = "/contact", label = "開始規劃" }: { title: string; description: string; href?: string; label?: string }) {
  return <section className="border-y border-[#d6c69c] bg-[#f5d77c] px-5 py-16 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow !text-[#8a6816]">Next step</p><h2 className="font-display max-w-2xl text-[clamp(1.85rem,3.2vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em] text-[#193b43]">{cleanHeading(title)}</h2><p className="mt-4 max-w-2xl text-base leading-7 text-[#536864]">{description}</p></div><Link href={href} className="btn min-h-12 w-fit rounded-full bg-[#193b43] px-6 font-bold text-white hover:bg-[#b08116]">{label} <span aria-hidden="true">↗</span></Link></div></section>;
}

export function MarketingPhoto({ src, alt, caption, priority = false }: { src: string; alt: string; caption: string; priority?: boolean }) {
  return <figure className="overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_20px_50px_rgba(31,69,80,.14)]"><div className="relative aspect-[5/3] overflow-hidden"><Image src={src} alt={alt} fill sizes="(max-width: 1024px) 100vw, 42vw" className="object-cover transition duration-700 hover:scale-[1.03]" priority={priority} /><span className="absolute bottom-4 left-4 rounded-full bg-[#fffaf0]/90 px-3 py-1.5 text-[10px] font-bold tracking-[.1em] text-[#193b43]">實際工作情境</span></div><figcaption className="bg-[#fffaf0] px-5 py-4 text-xs leading-5 text-[#6d7b76]">{caption}</figcaption></figure>;
}

export function PhotoBand({ src, alt, eyebrow, title, description, children, dark = true }: { src: string; alt: string; eyebrow: string; title: string; description: string; children?: ReactNode; dark?: boolean }) {
  return <section className="relative isolate min-h-[30rem] overflow-hidden"><Image src={src} alt={alt} fill sizes="100vw" className="object-cover" /><div className={`absolute inset-0 ${dark ? "bg-[linear-gradient(90deg,rgba(20,54,62,.94),rgba(20,54,62,.72)_48%,rgba(20,54,62,.25))]" : "bg-[linear-gradient(90deg,rgba(247,242,232,.95),rgba(247,242,232,.68)_52%,rgba(247,242,232,.18))]"}`} /><div className="relative mx-auto flex min-h-[30rem] max-w-7xl items-end px-5 py-14 sm:px-8 sm:py-20 lg:px-10"><div className="max-w-xl"><p className={`eyebrow ${dark ? "!text-[#f1ca5b]" : "!text-[#b08116]"}`}>{eyebrow}</p><h2 className={`font-display text-[clamp(2rem,4vw,3.5rem)] font-black leading-[1.08] tracking-[-0.05em] ${dark ? "text-white" : "text-[#193b43]"}`}>{cleanHeading(title)}</h2><p className={`mt-5 text-base leading-8 ${dark ? "text-[#dce9e6]" : "text-[#536864]"}`}>{description}</p>{children && <div className="mt-7 flex flex-wrap gap-3">{children}</div>}</div></div></section>;
}

type IntroVisualVariant = "product" | "solutions" | "pricing" | "contact";

export function PageIntroVisual({ variant, dark = false, photoSrc, photoAlt, photoCaption }: { variant: IntroVisualVariant; dark?: boolean; photoSrc?: string; photoAlt?: string; photoCaption?: string }) {
  const photo = photoSrc && photoAlt && photoCaption ? <MarketingPhoto src={photoSrc} alt={photoAlt} caption={photoCaption} priority /> : null;
  const shell = dark ? "border-[#6f9695] bg-[#f7f2e8]" : "border-[#e3dccd] bg-white";
  if (variant === "product") return <div className={`rounded-[2rem] border p-2 shadow-[0_24px_60px_rgba(22,55,62,.2)] ${shell}`}>{photo}<div className="grid gap-2 p-2 sm:grid-cols-2"><div className="rounded-[1.3rem] bg-[#193b43] p-5 text-white"><p className="eyebrow !text-[#f1ca5b]">入口與排程</p><h3 className="font-display mt-3 text-xl font-black">把服務安排好</h3><p className="mt-3 text-sm leading-6 text-[#c9dcda]">LINE 預約 報名 時段與場次在同一條工作流程裡</p></div><div className="rounded-[1.3rem] bg-[#fffaf0] p-5 text-[#193b43]"><p className="eyebrow !text-[#b08116]">顧客與報表</p><h3 className="font-display mt-3 text-xl font-black">讓後續接得上</h3><p className="mt-3 text-sm leading-6 text-[#6d7b76]">通知 CRM Lite 回訪與營運統計留在品牌後台</p></div></div></div>;
  if (variant === "solutions") return <div className={`rounded-[2rem] border p-2 shadow-[0_24px_60px_rgba(22,55,62,.16)] ${shell}`}>{photo}<div className="p-4 sm:p-5"><div className="flex items-end justify-between gap-4 border-b border-[#e3dccd] pb-4"><div><p className="eyebrow !text-[#b08116]">工作方式</p><h3 className="font-display mt-2 text-xl font-black text-[#193b43]">依服務目標選擇流程</h3></div><span className="rounded-full bg-[#d9f5e4] px-3 py-1.5 text-[10px] font-bold text-[#087f4e]">01—06</span></div><div className="mt-5 grid grid-cols-2 gap-2 text-sm text-[#5d6d6b]">{["一對一服務", "課程／活動", "健身／教學", "美容／生活", "場地／設備", "多品牌服務"].map((item, index) => <span key={item} className={`rounded-xl px-3 py-3 font-semibold ${index === 0 ? "bg-[#f5d77c] text-[#193b43]" : "bg-[#f7f2e8]"}`}>{item}</span>)}</div></div></div>;
  if (variant === "pricing") return <div className={`rounded-[2rem] border p-2 shadow-[0_24px_60px_rgba(22,55,62,.18)] ${shell}`}>{photo}<div className="grid gap-2 p-2 sm:grid-cols-2"><div className="rounded-[1.3rem] bg-[#193b43] p-6 text-white"><p className="eyebrow !text-[#f1ca5b]">標準交付</p><p className="font-display mt-3 text-6xl font-black">70</p><p className="mt-2 text-sm text-[#c9dcda]">項標準功能全部開放</p></div><div className="rounded-[1.3rem] bg-[#fffaf0] p-6 text-[#193b43]"><p className="eyebrow !text-[#b08116]">另行確認</p><p className="font-display mt-3 text-6xl font-black">07</p><p className="mt-2 text-sm text-[#6d7b76]">項加值或清單外需求</p></div></div></div>;
  return <div className={`rounded-[2rem] border p-2 shadow-[0_24px_60px_rgba(22,55,62,.16)] ${shell}`}>{photo}<div className="p-4"><div className="flex items-end justify-between gap-4 border-b border-[#e3dccd] pb-4"><div><p className="eyebrow !text-[#b08116]">導入路徑</p><h3 className="font-display mt-2 text-xl font-black text-[#193b43]">從現況到可驗收</h3></div><span className="rounded-full bg-[#dceef5] px-3 py-1.5 text-[10px] font-bold text-[#2c7594]">4 steps</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><OnboardingStep number="01" title="說明現況" detail="入口 排程 收款與通知" done /><OnboardingStep number="02" title="拆解角色" detail="品牌 團隊與顧客" done /><OnboardingStep number="03" title="排列優先" detail="標準流程 加購與客製" active /><OnboardingStep number="04" title="準備驗收" detail="場景 權限 隔離與結果" /></div></div></div>;
}

export function JourneyDiagram() {
  const steps = [{ number: "01", title: "顧客入口", detail: "LINE Rich Menu · LIFF · 瀏覽器", icon: "line" as IconName }, { number: "02", title: "品牌服務作業", detail: "時段 · 場次 · 付款 · 報到", icon: "calendar" as IconName }, { number: "03", title: "CRM Lite 與報表", detail: "提醒 · 分眾 · 回訪 · 營運分析", icon: "chart" as IconName }];
  return <div className="rounded-[2rem] bg-[#fffaf0] p-5 shadow-[0_20px_50px_rgba(31,69,80,.12)] sm:p-7"><p className="eyebrow !text-[#b08116]">Operational flow</p><h3 className="font-display mt-2 text-2xl font-black text-[#193b43]">一條可追蹤的服務路徑</h3><div className="mt-7 space-y-3">{steps.map((step, index) => <div key={step.number} className="relative flex gap-4 rounded-[1.25rem] bg-[#f7f2e8] p-3.5"><FeatureIcon name={step.icon} compact /><div><p className="text-[10px] font-bold text-[#b08116]">{step.number}</p><p className="font-bold text-[#193b43]">{step.title}</p><p className="mt-1 text-sm leading-6 text-[#6d7b76]">{step.detail}</p></div>{index < steps.length - 1 && <span className="absolute bottom-[-.7rem] left-8 h-3 border-l-2 border-dashed border-[#e2b644]" aria-hidden="true" />}</div>)}</div></div>;
}

function SceneChip({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={`rounded-full px-3 py-2 text-sm font-semibold ${active ? "bg-[#193b43] text-white" : "bg-[#fffaf0] text-[#6d7b76]"}`}>{label}</span>;
}

function OnboardingStep({ number, title, detail, done = false, active = false }: { number: string; title: string; detail: string; done?: boolean; active?: boolean }) {
  return <div className={`rounded-[1.2rem] p-3 ${active ? "bg-[#fff0c2]" : "bg-[#fffaf0]"}`}><div className="flex items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[#193b43] text-white" : active ? "bg-[#b08116] text-white" : "bg-[#e7e2d8] text-[#7a8782]"}`}>{done ? "✓" : number}</span><div className="min-w-0"><p className="text-xs font-bold text-[#193b43]">{title}</p><p className="mt-0.5 text-[10px] leading-5 text-[#6d7b76]">{detail}</p></div></div></div>;
}

export function SignalStrip({ items, dark = false }: { items: ReadonlyArray<{ label: string; value: string; detail: string; icon?: IconName }>; dark?: boolean }) {
  return <div className={`grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${dark ? "text-white" : "text-[#193b43]"}`}>{items.map((item) => <div key={item.label} className={`rounded-[1.5rem] p-4 ${dark ? "bg-white/10" : "bg-[#fffaf0] shadow-[0_12px_30px_rgba(31,69,80,.08)]"}`}><div className="flex items-start gap-3"><FeatureIcon name={item.icon ?? iconForLabel(item.label)} dark={dark} compact /><div><p className={`text-[10px] font-bold uppercase tracking-[.14em] ${dark ? "text-[#f1ca5b]" : "text-[#b08116]"}`}>{item.label}</p><p className="mt-2 text-lg font-black tracking-tight">{item.value}</p><p className={`mt-1 text-xs leading-5 ${dark ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{item.detail}</p></div></div></div>)}</div>;
}

export function WorkflowRail({ steps, dark = false }: { steps: ReadonlyArray<{ label: string; title: string; detail: string }>; dark?: boolean }) {
  return <div className="overflow-x-auto pb-2"><div className="grid min-w-[700px] grid-cols-4 gap-3">{steps.map((step, index) => <div key={step.label} className={`relative rounded-[1.5rem] p-5 ${dark ? "bg-white/10" : "bg-[#fffaf0] shadow-[0_12px_30px_rgba(31,69,80,.08)]"}`}><div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${index === steps.length - 1 ? "bg-[#f1ca5b]" : dark ? "bg-white/70" : "bg-[#1f4550]"}`} /><span className={`text-[10px] font-bold uppercase tracking-[.14em] ${dark ? "text-[#f1ca5b]" : "text-[#b08116]"}`}>{step.label}</span></div><h3 className={`font-display mt-4 text-lg font-black ${dark ? "text-white" : "text-[#193b43]"}`}>{cleanHeading(step.title)}</h3><p className={`mt-2 text-sm leading-6 ${dark ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{step.detail}</p></div>)}</div></div>;
}

export function DashboardMockup({ variant = "operations" }: { variant?: "operations" | "customer" | "marketing" }) {
  const content = {
    operations: { eyebrow: "品牌後台 / 今日工作", title: "團隊營運總覽", rows: [["預約與報名", "查看今日安排"], ["待處理狀態", "確認付款與報到"], ["通知作業", "查看提醒紀錄"]] },
    customer: { eyebrow: "品牌後台 / 顧客經營", title: "顧客互動時間軸", rows: [["顧客分眾", "依標籤與來源查看"], ["互動時間軸", "回看預約與報名"], ["CRM Lite", "安排下一個動作"]] },
    marketing: { eyebrow: "品牌後台 / 行銷自動化", title: "規則式行銷流程", rows: [["觸發條件", "依服務與互動判斷"], ["訊息管道", "LINE／Email 投遞"], ["投遞紀錄", "去重 重試與阻擋"]] },
  }[variant];
  return <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-white p-2 shadow-[0_25px_60px_rgba(31,69,80,.2)]"><div className="rounded-[1.5rem] bg-[#f7f2e8] p-3 sm:p-5"><div className="flex items-center justify-between border-b border-[#e3dccd] pb-3"><div><p className="text-[10px] font-black tracking-[.12em] text-[#193b43]">XINHOW WORKSPACE</p><p className="mt-0.5 text-[9px] text-[#7a8782]">品牌營運後台 · 功能畫面示意</p></div><span className="rounded-full bg-[#dceef5] px-3 py-1.5 text-[9px] font-bold text-[#2c7594]">品牌後台</span></div><div className="mt-3 grid sm:grid-cols-[9.5rem_1fr] sm:gap-3"><aside className="hidden rounded-[1.2rem] bg-[#193b43] p-3 text-[10px] text-[#dce9e6] sm:block"><p className="mb-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#f1ca5b]">Workspace</p>{["總覽", "預約／報名", "顧客 CRM", "報表", "品牌設定"].map((item, index) => <p key={item} className={`rounded-lg px-2 py-2.5 ${index === 0 ? "bg-white/15 font-bold text-white" : "text-[#a9c2be]"}`}>{item}</p>)}</aside><div className="rounded-[1.2rem] bg-white p-4 sm:p-5"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#b08116]">{content.eyebrow}</p><div className="mt-2 flex flex-wrap items-end justify-between gap-3"><h3 className="font-display text-2xl font-black tracking-[-0.04em] text-[#193b43]">{cleanHeading(content.title)}</h3><span className="rounded-full border border-[#d8d2c5] px-3 py-1.5 text-[10px] font-bold text-[#1f4550]">依角色查看</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{content.rows.map(([label, text], index) => <div key={label} className={`rounded-[1.1rem] border border-[#eee7d9] p-3 ${index === 0 ? "bg-[#fff0c2]" : "bg-[#fffaf0]"}`}><p className="text-xs font-black text-[#193b43]">{label}</p><p className="mt-2 text-[10px] leading-5 text-[#6d7b76]">{text}</p><span className="mt-4 inline-flex text-[10px] font-bold text-[#b08116]">查看 →</span></div>)}</div><div className="mt-4 rounded-[1.1rem] bg-[#f7f2e8] p-4"><div className="flex items-center justify-between"><p className="text-xs font-black text-[#193b43]">工作流程</p><span className="text-[10px] text-[#7a8782]">狀態可追蹤</span></div><div className="mt-4 grid gap-2 sm:grid-cols-4">{["入口", "安排", "完成", "回訪"].map((step, index) => <div key={step} className="flex items-center gap-2 text-[10px] text-[#5d6d6b]"><span className={`h-2.5 w-2.5 rounded-full ${index < 2 ? "bg-[#1f4550]" : index === 2 ? "bg-[#e2b644]" : "bg-[#cddbd5]"}`} />{step}{index < 3 && <span className="ml-auto text-[#b08116]">→</span>}</div>)}</div></div></div></div></div></div>;
}

export function ScenarioMatrix() {
  const rows = [["入口", "LINE → LIFF", "活動連結", "品牌網址", "嵌入元件"], ["安排", "時間／人員", "場次／票種", "設備／場地", "共用資源"], ["完成", "提醒／回訪", "QR 報到", "付款／收據", "報表／分析"]];
  return <div className="overflow-x-auto rounded-[2rem] bg-[#fffaf0] p-3 shadow-[0_18px_40px_rgba(31,69,80,.08)] sm:p-5"><div className="min-w-[720px]"><div className="grid grid-cols-[110px_repeat(4,1fr)] gap-2 px-2 pb-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#7a8782]"><span>工作層</span><span>一對一服務</span><span>課程活動</span><span>場地設備</span><span>品牌入口</span></div>{rows.map(([label, ...values]) => <div key={label} className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-2"><span className="flex items-center rounded-xl bg-[#193b43] px-3 text-xs font-black text-white">{label}</span>{values.map((value, index) => <span key={value} className={`rounded-xl px-3 py-3 text-xs font-bold ${index === 0 ? "bg-[#fff0c2] text-[#8a6816]" : "bg-[#eef3ef] text-[#1f4550]"}`}>{value}</span>)}</div>)}</div></div>;
}

export function PricingVisual() {
  return <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-[2rem] bg-[#193b43] p-7 text-white shadow-[0_18px_40px_rgba(31,69,80,.16)]"><p className="eyebrow !text-[#f1ca5b]">標準交付</p><p className="font-display mt-4 text-6xl font-black">70</p><p className="mt-2 text-sm leading-6 text-[#c9dcda]">項標準功能全部開放</p><p className="mt-8 border-t border-white/15 pt-4 text-xs leading-5 text-[#a9c2be]">預約 報名 金流 CRM Lite 通知與報表</p></div><div className="rounded-[2rem] bg-[#fffaf0] p-7 text-[#193b43] shadow-[0_18px_40px_rgba(31,69,80,.08)]"><p className="eyebrow !text-[#b08116]">另行確認</p><p className="font-display mt-4 text-6xl font-black">07</p><p className="mt-2 text-sm leading-6 text-[#6d7b76]">項加值或清單外需求</p><p className="mt-8 border-t border-[#e3dccd] pt-4 text-xs leading-5 text-[#6d7b76]">先確認範圍 交付內容與時程再進入開發</p></div></div>;
}

function SceneLine({ label, text, accent = false }: { label: string; text: string; accent?: boolean }) {
  return <div className="flex gap-3 rounded-[1.2rem] bg-[#f7f2e8] p-3"><FeatureIcon name={label === "現場情況" ? "users" : label === "系統怎麼接" ? "settings" : "chart"} compact /><div><p className={`text-xs font-bold ${accent ? "text-[#b08116]" : "text-[#7a8782]"}`}>{label}</p><p className={`mt-1 leading-6 ${accent ? "font-bold text-[#1f4550]" : "text-[#5d6d6b]"}`}>{text}</p></div></div>;
}

function ConfigPill({ title, value }: { title: string; value: string }) {
  return <div className="flex gap-3 rounded-[1.4rem] bg-white/10 p-4"><FeatureIcon name={title === "預約模式" ? "calendar" : title === "服務目標" ? "users" : title === "顧客入口" ? "line" : "layers"} dark compact /><div><p className="text-xs text-[#a9c2be]">{title}</p><p className="mt-2 font-bold text-white">{value}</p></div></div>;
}

export { SceneChip, SceneLine, ConfigPill };
