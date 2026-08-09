import Link from "next/link";
import { ArrowLink, Callout, CapabilityCard, DashboardMockup, FeatureIcon, MarketingPhoto, MarketingShell, SectionHeading, SignalStrip, WorkflowRail } from "@/components/MarketingLayout";

const homeCapabilities = [
  ["01", "跨產業預約", "時間制、場次制，依你的服務、場地或設備安排流程。"],
  ["02", "活動與課程報名", "活動、場次、票種、候補與 QR 報到一套管理。"],
  ["03", "LINE 優先入口", "Rich Menu → LIFF 為主，也保留瀏覽器與品牌網址。"],
  ["04", "CRM Lite", "顧客分眾、互動時間軸與規則式自動化接續回訪。"],
  ["05", "多品牌清楚分開", "每個品牌有自己的入口、資料與權限範圍，團隊只處理該看的工作。"],
  ["06", "營運統計報表", "預約、報名、付款、通知、漏斗與未到狀態可追蹤。"],
] as const;

const journey = [
  ["入口", "顧客從 LINE Rich Menu、LIFF、瀏覽器或品牌網址進入。"],
  ["服務", "選擇服務、時段、場次、票種，完成預約或活動報名。"],
  ["經營", "付款、提醒、CRM Lite 與報表，讓一次成交變成持續關係。"],
] as const;

export function MarketingHome() {
  return <MarketingShell>
    <section className="relative overflow-hidden bg-[#1f4550] text-white"><div className="absolute inset-y-0 right-0 hidden w-[42%] border-l border-white/10 lg:block" aria-hidden="true" /><div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-16 lg:px-10 lg:py-24"><div className="max-w-2xl"><p className="eyebrow !text-[#e2b644]">多品牌服務營運平台</p><h1 className="mt-4 max-w-2xl text-[clamp(2.3rem,4.8vw,4.4rem)] font-bold leading-[1.04] tracking-[-0.055em]">讓預約、報名與回訪，<span className="text-[#e2b644]">回到同一條流程。</span></h1><p className="mt-6 max-w-xl text-base leading-8 text-[#c9dcda] sm:text-lg">星昊科技為服務型品牌打造多品牌預約與報名 SaaS，從顧客入口、團隊作業到日常經營，讓每個流程都能被看見、被交接、被持續優化。</p><div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Link href="/product" className="btn min-h-12 w-fit bg-[#e2b644] px-5 font-semibold text-[#193b43] hover:bg-[#f1ca5b]">看完整產品能力 <span aria-hidden="true">↗</span></Link><Link href="/contact" className="btn min-h-12 w-fit border border-white/25 bg-transparent px-5 text-white hover:bg-white/10">預約導入諮詢</Link><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="btn min-h-12 w-fit border border-[#e2b644]/50 bg-transparent px-5 text-[#f1ca5b] hover:bg-[#e2b644]/10">官方 LINE · @xinhow</a></div><div className="mt-10 grid max-w-xl grid-cols-3 border-t border-white/15 pt-5"><HomeFact label="標準功能" value="70 項" /><HomeFact label="資料邊界" value="多品牌資料隔離" /><HomeFact label="主要入口" value="LINE → LIFF" /></div></div><div className="relative lg:pl-5"><MarketingPhoto src="/marketing/hero-service-counter.png" alt="服務現場的接待與排程作業" caption="真實工作情境：顧客接待、服務安排與團隊交接同時發生。" priority /><div className="mt-4 grid grid-cols-3 border-t border-white/20 pt-4 text-[11px] text-[#c9dcda]"><span className="border-r border-white/15 pr-3">顧客入口<br /><strong className="mt-1 block text-white">看得見</strong></span><span className="border-r border-white/15 px-3">團隊作業<br /><strong className="mt-1 block text-white">接得起</strong></span><span className="pl-3">資料範圍<br /><strong className="mt-1 block text-white">隔離清楚</strong></span></div></div></div></section>

    <section className="border-b border-[#d8d2c5] bg-[#fbfaf6] px-5 py-5 sm:px-8 lg:px-10"><div className="mx-auto max-w-7xl"><SignalStrip items={[{ label: "入口", value: "LINE → LIFF", detail: "顧客從熟悉的入口開始" }, { label: "安排", value: "時間／場次", detail: "依服務目標切換模式" }, { label: "延續", value: "CRM Lite", detail: "完成後留下可用脈絡" }, { label: "資料範圍", value: "多品牌隔離", detail: "每個品牌各自管理" }]} /></div></section>

    <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-10"><div><SectionHeading eyebrow="從顧客到團隊" title="不只讓顧客預約，而是讓團隊有一條完整的工作路徑。" description="服務型品牌最常遇到的問題，不是沒有入口，而是入口、排程、收款、提醒與回訪分散在不同工具。" /><div className="mt-8"><ArrowLink href="/product">查看產品架構</ArrowLink></div></div><div className="border-l-2 border-[#b08116] pl-5 sm:pl-7">{journey.map(([title, description], index) => <div key={title} className="relative flex gap-4 border-b border-[#d8d2c5] py-5 first:pt-0 last:border-b-0"><span className="font-mono text-xs text-[#b08116]">0{index + 1}</span><div><h3 className="text-xl font-bold text-[#193b43]">{title}</h3><p className="mt-2 text-sm leading-7 text-[#6d7b76]">{description}</p></div></div>)}</div></section>

    <section className="border-y border-[#d8d2c5] bg-[#e8f0ec] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><SectionHeading eyebrow="核心能力" title="先看懂工作，再看功能。" description="70 項標準功能完整開放，依品牌設定切換流程，不把你的產業硬套成單一模板。" /><ArrowLink href="/product">瀏覽全部產品能力</ArrowLink></div><div className="mt-12 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">{homeCapabilities.map(([number, title, description]) => <CapabilityCard key={number} number={number} title={title} description={description} />)}</div></div></section>

    <section className="bg-[#193b43] px-5 py-20 text-white sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:items-center lg:gap-16"><div><p className="eyebrow !text-[#e2b644]">品牌營運後台</p><h2 className="text-[clamp(1.8rem,3.2vw,2.8rem)] font-bold leading-[1.1] tracking-[-0.045em]">把每天要處理的事情，放進同一個工作畫面。</h2><p className="mt-5 max-w-xl text-base leading-7 text-[#c9dcda]">品牌團隊可以在同一個後台查看預約、報名、顧客、通知與報表，再依狀態決定下一個動作。</p><div className="mt-8"><ArrowLink href="/product" dark>看品牌後台功能</ArrowLink></div></div><DashboardMockup variant="operations" /></div><div className="mt-12"><WorkflowRail steps={[{ label: "顧客入口", title: "看見與進入", detail: "LINE Rich Menu、LIFF、瀏覽器" }, { label: "服務作業", title: "預約或報名", detail: "時段、場次、付款、報到" }, { label: "團隊處理", title: "提醒與交接", detail: "狀態、通知、例外日期" }, { label: "後續經營", title: "回訪與分析", detail: "CRM Lite、分眾、報表" }]} dark /></div></div></section>

    <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:gap-20 lg:px-10"><div className="order-2 lg:order-1"><MarketingPhoto src="/marketing/product-schedule-team.png" alt="服務團隊共同檢視每日排程" caption="真實工作情境：團隊共同檢視服務安排，讓交接依照相同狀態進行。" /><div className="mt-5 grid grid-cols-3 border-t border-[#d8d2c5] pt-4 text-xs text-[#6d7b76]"><span>服務目標<br /><strong className="mt-1 block text-[#193b43]">人員／資源／場地</strong></span><span>工作方式<br /><strong className="mt-1 block text-[#193b43]">時間／場次</strong></span><span>後續關係<br /><strong className="mt-1 block text-[#193b43]">提醒／回訪</strong></span></div></div><div className="order-1 lg:order-2"><SectionHeading eyebrow="依場景配置" title="不同產業，不必共用同一種操作方式。" description="從一對一服務、團體課程到場地與設備預約，系統以服務目標與資源配置為核心，讓品牌用自己的語言營運。" /><div className="mt-8 grid gap-3 border-t border-[#d8d2c5] pt-5 text-sm text-[#5d6d6b]"><p className="flex items-center gap-3"><FeatureIcon name="users" compact />指定服務提供者，或由系統依設定安排</p><p className="flex items-center gap-3"><FeatureIcon name="calendar" compact />時間制、場次制與共用資源排程</p><p className="flex items-center gap-3"><FeatureIcon name="chart" compact />完成服務後留下可用的顧客脈絡</p></div><div className="mt-8"><ArrowLink href="/solutions">查看產業場景</ArrowLink></div></div></section>

    <Callout title="先從你的實際流程開始，不從套版開始。" description="告訴我們品牌類型、服務方式與目前使用的入口，我們會依照你的營運角色與顧客旅程規劃導入路徑。" />
  </MarketingShell>;
}

function HomeFact({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-white/15 px-3 first:pl-0 last:border-r-0"><p className="text-[10px] text-[#a9c2be]">{label}</p><p className="mt-2 text-xs font-semibold text-white sm:text-sm">{value}</p></div>;
}
