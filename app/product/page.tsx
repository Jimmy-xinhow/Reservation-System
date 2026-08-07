import Link from "next/link";
import { Callout, CapabilityCard, JourneyDiagram, MarketingShell, PageIntro, PageIntroVisual, SectionHeading } from "@/components/MarketingLayout";

const modules = [
  ["預約引擎", "時間制與場次制", "可指定服務提供者，也可使用場地、設備或共用資源。"],
  ["報名中心", "活動、場次與票種", "候補、QR 報到、報名表單與報名狀態一併管理。"],
  ["付款與方案", "標準金流、訂金與會員", "支援綠界／藍新、套票堂數 ledger 與報名優惠碼。"],
  ["顧客經營", "CRM Lite 與自動化", "分眾、互動時間軸、opt-in 與三種規則式自動化。"],
  ["通知與入口", "LINE、Email 與品牌入口", "Rich Menu → LIFF 為主，搭配瀏覽器備援、嵌入與自訂網域。"],
  ["報表與治理", "營運報表與平台稽核", "品牌看自己的營運，系統擁有者看平台聚合與跨品牌健康度。"],
] as const;

export default function ProductPage() {
  return <MarketingShell>
    <PageIntro dark eyebrow="Product architecture" title="一套可配置的服務營運系統。" description="XINHOW 把顧客入口、服務排程、交易狀態、通知、CRM Lite 與平台治理拆成清楚的模組，再透過品牌設定組成每個產業真正需要的流程。" visual={<PageIntroVisual variant="product" dark photoSrc="/marketing/product-schedule-team.png" photoAlt="服務團隊共同檢視每日排程" photoCaption="實際工作情境：團隊共同檢視排程，再由系統分工執行。" />}><Link href="/solutions" className="btn min-h-12 bg-[#e2b644] px-5 font-semibold text-[#193b43] hover:bg-[#f1ca5b]">看產業場景 <span aria-hidden="true">↗</span></Link><Link href="/contact" className="btn min-h-12 border border-white/20 bg-white/5 px-5 text-white hover:bg-white/10">討論導入方式</Link></PageIntro>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:gap-20"><div><SectionHeading eyebrow="One system, two layers" title="平台與品牌各自管理，彼此不混淆。" description="這是多品牌 SaaS 的核心：系統擁有者負責租戶與平台治理；品牌團隊負責自己的服務與顧客營運。" /></div><div className="grid gap-4 sm:grid-cols-2"><LayerCard number="01" title="平台層" subtitle="System owner console" items={["建立與開通品牌租戶", "管理平台 owner／admin", "查看跨品牌聚合報表", "監控健康與平台稽核"]} dark /><LayerCard number="02" title="品牌層" subtitle="Brand operations console" items={["服務、排程與例外日期", "預約、活動報名與報到", "顧客、CRM Lite 與通知", "品牌自己的報表與設定"]} /></div></div></section>

    <section className="bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Modules" title="每個模組，都對應一個實際工作場景。" description="不把功能堆在同一頁，而是讓團隊依照工作順序找到正確工具。" /><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{modules.map(([eyebrow, title, description], index) => <CapabilityCard key={eyebrow} number={String(index + 1).padStart(2, "0")} title={`${eyebrow}｜${title}`} description={description} />)}</div></div></section>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-10 lg:grid-cols-[1fr_.8fr] lg:items-center lg:gap-20"><div><p className="eyebrow !text-[#b08116]">A connected journey</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-[#193b43] sm:text-4xl">從第一次點擊，到下一次回訪。</h2><div className="mt-8 space-y-3"><JourneyRow number="01" title="入口被看見" description="LINE Rich Menu、LIFF、瀏覽器與品牌網址承接顧客。" /><JourneyRow number="02" title="服務被完成" description="預約／報名、訂金／付款、取消／改期與報到保留完整狀態。" /><JourneyRow number="03" title="關係被延續" description="提醒、CRM Lite 分眾、互動紀錄與報表讓團隊知道下一步。" /></div></div><JourneyDiagram /></div></section>

    <Callout title="想看自己的流程會怎麼落在系統裡？" description="導入前先釐清服務目標、資源、成員角色與顧客入口，再決定品牌需要開啟的設定。" label="預約導入諮詢" />
  </MarketingShell>;
}

function LayerCard({ number, title, subtitle, items, dark = false }: { number: string; title: string; subtitle: string; items: readonly string[]; dark?: boolean }) {
  return <article className={`rounded-2xl p-5 sm:p-6 ${dark ? "bg-[#1f4550] text-white" : "border border-[#ddd7ca] bg-white"}`}><span className={`text-sm font-mono font-semibold ${dark ? "text-[#e2b644]" : "text-[#b08116]"}`}>{number}</span><h3 className="mt-7 text-xl font-bold">{title}</h3><p className={`mt-1 text-xs ${dark ? "text-[#a9c2be]" : "text-[#7a8782]"}`}>{subtitle}</p><ul className={`mt-6 space-y-3 text-sm leading-6 ${dark ? "text-[#c9dcda]" : "text-[#5d6d6b]"}`}>{items.map((item) => <li key={item} className="flex gap-2"><span className={dark ? "text-[#e2b644]" : "text-[#b08116]"}>✓</span>{item}</li>)}</ul></article>;
}

function JourneyRow({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="flex gap-4 rounded-xl border border-[#ddd7ca] bg-white p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#edf2ef] text-xs font-bold text-[#1f4550]">{number}</span><div><p className="font-semibold text-[#193b43]">{title}</p><p className="mt-1 text-sm leading-6 text-[#6d7b76]">{description}</p></div></div>;
}
