import Link from "next/link";
import { Callout, CapabilityCard, DashboardMockup, FeatureIcon, JourneyDiagram, MarketingShell, PageIntro, PageIntroVisual, PhotoBand, SectionHeading, SignalStrip, WorkflowRail } from "@/components/MarketingLayout";

const modules = [
  ["預約引擎", "時間制與場次制", "可指定服務提供者，也可使用場地、設備或共用資源。"],
  ["報名中心", "活動、場次與票種", "候補、QR 報到、報名表單與報名狀態一併管理。"],
  ["付款與方案", "標準金流、訂金與會員", "支援綠界／藍新、套票堂數 ledger 與報名優惠碼。"],
  ["顧客經營", "CRM Lite 與自動化", "分眾、互動時間軸、opt-in 與三種規則式自動化。"],
  ["通知與入口", "LINE、Email 與品牌入口", "Rich Menu → LIFF 為主，搭配瀏覽器備援、嵌入與自訂網域。"],
  ["營運分析", "營運報表與權限", "品牌看自己的預約、報名、付款、出席與通知狀態，依角色管理資料範圍。"],
] as const;

export default function ProductPage() {
  return <MarketingShell>
    <PageIntro dark eyebrow="Product architecture" title="一套可配置的服務營運系統。" description="XINHOW 把顧客入口、服務排程、交易狀態、通知、CRM Lite 與品牌營運設定拆成清楚的模組，再組成每個產業真正需要的流程。" visual={<PageIntroVisual variant="product" dark photoSrc="/marketing/product-schedule-team.png" photoAlt="服務團隊共同檢視每日排程" photoCaption="實際工作情境：團隊共同檢視排程，再由系統分工執行。" />}><Link href="/solutions" className="btn min-h-12 bg-[#e2b644] px-5 font-semibold text-[#193b43] hover:bg-[#f1ca5b]">看產業場景 <span aria-hidden="true">↗</span></Link><Link href="/contact" className="btn min-h-12 border border-white/20 bg-white/5 px-5 text-white hover:bg-white/10">討論導入方式</Link></PageIntro>

    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10"><div className="grid gap-10 lg:grid-cols-[.7fr_1.3fr] lg:items-center lg:gap-16"><div><SectionHeading eyebrow="品牌每天怎麼工作" title="從顧客入口，到團隊下一個動作。" description="品牌後台把入口、預約、報名、顧客、通知與報表接在同一條工作路徑，讓不同角色可以照著狀態交接。" /></div><DashboardMockup variant="operations" /></div></section>

    <section className="bg-[#193b43] px-5 py-16 text-white sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-10 lg:grid-cols-[.68fr_1.32fr] lg:items-center lg:gap-16"><div><p className="eyebrow !text-[#e2b644]">顧客經營工作畫面</p><h2 className="text-[clamp(1.8rem,3.2vw,2.8rem)] font-bold leading-[1.1] tracking-[-0.045em]">先看狀態再決定下一個動作</h2><p className="mt-4 max-w-xl text-base leading-7 text-[#c9dcda]">品牌團隊可以從顧客清單、互動時間軸、通知紀錄與營運報表，判斷服務完成後的下一步。</p></div><DashboardMockup variant="customer" /></div><div className="mt-10"><SignalStrip dark items={[{ label: "顧客", value: "互動脈絡", detail: "分眾與時間軸" }, { label: "通知", value: "LINE／Email", detail: "提醒與投遞紀錄" }, { label: "回訪", value: "規則式流程", detail: "依條件接續經營" }, { label: "報表", value: "資料回看", detail: "品牌日期範圍" }]} /></div></div></section>

    <PhotoBand src="/marketing/product-schedule-team.png" alt="服務團隊共同檢視每日排程" eyebrow="模組如何落到日常" title="每個畫面都要對應下一個工作動作" description="產品介面不只展示資料，也要讓團隊知道現在的狀態、誰負責處理，以及接下來要做什麼。" />

    <section className="bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Modules" title="每個模組，都對應一個實際工作場景。" description="不把功能堆在同一頁，而是讓團隊依照工作順序找到正確工具。" /><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{modules.map(([eyebrow, title, description], index) => <CapabilityCard key={eyebrow} number={String(index + 1).padStart(2, "0")} title={`${eyebrow}｜${title}`} description={description} />)}</div></div></section>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-10 lg:grid-cols-[1fr_.8fr] lg:items-center lg:gap-20"><div><p className="eyebrow !text-[#b08116]">A connected journey</p><h2 className="text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.04em] text-[#193b43]">從第一次點擊到下一次回訪</h2><div className="mt-8 space-y-3"><JourneyRow number="01" title="入口被看見" description="LINE Rich Menu、LIFF、瀏覽器與品牌網址承接顧客。" /><JourneyRow number="02" title="服務被完成" description="預約／報名、訂金／付款、取消／改期與報到保留完整狀態。" /><JourneyRow number="03" title="關係被延續" description="提醒、CRM Lite 分眾、互動紀錄與報表讓團隊知道下一步。" /></div></div><JourneyDiagram /></div></section>

    <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 sm:pb-24 lg:px-10"><WorkflowRail steps={[{ label: "入口", title: "顧客被接住", detail: "LINE、瀏覽器、品牌網址" }, { label: "流程", title: "服務有狀態", detail: "預約、報名、付款、報到" }, { label: "記錄", title: "互動可延續", detail: "顧客、通知、分眾" }, { label: "回看", title: "資料可回看", detail: "報表、權限、操作紀錄" }]} /></section>

    <Callout title="想看自己的流程會怎麼落在系統裡？" description="導入前先釐清服務目標、資源、成員角色與顧客入口，再決定品牌需要開啟的設定。" label="預約導入諮詢" />
  </MarketingShell>;
}

function JourneyRow({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="flex gap-4 rounded-[1.15rem] border border-[#ddd7ca] bg-white p-4"><FeatureIcon name={number === "01" ? "line" : number === "02" ? "calendar" : "chart"} compact /><div><p className="font-semibold text-[#193b43]">{title}</p><p className="mt-1 text-sm leading-6 text-[#6d7b76]">{description}</p></div></div>;
}
