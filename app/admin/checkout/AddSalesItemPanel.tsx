"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { addCatalogSalesItemAction, addCustomSalesItemAction } from "./actions";

export interface CatalogSalesItem {
  id: string;
  name: string;
  price: number;
  meta?: string;
}

const KINDS = [
  { key: "service", label: "服務" },
  { key: "product", label: "商品" },
  { key: "package", label: "套票" },
  { key: "custom", label: "自訂品項" },
] as const;

type Kind = (typeof KINDS)[number]["key"];

function money(value: number): string { return `NT$${Number(value).toLocaleString("zh-TW")}`; }

export function AddSalesItemPanel({ orderId, services, products, packages }: { orderId: string; services: CatalogSalesItem[]; products: CatalogSalesItem[]; packages: CatalogSalesItem[] }) {
  const [kind, setKind] = useState<Kind>(products.length > 0 ? "product" : services.length > 0 ? "service" : packages.length > 0 ? "package" : "custom");
  const catalogs: Record<Exclude<Kind, "custom">, CatalogSalesItem[]> = { service: services, product: products, package: packages };
  const current = kind === "custom" ? [] : catalogs[kind];

  return (
    <section className="checkout-add-items" aria-labelledby="checkout-add-items-title">
      <div className="checkout-add-items-heading">
        <div><h3 id="checkout-add-items-title">加入品項</h3><p>選擇服務、庫存商品、套票，或輸入臨時加購項目。</p></div>
      </div>
      <div className="checkout-item-tabs" role="tablist" aria-label="品項類型">
        {KINDS.map((item) => <button type="button" role="tab" aria-selected={kind === item.key} className={kind === item.key ? "is-active" : ""} key={item.key} onClick={() => setKind(item.key)}>{item.label}{item.key !== "custom" && <span>{catalogs[item.key].length}</span>}</button>)}
      </div>
      {kind !== "custom" ? (
        <form action={addCatalogSalesItemAction} className="checkout-add-item-form">
          <input type="hidden" name="order_id" value={orderId} />
          <label><span className="label">選擇{KINDS.find((item) => item.key === kind)?.label}</span><select name="catalog_item" className="input" required defaultValue=""><option value="" disabled>{current.length > 0 ? `請選擇${KINDS.find((item) => item.key === kind)?.label}` : `目前沒有可用${KINDS.find((item) => item.key === kind)?.label}`}</option>{current.map((item) => <option key={item.id} value={`${kind}:${item.id}`}>{item.name} · {money(item.price)}{item.meta ? ` · ${item.meta}` : ""}</option>)}</select></label>
          <label><span className="label">數量</span><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className="input" required /></label>
          <SubmitButton className="btn btn-secondary" disabled={current.length === 0}>加入銷售單</SubmitButton>
        </form>
      ) : (
        <form action={addCustomSalesItemAction} className="checkout-add-item-form checkout-add-item-form-custom">
          <input type="hidden" name="order_id" value={orderId} />
          <label><span className="label">品項名稱</span><input name="name" className="input" maxLength={160} required placeholder="例如：材料費、現場加購" /></label>
          <label><span className="label">數量</span><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className="input" required /></label>
          <label><span className="label">單價</span><input name="unit_price" type="number" min="0" defaultValue="0" className="input" required /></label>
          <SubmitButton className="btn btn-secondary">加入銷售單</SubmitButton>
        </form>
      )}
    </section>
  );
}
