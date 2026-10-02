import Link from "next/link";
import { adminQuery } from "@/lib/admin-query";
import { BRAND_SETUP_STATUS, type BrandSetupAnswers } from "@/lib/brand-setup-intake";
import { requireSystemPermission } from "@/lib/platform";
import { createServiceClient } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";
import { SubmitButton } from "@/components/SubmitButton";
import { updateBrandSetupRequestAction } from "./actions";

export const dynamic = "force-dynamic";

const goalNames = { booking: "服務預約", registration: "活動報名", both: "預約＋報名" };
const modeNames = { time: "確切時段", number: "場次取號", unsure: "待討論" };
const assignmentNames = { required: "必須指定服務者", optional: "可指定或店家安排", resource: "場地／設備", unsure: "待討論" };
const paymentNames = { none: "暫不收款", newebpay: "藍新", ecpay: "綠界", unsure: "待討論" };
const channelNames = { line: "LINE", email: "Email", browser: "瀏覽器", website: "品牌網站／網域" };

export default async function PlatformSetupRequestsPage() {
  await requireSystemPermission("brands.manage");
  const service = createServiceClient();
  const [requests, brands] = await adminQuery(Promise.all([
    fetchAllSupabasePages((from, to) => service.from("brand_setup_requests")
      .select("id, clinic_id, answers, status, submitted_at, updated_at")
      .order("updated_at", { ascending: false }).order("id").range(from, to)),
    fetchAllSupabasePages((from, to) => service.from("clinics")
      .select("id, name, slug").order("id").range(from, to)),
  ]));
  const brandNames = new Map(brands.map((brand) => [brand.id, brand.name]));
  return <div className="mx-auto max-w-5xl space-y-5">
    <header className="admin-page-header"><div><p className="eyebrow">系統管理 · 品牌交付</p><h1 className="mt-1 text-2xl font-bold text-slate-950">代設定需求</h1><p className="mt-2 text-sm text-slate-600">只記錄店家填寫的需求；依需求在品牌後台實際設定，確認入口、通知與付款後再更新狀態。代設人員仍須先取得該品牌授權，平台權限本身不會繞過品牌資料隔離。</p></div><Link href="/admin/platform?section=brands" className="btn btn-secondary">返回品牌清單</Link></header>
    {requests.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">目前尚無店家提交代設定需求。</p>}
    {requests.map((request) => {
      const answer = request.answers as BrandSetupAnswers;
      return <section key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{brandNames.get(request.clinic_id) ?? "未知品牌"}</h2><p className="mt-1 text-xs text-slate-500">提交時間 {new Date(request.submitted_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p></div><span className="badge bg-brand-50 text-brand-700">{BRAND_SETUP_STATUS[request.status] ?? "待確認"}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">主要用途／預約模式</dt><dd className="mt-1 font-medium">{goalNames[answer.goal] ?? "待確認"} · {modeNames[answer.bookingMode] ?? "待確認"}</dd></div>
          <div><dt className="text-slate-500">服務分配／收款</dt><dd className="mt-1 font-medium">{assignmentNames[answer.assignment] ?? "待確認"} · {paymentNames[answer.payment] ?? "待確認"}</dd></div>
          <div><dt className="text-slate-500">入口與通知</dt><dd className="mt-1 font-medium">{answer.channels?.map((channel) => channelNames[channel] ?? channel).join("、") || "未選"}</dd></div>
          <div><dt className="text-slate-500">預計啟用</dt><dd className="mt-1 font-medium">{answer.targetDate || "未指定"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">服務與時長</dt><dd className="mt-1 whitespace-pre-wrap break-words">{answer.serviceSummary}</dd></div>
          <div><dt className="text-slate-500">同時接待量</dt><dd className="mt-1 font-medium">{answer.simultaneousBookings == null ? "未提供" : `每時段 ${answer.simultaneousBookings} 筆`}</dd></div>
          <div><dt className="text-slate-500">預約訂金</dt><dd className="mt-1 font-medium">{answer.depositAmount == null ? "未提供" : answer.depositAmount === 0 ? "先免付" : `NT$${answer.depositAmount}`}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">各服務售價</dt><dd className="mt-1 whitespace-pre-wrap break-words">{answer.pricingSummary || "未提供"}</dd></div>
          {answer.openingHours && <div className="sm:col-span-2"><dt className="text-slate-500">可預約時段</dt><dd className="mt-1 whitespace-pre-wrap break-words">{answer.openingHours}</dd></div>}
          {answer.additionalNeeds && <div className="sm:col-span-2"><dt className="text-slate-500">其他需求</dt><dd className="mt-1 whitespace-pre-wrap break-words">{answer.additionalNeeds}</dd></div>}
        </dl>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Link href={`/admin/login?brand=${encodeURIComponent(request.clinic_id)}`} className="btn btn-secondary">以授權帳號開啟品牌後台</Link>
          {request.status !== "completed" && ([ ["in_progress", "開始代設定"], ["ready_for_review", "交給店家確認"] ] as const).map(([status, label]) => <form key={status} action={updateBrandSetupRequestAction}><input type="hidden" name="id" value={request.id} /><input type="hidden" name="status" value={status} /><SubmitButton className="btn btn-secondary" disabled={request.status === status}>{label}</SubmitButton></form>)}
        </div>
      </section>;
    })}
  </div>;
}
