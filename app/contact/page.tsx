import { Callout, FeatureIcon, MarketingShell, ModuleInterface, PageIntro, PageIntroVisual, SectionHeading, SignalStrip, WorkflowRail } from "@/components/MarketingLayout";

const steps = [
  ["說明現況", "目前使用什麼入口、怎麼排程、如何收款與通知。"],
  ["拆解角色", "品牌 owner、櫃台、服務人員與顧客各自需要什麼。"],
  ["排列優先", "先完成能支撐營運的標準流程，再處理加購或客製整合。"],
  ["準備驗收", "用真實產業場景確認流程、資料隔離、權限與操作結果。"],
] as const;

export default function ContactPage() {
  return <MarketingShell>
    <PageIntro dark backgroundSrc="/marketing/contact-onboarding.png" eyebrow="Start with the real workflow" title="先談你的工作方式 再談要開哪些功能" description="我們不從套版畫面開始，而是先理解你的品牌、服務目標、資源與顧客入口，再一起決定適合的產品模組與導入順序。" visual={<PageIntroVisual variant="contact" dark photoSrc="/marketing/contact-onboarding.png" photoAlt="品牌業主與導入顧問討論服務流程" photoCaption="從品牌自己的流程開始討論，而不是先套用畫面。" />}>
      <a href="tel:079721612" className="btn min-h-12 rounded-full bg-[#e2b644] px-5 font-bold text-[#193b43] hover:bg-[#f1ca5b]">撥打導入專線 <span>07-9721612</span></a>
      <a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="btn min-h-12 rounded-full border border-white/25 bg-white/5 px-5 font-bold text-white hover:bg-white/10">加入官方 LINE <span>@xinhow</span></a>
    </PageIntro>

    <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.82fr_1.18fr] lg:items-start lg:gap-20 lg:px-10"><div><SectionHeading eyebrow="Implementation conversation" title="一次討論 先把最重要的問題說清楚" description="如果你正在評估預約／報名系統，建議先帶著以下資訊來，不需要先整理成正式規格書。" /><div className="mt-8 border-l-2 border-[#b08116] bg-[#fffdf8] p-6"><p className="text-xs font-bold tracking-[.16em] text-[#b08116]">導入聯絡方式</p><a href="tel:079721612" className="mt-4 block text-2xl font-black tracking-wide text-[#173f48] hover:text-[#b08116]">07-9721612</a><a href="mailto:service@xinhow.com.tw" className="mt-3 block break-all text-sm text-[#5d706d] hover:text-[#b08116]">service@xinhow.com.tw</a><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#d9f5e4] px-4 text-sm font-bold text-[#087f4e] hover:bg-[#c6efd6]">官方 LINE @xinhow</a><p className="mt-4 text-sm leading-7 text-[#6d706d]">適合先討論品牌類型、使用人數、顧客入口與目前最卡的流程。</p></div></div><div><div className="divide-y divide-[#d8d2c5] border-y border-[#d8d2c5]">{steps.map(([title, description], index) => <article key={title} className="grid gap-4 py-5 sm:grid-cols-[3rem_1fr] sm:items-start"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#173f48] text-xs font-bold text-white">{String(index + 1).padStart(2, "0")}</span><div><h2 className="font-black text-[#173f48]">{title}</h2><p className="mt-2 text-sm leading-7 text-[#6d706d]">{description}</p></div></article>)}</div><div className="mt-8"><ModuleInterface kind="entrance" compact /></div></div></section>

    <section className="bg-[#173f48] px-5 py-16 text-white sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr] lg:items-end lg:gap-16"><div><p className="eyebrow !text-[#e2b644]">Choose the easiest channel</p><h2 className="text-[clamp(1.9rem,3.2vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em]">不用先寫規格書 先從一個問題開始</h2><p className="mt-5 max-w-xl text-base leading-8 text-[#c9dcda]">依你的方便選擇電話、Email 或官方 LINE，我們再把品牌、入口與工作流程整理成可執行的導入路徑。</p></div><SignalStrip dark items={[{ label: "電話", value: "07-9721612", detail: "直接討論目前卡點" }, { label: "Email", value: "service@xinhow.com.tw", detail: "適合補充品牌資料" }, { label: "LINE", value: "@xinhow", detail: "官方帳號快速聯絡" }, { label: "操作介面", value: "品牌後台", detail: "先看工作流程" }]} /></div><div className="mt-12"><WorkflowRail dark steps={[{ label: "01", title: "說明現況", detail: "品牌、服務與入口" }, { label: "02", title: "拆解流程", detail: "角色、排程與資料" }, { label: "03", title: "確認範圍", detail: "標準功能與加購" }, { label: "04", title: "規劃導入", detail: "交付、訓練與驗收" }]} /></div></div></section>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><SectionHeading eyebrow="Before the first meeting" title="你可以先準備這五件事" description="資訊越接近實際使用情況，越容易在第一次討論就排出清楚的導入路徑。" /><div className="mt-10 grid gap-0 border-y border-[#d8d2c5] md:grid-cols-5">{["品牌數量", "服務或活動", "目前入口", "團隊角色", "最想改善的流程"].map((title, index) => <article key={title} className="border-b border-[#d8d2c5] p-5 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"><FeatureIcon name={index === 0 ? "globe" : index === 1 ? "calendar" : index === 2 ? "line" : index === 3 ? "users" : "spark"} compact /><span className="mt-4 block text-xs font-mono font-bold text-[#b08116]">0{index + 1}</span><p className="mt-2 text-sm font-bold text-[#173f48]">{title}</p></article>)}</div></section>

    <Callout title="也可以先登入查看目前的系統骨架" description="管理後台登入入口保留給已建立帳號的品牌團隊與系統管理者使用。" href="/admin/login" label="前往後台登入" />
  </MarketingShell>;
}
