import Link from "next/link";
import { ArrowLink, Callout, JourneyDiagram, MarketingShell, ModuleInterface, PageIntro, PageIntroVisual, ScenarioMatrix, SectionHeading, SignalStrip, WorkflowRail } from "@/components/MarketingLayout";

const modules = [
  ["預約引擎", "時間制與場次制", "可指定服務提供者，也可使用場地、設備或共用資源。", "booking"],
  ["報名中心", "活動、場次與票種", "候補、QR 報到、報名表單與報名狀態一併管理。", "registration"],
  ["顧客經營", "CRM Lite 與自動化", "分眾、互動時間軸、opt-in 與規則式自動化。", "crm"],
  ["營運分析", "報表與品牌權限", "品牌看自己的預約、報名、付款、出席與通知狀態。", "reports"],
] as const;

export default function ProductPage() {
  return <MarketingShell>
    <PageIntro dark backgroundSrc="/marketing/product-schedule-team.png" eyebrow="Product architecture" title="一套可配置的服務營運系統" description="XINHOW 把顧客入口、服務排程、交易狀態、通知、CRM Lite 與品牌營運設定拆成清楚的模組，再組成每個產業真正需要的流程。" visual={<PageIntroVisual variant="product" dark photoSrc="/marketing/product-schedule-team.png" photoAlt="服務團隊共同檢視每日排程" photoCaption="團隊共同檢視排程，再由系統分工執行。" />}>
      <Link href="/solutions" className="btn min-h-12 rounded-full bg-[#e2b644] px-5 font-bold text-[#193b43] hover:bg-[#f1ca5b]">看產業場景 <span aria-hidden="true">↗</span></Link>
      <Link href="/contact" className="btn min-h-12 rounded-full border border-white/20 bg-white/5 px-5 font-bold text-white hover:bg-white/10">討論導入方式</Link>
    </PageIntro>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><SectionHeading eyebrow="四個核心工作畫面" title="每個模組都對應下一個實際動作" description="以下不是抽象功能圖，而是團隊每天會使用的工作畫面與資料關係。" /><div className="mt-12 grid gap-x-10 gap-y-0 lg:grid-cols-2">{modules.map(([eyebrow, title, description, kind], index) => <article key={eyebrow} className="border-t border-[#d8d2c5] py-8 first:pt-0"><div className="flex items-start justify-between gap-5"><div><p className="eyebrow !mb-2 !text-[#b08116]">{eyebrow}</p><h2 className="text-xl font-black text-[#173f48]">{title}</h2><p className="mt-2 max-w-md text-sm leading-7 text-[#5d706d]">{description}</p></div><span className="font-mono text-xs font-bold text-[#b08116]">{String(index + 1).padStart(2, "0")}</span></div><div className="mt-5"><ModuleInterface kind={kind} compact /></div></article>)}</div></section>

    <section className="bg-[#173f48] px-5 py-20 text-white sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-12 lg:grid-cols-[.68fr_1.32fr] lg:items-center lg:gap-16"><div><p className="eyebrow !text-[#e2b644]">顧客經營工作畫面</p><h2 className="text-[clamp(1.9rem,3.2vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em]">先看狀態 再決定下一個動作</h2><p className="mt-5 max-w-xl text-base leading-8 text-[#c9dcda]">品牌團隊可以從顧客清單、互動時間軸、通知紀錄與營運報表，判斷服務完成後的下一步。</p><div className="mt-8"><ArrowLink href="/contact" dark>討論你的顧客流程</ArrowLink></div></div><ModuleInterface kind="crm" /></div><div className="mt-12"><SignalStrip dark items={[{ label: "顧客", value: "互動脈絡", detail: "分眾與時間軸" }, { label: "通知", value: "LINE／Email", detail: "提醒與投遞紀錄" }, { label: "回訪", value: "規則式流程", detail: "依條件接續經營" }, { label: "報表", value: "資料回看", detail: "品牌日期範圍" }]} /></div></div></section>

    <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-20 lg:px-10"><div><SectionHeading eyebrow="一條連續的工作路徑" title="從入口到回訪 資料不必重新整理" description="服務入口、排程、交易、通知與顧客經營都保留在品牌自己的工作範圍內。" /><div className="mt-8"><JourneyDiagram /></div></div><ScenarioMatrix /></section>

    <section className="bg-[#eef2ed] px-5 py-16 sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="品牌可配置" title="把差異放進設定 不把產業硬套成模板" description="時間制／場次制、指定服務提供者／資源型服務、首次／再次服務、訂金與顧客入口，都以設定決定行為。" /><div className="mt-10"><WorkflowRail steps={[{ label: "入口", title: "顧客被接住", detail: "LINE、瀏覽器、品牌網址" }, { label: "流程", title: "服務有狀態", detail: "預約、報名、付款、報到" }, { label: "記錄", title: "互動可延續", detail: "顧客、通知、分眾" }, { label: "回看", title: "資料可回看", detail: "報表、權限、操作紀錄" }]} /></div></div></section>

    <Callout title="想看自己的流程會怎麼落在系統裡" description="導入前先釐清服務目標、資源、成員角色與顧客入口，再決定品牌需要開啟的設定。" label="預約導入諮詢" />
  </MarketingShell>;
}
