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
  return (
    <div className="space-y-6">
      <header><p className="eyebrow">搬入既有資料</p><h1 className="mt-1 text-2xl font-bold text-slate-900">CSV 資料匯入</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">將既有顧客、服務與套票餘額分批移入目前品牌。匯入只在伺服器端寫入，遵守同電話人數上限與品牌資料隔離。</p></header>
      <CsvImportWizard />
      <section className="card overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">最近匯入紀錄</h2></div>{jobs.length === 0 ? <p className="px-5 py-8 text-sm text-slate-400">尚無匯入紀錄。</p> : <div className="divide-y divide-slate-100">{jobs.map((job) => <article key={job.id} className="space-y-2 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">{LABEL[job.entity] ?? job.entity}</p><span className={`badge ${job.status === "completed" ? "bg-emerald-50 text-emerald-700" : job.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{job.status === "completed" ? "已完成" : job.status === "failed" ? "失敗" : "處理中"}</span></div><p className="text-sm text-slate-500">共 {job.total_rows} 筆 · 成功 {job.imported_rows} · 失敗 {job.failed_rows} · {new Date(job.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>{job.error_summary?.length > 0 && <details><summary className="cursor-pointer text-xs font-medium text-red-700">查看錯誤列</summary><ul className="mt-2 space-y-1 text-xs text-red-600">{job.error_summary.slice(0, 20).map((item, index) => <li key={`${item.row}-${index}`}>第 {item.row} 列：{item.reason}</li>)}</ul></details>}</article>)}</div>}</section>
    </div>
  );
}
