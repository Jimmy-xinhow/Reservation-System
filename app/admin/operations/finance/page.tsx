import Link from "next/link";
import { requireNonProvider } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface SalesPayment { amount: number; method: string; received_at: string; sales_orders: { order_no: string } | Array<{ order_no: string }> | null; }
interface SalesOrder { total_amount: number; paid_amount: number; status: string; created_at: string; }
interface PurchaseOrder { order_no: string; status: string; created_at: string; inventory_suppliers: { name: string } | Array<{ name: string }> | null; purchase_order_items: Array<{ quantity: number; unit_cost: number }> | null; }
interface InventoryItem { name: string; stock_on_hand: number; reorder_level: number; retail_price: number; unit: string; }

const PAYMENT_METHOD: Record<string, string> = { cash: "現金", card: "刷卡", transfer: "轉帳", online: "線上付款", other: "其他" };
const PURCHASE_STATUS: Record<string, string> = { draft: "草稿", ordered: "已下單", received: "已入庫", cancelled: "已取消" };
const money = (value: number) => `NT$${Math.round(value).toLocaleString("zh-TW")}`;
const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;
function validDate(value: string | undefined, fallback: string): string { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback; }

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const member = await requireNonProvider();
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const from = validDate(params.from, `${today.slice(0, 8)}01`);
  const to = validDate(params.to, today);
  const startIso = new Date(`${from}T00:00:00+08:00`).toISOString();
  const endIso = new Date(`${to}T23:59:59.999+08:00`).toISOString();
  const supabase = await createSupabaseServer();
  const [paymentsResult, ordersResult, purchasesResult, inventoryResult] = await Promise.all([
    supabase.from("sales_payments").select("amount, method, received_at, sales_orders(order_no)").eq("clinic_id", member.clinicId).gte("received_at", startIso).lte("received_at", endIso).order("received_at", { ascending: false }).limit(500),
    supabase.from("sales_orders").select("total_amount, paid_amount, status, created_at").eq("clinic_id", member.clinicId).neq("status", "void").gte("created_at", startIso).lte("created_at", endIso),
    supabase.from("purchase_orders").select("order_no, status, created_at, inventory_suppliers(name), purchase_order_items(quantity, unit_cost)").eq("clinic_id", member.clinicId).neq("status", "cancelled").gte("created_at", startIso).lte("created_at", endIso).order("created_at", { ascending: false }).limit(200),
    supabase.from("inventory_items").select("name, stock_on_hand, reorder_level, retail_price, unit").eq("clinic_id", member.clinicId).eq("active", true).order("name"),
  ]);
  const error = paymentsResult.error ?? ordersResult.error ?? purchasesResult.error ?? inventoryResult.error;
  if (error) throw new Error(`讀取財務摘要失敗：${error.message}`);

  const payments = (paymentsResult.data ?? []) as unknown as SalesPayment[];
  const orders = (ordersResult.data ?? []) as SalesOrder[];
  const purchases = (purchasesResult.data ?? []) as unknown as PurchaseOrder[];
  const inventory = (inventoryResult.data ?? []) as InventoryItem[];
  const received = payments.reduce((sum, row) => sum + Number(row.amount), 0);
  const billed = orders.reduce((sum, row) => sum + Number(row.total_amount), 0);
  const outstanding = orders.reduce((sum, row) => sum + Math.max(0, Number(row.total_amount) - Number(row.paid_amount)), 0);
  const purchaseCost = purchases.filter((row) => row.status === "ordered" || row.status === "received").reduce((sum, row) => sum + (row.purchase_order_items ?? []).reduce((lineSum, line) => lineSum + Number(line.quantity) * Number(line.unit_cost), 0), 0);
  const stockRetailValue = inventory.reduce((sum, row) => sum + Number(row.stock_on_hand) * Number(row.retail_price), 0);
  const grossCashGap = received - purchaseCost;
  const methodTotals = Object.entries(payments.reduce<Record<string, number>>((result, row) => { result[row.method] = (result[row.method] ?? 0) + Number(row.amount); return result; }, {}));
  const lowStock = inventory.filter((row) => Number(row.stock_on_hand) <= Number(row.reorder_level));

  return <div className="admin-page">
    <header className="admin-page-header"><div><p className="eyebrow">營運中心</p><h1 className="admin-page-title">財務摘要</h1><p className="admin-page-description">以銷售收款、未收款、採購與庫存資料呈現營運現況；這是管理摘要，不是會計帳、發票、稅務或完整對帳系統。</p></div><div className="flex gap-2"><Link href="/admin/checkout" className="btn btn-primary">前往結帳中心</Link><Link href="/admin/beauty/supply" className="btn btn-secondary">採購與盤點</Link></div></header>

    <form className="admin-toolbar"><label className="text-sm"><span className="label">開始日期</span><input type="date" name="from" defaultValue={from} className="input" /></label><label className="text-sm"><span className="label">結束日期</span><input type="date" name="to" defaultValue={to} className="input" /></label><button className="btn btn-primary" type="submit">套用期間</button></form>

    <section className="admin-metric-strip grid-cols-2 lg:grid-cols-5" aria-label="財務摘要數字"><Metric label="已收款" value={money(received)} /><Metric label="銷售總額" value={money(billed)} /><Metric label="尚待收款" value={money(outstanding)} warning={outstanding > 0} /><Metric label="採購金額" value={money(purchaseCost)} /><Metric label="收款減採購" value={money(grossCashGap)} warning={grossCashGap < 0} /></section>

    <div className="grid gap-5 lg:grid-cols-2">
      <section className="admin-section"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">收款方式</h2><p className="mt-0.5 text-xs text-slate-500">依實際建立的收款紀錄加總</p></div></div>{methodTotals.length === 0 ? <p className="p-6 text-sm text-slate-400">期間內尚無收款。</p> : <div className="divide-y divide-slate-200">{methodTotals.map(([method, amount]) => <div key={method} className="flex items-center justify-between px-4 py-3 text-sm"><span>{PAYMENT_METHOD[method] ?? method}</span><strong className="tabular-nums">{money(amount)}</strong></div>)}</div>}</section>
      <section className="admin-section"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">庫存價值與補貨</h2><p className="mt-0.5 text-xs text-slate-500">庫存售價值 {money(stockRetailValue)}；不是進貨成本估值。</p></div><span className={`badge ${lowStock.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{lowStock.length} 項需補貨</span></div>{inventory.length === 0 ? <p className="p-6 text-sm text-slate-400">尚未建立庫存品項。</p> : <div className="divide-y divide-slate-200">{inventory.slice(0, 8).map((item) => <div key={item.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="min-w-0 truncate">{item.name}</span><span className={Number(item.stock_on_hand) <= Number(item.reorder_level) ? "font-semibold text-amber-700" : "text-slate-600"}>{item.stock_on_hand} {item.unit}</span></div>)}</div>}</section>
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <section className="admin-table-shell"><div className="admin-section-header"><h2 className="font-semibold text-slate-900">最近收款</h2></div><table className="tbl"><thead><tr><th>時間</th><th>銷售單</th><th>方式</th><th>金額</th></tr></thead><tbody>{payments.length === 0 ? <tr><td colSpan={4} className="py-8 text-center text-slate-400">期間內尚無收款</td></tr> : payments.slice(0, 12).map((row, index) => <tr key={`${row.received_at}-${index}`}><td>{new Date(row.received_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</td><td>{one(row.sales_orders)?.order_no ?? "—"}</td><td>{PAYMENT_METHOD[row.method] ?? row.method}</td><td className="font-medium tabular-nums">{money(row.amount)}</td></tr>)}</tbody></table></section>
      <section className="admin-table-shell"><div className="admin-section-header"><h2 className="font-semibold text-slate-900">期間採購</h2></div><table className="tbl"><thead><tr><th>採購單</th><th>供應商</th><th>狀態</th><th>金額</th></tr></thead><tbody>{purchases.length === 0 ? <tr><td colSpan={4} className="py-8 text-center text-slate-400">期間內尚無採購單</td></tr> : purchases.slice(0, 12).map((row) => { const amount = (row.purchase_order_items ?? []).reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_cost), 0); return <tr key={row.order_no}><td>{row.order_no}</td><td>{one(row.inventory_suppliers)?.name ?? "—"}</td><td>{PURCHASE_STATUS[row.status] ?? row.status}</td><td className="font-medium tabular-nums">{money(amount)}</td></tr>; })}</tbody></table></section>
    </div>
  </div>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className={`admin-metric ${warning ? "bg-amber-50" : ""}`}><span className="admin-metric-label">{label}</span><strong className={`admin-metric-value text-xl ${warning ? "text-amber-800" : ""}`}>{value}</strong></div>; }
