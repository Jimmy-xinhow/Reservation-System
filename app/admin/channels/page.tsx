import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { runChannelTestsAction } from "./actions";

export const dynamic = "force-dynamic";

type Status = "passed" | "warning" | "failed";
interface Check { label: string; status: Status; detail: string; }
interface Run { id: string; channel: string; status: Status; checks: Check[]; created_at: string; }

const CHANNELS = [
  { key: "line", label: "LINE 訊息", detail: "確認官方帳號可發送通知", icon: "message" },
  { key: "liff", label: "LINE 顧客入口", detail: "確認顧客可從 LINE 開啟服務", icon: "phone" },
  { key: "email", label: "Email 通知", detail: "確認寄件設定與通知功能", icon: "mail" },
  { key: "payment", label: "綠界／藍新付款", detail: "確認測試金流與回傳網址", icon: "payment" },
  { key: "domain", label: "公開網址", detail: "確認短網址與自訂網域", icon: "globe" },
] as const;

const LINK: Record<string, string> = {
  line: "/admin/line",
  liff: "/admin/line",
  email: "/admin/settings?section=channels",
  payment: "/admin/settings?section=channels",
  domain: "/admin/settings?section=domain",
};

const STATUS: Record<Status, { label: string; cls: string; dot: string }> = {
  passed: { label: "可使用", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  warning: { label: "待完成", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  failed: { label: "需處理", cls: "bg-red-50 text-red-700", dot: "bg-red-500" },
};

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ tested?: string }> }) {
  const { clinicId } = await requireAdmin();
  const tested = (await searchParams).tested === "1";
  const { data, error } = await createServiceClient()
    .from("channel_test_runs")
    .select("id, channel, status, checks, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`讀取渠道測試失敗：${error.message}`);

  const latest = new Map<string, Run>();
  for (const run of (data ?? []) as Run[]) if (!latest.has(run.channel)) latest.set(run.channel, run);
  const counts = CHANNELS.reduce((result, channel) => {
    const status = latest.get(channel.key)?.status ?? "untested";
    result[status] += 1;
    return result;
  }, { passed: 0, warning: 0, failed: 0, untested: 0 });
  const lastRunAt = [...latest.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">外部服務</p>
          <h1 className="admin-page-title">通知與付款檢查</h1>
          <p className="admin-page-description">先看哪些服務已可使用，再從同一列進入設定。檢查不會顯示或保存任何密鑰。</p>
        </div>
        <form action={runChannelTestsAction}>
          <SubmitButton className="btn btn-primary"><ActionIcon name="refresh" />重新檢查全部服務</SubmitButton>
        </form>
      </header>

      {tested && <p role="status" className="border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">檢查已完成。請依下方狀態處理尚未完成的項目。</p>}

      <section className="admin-metric-strip sm:grid-cols-4" aria-label="渠道狀態摘要">
        <Metric label="可使用" value={counts.passed} tone="text-emerald-700" />
        <Metric label="待完成" value={counts.warning} tone="text-amber-700" />
        <Metric label="需處理" value={counts.failed} tone="text-red-700" />
        <div className="admin-metric"><span className="admin-metric-label">最後檢查</span><strong className="mt-1 block text-sm font-semibold text-slate-900">{lastRunAt ? formatTime(lastRunAt) : "尚未執行"}</strong></div>
      </section>

      <section className="admin-section">
        <div className="admin-section-header">
          <div><h2 className="font-semibold text-slate-950">服務狀態</h2><p className="mt-1 text-xs text-slate-500">展開項目可查看每一項檢查的白話說明。</p></div>
          <span className="text-xs text-slate-500">共 {CHANNELS.length} 項服務</span>
        </div>
        <div className="divide-y divide-slate-200">
          {CHANNELS.map((channel) => {
            const run = latest.get(channel.key);
            const state = run ? STATUS[run.status] : { label: "尚未檢查", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
            return (
              <details key={channel.key} className="group">
                <summary className="grid min-h-20 cursor-pointer list-none grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[2.5rem_minmax(12rem,.8fr)_minmax(12rem,1fr)_auto_auto]">
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-slate-100 text-slate-600"><ActionIcon name={channel.icon} /></span>
                  <span><strong className="block text-sm font-semibold text-slate-900">{channel.label}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500 sm:hidden">{channel.detail}</span></span>
                  <span className="hidden text-sm text-slate-600 sm:block">{channel.detail}</span>
                  <span className={`badge ${state.cls}`}><i className={`mr-1.5 inline-block h-2 w-2 rounded-full ${state.dot}`} />{state.label}</span>
                  <span className="hidden text-xs font-medium text-slate-500 group-open:text-brand-700 sm:block">查看詳情 ↓</span>
                </summary>
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:pl-[4.75rem]">
                  {run ? (
                    <div className="grid gap-2 lg:grid-cols-2">
                      {run.checks.map((check, index) => (
                        <div key={`${check.label}-${index}`} className="flex gap-3 border-l-2 border-slate-200 bg-white px-3 py-2.5">
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS[check.status].dot}`} />
                          <div><p className="text-sm font-medium text-slate-800">{check.label}</p><p className="mt-0.5 text-xs leading-5 text-slate-600">{check.detail}</p></div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-slate-600">尚無結果。按上方「重新檢查全部服務」即可開始。</p>}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">{run ? `檢查時間：${formatTime(run.created_at)}` : "設定完成後再回來檢查"}</span>
                    <Link href={LINK[channel.key]} className="btn btn-secondary"><ActionIcon name="settings" />開啟{channel.label}設定</Link>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <p className="text-sm leading-6 text-slate-600">系統檢查通過後，上線前仍需用手機實際完成一次 LINE 登入、接收訊息與測試付款。</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="admin-metric"><span className="admin-metric-label">{label}</span><strong className={`admin-metric-value ${tone}`}>{value}</strong></div>;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ActionIcon({ name }: { name: string }) {
  const path = name === "message" ? <><path d="M4 5.5h16v11H8l-4 3v-14Z" /><path d="M8 9h8M8 13h5" /></>
    : name === "phone" ? <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10 6h4M11 18h2" /></>
      : name === "mail" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>
        : name === "payment" ? <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>
          : name === "globe" ? <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>
            : name === "refresh" ? <><path d="M20 7v5h-5" /><path d="M18.2 16A8 8 0 1 1 20 12" /></>
              : <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}
