import Link from "next/link";
import { Callout, MarketingShell, PageIntro, PageIntroVisual, SectionHeading } from "@/components/MarketingLayout";

const steps = [
  ["說明現況", "目前使用什麼入口、怎麼排程、如何收款與通知。"],
  ["拆解角色", "平台擁有者、品牌 owner、櫃台、服務人員與顧客各自需要什麼。"],
  ["排列優先", "先完成能支撐營運的標準流程，再處理加購或客製整合。"],
  ["準備驗收", "用真實產業場景確認流程、資料隔離、權限與操作結果。"],
] as const;

export default function ContactPage() {
  return <MarketingShell>
    <PageIntro eyebrow="Start with the real workflow" title="先談你的工作方式，再談要開哪些功能。" description="我們不從套版畫面開始，而是先理解你的品牌、服務目標、資源與顧客入口，再一起決定適合的產品模組與導入順序。" visual={<PageIntroVisual variant="contact" photoSrc="/marketing/contact-onboarding.png" photoAlt="品牌業主與導入顧問討論服務流程" photoCaption="實際工作情境：從品牌自己的流程開始討論，而不是先套用畫面。" />}><a href="tel:079721612" className="btn min-h-12 bg-[#1f4550] px-5 text-white hover:bg-[#193b43]">撥打導入專線 <span className="text-[#e2b644]">07-9721612</span></a><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="btn min-h-12 border border-[#1f4550]/20 bg-[#e2b644]/20 px-5 text-[#1f4550] hover:bg-[#e2b644]/30">加入官方 LINE <span className="font-semibold">@xinhow</span></a><Link href="/product" className="btn min-h-12 border border-[#1f4550]/20 bg-white/70 px-5 text-[#1f4550] hover:bg-white">先看產品能力</Link></PageIntro>

    <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.85fr_1.15fr] lg:gap-20 lg:px-10"><div><SectionHeading eyebrow="Implementation conversation" title="一次討論，先把最重要的問題說清楚。" description="如果你正在評估預約／報名系統，建議先帶著以下資訊來，不需要先整理成正式規格書。" /><div className="mt-8 rounded-2xl bg-[#1f4550] p-6 text-white"><p className="text-xs uppercase tracking-[0.2em] text-[#e2b644]">導入聯絡方式</p><a href="tel:079721612" className="mt-4 block text-2xl font-bold tracking-wide hover:text-[#e2b644]">07-9721612</a><a href="mailto:service@xinhow.com.tw" className="mt-3 block break-all text-sm text-[#dce9e6] hover:text-[#e2b644]">service@xinhow.com.tw</a><a href="https://lin.ee/jnAfCBy" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[#e2b644] px-4 text-sm font-semibold text-[#193b43] hover:bg-[#f1ca5b]">官方 LINE · @xinhow</a><p className="mt-3 text-sm leading-6 text-[#c9dcda]">適合先討論品牌類型、使用人數、顧客入口與目前最卡的流程。</p></div></div><div className="grid gap-3 sm:grid-cols-2">{steps.map(([title, description], index) => <article key={title} className="rounded-2xl border border-[#ddd7ca] bg-white p-5 shadow-[0_8px_30px_rgba(31,69,80,.05)]"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf2ef] text-xs font-bold text-[#1f4550]">{String(index + 1).padStart(2, "0")}</span><h2 className="mt-7 font-bold text-[#193b43]">{title}</h2><p className="mt-2 text-sm leading-6 text-[#6d7b76]">{description}</p></article>)}</div></section>

    <section className="bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Before the first meeting" title="你可以先準備這五件事。" description="資訊越接近實際使用情況，越容易在第一次討論就排出清楚的導入路徑。" /><div className="mt-10 grid gap-3 md:grid-cols-5"><PrepCard number="01" title="品牌數量" /><PrepCard number="02" title="服務或活動" /><PrepCard number="03" title="目前入口" /><PrepCard number="04" title="團隊角色" /><PrepCard number="05" title="最想改善的流程" /></div></div></section>

    <Callout title="也可以先登入查看目前的系統骨架。" description="管理後台登入入口保留給已建立帳號的品牌團隊與系統管理者使用。" href="/admin/login" label="前往後台登入" />
  </MarketingShell>;
}

function PrepCard({ number, title }: { number: string; title: string }) { return <div className="rounded-2xl border border-[#ddd7ca] bg-white p-4 text-center"><span className="text-xs font-mono font-semibold text-[#b08116]">{number}</span><p className="mt-4 text-sm font-semibold text-[#193b43]">{title}</p></div>; }
