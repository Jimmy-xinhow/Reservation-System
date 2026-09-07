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

const COLUMN_LABELS: Record<string, string> = {
  name: "姓名／服務名稱",
  phone: "電話",
  birthday: "生日",
  email: "電子郵件",
  marketing_opt_in: "是否同意接收行銷訊息",
  category: "服務分類",
  description: "服務說明",
  duration_minutes: "服務時間（分鐘）",
  buffer_minutes: "前後保留時間（分鐘）",
  booking_target: "預約時是否指定服務人員或資源",
  patient_name: "顧客姓名",
  patient_phone: "顧客電話",
  plan_name: "套票方案",
  credits_remaining: "剩餘堂數",
  expires_at: "到期日",
};

function columnLabel(column: string, entity?: Entity): string {
  if (column === "name") return entity === "patients" ? "顧客姓名" : "服務名稱";
  return COLUMN_LABELS[column] ?? column;
}

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
    <section className="admin-section">
      <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">匯入新資料</h2><p className="mt-0.5 text-xs text-slate-500">依序選擇資料類型、上傳檔案、確認預覽；每次最多 500 筆。</p></div></div>
      <div className="space-y-5 p-4">
      <div><p className="mb-2 text-xs font-semibold text-slate-500">1. 選擇資料類型</p><div className="grid border-y border-slate-200 sm:grid-cols-3">{(Object.keys(DEFINITIONS) as Entity[]).map((key) => <button key={key} type="button" onClick={() => { setEntity(key); setRows([]); setMessage(""); }} aria-pressed={entity === key} className={`min-h-11 border-b px-4 py-3 text-left text-sm font-medium last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${entity === key ? "bg-brand-50 text-brand-800" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{DEFINITIONS[key].label}</button>)}</div></div>
      <details className="technical-details"><summary>查看「{definition.label}」可匯入欄位與檔案範例</summary><div className="mt-3 border-y border-slate-200 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-700">可匯入欄位（* 必填）</p><ul className="mt-2 grid gap-1 text-sm leading-6 text-slate-600 sm:grid-cols-2">{definition.columns.map((column) => <li key={column}>{columnLabel(column, entity)}{definition.required.includes(column) ? " *" : ""}</li>)}</ul><p className="mt-3 break-words font-mono text-xs leading-6 text-slate-500">{definition.columns.map((column) => `${column}${definition.required.includes(column) ? "*" : ""}`).join(", ")}</p><pre className="mt-2 overflow-x-auto border border-slate-200 bg-white p-3 text-xs text-slate-600">{definition.sample}</pre></div></details>
      <label className="block text-sm"><span className="mb-2 block text-xs font-semibold text-slate-500">2. 選擇 CSV 檔案</span><span className="help-text mb-2 block">請使用 UTF-8 編碼，避免中文內容出現亂碼。</span><input type="file" accept=".csv,text/csv" className="input h-auto min-h-11 py-2" onChange={(event) => void loadFile(event.target.files?.[0])} />{fileName && <span className="mt-1 block text-xs text-slate-400">{fileName}</span>}</label>
      {missing.length > 0 && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">缺少必填欄位：{missing.map((column) => columnLabel(column, entity)).join("、")}</p>}
      {rows.length > 0 && <div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-slate-800">3. 預覽前 10 筆</p><span className="badge bg-brand-50 text-brand-700">共 {rows.length} 筆</span></div><div className="admin-table-shell admin-table-mobile-cards"><table className="tbl"><thead><tr>{definition.columns.map((column) => <th key={column}>{columnLabel(column, entity)}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index}>{definition.columns.map((column) => <td key={column} data-label={columnLabel(column, entity)}>{row[column] || "—"}</td>)}</tr>)}</tbody></table></div></div>}
      {message && <p role="status" className={`rounded-xl px-4 py-3 text-sm ${message.startsWith("匯入完成") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{message}</p>}
      <button type="button" disabled={busy || rows.length === 0 || missing.length > 0} onClick={() => void submit()} className="btn btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "匯入中…" : `4. 確認匯入 ${rows.length} 筆`}</button>
      </div>
    </section>
  );
}
