import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { CsvImportWizard } from "./CsvImportWizard";

export const dynamic = "force-dynamic";

interface ImportJob { id: string; entity: string; status: string; total_rows: number; imported_rows: number; failed_rows: number; error_summary: Array<{ row: number; reason: string }>; created_at: string; }
const LABEL: Record<string, string> = { patients: "顧客", services: "服務", memberships: "套票餘額" };

export default async function ImportPage() {
  const { clinicId } = await requireAdmin();
  const { data, error } = await createServiceClient().from("data_import_jobs").select("id, entity, status, total_rows, imported_rows, failed_rows, error_summary, created_at").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(`讀取匯入紀錄失敗：${error.message}`);
  const jobs = (data ?? []) as ImportJob[];
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const importedRows = jobs.reduce((total, job) => total + job.imported_rows, 0);
  return (
    <div className="admin-page">
      <header className="admin-page-header"><div><p className="eyebrow">搬入既有資料</p><h1 className="admin-page-title">CSV 資料匯入</h1><p className="admin-page-description">將既有顧客、服務與套票餘額分批移入目前品牌。CSV 是試算表可另存的逗號分隔檔案。</p></div></header>
      <section className="admin-metric-strip grid-cols-3" aria-label="匯入摘要">
        <div className="admin-metric"><span className="admin-metric-label">完成工作</span><strong className="admin-metric-value">{completedJobs}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">成功資料列</span><strong className="admin-metric-value">{importedRows}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">失敗工作</span><strong className={`admin-metric-value ${failedJobs ? "text-red-700" : ""}`}>{failedJobs}</strong></div>
      </section>
      <CsvImportWizard />
      <section className="admin-section"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">最近匯入紀錄</h2><p className="mt-0.5 text-xs text-slate-500">顯示最近 20 次工作與失敗原因。</p></div><span className="text-xs tabular-nums text-slate-500">{jobs.length} 筆</span></div>{jobs.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">尚未執行資料匯入</p> : <div className="divide-y divide-slate-200">{jobs.map((job) => <article key={job.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-800">{LABEL[job.entity] ?? job.entity}</p><span className={`badge ${job.status === "completed" ? "bg-emerald-50 text-emerald-700" : job.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{job.status === "completed" ? "已完成" : job.status === "failed" ? "失敗" : "處理中"}</span></div><p className="mt-1 text-sm text-slate-500">共 {job.total_rows} 筆 · 成功 {job.imported_rows} · 失敗 {job.failed_rows}</p>{job.error_summary?.length > 0 && <details className="technical-details mt-2"><summary>查看失敗資料列</summary><ul className="mt-2 space-y-1 text-xs text-red-600">{job.error_summary.slice(0, 20).map((item, index) => <li key={`${item.row}-${index}`}>第 {item.row} 列：{item.reason}</li>)}</ul></details>}</div><time className="text-xs text-slate-500">{new Date(job.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</time></article>)}</div>}</section>
    </div>
  );
}
