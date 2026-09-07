import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { createProductAction, recordProductMovementAction, toggleProductAction, updateProductAction } from "./actions";

export const dynamic = "force-dynamic";

interface Product {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  stock_on_hand: number;
  reorder_level: number;
  retail_price: number;
  active: boolean;
}

interface Movement {
  id: string;
  item_id: string;
  kind: string;
  quantity: number;
  stock_after: number;
  note: string | null;
  created_at: string;
}

const MOVEMENT_LABEL: Record<string, string> = { stock_in: "進貨", use: "服務使用", sale: "售出", waste: "報廢" };
const money = (value: number) => `NT$${Number(value).toLocaleString("zh-TW")}`;
const number = (value: number) => Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const member = await requireAdmin();
  const params = await searchParams;
  const [{ data: productData, error: productError }, { data: movementData, error: movementError }] = await Promise.all([
    member.supabase.from("inventory_items").select("id, sku, name, unit, stock_on_hand, reorder_level, retail_price, active").eq("clinic_id", member.clinicId).order("active", { ascending: false }).order("name"),
    member.supabase.from("inventory_movements").select("id, item_id, kind, quantity, stock_after, note, created_at").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }).limit(30),
  ]);
  if (productError || movementError) throw new Error(productError?.message ?? movementError?.message ?? "讀取商品資料失敗");
  const products = (productData ?? []) as Product[];
  const movements = (movementData ?? []) as Movement[];
  const selected = products.find((product) => product.id === params.edit) ?? null;
  const activeProducts = products.filter((product) => product.active);
  const lowStock = activeProducts.filter((product) => Number(product.stock_on_hand) <= Number(product.reorder_level));
  const retailValue = activeProducts.reduce((sum, product) => sum + Number(product.stock_on_hand) * Number(product.retail_price), 0);
  const nameById = new Map(products.map((product) => [product.id, product.name]));

  return <div className="admin-page">
    <header className="admin-page-header">
      <div><p className="eyebrow">設定中心</p><h1 className="admin-page-title">商品管理</h1><p className="admin-page-description">這裡建立的商品會直接出現在結帳、採購、盤點與工作台庫存，不需要另外重複設定。</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/admin/beauty/supply" className="btn btn-secondary">採購與盤點</Link><Link href="/admin/checkout" className="btn btn-primary">前往結帳中心</Link></div>
    </header>

    <section className="admin-metric-strip grid-cols-3" aria-label="商品摘要">
      <Metric label="啟用商品" value={`${activeProducts.length} 項`} />
      <Metric label="需要補貨" value={`${lowStock.length} 項`} tone={lowStock.length > 0 ? "warning" : undefined} />
      <Metric label="庫存售價值" value={money(retailValue)} />
    </section>

    <div className="admin-workbench-grid-wide">
      <section className="admin-table-shell">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">商品清單</h2><p className="mt-0.5 text-xs text-slate-500">停用後不會出現在新結帳，既有銷售與庫存紀錄仍保留。</p></div><span className="text-xs tabular-nums text-slate-500">{products.length} 項</span></div>
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>商品／編號</th><th>售價</th><th>庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>{products.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-slate-400">尚未建立商品，請使用右側表單新增</td></tr> : products.map((product) => {
          const needsStock = product.active && Number(product.stock_on_hand) <= Number(product.reorder_level);
          return <tr key={product.id} className={selected?.id === product.id ? "bg-brand-50/50" : ""}><td><strong className="text-slate-800">{product.name}</strong><div className="text-xs text-slate-500">{product.sku || "未設定商品編號"}</div></td><td>{money(product.retail_price)}</td><td><strong>{number(product.stock_on_hand)} {product.unit}</strong>{needsStock && <div className="text-xs text-amber-700">低於提醒量 {number(product.reorder_level)}</div>}</td><td><span className={`badge ${product.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{product.active ? "啟用" : "停用"}</span></td><td><Link href={`/admin/products?edit=${product.id}`} className="btn btn-secondary px-3 py-1.5">管理</Link></td></tr>;
        })}</tbody></table></div>
      </section>

      <aside className="space-y-5 self-start">
        <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">{selected ? "編輯商品" : "新增商品"}</h2><p className="mt-0.5 text-xs text-slate-500">{selected ? "修改名稱、售價與補貨條件；庫存請用下方異動。" : "建立後會立即出現在結帳的「商品」頁籤。"}</p></div>{selected && <Link href="/admin/products" className="text-xs font-semibold text-brand-700">取消編輯</Link>}</div>
          <form action={selected ? updateProductAction : createProductAction} className="grid gap-3 p-4 sm:grid-cols-2">
            {selected && <input type="hidden" name="id" value={selected.id} />}
            <label className="text-sm sm:col-span-2"><span className="label">商品名稱</span><input name="name" className="input" defaultValue={selected?.name ?? ""} maxLength={160} required placeholder="例如：修護精華 30ml" /></label>
            <label className="text-sm"><span className="label">商品編號</span><input name="sku" className="input uppercase" defaultValue={selected?.sku ?? ""} maxLength={60} placeholder="可留空" /></label>
            <label className="text-sm"><span className="label">計算單位</span><input name="unit" className="input" defaultValue={selected?.unit ?? "件"} maxLength={20} required /></label>
            {!selected && <label className="text-sm"><span className="label">初始庫存</span><input name="stock_on_hand" type="number" className="input" min="0" step="0.01" defaultValue="0" required /></label>}
            <label className="text-sm"><span className="label">補貨提醒量</span><input name="reorder_level" type="number" className="input" min="0" step="0.01" defaultValue={selected?.reorder_level ?? 3} required /></label>
            <label className="text-sm"><span className="label">商品售價</span><input name="retail_price" type="number" className="input" min="0" step="1" defaultValue={selected?.retail_price ?? 0} required /></label>
            <SubmitButton className="btn btn-primary sm:col-span-2">{selected ? "儲存商品資料" : "建立商品"}</SubmitButton>
          </form>
          {selected && <form action={toggleProductAction} className="border-t border-slate-200 p-4"><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="active" value={selected.active ? "false" : "true"} /><SubmitButton className="btn btn-secondary w-full">{selected.active ? "停用商品" : "重新啟用商品"}</SubmitButton></form>}
        </section>

        {selected && <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">庫存異動</h2><p className="mt-0.5 text-xs text-slate-500">每次異動都保留紀錄；售出、使用與報廢會扣除庫存。</p></div><strong className="tabular-nums text-slate-900">{number(selected.stock_on_hand)} {selected.unit}</strong></div>
          <form action={recordProductMovementAction} className="grid gap-3 p-4 sm:grid-cols-2"><input type="hidden" name="item_id" value={selected.id} /><label className="text-sm"><span className="label">異動類型</span><select name="kind" className="input" defaultValue="stock_in"><option value="stock_in">進貨</option><option value="use">服務使用</option><option value="sale">售出</option><option value="waste">報廢</option></select></label><label className="text-sm"><span className="label">數量</span><input name="quantity" type="number" min="0.01" step="0.01" className="input" required /></label><label className="text-sm sm:col-span-2"><span className="label">備註</span><input name="note" className="input" maxLength={300} placeholder="例如：9 月到貨、課程使用" /></label><SubmitButton className="btn btn-secondary sm:col-span-2">記錄庫存異動</SubmitButton></form>
        </section>}
      </aside>
    </div>

    {movements.length > 0 && <section className="admin-table-shell"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">最近庫存異動</h2><p className="mt-0.5 text-xs text-slate-500">顯示目前品牌最近 30 筆紀錄。</p></div></div><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>時間</th><th>商品</th><th>異動</th><th>數量</th><th>異動後庫存</th><th>備註</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td className="text-xs text-slate-500">{new Date(movement.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</td><td className="font-medium">{nameById.get(movement.item_id) ?? "已停用商品"}</td><td>{MOVEMENT_LABEL[movement.kind] ?? movement.kind}</td><td>{number(movement.quantity)}</td><td>{number(movement.stock_after)}</td><td className="text-slate-500">{movement.note || "—"}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return <div className="admin-metric"><span className="admin-metric-label">{label}</span><strong className={`admin-metric-value ${tone === "warning" ? "text-amber-700" : ""}`}>{value}</strong></div>;
}
