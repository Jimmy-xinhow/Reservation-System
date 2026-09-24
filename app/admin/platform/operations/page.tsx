
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import { CRON_JOB_EXPECTATIONS, cronRunState, type CronRunState, type CronRunSummary } from "@/lib/cron-operations-health";
import Link from "next/link";
import { requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface HealthCheck { label: string; description: string; configured: boolean; }

export default async function PlatformOperationsPage() {
  await requireSystemPermission("operations.view");
  const service = createServiceClient();
  const overdueCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const [
    { count: activeBrands, error: activeBrandsError },
    { count: inactiveBrands, error: inactiveBrandsError },
    { count: appointmentBacklog, error: appointmentBacklogError },
    { count: registrationBacklog, error: registrationBacklogError },
    { count: reminderBacklog, error: reminderBacklogError },
    { count: crmBacklog, error: crmBacklogError },
    { count: membershipBacklog, error: membershipBacklogError },
    { count: waitlistBacklog, error: waitlistBacklogError },
    { count: followupInProgressBacklog, error: followupInProgressError },
    { count: followupPendingBacklog, error: followupPendingError },
    { count: activePaymentSettings, error: paymentSettingsError },
    { count: vaultLineSecretCount, error: lineSecretError },
    { count: vaultEmailSecretCount, error: emailSecretError },
    { count: vaultPaymentSecretCount, error: paymentSecretError },
    { count: unprocessedWebhooks, error: webhookError },
  ] = await adminQuery(Promise.all([
    service.from("clinics").select("id", { count: "exact", head: true }).eq("active", true),
    service.from("clinics").select("id", { count: "exact", head: true }).eq("active", false),
    service.from("appointment_notification_logs").select("id", { count: "exact", head: true }).in("status", ["sending", "failed"]).or(`updated_at.lte.${overdueCutoff},updated_at.is.null`),
    service.from("registration_notification_logs").select("id", { count: "exact", head: true }).in("status", ["sending", "failed"]).or(`updated_at.lte.${overdueCutoff},updated_at.is.null`),
    service.from("reminder_logs").select("id", { count: "exact", head: true }).in("result", ["sending", "failed"]).or(`sent_at.lte.${overdueCutoff},sent_at.is.null`),
    service.from("crm_delivery_logs").select("id", { count: "exact", head: true }).in("status", ["pending", "failed"]).or(`attempted_at.lte.${overdueCutoff},attempted_at.is.null`),
    service.from("membership_notification_logs").select("id", { count: "exact", head: true }).in("status", ["claimed", "failed"]).or(`created_at.lte.${overdueCutoff},created_at.is.null`),
    service.from("appointment_waitlist_notification_logs").select("id", { count: "exact", head: true }).in("status", ["pending", "claimed", "failed"]).or(`updated_at.lte.${overdueCutoff},updated_at.is.null`),
    service.from("scheduled_followups").select("id", { count: "exact", head: true }).in("status", ["processing", "failed"]).in("channel", ["line", "email"]).or(`updated_at.lte.${overdueCutoff},updated_at.is.null`),
    service.from("scheduled_followups").select("id", { count: "exact", head: true }).eq("status", "pending").in("channel", ["line", "email"]).or(`scheduled_for.lte.${overdueCutoff},scheduled_for.is.null`),
    service.from("clinic_payment_settings").select("id", { count: "exact", head: true }).eq("active", true),
    service.from("clinic_line_secret_refs").select("clinic_id", { count: "exact", head: true }),
    service.from("clinic_email_secret_refs").select("clinic_id", { count: "exact", head: true }),
    service.from("clinic_payment_secret_refs").select("clinic_id", { count: "exact", head: true }),
    service.from("payment_webhook_events").select("id", { count: "exact", head: true }).is("processed_at", null),
  ]));
  const errors = [activeBrandsError, inactiveBrandsError, appointmentBacklogError, registrationBacklogError, reminderBacklogError, crmBacklogError, membershipBacklogError, waitlistBacklogError, followupInProgressError, followupPendingError, paymentSettingsError, lineSecretError, emailSecretError, paymentSecretError, webhookError].filter(Boolean);
  if (errors.length > 0) throw new Error(adminErrorMessage(`讀取平台健康狀態失敗：${errors[0]?.message ?? "未知錯誤"}`));

  const backlogs = [appointmentBacklog, registrationBacklog, reminderBacklog, crmBacklog, membershipBacklog, waitlistBacklog, followupInProgressBacklog, followupPendingBacklog];
  if (backlogs.some((count) => !Number.isSafeInteger(count) || count === null || count < 0)) {
    throw new Error(adminErrorMessage("通知待查數量無法確認"));
  }
  const cronRows = await adminQuery(Promise.all(CRON_JOB_EXPECTATIONS.map(({ job }) =>
    service.from("cron_job_runs").select("status,result_code,http_status,completed_at")
      .eq("mode", "global").eq("job", job).order("completed_at", { ascending: false }).limit(1),
  )));
  const cronChecks = CRON_JOB_EXPECTATIONS.map((expectation, index) => {
    const result = cronRows[index];
    if (result.error || !Array.isArray(result.data)) {
      throw new Error(adminErrorMessage("讀取排程執行紀錄失敗"));
    }
    const latest = (result.data[0] ?? null) as CronRunSummary | null;
    return { ...expectation, latest, state: cronRunState(latest, expectation.maxAgeMinutes) };
  });
  const cronWarningCount = cronChecks.filter((check) => check.state !== "healthy").length;

  const checks: HealthCheck[] = [
    { label: "各品牌 LINE 連線資料", description: "品牌後台安全設定或既有伺服器備援至少已有一組", configured: (vaultLineSecretCount ?? 0) > 0 || Boolean(process.env.LINE_CHANNEL_SECRETS_JSON && process.env.LINE_CHANNEL_ACCESS_TOKENS_JSON) },
    { label: "Email 寄送服務", description: "品牌後台安全設定或既有伺服器備援至少已有一組", configured: (vaultEmailSecretCount ?? 0) > 0 || Boolean(process.env.RESEND_API_KEYS_JSON || process.env.RESEND_API_KEY) },
    { label: "標準付款連線資料", description: "綠界／藍新的私密付款設定只保存在伺服器安全區", configured: (vaultPaymentSecretCount ?? 0) > 0 || Boolean(process.env.PAYMENT_SECRETS_JSON) },
    { label: "自動排程驗證資料", description: "只表示排程金鑰已設定，不代表 worker 正在執行", configured: Boolean(process.env.CRON_SECRET) },
  ];
  const warningCount = backlogs.reduce<number>((total, count) => total + (count ?? 0), 0);

  return (
    <div className="platform-workbench">
      <header className="admin-page-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">系統運作</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">營運健康</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">從平台層查看品牌數量、通知佇列、金流回呼與上線設定狀態。此頁只提供營運判斷，不直接修改品牌資料或顯示任何密鑰。</p>
        </div>
        <span className={`badge px-3 py-1.5 ${warningCount > 0 || cronWarningCount > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{warningCount > 0 ? `${warningCount} 筆逾期待查` : cronWarningCount > 0 ? `${cronWarningCount} 類排程待查` : "排程與通知正常"}</span>
      </header>

      <section className="platform-metrics" aria-label="營運健康摘要">
        <Metric label="啟用品牌" value={activeBrands ?? 0} detail="可正常營運的品牌" />
        <Metric label="停用品牌" value={inactiveBrands ?? 0} detail="保留資料，不硬刪除" />
        <Metric label="啟用金流設定" value={activePaymentSettings ?? 0} detail="品牌已啟用的金流設定" />
        <Metric label="未處理付款通知" value={unprocessedWebhooks ?? 0} detail="需檢查付款通知處理狀態" tone={(unprocessedWebhooks ?? 0) > 0 ? "warning" : "default"} />
      </section>

      <section className="platform-overview-grid">
        <div className="platform-panel space-y-4 p-5">
          <div><p className="eyebrow">上線設定</p><h2 className="mt-1 text-lg font-bold text-slate-900">上線設定狀態</h2><p className="mt-1 text-sm leading-6 text-slate-500">只顯示已設定或待設定，不會把私密資料內容送到畫面。</p></div>
          <div className="divide-y divide-slate-200 border-y border-slate-200">{checks.map((check) => <div key={check.label} className="flex items-start justify-between gap-4 py-3"><div><p className="text-sm font-medium text-slate-800">{check.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{check.description}</p></div><span className={`badge shrink-0 ${check.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{check.configured ? "已設定" : "待設定"}</span></div>)}</div>
        </div>
        <div className="platform-panel space-y-4 p-5">
          <div><p className="eyebrow">待處理訊息</p><h2 className="mt-1 text-lg font-bold text-slate-900">待查通知與訊息</h2><p className="mt-1 text-sm leading-6 text-slate-500">包含超過 15 分鐘、缺少完成時間或已失敗的紀錄，以及逾期未執行的 LINE／Email 回訪。只顯示數量，不顯示顧客資料。</p></div>
          <div className="space-y-3"><QueueRow label="預約通知" value={appointmentBacklog ?? 0} /><QueueRow label="報名通知" value={registrationBacklog ?? 0} /><QueueRow label="行前提醒" value={reminderBacklog ?? 0} /><QueueRow label="CRM Lite 投遞" value={crmBacklog ?? 0} /><QueueRow label="會員通知" value={membershipBacklog ?? 0} /><QueueRow label="候補通知" value={waitlistBacklog ?? 0} /><QueueRow label="回訪處理中／失敗" value={followupInProgressBacklog ?? 0} /><QueueRow label="逾期回訪" value={followupPendingBacklog ?? 0} /></div>
          {warningCount > 0 ? <p className="border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">待查狀態可能代表供應商已接受訊息。請先核對品牌、原通知與供應商紀錄；結果不明時不要直接重送。</p> : <p className="border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">目前沒有逾期待查紀錄；這不代表排程正在執行，也不證明 LINE／Email 已送達。仍須另查 worker 執行與告警。</p>}
        </div>
      </section>

      <section className="platform-panel p-5" aria-label="排程執行健康">
        <div><p className="eyebrow">排程監測</p><h2 className="mt-1 text-lg font-bold text-slate-900">最近全域排程</h2><p className="mt-1 text-sm leading-6 text-slate-500">依實際 worker 回寫判斷成功、失敗或漏跑。隔離測試的指定範圍執行不列入正式排程健康。</p></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">{cronChecks.map((check) => <div key={check.job} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3"><div><p className="text-sm font-medium text-slate-800">{check.label}</p><p className="mt-1 text-xs text-slate-500">{check.latest && check.state !== "invalid_time" ? `最近執行：${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(check.latest.completed_at))}` : "尚無可信執行時間"}</p>{check.state === "failed" && <p className="mt-1 text-xs text-amber-700">{cronFailureLabel(check.latest?.result_code)}{check.latest?.http_status ? `（HTTP ${check.latest.http_status}）` : ""}</p>}</div><span className={`badge shrink-0 ${check.state === "healthy" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{cronStateLabel(check.state)}</span></div>)}</div>
      </section>

      <section className="platform-panel p-5"><p className="text-sm font-semibold text-slate-950">建議處理順序</p><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">先用跨品牌報表找出尚未完成開通的品牌，再回到品牌後台處理服務、排程、入口與通知。平台健康頁只負責指出問題，不取代品牌日常操作。</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/admin/platform/reports" className="btn btn-primary min-h-11 px-4 py-2 text-sm">查看跨品牌報表</Link><Link href="/admin/platform/settings" className="btn btn-secondary min-h-11 px-4 py-2 text-sm">查看平台政策</Link></div></section>
    </div>
  );
}

function Metric({ label, value, detail, tone = "default" }: { label: string; value: number; detail: string; tone?: "default" | "warning" }) { return <div className={`platform-metric ${tone === "warning" ? "bg-amber-50/50" : ""}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p><p className={`mt-1 text-xs ${tone === "warning" ? "text-amber-700" : "text-slate-400"}`}>{detail}</p></div>; }
function QueueRow({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between border-b border-slate-200 py-3 last:border-b-0"><span className="text-sm text-slate-700">{label}</span><span className={`font-semibold tabular-nums ${value > 0 ? "text-amber-700" : "text-emerald-700"}`}>{value}</span></div>; }
function cronStateLabel(state: CronRunState): string { return { healthy: "正常", failed: "執行失敗", stale: "逾時未執行", missing: "尚無紀錄", invalid_time: "時間異常" }[state]; }
function cronFailureLabel(code: string | undefined): string { return ({ http_failed: "HTTP 失敗", invalid_or_failed_result: "回應未成功", partial_failure: "部分工作失敗", timeout: "請求逾時", request_failed: "連線失敗" } as Record<string, string>)[code ?? ""] ?? "工作未成功"; }
