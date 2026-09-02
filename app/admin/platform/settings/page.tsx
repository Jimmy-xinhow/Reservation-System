import Link from "next/link";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { requireSystemPermission } from "@/lib/platform";
import { platformAccessLabel } from "@/lib/platform-roles";

export const dynamic = "force-dynamic";

export default async function PlatformSettingsPage() {
  const platform = await requireSystemPermission("settings.view");
  const governanceChecks = [
    { label: "系統帳號身分", value: `目前帳號：${platformAccessLabel(platform.accessType)}`, tone: "good" },
    { label: "多品牌資料隔離", value: "登入身分、品牌範圍與資料庫權限共同保護", tone: "good" },
    { label: "標準功能政策", value: "70 項標準功能全開放", tone: "good" },
    { label: "清單外需求", value: "七項加購／客製需另行報價與確認", tone: "note" },
    { label: "品牌日常設定", value: "由各品牌管理者在品牌後台管理", tone: "note" },
  ];
  const deploymentChecks = [
    ["多品牌 LINE 憑證對應", Boolean(process.env.LINE_CHANNEL_SECRETS_JSON && process.env.LINE_CHANNEL_ACCESS_TOKENS_JSON)],
    ["Email 寄送服務", Boolean(process.env.RESEND_API_KEYS_JSON || process.env.RESEND_API_KEY)],
    ["標準金流密鑰", Boolean(process.env.PAYMENT_SECRETS_JSON)],
    ["自動排程驗證資料", Boolean(process.env.CRON_SECRET)],
  ] as const;

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">系統政策</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">平台設定</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          這裡只管理 XINHOW SaaS 系統本身的權限、品牌政策與上線設定，不修改任何品牌的服務、顧客、預約或通知內容。
        </p>
      </header>

      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <p className="eyebrow">管理範圍</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">系統層級規則</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">這些是系統營運與品牌交付的界線，品牌管理者不會在自己的後台看到。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {governanceChecks.map((check) => (
            <div key={check.label} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-sm font-medium text-slate-800">{check.label}</span>
              <span className={`text-right text-xs leading-5 ${check.tone === "good" ? "text-emerald-700" : "text-amber-700"}`}>{check.value}</span>
            </div>
          ))}
        </div>
        <TechnicalDetails summary="查看資料隔離的技術說明" items={[{ label: "品牌識別碼（clinic_id）", value: "每筆品牌資料都帶有專屬識別碼，避免不同品牌資料混在一起。", code: false }, { label: "資料列權限（RLS）", value: "資料庫會再次檢查登入者可讀寫的品牌範圍，即使畫面操作錯誤也會拒絕跨品牌存取。", code: false }]} />
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <p className="eyebrow">上線準備</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">上線設定狀態</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">只顯示是否已完成設定，不顯示任何私密內容；授權資料只保存在伺服器。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {deploymentChecks.map(([label, configured]) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <span className="text-sm text-slate-700">{label}</span>
              <span className={`badge ${configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{configured ? "已設定" : "待設定"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 sm:p-6">
        <p className="text-sm font-semibold text-indigo-950">品牌設定在哪裡？</p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-indigo-900/75">請先在品牌管理頁建立或查看品牌，再回到品牌後台處理服務、時段、LINE、訊息、顧客回訪與報表。系統管理控制台不代替品牌日常操作。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/platform" className="btn btn-primary px-4 py-2 text-sm">前往品牌管理</Link>
          <a href="/admin" className="btn btn-secondary px-4 py-2 text-sm">返回目前品牌後台</a>
        </div>
      </section>
    </div>
  );
}
