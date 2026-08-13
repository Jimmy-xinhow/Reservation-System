"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Entity = "patients" | "services" | "memberships";
type Row = Record<string, string>;

const DEFINITIONS: Record<Entity, { label: string; columns: string[]; required: string[]; sample: string }> = {
  patients: {
    label: "顧客",
    columns: ["name", "phone", "birthday", "email", "marketing_opt_in"],
    required: ["name", "phone"],
    sample: "name,phone,birthday,email,marketing_opt_in\n王小明,0912345678,1990-01-01,user@example.com,true",
  },
  services: {
    label: "服務",
    columns: ["name", "category", "description", "duration_minutes", "buffer_minutes", "booking_target"],
    required: ["name"],
    sample: "name,category,description,duration_minutes,buffer_minutes,booking_target\n首次諮詢,諮詢,初次需求訪談,60,10,provider_required",
  },
  memberships: {
    label: "套票餘額",
    columns: ["patient_name", "patient_phone", "plan_name", "credits_remaining", "expires_at"],
    required: ["patient_name", "patient_phone", "plan_name", "credits_remaining"],
    sample: "patient_name,patient_phone,plan_name,credits_remaining,expires_at\n王小明,0912345678,十堂套票,8,2027-12-31",
  },
};

const HEADER_ALIASES: Record<string, string> = {
  姓名: "name", 顧客姓名: "patient_name", 電話: "phone", 顧客電話: "patient_phone", 生日: "birthday",
  電子郵件: "email", 行銷同意: "marketing_opt_in", 服務名稱: "name", 分類: "category", 說明: "description",
  時長: "duration_minutes", 緩衝時間: "buffer_minutes", 預約目標: "booking_target", 套票方案: "plan_name",
  剩餘堂數: "credits_remaining", 到期日: "expires_at",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '"') {
      if (quoted && normalized[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim()); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && normalized[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("CSV 引號沒有正確結束");
  return rows;
}

function toObjects(rows: string[][]): Row[] {
  if (rows.length < 2) throw new Error("CSV 至少需要標題列與一筆資料");
  const headers = rows[0].map((header) => HEADER_ALIASES[header.trim()] ?? header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("CSV 標題欄位不可重複");
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function CsvImportWizard() {
  const router = useRouter();
  const [entity, setEntity] = useState<Entity>("patients");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const definition = DEFINITIONS[entity];
  const missing = useMemo(() => definition.required.filter((column) => rows.length > 0 && !(column in rows[0])), [definition.required, rows]);

  const loadFile = async (file: File | undefined) => {
    setMessage(""); setRows([]); setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 800_000) { setMessage("檔案不可超過 800 KB"); return; }
    try {
      const parsed = toObjects(parseCsv(await file.text()));
      if (parsed.length > 500) throw new Error("每次最多匯入 500 筆，請先分批");
      setRows(parsed);
    } catch (error) { setMessage(error instanceof Error ? error.message : "CSV 解析失敗"); }
  };

  const submit = async () => {
    if (rows.length === 0 || missing.length > 0) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, idempotency_key: `csv_${crypto.randomUUID().replaceAll("-", "")}`, rows }) });
      const body = await response.json() as { ok: boolean; error?: string; data?: { imported_rows: number; failed_rows: number } };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error ?? "匯入失敗");
      setMessage(`匯入完成：成功 ${body.data.imported_rows} 筆，失敗 ${body.data.failed_rows} 筆。`);
      setRows([]); setFileName(""); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "匯入失敗"); }
    finally { setBusy(false); }
  };

  return (
    <section className="card space-y-5 p-5">
      <div><h2 className="font-semibold text-slate-900">CSV 匯入精靈</h2><p className="mt-1 text-sm leading-6 text-slate-500">先選資料類型，再預覽與確認。每批最多 500 筆；重送相同工作不會重複匯入。</p></div>
      <div className="grid gap-3 sm:grid-cols-3">{(Object.keys(DEFINITIONS) as Entity[]).map((key) => <button key={key} type="button" onClick={() => { setEntity(key); setRows([]); setMessage(""); }} className={`min-h-11 rounded-xl border px-4 py-3 text-left text-sm font-medium ${entity === key ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600"}`}>{DEFINITIONS[key].label}</button>)}</div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-medium text-slate-700">支援欄位（* 必填）</p><p className="mt-2 break-words font-mono text-xs leading-6 text-slate-500">{definition.columns.map((column) => `${column}${definition.required.includes(column) ? "*" : ""}`).join(", ")}</p><details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-brand-700">查看範例</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 text-xs text-slate-600">{definition.sample}</pre></details></div>
      <label className="block text-sm"><span className="label">選擇 UTF-8 CSV 檔案</span><input type="file" accept=".csv,text/csv" className="input h-auto min-h-11 py-2" onChange={(event) => void loadFile(event.target.files?.[0])} />{fileName && <span className="mt-1 block text-xs text-slate-400">{fileName}</span>}</label>
      {missing.length > 0 && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">缺少必填欄位：{missing.join("、")}</p>}
      {rows.length > 0 && <div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-slate-800">預覽前 10 筆</p><span className="badge bg-brand-50 text-brand-700">共 {rows.length} 筆</span></div><div className="overflow-x-auto rounded-xl border border-slate-200"><table className="tbl"><thead><tr>{definition.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index}>{definition.columns.map((column) => <td key={column} className="max-w-56 truncate">{row[column] || "—"}</td>)}</tr>)}</tbody></table></div></div>}
      {message && <p role="status" className={`rounded-xl px-4 py-3 text-sm ${message.startsWith("匯入完成") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{message}</p>}
      <button type="button" disabled={busy || rows.length === 0 || missing.length > 0} onClick={() => void submit()} className="btn btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "匯入中…" : `確認匯入 ${rows.length} 筆`}</button>
    </section>
  );
}
