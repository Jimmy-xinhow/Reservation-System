import Link from "next/link";
import { ArrowLink, Callout, CapabilityCard, DashboardMockup, FeatureIcon, MarketingPhoto, MarketingShell, PageIntro, PhotoBand, ProductShowcase, SectionHeading, SignalStrip, WorkflowRail } from "@/components/MarketingLayout";

const homeModules = [
  ["01", "預約與服務排程", "時間制、場次制，依服務、場地或設備安排流程。"],
  ["02", "活動與課程報名", "活動、場次、票種、候補與 QR 報到一路管理。"],
  ["03", "CRM Lite 顧客經營", "分眾、互動時間軸與規則式自動化接續回訪。"],
  ["04", "營運報表與品牌設定", "看見預約、報名、付款、通知與出席狀態。"],
] as const;

const journey = [
  ["入口", "LINE Rich Menu、LIFF、瀏覽器或品牌網址承接顧客。"],
  ["服務", "選擇服務、時段、場次、票種，完成預約或活動報名。"],
  ["經營", "付款、提醒、CRM Lite 與報表，讓一次服務接上下一次回訪。"],
] as const;

export function MarketingHome() {
  return <MarketingShell>
    <PageIntro dark backgroundSrc="/marketing/hero-service-counter.png" eyebrow="多品牌服務營運平台" title="讓預約報名與回訪回到同一條流程" description="星昊科技為服務型品牌打造多品牌預約與報名 SaaS，從顧客入口、團隊作業到日常經營，讓每個流程都能被看見、被交接、被持續優化。" visual={<ProductShowcase variant="overview" />}>
      <Link href="/product" className="btn min-h-12 rounded-full bg-[#e2b644] px-5 font-bold text-[#193b43] hover:bg-[#f1ca5b]">看產品能力 <span aria-hidden="true">↗</span></Link>
      <Link href="/contact" className="btn min-h-12 rounded-full border border-white/25 bg-white/5 px-5 font-bold text-white hover:bg-white/10">預約導入</Link>
    </PageIntro>

    <section className="bg-[#fbf8f0] px-5 py-5 sm:px-8 lg:px-10"><div className="mx-auto max-w-7xl"><SignalStrip items={[{ label: "標準功能", value: "70 項", detail: "70 項標準功能完整開放" }, { label: "主要入口", value: "LINE → LIFF", detail: "瀏覽器保留備援" }, { label: "資料邊界", value: "多品牌資料隔離", detail: "每個品牌各自管理" }, { label: "後續經營", value: "CRM Lite", detail: "分眾與規則式自動化" }]} /></div></section>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:items-end lg:gap-16"><SectionHeading eyebrow="先看產品畫面" title="不是功能清單 而是每天真的要做的工作" description="從顧客進入、團隊安排到服務完成，每個模組都對應一個可操作、可交接的工作畫面。" /><div className="flex justify-start lg:justify-end"><ArrowLink href="/product">查看完整產品能力</ArrowLink></div></div><div className="mt-12 grid gap-x-8 gap-y-0 lg:grid-cols-2">{homeModules.map(([number, title, description]) => <CapabilityCard key={number} number={number} title={title} description={description} />)}</div></section>

    <PhotoBand src="/marketing/hero-service-counter.png" alt="服務現場的接待與排程作業" eyebrow="情境示意" title="入口被看見 團隊才接得起工作" description="照片只負責交代場景，真正的營運狀態回到產品介面中，讓顧客與團隊都知道下一步。" />

    <section className="bg-[#173f48] px-5 py-20 text-white sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-12 lg:grid-cols-[.68fr_1.32fr] lg:items-center lg:gap-16"><div><p className="eyebrow !text-[#e2b644]">品牌營運後台</p><h2 className="text-[clamp(1.9rem,3.2vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em]">讓團隊知道現在的狀態與下一個動作</h2><p className="mt-5 max-w-xl text-base leading-8 text-[#c9dcda]">品牌團隊可以在同一個後台查看預約、報名、顧客、通知與報表，再依狀態決定誰接手處理。</p><div className="mt-8"><ArrowLink href="/product" dark>看品牌後台介面</ArrowLink></div></div><DashboardMockup variant="operations" /></div><div className="mt-14"><WorkflowRail dark steps={[{ label: "顧客入口", title: "看見與進入", detail: "LINE Rich Menu、LIFF、瀏覽器" }, { label: "服務作業", title: "預約或報名", detail: "時段、場次、付款、報到" }, { label: "團隊處理", title: "提醒與交接", detail: "狀態、通知、例外日期" }, { label: "後續經營", title: "回訪與分析", detail: "CRM Lite、分眾、報表" }]} /></div></div></section>

    <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_.9fr] lg:items-center lg:gap-20 lg:px-10"><div><SectionHeading eyebrow="一條完整路徑" title="從第一次點擊到下一次回訪" description="服務型品牌最常遇到的問題，不是沒有入口，而是入口、排程、收款、提醒與回訪分散在不同工具。" /><div className="mt-8 border-l-2 border-[#b08116] pl-5 sm:pl-7">{journey.map(([title, description], index) => <div key={title} className="relative flex gap-4 border-b border-[#d8d2c5] py-5 first:pt-0 last:border-b-0"><span className="font-mono text-xs text-[#b08116]">0{index + 1}</span><div><h3 className="text-lg font-black text-[#173f48]">{title}</h3><p className="mt-2 text-sm leading-7 text-[#6d706d]">{description}</p></div></div>)}</div></div><MarketingPhoto src="/marketing/product-schedule-team.png" alt="服務團隊共同檢視每日排程" caption="情境示意：團隊共同檢視服務安排，讓交接依照相同狀態進行。" /></section>

    <section className="bg-[#eef2ed] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-8 lg:grid-cols-[.72fr_1.28fr] lg:items-end lg:gap-16"><SectionHeading eyebrow="依場景配置" title="不同產業 不必共用同一種操作方式" description="一對一服務看時段，課程活動看場次，場地設備看資源衝突；系統用設定接住不同現場。" /><div className="grid gap-3 sm:grid-cols-2"><p className="flex items-center gap-3 border-t border-[#d8d2c5] py-3 text-sm text-[#536864]"><FeatureIcon name="users" compact />人員與資源都能成為服務目標</p><p className="flex items-center gap-3 border-t border-[#d8d2c5] py-3 text-sm text-[#536864]"><FeatureIcon name="calendar" compact />時間制與場次制依品牌切換</p><p className="flex items-center gap-3 border-t border-[#d8d2c5] py-3 text-sm text-[#536864]"><FeatureIcon name="line" compact />LINE 優先並保留瀏覽器備援</p><p className="flex items-center gap-3 border-t border-[#d8d2c5] py-3 text-sm text-[#536864]"><FeatureIcon name="chart" compact />完成後留下顧客與營運脈絡</p></div></div></div></section>

    <Callout title="先從你的實際流程開始 不從套版開始" description="告訴我們品牌類型、服務方式與目前使用的入口，我們會依照你的營運角色與顧客旅程規劃導入路徑。" />
  </MarketingShell>;
}
