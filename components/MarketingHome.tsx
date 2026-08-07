import Link from "next/link";
import { BrandMark } from "@/components/Brand";

const capabilities = [
  { number: "01", title: "跨產業預約", description: "時間制、場次制，支援服務提供者、場地或設備資源，不被單一產業流程綁住。", accent: "bg-sky-100 text-sky-700" },
  { number: "02", title: "活動與課程報名", description: "活動、場次、票種、候補、優惠碼與 QR 報到，讓報名流程和預約一起管理。", accent: "bg-amber-100 text-amber-800" },
  { number: "03", title: "標準金流串接", description: "依企劃支援綠界／藍新、訂金與付款回呼；付款狀態和服務紀錄分開追蹤。", accent: "bg-emerald-100 text-emerald-700" },
  { number: "04", title: "LINE 優先入口", description: "LINE Rich Menu → LIFF 是主要入口，同時保留瀏覽器、Email、自訂網址與嵌入元件。", accent: "bg-lime-100 text-lime-800" },
  { number: "05", title: "多品牌完全隔離", description: "平台擁有者管理所有品牌；每個品牌有獨立後台、成員角色與資料邊界。", accent: "bg-indigo-100 text-indigo-700" },
  { number: "06", title: "CRM Lite 與自動化", description: "顧客分眾、互動時間軸與規則式行銷自動化，讓成交後的回訪不再靠人工記憶。", accent: "bg-rose-100 text-rose-700" },
  { number: "07", title: "營運統計報表", description: "預約、報名、付款、通知、漏斗與未到等指標，協助團隊看懂實際營運。", accent: "bg-violet-100 text-violet-700" },
  { number: "08", title: "品牌專屬入口", description: "支援品牌短網址、自訂網址、嵌入元件與自訂網域，顧客看到的是你的品牌。", accent: "bg-orange-100 text-orange-700" },
] as const;

const industries = [
  ["顧問與預約服務", "諮詢、教練、顧問、到府與一對一服務"],
  ["課程與活動", "講座、工作坊、訓練、營隊與多場次活動"],
  ["健身與教學", "團課、私教、教室、教練與場地排程"],
  ["美容與生活服務", "美容、美甲、按摩、攝影與生活體驗"],
  ["場地與設備", "會議室、共享空間、設備與資源預約"],
  ["寵物與照護服務", "美容、訓練、照護與其他預約型服務"],
] as const;

const addOns = ["指定金流串接", "退款與對帳", "外部行事曆同步", "外部 API／資料交換", "進階白牌入口", "多語系介面", "產業客製模組"] as const;

export function MarketingHome() {
  return (
    <main className="overflow-hidden bg-[#f7fafd] text-slate-900">
      <section className="relative isolate bg-[#071c2e] text-white">
        <div className="absolute inset-0 -z-10 opacity-60" style={{ backgroundImage: "linear-gradient(rgba(105,180,228,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(105,180,228,.09) 1px, transparent 1px)", backgroundSize: "52px 52px" }} />
        <div className="absolute -right-32 top-16 -z-10 h-80 w-80 rounded-full bg-[#1b6fc4]/30 blur-3xl" />
        <div className="absolute -left-40 bottom-0 -z-10 h-72 w-72 rounded-full bg-[#b8862b]/15 blur-3xl" />

        <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10" aria-label="主選單">
          <Link href="/" className="flex min-h-11 items-center gap-3" aria-label="XINHOW 首頁">
            <BrandMark className="h-10 w-10 bg-white text-[#071c2e]" />
            <span><span className="block text-base font-bold tracking-[0.12em]">XINHOW</span><span className="block text-[10px] tracking-[0.22em] text-sky-200">SERVICE PLATFORM</span></span>
          </Link>
          <div className="hidden items-center gap-7 text-sm text-slate-300 lg:flex">
            <a href="#capabilities" className="transition hover:text-white">產品能力</a>
            <a href="#industries" className="transition hover:text-white">適用產業</a>
            <a href="#workflow" className="transition hover:text-white">運作方式</a>
            <Link href="/admin/login" className="btn min-h-11 border border-white/20 bg-white/10 px-4 text-white hover:bg-white/15">後台登入</Link>
          </div>
          <Link href="#contact" className="btn min-h-11 border border-sky-200/30 bg-sky-300/10 px-4 text-sm text-sky-100 hover:bg-sky-300/20 lg:hidden">聯絡我們</Link>
        </nav>

        <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 pb-20 pt-10 sm:px-8 sm:pb-24 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:gap-16 lg:px-10 lg:pb-28 lg:pt-16">
          <div className="max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200/20 bg-white/5 px-3 py-1.5 text-xs font-medium tracking-wide text-sky-100"><span className="h-1.5 w-1.5 rounded-full bg-[#b8862b]" /> 多品牌預約與報名 SaaS</p>
            <h1 className="max-w-2xl text-4xl font-bold leading-[1.12] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">把每一次預約，<span className="text-sky-300">變成可持續經營的關係。</span></h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">XINHOW 將預約、報名、收款、提醒、CRM Lite 與營運報表整合在同一個多品牌平台，讓顧客更容易進來，讓團隊更清楚下一步。</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#contact" className="btn min-h-12 bg-white px-5 text-[#071c2e] shadow-lg shadow-black/10 hover:bg-sky-50">預約導入諮詢 <span aria-hidden="true">↗</span></a>
              <a href="#capabilities" className="btn min-h-12 border border-white/20 bg-white/5 px-5 text-white hover:bg-white/10">查看產品能力</a>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400"><span>✓ LINE Rich Menu → LIFF</span><span>✓ 瀏覽器備援</span><span>✓ 多品牌資料隔離</span></div>
          </div>

          <DashboardPreview />
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white" aria-label="產品範圍">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-5 text-sm text-slate-600 sm:px-8 lg:px-10"><span className="font-semibold text-slate-900">一個平台，完整接住</span><span>預約</span><span className="text-slate-300">/</span><span>活動報名</span><span className="text-slate-300">/</span><span>標準金流</span><span className="text-slate-300">/</span><span>通知</span><span className="text-slate-300">/</span><span>CRM Lite</span><span className="text-slate-300">/</span><span>統計報表</span></div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.8fr_1.2fr] lg:gap-20 lg:px-10">
        <div><p className="eyebrow">From first click to return visit</p><h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">不是只放一個預約連結，而是把服務流程接起來。</h2></div>
        <div className="grid gap-7 text-base leading-8 text-slate-600 sm:grid-cols-2"><p>顧客從熟悉的 LINE 入口開始，也能在瀏覽器、品牌網址或嵌入元件完成預約與報名。每個入口都回到同一套品牌流程，降低操作落差。</p><p>團隊在品牌後台管理服務、排程、名單、通知與 CRM Lite；平台擁有者則在系統層管理多品牌、交付狀態、健康度與跨品牌聚合資訊。</p></div>
      </section>

      <section id="capabilities" className="bg-[#eef5fa] px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
        <div className="mx-auto max-w-7xl"><div className="max-w-2xl"><p className="eyebrow">Product capabilities</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">從開門迎客，到看懂營運。</h2><p className="mt-4 text-base leading-7 text-slate-600">70 項標準功能完整開放，依品牌設定切換流程，不把你的產業硬套成單一模板。</p></div><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{capabilities.map((item) => <article key={item.number} className="group min-h-56 rounded-2xl border border-white/80 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md"><div className="flex items-start justify-between gap-3"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold ${item.accent}`}>{item.number}</span><span className="text-2xl text-slate-200 transition group-hover:text-[#1b6fc4]" aria-hidden="true">↗</span></div><h3 className="mt-7 font-bold text-slate-900">{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p></article>)}</div></div>
      </section>

      <section id="industries" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr] lg:gap-20"><div><p className="eyebrow">Built for service businesses</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">你的產業不同，流程也可以不同。</h2><p className="mt-4 max-w-md text-base leading-7 text-slate-600">不論是單次服務、固定時段、多人活動或共享資源，都用設定決定規則，保留品牌自己的工作方式。</p></div><div className="grid gap-3 sm:grid-cols-2">{industries.map(([title, description], index) => <div key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#071c2e] text-xs font-bold text-sky-200">{String(index + 1).padStart(2, "0")}</span><div><h3 className="font-semibold text-slate-900">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></div></div>)}</div></div></section>

      <section id="workflow" className="bg-[#071c2e] px-5 py-20 text-white sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><div className="max-w-2xl"><p className="eyebrow !text-sky-300">How the system works</p><h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">三個層次，讓流程不再斷裂。</h2></div><div className="mt-12 grid gap-4 lg:grid-cols-3"><FlowStep number="01" title="顧客入口" description="LINE Rich Menu → LIFF 為主，瀏覽器、Email、品牌網址與嵌入元件作為備援與擴充。" /><FlowStep number="02" title="品牌後台" description="品牌成員依角色處理服務、排程、預約、報名、報到、通知與 CRM Lite。" /><FlowStep number="03" title="平台營運" description="系統擁有者管理所有品牌的開通、平台管理員、健康狀態、聚合報表與稽核。" /></div><div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-white">同一套核心，對應不同品牌</p><p className="mt-1 text-sm leading-6 text-slate-400">品牌資料完全隔離，多品牌、多成員、多入口，不必犧牲管理清晰度。</p></div><div className="flex flex-wrap gap-2 text-xs text-sky-200"><span className="rounded-full border border-sky-200/20 px-3 py-1.5">Platform owner</span><span className="rounded-full border border-sky-200/20 px-3 py-1.5">Brand owner</span><span className="rounded-full border border-sky-200/20 px-3 py-1.5">Staff roles</span></div></div></div></div></section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-8 lg:grid-cols-2 lg:items-start"><div><p className="eyebrow">A clear commercial boundary</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">70 項標準功能完整開放，額外需求清楚分開。</h2><p className="mt-4 max-w-xl text-base leading-7 text-slate-600">基本產品以完整預約與報名營運為核心；清單外的特殊串接或客製模組，另行評估、報價與確認，維護合約不會默默變成新功能開發。</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between border-b border-slate-100 pb-4"><div><p className="text-sm font-bold text-slate-900">另行報價與客製項目</p><p className="mt-1 text-xs text-slate-500">依合作範圍確認，不影響標準功能使用</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">7 項</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{addOns.map((item) => <div key={item} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600"><span className="text-[#b8862b]" aria-hidden="true">+</span>{item}</div>)}</div></div></div></section>

      <section id="contact" className="relative overflow-hidden bg-[#dcecf6] px-5 py-16 sm:px-8 sm:py-20 lg:px-10"><div className="absolute -right-10 top-0 h-64 w-64 rounded-full bg-white/60 blur-3xl" /><div className="relative mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow">Start with your operating model</p><h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-[#071c2e] sm:text-4xl">準備把預約與報名，變成品牌的長期資產嗎？</h2><p className="mt-4 max-w-xl text-base leading-7 text-slate-600">告訴我們你的品牌、服務類型與目前入口，我們會從流程與開通方式開始一起規劃。</p></div><div className="flex flex-col gap-3 sm:flex-row lg:shrink-0"><a href="tel:079721612" className="btn min-h-12 bg-[#071c2e] px-5 text-white hover:bg-[#0b2733]">導入諮詢 <span className="text-sky-300">07-9721612#888</span></a><Link href="/admin/login" className="btn min-h-12 border border-[#071c2e]/20 bg-white/70 px-5 text-[#071c2e] hover:bg-white">後台登入</Link></div></div></section>

      <footer className="bg-[#071c2e] px-5 py-8 text-slate-400 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-white"><BrandMark className="h-7 w-7 bg-white text-[#071c2e]" /><span className="font-semibold tracking-[0.12em]">XINHOW</span></div><p>多品牌預約與報名 SaaS · 服務流程的營運基礎</p></div></footer>
    </main>
  );
}

function DashboardPreview() {
  return <div className="relative mx-auto w-full max-w-xl lg:ml-auto"><div className="absolute -inset-4 rounded-[2rem] border border-sky-200/10" /><div className="relative overflow-hidden rounded-2xl border border-white/15 bg-[#f7fafd] text-slate-900 shadow-2xl shadow-black/25"><div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#071c2e] text-[10px] font-bold text-white">XP</span><div><p className="text-[11px] font-bold">XINHOW PLATFORM</p><p className="text-[9px] text-slate-400">系統擁有者控制台</p></div></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">● Online</span></div><div className="grid min-h-[310px] grid-cols-[92px_1fr] sm:grid-cols-[124px_1fr]"><div className="space-y-1 bg-[#071c2e] p-3 text-[9px] text-slate-400"><p className="mb-3 px-2 text-[8px] uppercase tracking-[.14em] text-sky-200">Platform</p><p className="rounded-lg bg-white/10 px-2 py-2 text-white">總覽</p><p className="px-2 py-2">品牌租戶</p><p className="px-2 py-2">營運健康</p><p className="px-2 py-2">跨品牌報表</p><p className="px-2 py-2">平台稽核</p><div className="mt-8 border-t border-white/10 pt-3"><p className="px-2 py-2 text-slate-500">Brand backend</p><p className="px-2 py-2">預約與報名</p><p className="px-2 py-2">CRM Lite</p></div></div><div className="space-y-4 p-4 sm:p-5"><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#1b6fc4]">System overview</p><p className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">品牌營運總覽</p></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><MiniCard label="品牌" value="隔離" tone="blue" /><MiniCard label="預約" value="接起來" tone="green" /><MiniCard label="報名" value="可管理" tone="amber" /><MiniCard label="CRM" value="可追蹤" tone="rose" /></div><div className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold text-slate-700">品牌開通流程</p><span className="text-[9px] text-slate-400">3 steps</span></div><div className="mt-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="h-1 flex-1 rounded-full bg-emerald-100" /><span className="h-2 w-2 rounded-full bg-[#1b6fc4]" /><span className="h-1 flex-1 rounded-full bg-slate-100" /><span className="h-2 w-2 rounded-full bg-slate-300" /></div><div className="mt-2 flex justify-between text-[8px] text-slate-400"><span>建立品牌</span><span>完成設定</span><span>開始營運</span></div></div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#071c2e] p-3 text-white"><p className="text-[9px] text-sky-200">Customer journey</p><p className="mt-1 text-xs font-semibold">LINE → LIFF → 預約</p></div><div className="rounded-xl bg-amber-50 p-3 text-amber-900"><p className="text-[9px] text-amber-700">Growth loop</p><p className="mt-1 text-xs font-semibold">完成 → 提醒 → 回訪</p></div></div></div></div></div><p className="mt-4 text-center text-xs text-slate-400">平台層與品牌後台分開，讓管理責任清楚可交接。</p></div>;
}

function MiniCard({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "amber" | "rose" }) {
  const styles = { blue: "bg-sky-50 text-sky-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700" } as const;
  return <div className={`rounded-xl p-2.5 ${styles[tone]}`}><p className="text-[9px] opacity-70">{label}</p><p className="mt-1 text-[11px] font-bold">{value}</p></div>;
}

function FlowStep({ number, title, description }: { number: string; title: string; description: string }) {
  return <article className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6"><span className="text-sm font-mono font-semibold text-[#b8862b]">{number}</span><h3 className="mt-8 text-xl font-bold">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-400">{description}</p></article>;
}
