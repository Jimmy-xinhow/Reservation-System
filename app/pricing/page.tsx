import Link from "next/link";
import { Callout, MarketingShell, PageIntro, PageIntroVisual, PricingVisual, SectionHeading } from "@/components/MarketingLayout";

const plans = [
  {
    name: "兩年一次繳",
    subtitle: "24 個月合約，一次付清",
    price: "39,800",
    priceLabel: "合約總額",
    badge: "最超值",
    featured: true,
    note: "按月計 NT$60,000，省下 NT$20,200。",
    setup: "導入設定費免收",
    detail: "合約期間提前終止，需補付導入設定費 NT$6,000。",
  },
  {
    name: "月繳",
    subtitle: "24 個月合約，按月支付",
    price: "2,500",
    priceLabel: "每月",
    badge: "彈性付款",
    featured: false,
    note: "另收導入設定費 NT$6,000。",
    setup: "期滿退回導入設定費",
    detail: "簽約時支付一次，24 個月期滿全額退回；提前終止則不予退回。",
  },
] as const;

const featureGroups = [
  { number: "01", title: "顧客入口與品牌", description: "讓顧客用熟悉的入口進來，同時讓多品牌資料與對外識別保持隔離。", features: ["LINE Rich Menu → LIFF 主要入口", "瀏覽器備援與品牌短網址", "自訂網址、嵌入元件與自訂網域", "平台擁有者／品牌後台分層", "多品牌、多人員與角色權限", "品牌資料隔離與平台稽核"] },
  { number: "02", title: "預約與活動報名", description: "時間制與場次制都能使用，依服務目標選擇人員、場地、設備或共用資源。", features: ["時間制預約與場次制預約", "服務時長、首次／再次服務設定", "服務提供者、場地與設備排程", "活動、場次、票種與自訂報名表單", "候補、QR 報到與報名狀態", "取消、改期與容量控管"] },
  { number: "03", title: "收款、方案與通知", description: "把付款狀態、名額與通知接在同一條流程上，減少人工對照。", features: ["綠界／藍新標準金流串接", "訂金、付款回呼與狀態追蹤", "會員方案、套票與堂數 ledger", "報名優惠碼與指定票種扣抵", "LINE／Email 行前提醒", "投遞去重、重試與錯誤紀錄"] },
  { number: "04", title: "CRM Lite 與行銷自動化", description: "完成服務後保留可用的顧客脈絡，讓團隊知道下一步，不宣稱完整 CRM。", features: ["顧客分眾與標籤", "互動時間軸與預約／報名來源", "行銷同意 opt-in 管理", "三種規則式行銷自動化", "LINE／Email 投遞紀錄", "排程、去重與阻擋名單"] },
  { number: "05", title: "營運報表與治理", description: "讓品牌看自己的營運，讓系統擁有者看平台的交付與健康度。", features: ["預約、報名、付款與出席統計", "容量、候補、未到與取消分析", "CRM Lite 與行銷投遞結果", "品牌日期範圍查詢與匯出", "平台聚合、租戶開通與健康度", "權限、狀態異動與稽核追蹤"] },
] as const;

const addOns = [
  ["01", "指定金流商串接", "綠界、藍新以外之金流服務商", "NT$15,000 起"],
  ["02", "退款與對帳流程", "退款規則、對帳表與異常處理", "NT$15,000 起"],
  ["03", "行事曆雙向同步", "Google 或 Microsoft 行事曆", "NT$18,000 起"],
  ["04", "API 與 Webhook 對外串接", "與品牌既有系統交換資料", "NT$25,000 起"],
  ["05", "白標", "移除系統標識，改為品牌識別", "NT$30,000 起"],
  ["06", "多語系介面", "每增加一種語言計價，不含翻譯", "NT$20,000 起"],
  ["07", "特殊產業流程客製", "如療程、分院或分店架構", "評估後報價"],
] as const;

export default function PricingPage() {
  return <MarketingShell>
    <PageIntro dark eyebrow="Plans & service boundary" title="費用透明，功能不拆散。" description="兩種付款方式的服務內容完全相同，70 項標準功能全數開放；差別只在付款方式與導入設定費的處理。清單外需求則先確認範圍，再另行報價。" visual={<PageIntroVisual variant="pricing" dark photoSrc="/marketing/pricing-scope-planning.png" photoAlt="團隊在桌上整理流程與導入範圍" photoCaption="實際工作情境：先把流程、範圍與驗收方式在桌面上對齊。" />}><a href="#plans" className="btn min-h-12 bg-[#e2b644] px-5 font-semibold text-[#193b43] hover:bg-[#f1ca5b]">查看付款方案 <span aria-hidden="true">↓</span></a><Link href="/contact" className="btn min-h-12 border border-white/20 bg-white/5 px-5 text-white hover:bg-white/10">詢問導入範圍</Link></PageIntro>

    <section id="plans" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><SectionHeading eyebrow="Choose the payment method" title="兩種付款方式，服務內容完全相同。" description="不分方案等級、不限預約筆數、不依使用人數加價；差別只在一次付清或按月支付。" /><div className="mt-10 grid gap-5 lg:grid-cols-2">{plans.map((plan) => <PlanCard key={plan.name} plan={plan} />)}</div><div className="mt-6 flex flex-col gap-2 rounded-2xl border border-[#ddd7ca] bg-[#fbfaf6] px-5 py-4 text-sm leading-6 text-[#6d7b76] sm:flex-row sm:items-center sm:justify-between"><span><strong className="text-[#193b43]">以上金額均為未稅價</strong>，開立發票另加 5% 營業稅。</span><span>LINE 官方帳號方案費與推播費由品牌方自行負擔。</span></div></section>

    <section className="bg-[#fbfaf6] px-5 py-16 sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[.6fr_1.4fr] lg:items-center lg:gap-16"><div><p className="eyebrow !text-[#b08116]">The scope at a glance</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-[#193b43] sm:text-4xl">買的是完整營運骨架，不是功能拼盤。</h2><p className="mt-4 text-base leading-7 text-[#5d6d6b]">標準功能先全開放；需要額外串接或特殊流程時，再以加購項目清楚確認。</p></div><PricingVisual /></div></section>

    <section id="features" className="bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="70 included capabilities" title="詳細功能卡：從入口到回訪，一次看懂。" description="以下五大模組共同構成 70 項標準功能，全部開放，不需要為了使用某個功能升級方案。" /><div className="mt-10 grid gap-4 lg:grid-cols-2">{featureGroups.map((group) => <FeatureGroup key={group.number} group={group} />)}</div></div></section>

    <section id="addons" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><SectionHeading eyebrow="Optional build and integration" title="七項加值項目，價格先說清楚。" description="以下為單項起價，皆為一次性建置費、未稅；實際費用依需求規格、資料量與串接複雜度確認。" /><span className="w-fit rounded-full bg-[#fbf1d9] px-4 py-2 text-sm font-semibold text-[#8a6816]">7 項另行報價</span></div><div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{addOns.map(([number, title, note, price]) => <AddonCard key={number} number={number} title={title} note={note} price={price} />)}</div><div className="mt-6 rounded-2xl border border-[#ddd7ca] bg-[#fbfaf6] p-5 text-sm leading-7 text-[#6d7b76]"><strong className="text-[#193b43]">報價原則：</strong>多項一併建置可合併評估，費用低於逐項加總。所有加值項目都會在開發前確認範圍、交付內容與時程；合約期間提供系統維護，不包含清單外新功能建立。</div></section>

    <section className="bg-[#1f4550] px-5 py-16 text-white sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="What is included in both payment methods" title="兩種付款方式都包含的服務" description="導入設定、標準功能、操作訓練與合約期間維護，依企劃範圍交付。" /><div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ScopeItem title="導入設定" text="LINE 架構規劃、內容置入與流程設定至可上線。" /><ScopeItem title="70 項功能" text="預約、報名、金流、CRM Lite、通知與報表全開放。" /><ScopeItem title="合約維護" text="錯誤修正、安全性、相容性與既有功能維護。" /><ScopeItem title="上線訓練" text="上線前提供後台操作教育訓練與交付確認。" /></div></div></section>

    <Callout title="想確認你的品牌適合哪種付款方式？" description="提供品牌類型、目前入口與最想改善的流程，我們會依實際範圍說明導入方式與費用。" label="聯絡導入顧問" />
  </MarketingShell>;
}

function PlanCard({ plan }: { plan: (typeof plans)[number] }) {
  return <article className={`relative overflow-hidden rounded-[1.5rem] border p-6 shadow-[0_14px_40px_rgba(31,69,80,.08)] sm:p-8 ${plan.featured ? "border-[#b08116] bg-[#193b43] text-white" : "border-[#ddd7ca] bg-white text-[#193b43]"}`}>{plan.featured && <span className="absolute right-5 top-5 rounded-full bg-[#e2b644] px-3 py-1.5 text-xs font-bold text-[#193b43]">{plan.badge}</span>}<p className={`text-xs font-semibold uppercase tracking-[0.2em] ${plan.featured ? "text-[#e2b644]" : "text-[#b08116]"}`}>{plan.name}</p><p className={`mt-2 text-sm ${plan.featured ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{plan.subtitle}</p><div className="mt-7 flex items-end gap-2"><span className="text-sm font-semibold">NT$</span><span className="text-5xl font-bold tracking-tight">{plan.price}</span><span className={`pb-1 text-sm ${plan.featured ? "text-[#c9dcda]" : "text-[#6d7b76]"}`}>{plan.priceLabel}</span></div><p className={`mt-3 text-sm font-medium ${plan.featured ? "text-[#f1ca5b]" : "text-[#8a6816]"}`}>{plan.note}</p><div className={`mt-7 rounded-xl p-4 text-sm leading-6 ${plan.featured ? "bg-white/10 text-[#dce9e6]" : "bg-[#f7f5ef] text-[#5d6d6b]"}`}><p className="font-semibold">{plan.setup}</p><p className="mt-1">{plan.detail}</p></div><Link href="/contact" className={`mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition ${plan.featured ? "bg-[#e2b644] text-[#193b43] hover:bg-[#f1ca5b]" : "bg-[#1f4550] text-white hover:bg-[#193b43]"}`}>詢問此方案 <span className="ml-2" aria-hidden="true">↗</span></Link></article>;
}

function FeatureGroup({ group }: { group: (typeof featureGroups)[number] }) {
  return <article className="rounded-2xl border border-[#ddd7ca] bg-white p-5 shadow-[0_8px_30px_rgba(31,69,80,.05)] sm:p-6"><div className="flex items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#193b43] text-xs font-bold text-[#e2b644]">{group.number}</span><div><h3 className="text-xl font-bold text-[#193b43]">{group.title}</h3><p className="mt-2 text-sm leading-6 text-[#6d7b76]">{group.description}</p></div></div><ul className="mt-6 grid gap-2 border-t border-[#eee9df] pt-5 sm:grid-cols-2">{group.features.map((feature) => <li key={feature} className="flex gap-2 text-sm leading-6 text-[#5d6d6b]"><span className="text-[#b08116]">✓</span>{feature}</li>)}</ul></article>;
}

function AddonCard({ number, title, note, price }: { number: string; title: string; note: string; price: string }) {
  return <article className="flex min-h-48 flex-col rounded-2xl border border-[#ddd7ca] bg-white p-5 shadow-[0_8px_30px_rgba(31,69,80,.05)] transition hover:-translate-y-1 hover:border-[#b08116] sm:p-6"><div className="flex items-start justify-between gap-3"><span className="text-xs font-bold text-[#b08116]">{number}</span><span className="rounded-full bg-[#fbf1d9] px-2.5 py-1 text-xs font-bold text-[#8a6816]">{price}</span></div><h3 className="mt-7 text-lg font-bold text-[#193b43]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#6d7b76]">{note}</p></article>;
}

function ScopeItem({ title, text }: { title: string; text: string }) {
  return <article className="rounded-2xl border border-white/10 bg-white/5 p-5"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#e2b644]">Included</span><h3 className="mt-4 font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-[#c9dcda]">{text}</p></article>;
}
