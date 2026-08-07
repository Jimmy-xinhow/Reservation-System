import Image from "next/image";
import Link from "next/link";

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen overflow-hidden bg-[#f7f5ef] text-[#193b43]"><MarketingHeader />{children}<MarketingFooter /></main>;
}

export function MarketingHeader() {
  return <header className="sticky top-0 z-30 border-b border-[#d8d2c5]/80 bg-[#f7f5ef]/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 sm:px-8 lg:px-10"><Link href="/" className="flex min-h-11 shrink-0 items-center gap-2" aria-label="回到星昊科技首頁"><Image src="/brand/xinhao-horizontal.png" alt="星昊科技 XINHOW" width={2048} height={1024} className="h-12 w-24 object-contain" priority /><span className="hidden text-xs font-semibold tracking-[0.14em] text-[#1f4550] sm:block">星昊科技</span></Link><nav className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto text-xs font-medium text-[#5d6d6b] sm:gap-2 sm:text-sm" aria-label="行銷網站主選單"><NavLink href="/product">產品能力</NavLink><NavLink href="/solutions">產業場景</NavLink><NavLink href="/pricing">方案與服務</NavLink><NavLink href="/contact">聯絡導入</NavLink></nav><Link href="/admin/login" className="btn min-h-11 shrink-0 border border-[#1f4550]/20 bg-white/70 px-3 text-xs text-[#1f4550] hover:bg-white sm:px-4 sm:text-sm">後台登入</Link></div></header>;
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2.5 transition hover:bg-white hover:text-[#1f4550] sm:px-3">{children}</Link>;
}

export function MarketingFooter() {
  return <footer className="bg-[#193b43] px-5 py-10 text-[#dfe9e5] sm:px-8 lg:px-10"><div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.2fr_.8fr_.8fr] md:items-start"><div><div className="flex items-center gap-3"><Image src="/brand/xinhao-gold-dark.png" alt="星昊科技 XINHOW" width={1536} height={1536} className="h-14 w-14 rounded-xl object-contain" /><div><p className="font-semibold tracking-[0.12em]">星昊科技 XINHOW</p><p className="mt-1 text-xs text-[#a9c2be]">服務流程的營運基礎</p></div></div><p className="mt-5 max-w-md text-sm leading-6 text-[#a9c2be]">多品牌預約與報名 SaaS，從顧客入口、品牌後台到平台營運，讓每個角色都在正確的工作層級上。</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Explore</p><div className="mt-3 grid gap-2 text-sm text-[#c5d5d1]"><Link href="/product" className="hover:text-white">產品能力</Link><Link href="/solutions" className="hover:text-white">產業場景</Link><Link href="/pricing" className="hover:text-white">方案與服務</Link></div></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Contact</p><div className="mt-3 grid gap-2 text-sm text-[#c5d5d1]"><a href="tel:079721612" className="hover:text-white">07-9721612#888</a><Link href="/admin/login" className="hover:text-white">管理後台登入</Link></div></div></div><div className="mx-auto mt-9 max-w-7xl border-t border-white/10 pt-5 text-xs text-[#86a39e]">© 星昊科技 XINHOW · 多品牌預約與報名 SaaS</div></footer>;
}

export function PageIntro({ eyebrow, title, description, children, dark = false }: { eyebrow: string; title: string; description: string; children?: React.ReactNode; dark?: boolean }) {
  return <section className={dark ? "bg-[#1f4550] px-5 py-16 text-white sm:px-8 sm:py-24 lg:px-10" : "bg-[#f7f5ef] px-5 py-16 sm:px-8 sm:py-24 lg:px-10"}><div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end lg:gap-20"><div><p className={`eyebrow ${dark ? "!text-[#e2b644]" : "!text-[#b08116]"}`}>{eyebrow}</p><h1 className={`max-w-3xl text-4xl font-bold leading-[1.12] tracking-[-0.04em] sm:text-5xl lg:text-6xl ${dark ? "text-white" : "text-[#193b43]"}`}>{title}</h1><p className={`mt-6 max-w-2xl text-base leading-8 sm:text-lg ${dark ? "text-[#c4d8d5]" : "text-[#5d6d6b]"}`}>{description}</p>{children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}</div><div className="hidden lg:block"><div className={`ml-auto max-w-sm border-l-2 pl-6 text-sm leading-7 ${dark ? "border-[#e2b644] text-[#c4d8d5]" : "border-[#d6a92f] text-[#6d7b76]"}`}>把複雜的服務流程拆成清楚的入口、工作層級與資料邏輯，讓團隊能真正照著系統營運。</div></div></div></section>;
}

export function SectionHeading({ eyebrow, title, description, align = "left" }: { eyebrow: string; title: string; description?: string; align?: "left" | "center" }) {
  return <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}><p className="eyebrow !text-[#b08116]">{eyebrow}</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-[#193b43] sm:text-4xl">{title}</h2>{description && <p className="mt-4 text-base leading-7 text-[#5d6d6b]">{description}</p>}</div>;
}

export function ArrowLink({ href, children, dark = false }: { href: string; children: React.ReactNode; dark?: boolean }) {
  return <Link href={href} className={`inline-flex min-h-11 items-center gap-2 text-sm font-semibold transition ${dark ? "text-[#f1ca5b] hover:text-white" : "text-[#1f4550] hover:text-[#b08116]"}`}>{children}<span aria-hidden="true">↗</span></Link>;
}

export function CapabilityCard({ number, title, description, href = "/product" }: { number: string; title: string; description: string; href?: string }) {
  return <Link href={href} className="group block rounded-2xl border border-[#ddd7ca] bg-white p-5 shadow-[0_8px_30px_rgba(31,69,80,.05)] transition duration-200 hover:-translate-y-1 hover:border-[#c7a340] hover:shadow-[0_16px_35px_rgba(31,69,80,.1)]"><div className="flex items-start justify-between gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf2ef] text-xs font-bold text-[#1f4550]">{number}</span><span className="text-2xl text-[#d8d2c5] transition group-hover:text-[#c7a340]" aria-hidden="true">↗</span></div><h3 className="mt-7 font-bold text-[#193b43]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#6d7b76]">{description}</p></Link>;
}

export function Callout({ title, description, href = "/contact", label = "開始規劃" }: { title: string; description: string; href?: string; label?: string }) {
  return <section className="bg-[#dfece7] px-5 py-14 sm:px-8 sm:py-18 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow !text-[#b08116]">Next step</p><h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-[#193b43] sm:text-4xl">{title}</h2><p className="mt-4 max-w-2xl text-base leading-7 text-[#5d6d6b]">{description}</p></div><Link href={href} className="btn min-h-12 w-fit bg-[#1f4550] px-5 text-white hover:bg-[#193b43]">{label} <span aria-hidden="true">↗</span></Link></div></section>;
}

export function BrandPlate({ caption = "星昊科技 XINHOW" }: { caption?: string }) {
  return <div className="relative mx-auto flex min-h-72 w-full max-w-md items-center justify-center overflow-hidden rounded-[2rem] bg-[#1f4550] p-8 shadow-2xl shadow-[#193b43]/15"><div className="absolute -right-16 -top-16 h-48 w-48 rounded-full border border-[#e2b644]/20" /><div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full border border-[#e2b644]/15" /><Image src="/brand/xinhao-gold-dark.png" alt="星昊科技 XINHOW" width={1536} height={1536} className="relative h-52 w-52 rounded-2xl object-contain" /><span className="absolute bottom-5 left-0 right-0 text-center text-xs tracking-[0.18em] text-[#e2b644]">{caption}</span></div>;
}
