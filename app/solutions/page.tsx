import Link from "next/link";
import { Callout, ConfigPill, MarketingShell, ModuleInterface, PageIntro, PageIntroVisual, PhotoBand, ScenarioMatrix, SceneLine, SectionHeading, SignalStrip, type ModuleKind } from "@/components/MarketingLayout";

const scenes = [
  { number: "01", title: "顧問 教練與一對一服務", situation: "每位顧客的服務時間不同，需要指定人員或依資源安排。", system: "設定服務時長、首次／再次服務、服務提供者與可預約區間；顧客從 LINE 或瀏覽器選擇可用時段。", result: "團隊看得到每日安排，顧客不用來回確認時間。" },
  { number: "02", title: "課程 講座與多場次活動", situation: "同一個活動有不同場次、票種、容量與報名資料。", system: "建立活動、場次、票種、報名表單、候補與 QR 報到，付款與報名狀態分開追蹤。", result: "活動承辦人不用用多張表格拼出一份報名名單。" },
  { number: "03", title: "健身 教學與團體課程", situation: "固定週期、單堂預約、會員套票與場地容量同時存在。", system: "用場次制或時間制切換流程，會員堂數 ledger 與指定票種扣抵，提醒與報表同步。", result: "前台、教練與櫃台看同一份可用量與出席狀態。" },
  { number: "04", title: "美容 生活與體驗服務", situation: "顧客重視品牌感受，服務完成後還需要回訪與再次預約。", system: "品牌專屬入口、Email／LINE 提醒、CRM Lite 分眾與規則式自動化接續經營。", result: "從第一次預約到下一次回訪，有可追蹤的顧客旅程。" },
  { number: "05", title: "場地 設備與共享資源", situation: "不一定有服務人員，但同一資源不能被重複預約。", system: "以 service_id 綁定場地／設備排程與容量，不虛構不需要的人員角色。", result: "資源排程符合實際使用方式，管理者仍保有容量控制。" },
  { number: "06", title: "多據點與多品牌服務", situation: "多個品牌或據點需要各自管理資料、成員與對外入口。", system: "每個品牌各自管理服務、顧客、報表與通知，入口與資料範圍清楚分開。", result: "各團隊依自己的工作方式營運，不會混用其他品牌資料。" },
] as const;

function sceneKind(number: string): ModuleKind {
  if (number === "02") return "registration";
  if (number === "04") return "crm";
  if (number === "05" || number === "06") return "brand";
  return "booking";
}

export default function SolutionsPage() {
  return <MarketingShell>
    <PageIntro dark backgroundSrc="/marketing/solutions-event-checkin.png" eyebrow="Scenes before features" title="不預設你是什麼產業 先理解你怎麼工作" description="預約與報名不是同一種生意。XINHOW 以服務目標、資源配置、成員角色與顧客入口來設計流程，讓系統貼近場景，而不是要求團隊改成系統的樣子。" visual={<PageIntroVisual variant="solutions" dark photoSrc="/marketing/solutions-event-checkin.png" photoAlt="活動現場的報到與入場作業" photoCaption="活動入口、報到資料與現場人流需要同時被接住。" />}>
      <Link href="/contact" className="btn min-h-12 rounded-full bg-[#e2b644] px-5 font-bold text-[#193b43] hover:bg-[#f1ca5b]">討論你的場景 <span aria-hidden="true">↗</span></Link>
      <Link href="/product" className="btn min-h-12 rounded-full border border-white/25 bg-white/5 px-5 font-bold text-white hover:bg-white/10">回看產品能力</Link>
    </PageIntro>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><SectionHeading eyebrow="Real operating scenes" title="每個場景都要回答三個問題" description="顧客怎麼進來？團隊怎麼處理？完成後如何延續？以下用實際營運語言說明系統會怎麼接。" /><div className="mt-12 divide-y divide-[#d8d2c5] border-y border-[#d8d2c5]">{scenes.slice(0, 3).map((scene) => <ScenePanel key={scene.number} scene={scene} />)}</div></section>

    <PhotoBand src="/marketing/solutions-event-checkin.png" alt="活動現場的報到與入場作業" eyebrow="情境示意" title="不同現場 共用一套可配置的邏輯" description="一對一服務看時段，活動看場次與報到，場地設備看資源衝突；系統用同一套邏輯接住不同工作方式。" />

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="divide-y divide-[#d8d2c5] border-y border-[#d8d2c5]">{scenes.slice(3).map((scene) => <ScenePanel key={scene.number} scene={scene} />)}</div></section>

    <section className="bg-[#eef2ed] px-5 py-16 sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-10 lg:grid-cols-[.7fr_1.3fr] lg:items-end lg:gap-16"><div><SectionHeading eyebrow="One core many operating shapes" title="同一套核心對應不同的工作方式" description="入口、安排與完成方式可以不同，但資料仍然回到同一個品牌營運系統。" /></div><SignalStrip items={[{ label: "一對一", value: "服務時段", detail: "人員／資源" }, { label: "課程活動", value: "場次票種", detail: "容量／報到" }, { label: "場地設備", value: "資源排程", detail: "避免重複預約" }, { label: "多品牌", value: "資料隔離", detail: "品牌資料範圍" }]} /></div><div className="mt-10"><ScenarioMatrix /></div></div></section>

    <section className="bg-[#173f48] px-5 py-20 text-white sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:gap-16"><div><p className="eyebrow !text-[#e2b644]">Configuration over assumptions</p><h2 className="text-[clamp(1.9rem,3.2vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em]">同一個核心 依品牌設定成不同流程</h2><p className="mt-5 max-w-xl text-base leading-8 text-[#c9dcda]">時間制／場次制、指定服務提供者／資源型服務、首次／再次服務、訂金與顧客入口，都以設定決定行為。</p></div><div className="grid gap-3 sm:grid-cols-2"><ConfigPill title="預約模式" value="時間制 ↔ 場次制" /><ConfigPill title="服務目標" value="人員／場地／設備" /><ConfigPill title="顧客入口" value="LINE／瀏覽器／嵌入" /><ConfigPill title="資料範圍" value="每個品牌各自管理" /></div></div></section>

    <Callout title="你的服務流程不需要先被壓縮成模板" description="把目前的入口、排程、名單與回訪方式帶來，我們從真實工作拆解適合的模組與導入順序。" label="預約場景諮詢" />
  </MarketingShell>;
}

function ScenePanel({ scene }: { scene: (typeof scenes)[number] }) {
  return <article className="grid gap-8 py-10 first:pt-0 last:pb-0 lg:grid-cols-[.85fr_1.15fr] lg:items-start lg:gap-16"><div><div className="flex items-center gap-3"><span className="font-mono text-xs font-bold text-[#b08116]">{scene.number}</span><span className="text-[10px] font-bold tracking-[.14em] text-[#8b9992]">場景說明</span></div><h2 className="mt-4 text-2xl font-black tracking-[-0.035em] text-[#173f48]">{scene.title}</h2><div className="mt-6"><ModuleInterface kind={sceneKind(scene.number)} compact /></div></div><div className="grid gap-4 text-sm leading-6"><SceneLine label="現場情況" text={scene.situation} /><SceneLine label="系統怎麼接" text={scene.system} /><SceneLine label="帶來的結果" text={scene.result} accent /></div></article>;
}
