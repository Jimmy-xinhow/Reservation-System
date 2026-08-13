import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { runChannelTestsAction } from "./actions";

export const dynamic = "force-dynamic";

type Status = "passed" | "warning" | "failed";
interface Check { label: string; status: Status; detail: string; }
interface Run { id: string; channel: string; status: Status; checks: Check[]; created_at: string; }
const LABEL: Record<string, string> = { line: "LINE Messaging API", liff: "LIFF 顧客入口", email: "Email", payment: "綠界／藍新金流", domain: "短網址／自訂網域" };
const LINK: Record<string, string> = { line: "/admin/line", liff: "/admin/line", email: "/admin/settings?section=channels", payment: "/admin/settings?section=channels", domain: "/admin/settings?section=domain" };
const STATUS: Record<Status, { label: string; cls: string }> = { passed: { label: "通過", cls: "bg-emerald-50 text-emerald-700" }, warning: { label: "待完成", cls: "bg-amber-50 text-amber-700" }, failed: { label: "失敗", cls: "bg-red-50 text-red-700" } };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ tested?: string }> }) {
  const { clinicId } = await requireAdmin();
  const tested = (await searchParams).tested === "1";
  const { data, error } = await createServiceClient().from("channel_test_runs").select("id, channel, status, checks, created_at").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`讀取渠道測試失敗：${error.message}`);
  const latest = new Map<string, Run>();
  for (const run of (data ?? []) as Run[]) if (!latest.has(run.channel)) latest.set(run.channel, run);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Channel readiness</p><h1 className="mt-1 text-2xl font-bold text-slate-900">渠道測試中心</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">一次檢查 LINE、LIFF、Email、標準金流與公開網域；只顯示是否就緒，不讀出或保存任何機密。</p></div><form action={runChannelTestsAction}><SubmitButton className="btn btn-primary min-h-11">執行全部測試</SubmitButton></form></header>
      {tested && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">測試已完成並保存，可依卡片結果回到來源設定修正。</p>}
      <div className="grid gap-4 lg:grid-cols-2">{Object.keys(LABEL).map((channel) => { const run = latest.get(channel); const state = run ? STATUS[run.status] : { label: "尚未測試", cls: "bg-slate-100 text-slate-600" }; return <section key={channel} className="card space-y-4 p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{LABEL[channel]}</h2>{run && <p className="mt-1 text-xs text-slate-400">{new Date(run.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}</div><span className={`badge ${state.cls}`}>{state.label}</span></div>{run ? <div className="space-y-2">{run.checks.map((check, index) => <div key={`${check.label}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-700">{check.label}</span><span className={`h-2.5 w-2.5 rounded-full ${check.status === "passed" ? "bg-emerald-500" : check.status === "warning" ? "bg-amber-500" : "bg-red-500"}`} /></div><p className="mt-1 text-xs leading-5 text-slate-500">{check.detail}</p></div>)}</div> : <p className="text-sm text-slate-400">執行測試後顯示檢查明細。</p>}<Link href={LINK[channel]} className="btn btn-secondary min-h-11 w-fit">前往設定</Link></section>; })}</div>
      <p className="text-xs leading-5 text-slate-400">本中心驗證伺服器設定與可安全查詢的外部連線。LIFF 在 LINE App 內登入、Rich Menu 點擊、實際推播收件與金流付款，仍保留在交付驗收清單中由測試人員完成。</p>
    </div>
  );
}
