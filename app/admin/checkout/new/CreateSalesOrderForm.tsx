"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { createSalesOrderAction } from "../actions";

export interface CheckoutSourceOption {
  value: string;
  kind: "appointment" | "registration" | "patient";
  label: string;
  amount: number | null;
}

const GROUPS: Array<{ kind: CheckoutSourceOption["kind"]; label: string }> = [
  { kind: "appointment", label: "預約服務" },
  { kind: "registration", label: "活動／課程報名" },
  { kind: "patient", label: "顧客／會員" },
];

export default function CreateSalesOrderForm({ options, defaultSource, closeHref = "/admin/checkout", embedded = false }: { options: CheckoutSourceOption[]; defaultSource: string; closeHref?: string; embedded?: boolean }) {
  const [source, setSource] = useState(defaultSource);
  const selected = useMemo(() => options.find((option) => option.value === source) ?? null, [options, source]);
  const [kind, setKind] = useState<CheckoutSourceOption["kind"]>(() => selected?.kind ?? GROUPS.find((group) => options.some((option) => option.kind === group.kind))?.kind ?? "patient");
  const [sourceAmount, setSourceAmount] = useState(() => {
    const option = options.find((item) => item.value === defaultSource);
    return option?.amount === null || option?.amount === undefined ? "" : String(option.amount);
  });

  function changeSource(value: string) {
    setSource(value);
    const option = options.find((item) => item.value === value);
    setSourceAmount(option?.amount === null || option?.amount === undefined ? "" : String(option.amount));
  }

  function changeKind(value: CheckoutSourceOption["kind"]) {
    setKind(value);
    setSource("");
    setSourceAmount("");
  }

  const visibleOptions = options.filter((option) => option.kind === kind);

  return (
    <form action={createSalesOrderAction} className={`${embedded ? "checkout-create-form checkout-create-form-modal" : "admin-section checkout-create-form"}`}>
      <div className="checkout-form-section">
        <div className="checkout-form-heading">
          <span>1</span>
          <div><h2>選擇結帳對象</h2><p>可從預約、活動報名或既有顧客開始，不會預設成現場顧客。</p></div>
        </div>
        <div className="checkout-source-tabs" role="tablist" aria-label="結帳來源類型">
          {GROUPS.map((group) => {
            const count = options.filter((option) => option.kind === group.kind).length;
            return <button key={group.kind} type="button" role="tab" aria-selected={kind === group.kind} className={kind === group.kind ? "is-active" : ""} disabled={count === 0} onClick={() => changeKind(group.kind)}><strong>{group.label}</strong><span>{count} 筆可選</span></button>;
          })}
        </div>
        <label className="block text-sm">
          <span className="label">選擇{GROUPS.find((group) => group.kind === kind)?.label}</span>
          <select name="source" className="input" value={source} onChange={(event) => changeSource(event.target.value)} required>
            <option value="" disabled>請選擇結帳對象</option>
            {visibleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {selected?.kind === "patient" && <p className="checkout-form-hint">商品、套票或沒有預約的服務：先選擇顧客建立銷售單，再於下一步加入品項與數量。</p>}
      </div>

      <div className="checkout-form-section">
        <div className="checkout-form-heading">
          <span>2</span>
          <div><h2>確認本次金額</h2><p>服務過程有調整、現場優惠或其他搭配時，可直接修改本次成交金額。</p></div>
        </div>
        {selected && selected.kind !== "patient" ? (
          <label className="block max-w-xs text-sm">
            <span className="label">本次服務／報名金額</span>
            <div className="checkout-money-input"><span>NT$</span><input name="source_amount" type="number" min="0" step="1" value={sourceAmount} onChange={(event) => setSourceAmount(event.target.value)} required /></div>
          </label>
        ) : (
          <p className="checkout-form-hint">選擇預約或報名後會帶入原價；選擇顧客時，於銷售單內加入商品、套票或自訂服務價格。</p>
        )}
      </div>

      <div className="checkout-form-section checkout-form-grid">
        <label className="text-sm"><span className="label">整單折扣</span><input name="discount_amount" type="number" min="0" defaultValue="0" className="input" /></label>
        <label className="text-sm"><span className="label">備註</span><input name="note" className="input" maxLength={500} placeholder="例如：現場活動折扣、材料調整" /></label>
      </div>

      <div className="checkout-create-actions">
        <a href={closeHref} className="btn btn-secondary">取消</a>
        <SubmitButton className="btn btn-primary" disabled={!selected}>建立並開啟銷售單</SubmitButton>
      </div>
    </form>
  );
}
