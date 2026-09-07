import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireOperator } from "@/lib/admin";
import { formatDateTime } from "@/lib/slots";
import { createServiceClient } from "@/lib/supabase";
import { createInventoryItemAction, recordInventoryMovementAction } from "../../beauty/actions";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

interface InventoryRow { id: string; sku: string | null; name: string; unit: string; stock_on_hand: number; reorder_level: number; retail_price: number; active: boolean; }
interface MovementRow { id: string; kind: string; quantity: number; stock_after: number; note: string | null; created_at: string; inventory_items: Relation<{ name: string; unit: string }>; }

const MOVEMENT_LABEL: Record<string, string> = { stock_in: "進貨", use: "服務／課程使用", sale: "零售售出", waste: "報廢", stocktake: "盤點調整" };
const twd = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });

export default async function InventoryOperationsPage() {
  const { clinicId } = await requireOperator();
  const service = createServiceClient();
  const [inventoryResult, movementsResult] = await Promise.all([
    service.from("inventory_items").select("id, sku, name, unit, stock_on_hand, reorder_level, retail_price, active").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("inventory_movements").select("id, kind, quantity, stock_after, note, created_at, inventory_items(name, unit)").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(30),
  ]);
  if (inventoryResult.error || movementsResult.error) throw new Error(inventoryResult.error?.message ?? movementsResult.error?.message ?? "讀取庫存失敗");
  const inventory = (inventoryResult.data ?? []) as InventoryRow[];
  const movements = (movementsResult.data ?? []) as unknown as MovementRow[];
  const lowStock = inventory.filter((item) => Number(item.stock_on_hand) <= Number(item.reorder_level)).length;

  return <div className="admin-page">
    <header className="admin-page-header"><div><p className="eyebrow">營運中心</p><h1 className="admin-page-title">耗材與商品庫存</h1><p className="admin-page-description">管理服務、課程與零售所需品項；每次進貨、使用、售出與報廢都保留可追溯紀錄。</p></div><div className="flex flex-wrap gap-2"><Link href="/admin/products" className="btn btn-secondary">商品管理</Link><Link href="/admin/beauty/supply" className="btn btn-primary">採購與盤點</Link></div></header>
    <div className="admin-metric-strip grid-cols-2 sm:max-w-lg"><Metric label="啟用品項" value={`${inventory.length}`} /><Metric label="低庫存提醒" value={`${lowStock}`} warning={lowStock > 0} /></div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
      <section className="admin-section overflow-hidden"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">目前庫存</h2><p className="mt-0.5 text-xs text-slate-500">低於補貨提醒量的品項會明確標示。</p></div></div><div className="divide-y divide-slate-200">{inventory.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">尚未建立庫存品項。</p> : inventory.map((item) => <article key={item.id} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(300px,.85fr)] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{item.name}</h3>{item.stock_on_hand <= item.reorder_level && <span className="badge bg-amber-50 text-amber-700">需要補貨</span>}</div><p className="mt-1 text-sm text-slate-500">{item.sku || "未設編號"} · 售價 {twd.format(item.retail_price)}</p><p className="mt-2 text-2xl font-bold text-slate-900">{item.stock_on_hand} <span className="text-sm font-normal text-slate-500">{item.unit}</span></p></div><form action={recordInventoryMovementAction} className="grid gap-2 sm:grid-cols-2"><input type="hidden" name="item_id" value={item.id} /><select name="kind" className="input"><option value="stock_in">進貨</option><option value="use">服務／課程使用</option><option value="sale">零售售出</option><option value="waste">報廢</option></select><input type="number" name="quantity" min="0.01" step="0.01" required className="input" placeholder="數量" /><input name="note" className="input sm:col-span-2" maxLength={300} placeholder="備註（選填）" /><SubmitButton className="btn btn-primary sm:col-span-2">記錄異動</SubmitButton></form></article>)}</div></section>
      <form action={createInventoryItemAction} className="admin-section h-fit space-y-4 p-5"><div><h2 className="font-semibold text-slate-900">新增庫存品項</h2><p className="mt-1 text-xs text-slate-500">耗材與可銷售商品都能建立。</p></div><label><span className="label">品項名稱</span><input name="name" className="input" required /></label><div className="grid grid-cols-2 gap-3"><label><span className="label">品項編號</span><input name="sku" className="input uppercase" /></label><label><span className="label">單位</span><input name="unit" defaultValue="件" className="input" /></label></div><div className="grid grid-cols-2 gap-3"><label><span className="label">目前數量</span><input type="number" step="0.01" min="0" name="stock_on_hand" defaultValue="0" className="input" /></label><label><span className="label">補貨提醒量</span><input type="number" step="0.01" min="0" name="reorder_level" defaultValue="3" className="input" /></label></div><label><span className="label">建議售價</span><input type="number" min="0" name="retail_price" defaultValue="0" className="input" /></label><SubmitButton className="btn btn-primary w-full">建立品項</SubmitButton></form>
    </div>
    {movements.length > 0 && <section className="admin-table-shell"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">最近庫存異動</h2><p className="mt-0.5 text-xs text-slate-500">目前品牌最近 30 筆紀錄。</p></div></div><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>時間</th><th>品項</th><th>異動</th><th>數量</th><th>異動後庫存</th><th>備註</th></tr></thead><tbody>{movements.map((movement) => { const item = one(movement.inventory_items); return <tr key={movement.id}><td>{formatDateTime(movement.created_at)}</td><td>{item?.name ?? "品項"}</td><td>{MOVEMENT_LABEL[movement.kind] ?? movement.kind}</td><td>{movement.quantity} {item?.unit ?? ""}</td><td>{movement.stock_after}</td><td>{movement.note || "—"}</td></tr>; })}</tbody></table></div></section>}
  </div>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className="admin-metric"><span className="admin-metric-label">{label}</span><strong className={`admin-metric-value ${warning ? "text-amber-700" : ""}`}>{value}</strong></div>; }
