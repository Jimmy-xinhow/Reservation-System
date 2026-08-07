import Link from "next/link";
import { ArrowLink, Callout, CapabilityCard, MarketingPhoto, MarketingShell, PlatformPreview, SectionHeading } from "@/components/MarketingLayout";

const homeCapabilities = [
  ["01", "跨產業預約", "時間制、場次制，依你的服務、場地或設備安排流程。"],
  ["02", "活動與課程報名", "活動、場次、票種、候補與 QR 報到一套管理。"],
  ["03", "LINE 優先入口", "Rich Menu → LIFF 為主，也保留瀏覽器與品牌網址。"],
  ["04", "CRM Lite", "顧客分眾、互動時間軸與規則式自動化接續回訪。"],
  ["05", "多品牌完全隔離", "平台擁有者與品牌後台分層，資料與權限清楚分開。"],
  ["06", "營運統計報表", "預約、報名、付款、通知、漏斗與未到狀態可追蹤。"],
] as const;

const journey = [
  ["入口", "顧客從 LINE Rich Menu、LIFF、瀏覽器或品牌網址進入。"],
  ["服務", "選擇服務、時段、場次、票種，完成預約或活動報名。"],
  ["經營", "付款、提醒、CRM Lite 與報表，讓一次成交變成持續關係。"],
] as const;

export function MarketingHome() {
  return <MarketingShell>
    <section className="relative overflow-hidden bg-[#1f4550] px-5 py-16 text-white sm:px-8 sm:py-24 lg:px-10"><div className="absolute inset-0 opacity-50" style={{ backgroundImage: "linear-gradient(rgba(226,182,68,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(226,182,68,.09) 1px, transparent 1px)", backgroundSize: "54px 54px" }} /><div className="absolute -right-24 top-12 h-80 w-80 rounded-full bg-[#e2b644]/10 blur-3xl" /><div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:gap-20"><div><p className="eyebrow !text-[#e2b644]">XINHOW SERVICE PLATFORM</p><h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-[-0.04em] sm:text-5xl lg:text-6xl">把預約、報名與後續經營，<span className="text-[#e2b644]">放回同一套系統。</span></h1><p className="mt-6 max-w-2xl text-base leading-8 text-[#c9dcda] sm:text-lg">星昊科技為服務型品牌打造多品牌預約與報名 SaaS，從顧客入口、團隊作業到平台營運，讓每個流程都能被看見、被交接、被持續優化。</p><div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Link href="/product" className="btn min-h-12 w-fit bg-[#e2b644] px-5 font-semibold text-[#193b43] hover:bg-[#f1ca5b]">看完整產品能力 <span aria-hidden="true">↗</span></Link><Link href="/contact" className="btn min-h-12 w-fit border border-white/20 bg-white/5 px-5 text-white hover:bg-white/10">預約導入諮詢</Link><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="btn min-h-12 w-fit border border-[#e2b644]/40 bg-[#e2b644]/10 px-5 text-[#f1ca5b] hover:bg-[#e2b644]/20">官方 LINE · @xinhow</a></div><div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#a9c2be]"><span>70 項標準功能</span><span>多品牌資料隔離</span><span>LINE → LIFF 優先</span></div></div><PlatformPreview /></div></section>

    <section className="border-b border-[#d8d2c5] bg-white px-5 py-5 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#5d6d6b]"><span className="font-semibold text-[#193b43]">一個平台，完整接住</span><span>預約</span><span className="text-[#d8d2c5]">/</span><span>活動報名</span><span className="text-[#d8d2c5]">/</span><span>標準金流</span><span className="text-[#d8d2c5]">/</span><span>提醒與 Email</span><span className="text-[#d8d2c5]">/</span><span>CRM Lite</span><span className="text-[#d8d2c5]">/</span><span>統計報表</span></div></section>

    <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.72fr_1.28fr] lg:gap-20 lg:px-10"><div><SectionHeading eyebrow="One operating system" title="不只讓顧客預約，而是讓團隊有一條完整的工作路徑。" description="服務型品牌最常遇到的問題，不是沒有入口，而是入口、排程、收款、提醒與回訪分散在不同工具。" /><div className="mt-7"><ArrowLink href="/product">查看產品架構</ArrowLink></div></div><div className="grid gap-3">{journey.map(([title, description], index) => <div key={title} className="flex gap-4 rounded-2xl border border-[#ddd7ca] bg-white p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf2ef] text-xs font-bold text-[#1f4550]">0{index + 1}</span><div><h3 className="font-bold text-[#193b43]">{title}</h3><p className="mt-1 text-sm leading-6 text-[#6d7b76]">{description}</p></div></div>)}</div></section>

    <section className="bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><SectionHeading eyebrow="Core capabilities" title="先看懂核心，再深入每個模組。" description="70 項標準功能完整開放，依品牌設定切換流程，不把你的產業硬套成單一模板。" /><ArrowLink href="/product">瀏覽全部產品能力</ArrowLink></div><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{homeCapabilities.map(([number, title, description]) => <CapabilityCard key={number} number={number} title={title} description={description} />)}</div></div></section>

    <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20 lg:px-10"><div><p className="eyebrow !text-[#b08116]">Built around your scene</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-[#193b43] sm:text-4xl">不同產業，不必共用同一種操作方式。</h2><p className="mt-4 max-w-xl text-base leading-7 text-[#5d6d6b]">從一對一服務、團體課程到場地與設備預約，系統以服務目標與資源配置為核心，讓品牌用自己的語言營運。</p><div className="mt-7"><ArrowLink href="/solutions">查看產業場景</ArrowLink></div></div><div className="space-y-3"><MarketingPhoto src="/marketing/hero-service-counter.png" alt="服務現場的接待與排程作業" caption="實際服務現場：顧客接待與團隊排程同時進行。" /><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-[#1f4550] p-5 text-white"><p className="text-xs uppercase tracking-[0.18em] text-[#e2b644]">Service</p><p className="mt-8 text-lg font-bold">指定人員／資源／場地</p><p className="mt-2 text-sm leading-6 text-[#c4d8d5]">服務目標可依品牌設定，不虛構不需要的角色。</p></div><div className="rounded-2xl border border-[#ddd7ca] bg-[#f7f5ef] p-5"><p className="text-xs uppercase tracking-[0.18em] text-[#b08116]">Growth</p><p className="mt-8 text-lg font-bold text-[#193b43]">完成服務後的回訪</p><p className="mt-2 text-sm leading-6 text-[#6d7b76]">CRM Lite 分眾、互動時間軸與規則式自動化接續經營。</p></div></div></div></section>

    <Callout title="先從你的實際流程開始，不從套版開始。" description="告訴我們品牌類型、服務方式與目前使用的入口，我們會依照你的營運角色與顧客旅程規劃導入路徑。" />
  </MarketingShell>;
}
