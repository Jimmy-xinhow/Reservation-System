import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface HealthCheck { label: string; description: string; configured: boolean; }

export default async function PlatformOperationsPage() {
  await requirePlatformAdmin();
  const service = createServiceClient();
  const [
    { count: activeBrands, error: activeBrandsError },
    { count: inactiveBrands, error: inactiveBrandsError },
    { count: failedCrm, error: failedCrmError },
    { count: failedAppointmentNotifications, error: failedAppointmentError },
    { count: failedRegistrationNotifications, error: failedRegistrationError },
    { count: activePaymentSettings, error: paymentSettingsError },
    { count: unprocessedWebhooks, error: webhookError },
  ] = await Promise.all([
    service.from("clinics").select("id", { count: "exact", head: true }).eq("active", true),
    service.from("clinics").select("id", { count: "exact", head: true }).eq("active", false),
    service.from("crm_delivery_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    service.from("appointment_notification_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    service.from("registration_notification_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    service.from("clinic_payment_settings").select("id", { count: "exact", head: true }).eq("active", true),
    service.from("payment_webhook_events").select("id", { count: "exact", head: true }).is("processed_at", null),
  ]);
  const errors = [activeBrandsError, inactiveBrandsError, failedCrmError, failedAppointmentError, failedRegistrationError, paymentSettingsError, webhookError].filter(Boolean);
  if (errors.length > 0) throw new Error(`讀取平台健康狀態失敗：${errors[0]?.message ?? "未知錯誤"}`);

  const checks: HealthCheck[] = [
    { label: "多品牌 LINE 憑證", description: "destination 對應 access token 與 channel secret", configured: Boolean(process.env.LINE_CHANNEL_SECRETS_JSON && process.env.LINE_CHANNEL_ACCESS_TOKENS_JSON) },
    { label: "Email Provider", description: "品牌 Email 發送所需的 server-only 憑證", configured: Boolean(process.env.RESEND_API_KEYS_JSON || process.env.RESEND_API_KEY) },
    { label: "標準金流密鑰", description: "綠界／藍新 server-only 金流設定", configured: Boolean(process.env.PAYMENT_SECRETS_JSON) },
    { label: "Cron 排程密鑰", description: "提醒、報名與規則式行銷排程驗證", configured: Boolean(process.env.CRON_SECRET) },
  ];
  const warningCount = (failedCrm ?? 0) + (failedAppointmentNotifications ?? 0) + (failedRegistrationNotifications ?? 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Platform operations</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">營運健康</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">從平台層查看品牌數量、通知佇列、金流回呼與部署能力。此頁只提供營運判斷，不直接修改品牌資料或顯示任何密鑰。</p>
        </div>
        <span className={`badge px-3 py-1.5 ${warningCount > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{warningCount > 0 ? `${warningCount} 筆待處理` : "目前無通知失敗"}</span>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="啟用品牌" value={activeBrands ?? 0} detail="可正常營運的租戶" />
        <Metric label="停用品牌" value={inactiveBrands ?? 0} detail="保留資料，不硬刪除" />
        <Metric label="啟用金流設定" value={activePaymentSettings ?? 0} detail="品牌已啟用的金流設定" />
        <Metric label="未處理金流回呼" value={unprocessedWebhooks ?? 0} detail="需檢查 webhook 狀態" tone={(unprocessedWebhooks ?? 0) > 0 ? "warning" : "default"} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card space-y-4 p-5 sm:p-6">
          <div><p className="eyebrow">Runtime readiness</p><h2 className="mt-1 text-lg font-bold text-slate-900">部署能力</h2><p className="mt-1 text-sm leading-6 text-slate-500">只顯示已設定或待設定，不會把 secret 值送到畫面。</p></div>
          <div className="space-y-3">{checks.map((check) => <div key={check.label} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div><p className="text-sm font-medium text-slate-800">{check.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{check.description}</p></div><span className={`badge shrink-0 ${check.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{check.configured ? "已設定" : "待設定"}</span></div>)}</div>
        </div>
        <div className="card space-y-4 p-5 sm:p-6">
          <div><p className="eyebrow">Queue health</p><h2 className="mt-1 text-lg font-bold text-slate-900">通知與訊息佇列</h2><p className="mt-1 text-sm leading-6 text-slate-500">失敗資料會保留在品牌範圍內，由品牌後台或排程重試處理。</p></div>
          <div className="space-y-3"><QueueRow label="CRM Lite 行銷投遞失敗" value={failedCrm ?? 0} /><QueueRow label="預約通知失敗" value={failedAppointmentNotifications ?? 0} /><QueueRow label="報名通知失敗" value={failedRegistrationNotifications ?? 0} /></div>
          {warningCount > 0 ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">目前有通知失敗紀錄，請先由品牌後台確認顧客 opt-in、LINE／Email 設定與排程錯誤，再決定是否重試。</p> : <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">目前沒有通知失敗紀錄；仍需持續觀察同日新增預約與報名的提醒佇列。</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 sm:p-6"><p className="text-sm font-semibold text-indigo-950">下一步建議</p><p className="mt-2 max-w-3xl text-sm leading-6 text-indigo-900/75">先用跨品牌報表確認哪個品牌沒有完成開通，再回到品牌後台處理服務、排程、入口與通知。平台健康頁不取代品牌營運操作。</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/admin/platform/reports" className="btn btn-primary min-h-11 px-4 py-2 text-sm">查看跨品牌報表</Link><Link href="/admin/platform/settings" className="btn btn-secondary min-h-11 px-4 py-2 text-sm">查看平台政策</Link></div></section>
    </div>
  );
}

function Metric({ label, value, detail, tone = "default" }: { label: string; value: number; detail: string; tone?: "default" | "warning" }) { return <div className={`card p-4 ${tone === "warning" ? "border-amber-200 bg-amber-50/50" : ""}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p><p className={`mt-1 text-xs ${tone === "warning" ? "text-amber-700" : "text-slate-400"}`}>{detail}</p></div>; }
function QueueRow({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3"><span className="text-sm text-slate-700">{label}</span><span className={`font-semibold ${value > 0 ? "text-amber-700" : "text-emerald-700"}`}>{value}</span></div>; }
