import Link from "next/link";
import { Callout, FeatureIcon, MarketingShell, ModuleInterface, PageIntro, PageIntroVisual, SectionHeading, type ModuleKind } from "@/components/MarketingLayout";

const plans = [
  { name: "兩年一次繳", subtitle: "24 個月合約 一次付清", price: "39,800", priceLabel: "合約總額", badge: "最超值", featured: true, note: "按月計 NT$60,000 省下 NT$20,200", setup: "導入設定費免收", detail: "合約期間提前終止，需補付導入設定費 NT$6,000" },
  { name: "月繳", subtitle: "24 個月合約 按月支付", price: "2,500", priceLabel: "每月", badge: "彈性付款", featured: false, note: "另收導入設定費 NT$6,000", setup: "期滿退回導入設定費", detail: "簽約時支付一次，24 個月期滿全額退回；提前終止則不予退回" },
] as const;

const featureGroups = [
  { number: "01", title: "顧客入口與品牌", description: "讓顧客用熟悉的入口進來，同時讓不同品牌的資料與對外識別保持隔離。", features: ["LINE Rich Menu → LIFF 主要入口", "瀏覽器備援與品牌短網址", "自訂網址、嵌入元件與自訂網域", "品牌團隊角色與權限", "多品牌、多人員與資料範圍", "品牌資料隔離與操作紀錄"] },
  { number: "02", title: "預約與活動報名", description: "時間制與場次制都能使用，依服務目標選擇人員、場地、設備或共用資源。", features: ["時間制預約與場次制預約", "服務時長、首次／再次服務設定", "服務提供者、場地與設備排程", "活動、場次、票種與自訂報名表單", "候補、QR 報到與報名狀態", "取消、改期與容量控管"] },
  { number: "03", title: "收款 方案與通知", description: "把付款狀態、名額與通知接在同一條流程上，減少人工對照。", features: ["綠界／藍新標準金流串接", "訂金、付款回呼與狀態追蹤", "會員方案、套票與堂數 ledger", "報名優惠碼與指定票種扣抵", "LINE／Email 行前提醒", "投遞去重、重試與錯誤紀錄"] },
  { number: "04", title: "CRM Lite 與行銷自動化", description: "完成服務後保留可用的顧客脈絡，讓團隊知道下一步，不宣稱完整 CRM。", features: ["顧客分眾與標籤", "互動時間軸與預約／報名來源", "行銷同意 opt-in 管理", "三種規則式行銷自動化", "LINE／Email 投遞紀錄", "排程、去重與阻擋名單"] },
  { number: "05", title: "營運報表與品牌管理", description: "讓品牌看懂自己的營運狀態，依角色管理資料範圍與工作紀錄。", features: ["預約、報名、付款與出席統計", "容量、候補、未到與取消分析", "CRM Lite 與行銷投遞結果", "品牌日期範圍查詢與匯出", "角色權限與資料範圍", "品牌操作與狀態異動紀錄"] },
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

function featureGroupKind(number: string): ModuleKind {
  if (number === "01") return "entrance";
  if (number === "02") return "booking";
  if (number === "03") return "registration";
  if (number === "04") return "crm";
  return "reports";
}

export default function PricingPage() {
  return <MarketingShell>
    <PageIntro dark backgroundSrc="/marketing/pricing-scope-planning.png" eyebrow="Plans & service boundary" title="費用透明 功能不拆散" description="兩種付款方式的服務內容完全相同，70 項標準功能全數開放；差別只在付款方式與導入設定費的處理。清單外需求則先確認範圍，再另行報價。" visual={<PageIntroVisual variant="pricing" dark photoSrc="/marketing/pricing-scope-planning.png" photoAlt="團隊在桌上整理流程與導入範圍" photoCaption="先把流程、範圍與驗收方式在桌面上對齊。" />}>
      <a href="#plans" className="btn min-h-12 rounded-full bg-[#e2b644] px-5 font-bold text-[#193b43] hover:bg-[#f1ca5b]">查看付款方案 <span aria-hidden="true">↓</span></a>
      <Link href="/contact" className="btn min-h-12 rounded-full border border-white/20 bg-white/5 px-5 font-bold text-white hover:bg-white/10">詢問導入範圍</Link>
    </PageIntro>

    <section id="plans" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><SectionHeading eyebrow="Choose the payment method" title="兩種付款方式 服務內容完全相同" description="不分方案等級、不限預約筆數、不依使用人數加價；差別只在一次付清或按月支付。" /><div className="mt-12 grid gap-6 lg:grid-cols-2">{plans.map((plan) => <PlanCard key={plan.name} plan={plan} />)}</div><div className="mt-6 grid gap-2 border-y border-[#d8d2c5] py-4 text-sm leading-6 text-[#6d706d] sm:grid-cols-2"><span><strong className="text-[#173f48]">以上金額均為未稅價</strong>，開立發票另加 5% 營業稅。</span><span>LINE 官方帳號方案費與推播費由品牌方自行負擔。</span></div></section>

    <section id="features" className="bg-[#eef2ed] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="70 included capabilities" title="詳細功能 從入口到回訪一次看懂" description="以下五大模組共同構成 70 項標準功能，全部開放，不需要為了使用某個功能升級方案。" /><div className="mt-12 divide-y divide-[#d8d2c5] border-y border-[#d8d2c5]">{featureGroups.map((group) => <FeatureGroup key={group.number} group={group} />)}</div></div></section>

    <section id="addons" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><SectionHeading eyebrow="Optional build and integration" title="七項加值項目 價格先說清楚" description="以下為單項起價，皆為一次性建置費、未稅；實際費用依需求規格、資料量與串接複雜度確認。" /><span className="w-fit rounded-full bg-[#fff0bd] px-4 py-2 text-sm font-bold text-[#8a6816]">7 項另行報價</span></div><div className="mt-10 divide-y divide-[#d8d2c5] border-y border-[#d8d2c5]">{addOns.map(([number, title, note, price]) => <AddonRow key={number} number={number} title={title} note={note} price={price} />)}</div><div className="mt-6 border-l-2 border-[#b08116] bg-[#fffdf8] p-5 text-sm leading-7 text-[#6d706d]"><strong className="text-[#173f48]">報價原則：</strong>多項一併建置可合併評估，費用低於逐項加總。所有加值項目都會在開發前確認範圍、交付內容與時程；合約期間提供系統維護，不包含清單外新功能建立。</div></section>

    <section className="bg-[#173f48] px-5 py-16 text-white sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="What is included in both payment methods" title="兩種付款方式都包含的服務" description="導入設定、標準功能、操作訓練與合約期間維護，依企劃範圍交付。" /><div className="mt-10 grid gap-0 border-y border-white/15 sm:grid-cols-2 lg:grid-cols-4"><ScopeItem title="導入設定" text="LINE 架構規劃、內容置入與流程設定至可上線。" /><ScopeItem title="70 項功能" text="預約、報名、金流、CRM Lite、通知與報表全開放。" /><ScopeItem title="合約維護" text="錯誤修正、安全性、相容性與既有功能維護。" /><ScopeItem title="上線訓練" text="上線前提供後台操作教育訓練與交付確認。" /></div></div></section>

    <Callout title="想確認你的品牌適合哪種付款方式" description="提供品牌類型、目前入口與最想改善的流程，我們會依實際範圍說明導入方式與費用。" label="聯絡導入顧問" />
  </MarketingShell>;
}

function PlanCard({ plan }: { plan: (typeof plans)[number] }) {
  return <article className={`relative border p-6 sm:p-8 ${plan.featured ? "border-[#b08116] bg-[#173f48] text-white" : "border-[#d8d2c5] bg-[#fffdf8] text-[#173f48]"}`}>{plan.featured && <span className="absolute right-5 top-5 rounded-full bg-[#e2b644] px-3 py-1.5 text-xs font-bold text-[#173f48]">{plan.badge}</span>}<p className={`text-xs font-bold tracking-[.18em] ${plan.featured ? "text-[#e2b644]" : "text-[#b08116]"}`}>{plan.name}</p><p className={`mt-2 text-sm ${plan.featured ? "text-[#c9dcda]" : "text-[#6d706d]"}`}>{plan.subtitle}</p><div className="mt-7 flex items-end gap-2"><span className="text-sm font-semibold">NT$</span><span className="text-5xl font-black tracking-tight">{plan.price}</span><span className={`pb-1 text-sm ${plan.featured ? "text-[#c9dcda]" : "text-[#6d706d]"}`}>{plan.priceLabel}</span></div><p className={`mt-3 text-sm font-bold ${plan.featured ? "text-[#f1ca5b]" : "text-[#8a6816]"}`}>{plan.note}</p><div className={`mt-7 border-l-2 p-4 text-sm leading-6 ${plan.featured ? "border-[#f1ca5b] bg-white/10 text-[#dce9e6]" : "border-[#b08116] bg-[#fff7dc] text-[#5d706d]"}`}><p className="font-bold">{plan.setup}</p><p className="mt-1">{plan.detail}</p></div><Link href="/contact" className={`mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full px-5 text-sm font-bold transition ${plan.featured ? "bg-[#e2b644] text-[#173f48] hover:bg-[#f1ca5b]" : "bg-[#173f48] text-white hover:bg-[#2d6871]"}`}>詢問此方案 <span className="ml-2" aria-hidden="true">↗</span></Link></article>;
}

function FeatureGroup({ group }: { group: (typeof featureGroups)[number] }) {
  return <article className="grid gap-8 py-10 first:pt-0 last:pb-0 lg:grid-cols-[.7fr_1.3fr] lg:items-start lg:gap-14"><div><div className="flex items-center gap-3"><FeatureIcon name={group.number === "01" ? "line" : group.number === "02" ? "calendar" : group.number === "03" ? "ticket" : group.number === "04" ? "message" : "chart"} compact /><span className="text-xs font-bold tracking-[.14em] text-[#b08116]">MODULE {group.number}</span></div><h3 className="mt-4 text-2xl font-black text-[#173f48]">{group.title}</h3><p className="mt-3 text-sm leading-7 text-[#6d706d]">{group.description}</p></div><div><ul className="grid gap-x-8 gap-y-3 border-y border-[#d8d2c5] py-5 text-sm text-[#536864] sm:grid-cols-2">{group.features.map((feature) => <li key={feature} className="flex gap-2"><span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#173f48] text-[10px] text-white">✓</span>{feature}</li>)}</ul><ModuleInterface kind={featureGroupKind(group.number)} compact /></div></article>;
}

function AddonRow({ number, title, note, price }: { number: string; title: string; note: string; price: string }) {
  return <article className="grid gap-3 py-5 sm:grid-cols-[3rem_1fr_auto] sm:items-center"><span className="font-mono text-xs font-bold text-[#b08116]">{number}</span><div><h3 className="font-bold text-[#173f48]">{title}</h3><p className="mt-1 text-sm text-[#6d706d]">{note}</p></div><span className="w-fit rounded-full bg-[#fff0bd] px-3 py-1.5 text-xs font-bold text-[#8a6816]">{price}</span></article>;
}

function ScopeItem({ title, text }: { title: string; text: string }) {
  return <article className="border-b border-white/15 p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"><FeatureIcon name={title.includes("功能") ? "layers" : title.includes("設定") ? "settings" : title.includes("維護") ? "check" : "users"} dark compact /><span className="mt-4 block text-xs font-bold tracking-[.14em] text-[#e2b644]">INCLUDED</span><h3 className="mt-2 font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-[#c9dcda]">{text}</p></article>;
}
