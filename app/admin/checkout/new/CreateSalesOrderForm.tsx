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
type SourceKind = CheckoutSourceOption["kind"];
type HasMore = Record<SourceKind, boolean>;

const GROUPS: Array<{ kind: CheckoutSourceOption["kind"]; label: string }> = [
  { kind: "appointment", label: "預約服務" },
  { kind: "registration", label: "活動／課程報名" },
  { kind: "patient", label: "顧客／會員" },
];

export default function CreateSalesOrderForm({ options, initialHasMore, defaultSource, closeHref = "/admin/checkout", embedded = false }: { options: CheckoutSourceOption[]; initialHasMore: HasMore; defaultSource: string; closeHref?: string; embedded?: boolean }) {
  const [availableOptions, setAvailableOptions] = useState(options);
  const [source, setSource] = useState(defaultSource);
  const selected = useMemo(() => availableOptions.find((option) => option.value === source) ?? null, [availableOptions, source]);
  const [kind, setKind] = useState<CheckoutSourceOption["kind"]>(() => selected?.kind ?? GROUPS.find((group) => options.some((option) => option.kind === group.kind))?.kind ?? "patient");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(initialHasMore[kind]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sourceAmount, setSourceAmount] = useState(() => {
    const option = options.find((item) => item.value === defaultSource);
    return option?.amount === null || option?.amount === undefined ? "" : String(option.amount);
  });

  function changeSource(value: string) {
    setSource(value);
    const option = availableOptions.find((item) => item.value === value);
    setSourceAmount(option?.amount === null || option?.amount === undefined ? "" : String(option.amount));
  }

  function changeKind(value: CheckoutSourceOption["kind"]) {
    setKind(value);
    setSource("");
    setSourceAmount("");
    setQuery("");
    setAppliedQuery("");
    setPage(0);
    setHasMore(initialHasMore[value]);
    setSearchError(null);
    setAvailableOptions((current) => [...current.filter((option) => option.kind !== value), ...options.filter((option) => option.kind === value)]);
  }

  async function searchSources(nextPage: number, append: boolean) {
    const term = append ? appliedQuery : query.trim();
    if (term && term.length < 2) { setSearchError("請輸入至少兩個字或數字"); return; }
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ kind, q: term, page: String(nextPage) });
      const response = await fetch(`/api/admin/checkout/sources?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: { options?: CheckoutSourceOption[]; hasMore?: boolean }; error?: string };
      if (!response.ok || !body.ok || !Array.isArray(body.data?.options) || typeof body.data.hasMore !== "boolean") {
        throw new Error(body.error ?? "讀取結帳來源失敗，請稍後再試");
      }
      const incoming = body.data.options.filter((option) => option.kind === kind);
      setAvailableOptions((current) => {
        const otherKinds = current.filter((option) => option.kind !== kind);
        const currentKind = append ? current.filter((option) => option.kind === kind) : [];
        const merged = [...currentKind];
        for (const option of incoming) if (!merged.some((existing) => existing.value === option.value)) merged.push(option);
        return [...otherKinds, ...merged];
      });
      setPage(nextPage);
      setHasMore(body.data.hasMore);
      if (!append) { setAppliedQuery(term); setSource(""); setSourceAmount(""); }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "讀取結帳來源失敗，請稍後再試");
    } finally { setSearching(false); }
  }

  const visibleOptions = availableOptions.filter((option) => option.kind === kind);

  return (
    <form action={createSalesOrderAction} className={`${embedded ? "checkout-create-form checkout-create-form-modal" : "admin-section checkout-create-form"}`}>
      <div className="checkout-form-section">
        <div className="checkout-form-heading">
          <span>1</span>
          <div><h2>選擇結帳對象</h2><p>可從預約、活動報名或既有顧客開始，不會預設成現場顧客。</p></div>
        </div>
        <div className="checkout-source-tabs" role="tablist" aria-label="結帳來源類型">
          {GROUPS.map((group) => {
            const count = availableOptions.filter((option) => option.kind === group.kind).length;
            return <button key={group.kind} type="button" role="tab" aria-selected={kind === group.kind} className={kind === group.kind ? "is-active" : ""} disabled={searching} onClick={() => changeKind(group.kind)}><strong>{group.label}</strong><span>{count} 筆已載入</span></button>;
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="search" className="input flex-1" aria-label="搜尋結帳對象" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!searching) void searchSources(0, false); } }} maxLength={80} placeholder={kind === "registration" ? "搜尋報名人或報名單號" : "搜尋顧客姓名或電話"} />
          <button type="button" className="btn btn-secondary" disabled={searching} onClick={() => void searchSources(0, false)}>{searching ? "搜尋中…" : "搜尋結帳對象"}</button>
        </div>
        {searchError && <p role="alert" className="text-sm text-red-700">{searchError}</p>}
        <label className="block text-sm">
          <span className="label">選擇{GROUPS.find((group) => group.kind === kind)?.label}</span>
          <select name="source" className="input" value={source} onChange={(event) => changeSource(event.target.value)} required>
            <option value="" disabled>請選擇結帳對象</option>
            {visibleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {visibleOptions.length === 0 && <p className="checkout-form-hint">目前沒有符合的結帳對象，請更換搜尋條件。</p>}
        {hasMore && <button type="button" className="btn btn-secondary" disabled={searching} onClick={() => void searchSources(page + 1, true)}>{searching ? "載入中…" : "顯示更多結帳對象"}</button>}
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
