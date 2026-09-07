"use client";

import { useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { addCatalogSalesItemAction } from "./actions";

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
] as const;

type Kind = (typeof KINDS)[number]["key"];

function money(value: number): string { return `NT$${Number(value).toLocaleString("zh-TW")}`; }

export function AddSalesItemPanel({ orderId, services, products, packages, canManageProducts }: { orderId: string; services: CatalogSalesItem[]; products: CatalogSalesItem[]; packages: CatalogSalesItem[]; canManageProducts: boolean }) {
  const [kind, setKind] = useState<Kind>(products.length > 0 ? "product" : services.length > 0 ? "service" : "package");
  const catalogs: Record<Kind, CatalogSalesItem[]> = { service: services, product: products, package: packages };
  const current = catalogs[kind];
  const manager = {
    service: { href: "/admin/services", label: "前往服務方案新增", source: "服務來自營運中心的服務方案。" },
    product: { href: "/admin/products", label: "前往商品管理新增", source: "商品來自設定中心的商品清單。" },
    package: { href: "/admin/memberships", label: "前往套票管理新增", source: "套票來自會員管理的套票方案。" },
  }[kind];

  return (
    <section className="checkout-add-items" aria-labelledby="checkout-add-items-title">
      <div className="checkout-add-items-heading">
        <div><h3 id="checkout-add-items-title">加入品項</h3><p>從已建立的服務、庫存商品或套票加入本次銷售單。</p></div>
      </div>
      <div className="checkout-item-tabs" role="tablist" aria-label="品項類型">
        {KINDS.map((item) => <button type="button" role="tab" aria-selected={kind === item.key} className={kind === item.key ? "is-active" : ""} key={item.key} onClick={() => setKind(item.key)}>{item.label}<span>{catalogs[item.key].length}</span></button>)}
      </div>
      {canManageProducts && <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"><span>{current.length > 0 ? manager.source : `目前尚未建立可結帳的${KINDS.find((item) => item.key === kind)?.label}。`}</span><Link href={manager.href} className="font-semibold text-brand-700 hover:underline">{manager.label} →</Link></div>}
      <form action={addCatalogSalesItemAction} className="checkout-add-item-form">
        <input type="hidden" name="order_id" value={orderId} />
        <label><span className="label">選擇{KINDS.find((item) => item.key === kind)?.label}</span><select name="catalog_item" className="input" required defaultValue=""><option value="" disabled>{current.length > 0 ? `請選擇${KINDS.find((item) => item.key === kind)?.label}` : `目前沒有可用${KINDS.find((item) => item.key === kind)?.label}`}</option>{current.map((item) => <option key={item.id} value={`${kind}:${item.id}`}>{item.name} · {money(item.price)}{item.meta ? ` · ${item.meta}` : ""}</option>)}</select></label>
        <label><span className="label">數量</span><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className="input" required /></label>
        <SubmitButton className="btn btn-secondary" disabled={current.length === 0}>加入銷售單</SubmitButton>
      </form>
    </section>
  );
}
