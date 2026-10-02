import Link from "next/link";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import { requireAdmin } from "@/lib/admin";
import { BRAND_SETUP_STATUS, type BrandSetupAnswers } from "@/lib/brand-setup-intake";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { confirmBrandSetupRequestAction, submitBrandSetupRequestAction } from "./actions";

export const dynamic = "force-dynamic";

const selectClass = "input w-full";
const boxClass = "rounded-xl border border-slate-200 bg-white p-5";

export default async function BrandSetupRequestPage({ searchParams }: { searchParams: Promise<{ submitted?: string; confirmed?: string }> }) {
  const member = await requireAdmin();
  const { data, error } = await adminQuery(createServiceClient().from("brand_setup_requests")
    .select("answers, status, submitted_at")
    .eq("clinic_id", member.clinicId).maybeSingle());
  if (error) throw new Error(adminErrorMessage(error));
  const answers = data?.answers as BrandSetupAnswers | undefined;
  const params = await searchParams;

  return <div className="mx-auto max-w-4xl space-y-5">
    <header className="admin-page-header">
      <div>
        <p className="eyebrow">新品牌上線準備</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">請我們協助設定</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">填寫營運需求後，平台人員會依內容在品牌後台代為建立設定，再交給你確認。你也可以隨時<Link href="/admin/dashboard" className="font-semibold text-brand-700 underline">照工作台步驟自行設定</Link>。</p>
      </div>
    </header>
    {params.submitted === "1" && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">需求已收到；這不代表服務、LINE 或付款已啟用。平台設定完畢後仍需要你確認。</p>}
    {params.confirmed === "1" && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">你已確認代設定交接。正式對外營運前仍需完成實際預約、通知與付款驗收。</p>}
    {data && <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900"><strong>目前進度：{BRAND_SETUP_STATUS[data.status] ?? "待確認"}</strong><span className="ml-2 text-xs">提交於 {new Date(data.submitted_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</span></div>}
    {data?.status === "ready_for_review" && <form action={confirmBrandSetupRequestAction} className="rounded-xl border border-brand-200 bg-white p-4"><p className="mb-3 text-sm leading-6 text-slate-700">平台已標示設定完成。請先到品牌設定、服務、時段與公開入口核對，再確認交接。</p><SubmitButton className="btn btn-primary">我已核對，確認交接</SubmitButton></form>}
    <form action={submitBrandSetupRequestAction} className="space-y-5">
      <section className={boxClass}>
        <h2 className="mb-4 font-semibold text-slate-900">1. 主要營運方式</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm"><span className="label">主要用途</span><select name="goal" required defaultValue={answers?.goal ?? ""} className={selectClass}><option value="" disabled>請選擇</option><option value="booking">服務預約</option><option value="registration">活動報名</option><option value="both">兩者都需要</option></select></label>
          <label className="text-sm"><span className="label">預約模式</span><select name="bookingMode" required defaultValue={answers?.bookingMode ?? ""} className={selectClass}><option value="" disabled>請選擇</option><option value="time">選擇確切時間</option><option value="number">場次取號</option><option value="unsure">希望我們建議</option></select></label>
          <label className="text-sm"><span className="label">服務提供者</span><select name="assignment" required defaultValue={answers?.assignment ?? ""} className={selectClass}><option value="" disabled>請選擇</option><option value="required">顧客必須指定</option><option value="optional">可指定或由店家安排</option><option value="resource">只需場地／設備</option><option value="unsure">希望我們建議</option></select></label>
          <label className="text-sm"><span className="label">預計啟用日期（可留白）</span><input type="date" name="targetDate" defaultValue={answers?.targetDate ?? ""} className={selectClass} /></label>
        </div>
      </section>
      <section className={boxClass}>
        <h2 className="mb-4 font-semibold text-slate-900">2. 服務與時段</h2>
        <div className="space-y-4">
          <label className="block text-sm"><span className="label">提供哪些服務或活動？請寫名稱與大致時長</span><textarea name="serviceSummary" required maxLength={500} rows={3} defaultValue={answers?.serviceSummary ?? ""} className={selectClass} placeholder="例如：諮詢 30 分鐘、美容服務 60 分鐘" /></label>
          <label className="block text-sm"><span className="label">營業／可預約時段（可留白）</span><textarea name="openingHours" maxLength={300} rows={2} defaultValue={answers?.openingHours ?? ""} className={selectClass} placeholder="例如：週一至週五 10:00–19:00，週末休息" /></label>
          <label className="block text-sm"><span className="label">同一時段最多可接待幾筆？（未定可留白）</span><input type="number" name="simultaneousBookings" min={1} step={1} defaultValue={answers?.simultaneousBookings ?? ""} className={selectClass} placeholder="例如：所有服務共用 1 個接待名額" /></label>
          <label className="block text-sm"><span className="label">各項服務售價（未定可留白）</span><textarea name="pricingSummary" maxLength={800} rows={3} defaultValue={answers?.pricingSummary ?? ""} className={selectClass} placeholder="例如：服務 A NT$800；服務 B NT$1,200；免收費請填 NT$0" /></label>
        </div>
      </section>
      <section className={boxClass}>
        <h2 className="mb-4 font-semibold text-slate-900">3. 顧客入口與收款</h2>
        <fieldset><legend className="label">希望使用的入口／通知（可複選）</legend><div className="grid gap-3 sm:grid-cols-2">{([ ["line", "LINE 官方帳號"], ["email", "Email 通知"], ["browser", "一般瀏覽器預約"], ["website", "品牌網站／自訂網域"] ] as const).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm"><input name="channels" type="checkbox" value={value} defaultChecked={answers?.channels.includes(value)} />{label}</label>)}</div></fieldset>
        <label className="mt-4 block text-sm"><span className="label">付款需求</span><select name="payment" required defaultValue={answers?.payment ?? ""} className={selectClass}><option value="" disabled>請選擇</option><option value="none">暫不收款</option><option value="newebpay">藍新金流</option><option value="ecpay">綠界金流</option><option value="unsure">希望我們建議</option></select></label>
        <label className="mt-4 block text-sm"><span className="label">每筆預約訂金 NT$（未定可留白，0 表示先免付）</span><input type="number" name="depositAmount" min={0} step={1} defaultValue={answers?.depositAmount ?? ""} className={selectClass} placeholder="例如：100" /></label>
        <label className="mt-4 block text-sm"><span className="label">其他設定需求（可留白）</span><textarea name="additionalNeeds" maxLength={500} rows={3} defaultValue={answers?.additionalNeeds ?? ""} className={selectClass} placeholder="例如：多人共用電話、第一次服務較長、需要候補" /></label>
      </section>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">請勿在表單中填寫 LINE／金流／Email 金鑰、密碼、顧客資料。憑證必須由有權限的人員在品牌設定頁安全儲存。重新提交會更新這個品牌的需求並回到「待處理」。</div>
      <div className="flex flex-wrap items-center gap-3"><SubmitButton className="btn btn-primary">提交代設定需求</SubmitButton><Link href="/admin/dashboard" className="btn btn-secondary">返回自行設定清單</Link></div>
    </form>
  </div>;
}
