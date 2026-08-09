import Link from "next/link";
import { Callout, FeatureIcon, MarketingShell, PageIntro, PageIntroVisual, ScenarioMatrix, SectionHeading, SignalStrip } from "@/components/MarketingLayout";

const scenes = [
  { number: "01", title: "顧問、教練與一對一服務", situation: "每位顧客的服務時間不同，需要指定人員或依資源安排。", system: "設定服務時長、首次／再次服務、服務提供者與可預約區間；顧客從 LINE 或瀏覽器選擇可用時段。", result: "團隊看得到每日安排，顧客不用來回確認時間。" },
  { number: "02", title: "課程、講座與多場次活動", situation: "同一個活動有不同場次、票種、容量與報名資料。", system: "建立活動、場次、票種、報名表單、候補與 QR 報到，付款與報名狀態分開追蹤。", result: "活動承辦人不用用多張表格拼出一份報名名單。" },
  { number: "03", title: "健身、教學與團體課程", situation: "固定週期、單堂預約、會員套票與場地容量同時存在。", system: "用場次制或時間制切換流程，會員堂數 ledger 與指定票種扣抵，提醒與報表同步。", result: "前台、教練與櫃台看同一份可用量與出席狀態。" },
  { number: "04", title: "美容、生活與體驗服務", situation: "顧客重視品牌感受，服務完成後還需要回訪與再次預約。", system: "品牌專屬入口、Email／LINE 提醒、CRM Lite 分眾與規則式自動化接續經營。", result: "從第一次預約到下一次回訪，有可追蹤的顧客旅程。" },
  { number: "05", title: "場地、設備與共享資源", situation: "不一定有服務人員，但同一資源不能被重複預約。", system: "以 service_id 綁定場地／設備排程與容量，不虛構不需要的人員角色。", result: "資源排程符合實際使用方式，管理者仍保有容量控制。" },
  { number: "06", title: "多品牌服務集團", situation: "多個品牌共用平台，但每個品牌的資料、成員與對外入口必須隔離。", system: "平台層管理租戶與開通；品牌層獨立操作服務、顧客、報表與通知。", result: "系統擁有者看全局，品牌團隊只看得到自己的工作。" },
] as const;

export default function SolutionsPage() {
  return <MarketingShell>
    <PageIntro eyebrow="Scenes before features" title="不預設你是什麼產業，先理解你怎麼工作。" description="預約與報名不是同一種生意。XINHOW 以服務目標、資源配置、成員角色與顧客入口來設計流程，讓系統貼近場景，而不是要求團隊改成系統的樣子。" visual={<PageIntroVisual variant="solutions" photoSrc="/marketing/solutions-event-checkin.png" photoAlt="活動現場的報到與入場作業" photoCaption="實際工作情境：活動入口、報到資料與現場人流需要同時被接住。" />}><Link href="/contact" className="btn min-h-12 bg-[#1f4550] px-5 text-white hover:bg-[#193b43]">討論你的場景 <span aria-hidden="true">↗</span></Link><Link href="/product" className="btn min-h-12 border border-[#1f4550]/20 bg-white/70 px-5 text-[#1f4550] hover:bg-white">回看產品能力</Link></PageIntro>

    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10"><div className="max-w-2xl"><SectionHeading eyebrow="Real operating scenes" title="每個場景，都要回答三個問題。" description="顧客怎麼進來？團隊怎麼處理？完成後如何延續？以下用實際營運語言說明系統會怎麼接。" /></div><div className="mt-10 grid gap-5 lg:grid-cols-2">{scenes.map((scene) => <article key={scene.number} className="rounded-2xl border border-[#ddd7ca] bg-white p-5 shadow-[0_8px_30px_rgba(31,69,80,.05)] sm:p-6"><div className="flex items-start justify-between gap-4"><span className="text-sm font-mono font-semibold text-[#b08116]">{scene.number}</span><span className="rounded-full bg-[#edf2ef] px-3 py-1 text-xs font-medium text-[#1f4550]">場景說明</span></div><h2 className="mt-7 text-xl font-bold text-[#193b43]">{scene.title}</h2><div className="mt-5 grid gap-4 border-t border-[#eee9df] pt-5 text-sm leading-6"><SceneLine label="現場情況" text={scene.situation} /><SceneLine label="系統怎麼接" text={scene.system} /><SceneLine label="帶來的結果" text={scene.result} accent /></div></article>)}</div></section>

    <section className="bg-[#eef3ef] px-5 py-16 sm:px-8 sm:py-20 lg:px-10"><div className="mx-auto max-w-7xl"><div className="grid gap-8 lg:grid-cols-[.7fr_1.3fr] lg:items-end lg:gap-16"><div><p className="eyebrow !text-[#b08116]">One core, many operating shapes</p><h2 className="text-3xl font-bold leading-tight tracking-tight text-[#193b43] sm:text-4xl">同一套核心，對應不同的工作方式。</h2><p className="mt-4 text-base leading-7 text-[#5d6d6b]">視覺化看出差異：入口、安排與完成方式可以不同，但資料仍然回到同一個營運系統。</p></div><SignalStrip items={[{ label: "一對一", value: "服務時段", detail: "人員／資源" }, { label: "課程活動", value: "場次票種", detail: "容量／報到" }, { label: "場地設備", value: "資源排程", detail: "避免重複預約" }, { label: "多品牌", value: "資料隔離", detail: "平台／品牌分層" }]} /></div><div className="mt-10"><ScenarioMatrix /></div></div></section>

    <section className="bg-[#1f4550] px-5 py-20 text-white sm:px-8 sm:py-24 lg:px-10"><div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-20"><div><p className="eyebrow !text-[#e2b644]">Configuration over assumptions</p><h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">同一個核心，依品牌設定成不同流程。</h2><p className="mt-4 max-w-xl text-base leading-7 text-[#c9dcda]">時間制／場次制、指定服務提供者／資源型服務、首次／再次服務、訂金與顧客入口，都以設定決定行為。</p></div><div className="grid gap-3 sm:grid-cols-2"><ConfigPill title="預約模式" value="時間制 ↔ 場次制" /><ConfigPill title="服務目標" value="人員／場地／設備" /><ConfigPill title="顧客入口" value="LINE／瀏覽器／嵌入" /><ConfigPill title="品牌層級" value="平台 ↔ 品牌後台" /></div></div></section>

    <Callout title="你的服務流程，不需要先被壓縮成模板。" description="把目前的入口、排程、名單與回訪方式帶來，我們從真實工作拆解適合的模組與導入順序。" label="預約場景諮詢" />
  </MarketingShell>;
}

function SceneLine({ label, text, accent = false }: { label: string; text: string; accent?: boolean }) { return <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-3"><FeatureIcon name={label === "現場情況" ? "users" : label === "系統怎麼接" ? "settings" : "chart"} compact /><div><p className={`text-xs font-semibold ${accent ? "text-[#b08116]" : "text-[#7a8782]"}`}>{label}</p><p className={`mt-1 ${accent ? "font-medium text-[#1f4550]" : "text-[#5d6d6b]"}`}>{text}</p></div></div>; }
function ConfigPill({ title, value }: { title: string; value: string }) { return <div className="flex gap-3 rounded-[1.15rem] border border-white/10 bg-white/5 p-4"><FeatureIcon name={title === "預約模式" ? "calendar" : title === "服務目標" ? "users" : title === "顧客入口" ? "line" : "layers"} dark compact /><div><p className="text-xs text-[#a9c2be]">{title}</p><p className="mt-2 font-semibold text-white">{value}</p></div></div>; }
