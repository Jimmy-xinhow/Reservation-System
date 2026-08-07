import Link from "next/link";
import { Callout, MarketingShell, PageIntro, SectionHeading } from "@/components/MarketingLayout";

const addOns = ["指定金流串接", "退款與對帳", "外部行事曆同步", "外部 API／資料交換", "進階白牌入口", "多語系介面", "產業客製模組"] as const;
const included = ["預約與活動報名核心流程", "標準綠界／藍新金流與付款回呼", "LINE Rich Menu → LIFF 與瀏覽器備援", "Email／LINE 提醒與投遞去重", "CRM Lite、分眾、時間軸與規則式自動化", "品牌後台、角色權限與營運統計報表", "平台擁有者的多品牌租戶治理"] as const;

export default function PricingPage() {
  return <MarketingShell>
    <PageIntro dark eyebrow="Plans & service boundary" title="先把商業邊界說清楚，再一起把系統做好。" description="標準功能以完整的預約與報名營運為核心；清單外的特殊串接或客製模組另行評估、報價與確認，維護合約不會默默變成新功能開發。"><Link href="/contact" className="btn min-h-12 bg-[#e2b644] px-5 font-semibold text-[#193b43] hover:bg-[#f1ca5b]">詢問導入範圍 <span aria-hidden="true">↗</span></Link><Link href="/product" className="btn min-h-12 border border-white/20 bg-white/5 px-5 text-white hover:bg-white/10">查看產品模組</Link></PageIntro>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr] lg:items-stretch"><article className="rounded-2xl bg-[#1f4550] p-6 text-white sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e2b644]">Standard foundation</p><h2 className="mt-3 text-3xl font-bold">70 項標準功能</h2><p className="mt-2 text-sm text-[#c9dcda]">完整開放，不以方案開關隱藏核心功能。</p></div><span className="rounded-full border border-[#e2b644]/30 px-3 py-1.5 text-xs text-[#e2b644]">標準功能全開放</span></div><ul className="mt-8 grid gap-3 text-sm leading-6 sm:grid-cols-2">{included.map((item) => <li key={item} className="flex gap-2 text-[#dce9e6]"><span className="text-[#e2b644]">✓</span>{item}</li>)}</ul></article><article className="rounded-2xl border border-[#ddd7ca] bg-white p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b08116]">Commercial clarity</p><h2 className="mt-3 text-3xl font-bold text-[#193b43]">7 項另行評估</h2><p className="mt-2 text-sm leading-6 text-[#6d7b76]">不影響標準功能使用，依合作範圍另行報價與確認。</p><div className="mt-7 grid gap-2">{addOns.map((item, index) => <div key={item} className="flex items-center gap-3 rounded-lg bg-[#f7f5ef] px-3 py-2.5 text-sm text-[#5d6d6b]"><span className="text-xs font-bold text-[#b08116]">{String(index + 1).padStart(2, "0")}</span>{item}</div>)}</div></article></div></section>

    <section className="bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="How we scope the work" title="從需求盤點到可驗收的交付。" description="導入時先釐清哪些是標準設定、哪些需要整合、哪些屬於清單外客製，再決定實作與驗收邊界。" /><div className="mt-10 grid gap-4 md:grid-cols-3"><ScopeCard number="01" title="確認流程" description="盤點品牌、角色、顧客入口、服務／活動、付款與通知流程。" /><ScopeCard number="02" title="確認範圍" description="把標準功能、設定、加購與清單外客製分層記錄。" /><ScopeCard number="03" title="確認驗收" description="以實際場景、權限、資料隔離與操作結果共同驗收。" /></div></div></section>

    <Callout title="需要先知道你的品牌適合哪種導入方式？" description="聯絡我們時提供品牌類型、目前入口與最想改善的流程，我們會從範圍和優先順序開始。" label="聯絡導入顧問" />
  </MarketingShell>;
}

function ScopeCard({ number, title, description }: { number: string; title: string; description: string }) { return <article className="rounded-2xl border border-[#ddd7ca] bg-white p-5"><span className="text-sm font-mono font-semibold text-[#b08116]">{number}</span><h3 className="mt-8 font-bold text-[#193b43]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#6d7b76]">{description}</p></article>; }
