"use client";

import { useRef, useState } from "react";

interface MergeTarget {
  id: string;
  label: string;
}

export default function MergeTargetPicker({ sourcePatientId }: { sourcePatientId: string }) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [options, setOptions] = useState<MergeTarget[]>([]);
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  async function search(nextPage: number, append: boolean) {
    const term = append ? appliedQuery : query.trim();
    if (term.length < 2) {
      setError("請輸入至少兩個字或數字");
      return;
    }
    const currentRequest = ++requestNumber.current;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ source: sourcePatientId, q: term, page: String(nextPage) });
      const response = await fetch(`/api/admin/patients/merge-targets?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: { options?: MergeTarget[]; hasMore?: boolean }; error?: string };
      if (!response.ok || !body.ok || !Array.isArray(body.data?.options) || typeof body.data.hasMore !== "boolean") {
        throw new Error(body.error ?? "讀取顧客失敗，請稍後再試");
      }
      if (currentRequest !== requestNumber.current) return;
      setOptions((previous) => {
        if (!append) return body.data?.options ?? [];
        const combined = [...previous];
        for (const option of body.data?.options ?? []) if (!combined.some((item) => item.id === option.id)) combined.push(option);
        return combined;
      });
      setPage(nextPage);
      setHasMore(body.data.hasMore);
      if (!append) {
        setAppliedQuery(term);
        setSelected("");
      }
    } catch (cause) {
      if (currentRequest === requestNumber.current) setError(cause instanceof Error ? cause.message : "讀取顧客失敗，請稍後再試");
    } finally {
      if (currentRequest === requestNumber.current) setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="label">搜尋要保留的顧客</span>
        <span className="text-xs text-slate-500">請以姓名或電話搜尋；同名時請用完整電話核對，清單僅顯示末四碼。</span>
        <input type="search" className="input mt-1" aria-label="搜尋合併目標顧客" maxLength={80} value={query} onChange={(event) => {
          requestNumber.current++;
          setQuery(event.target.value);
          setAppliedQuery("");
          setOptions([]);
          setSelected("");
          setHasMore(false);
          setSearching(false);
          setError(null);
        }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!searching) void search(0, false); } }} />
      </label>
      <button type="button" className="btn btn-secondary" disabled={searching} onClick={() => void search(0, false)}>{searching ? "搜尋中…" : "搜尋顧客"}</button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <label className="block text-sm">
        <span className="label">保留哪一筆顧客</span>
        <select name="target_patient_id" className="input" required value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="" disabled>請先搜尋並選擇顧客</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      {appliedQuery && options.length === 0 && !searching && !error && <p className="text-xs text-slate-500">目前沒有符合的顧客，請更換搜尋條件。</p>}
      {hasMore && <button type="button" className="btn btn-secondary" disabled={searching} onClick={() => void search(page + 1, true)}>{searching ? "載入中…" : "顯示更多顧客"}</button>}
    </div>
  );
}
