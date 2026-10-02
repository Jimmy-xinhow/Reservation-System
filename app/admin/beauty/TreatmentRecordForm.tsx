"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

export type OperationFocus = "booking" | "registration" | "mixed";
export interface ServiceRecordSourceOption { id: string; kind: "appointment" | "registration"; label: string; }

const COPY = {
  booking: {
    source: "對應預約",
    empty: "請選擇預約",
    assessment: "服務前狀況",
    assessmentPlaceholder: "顧客當日狀況、需求與需留意事項。",
    content: "本次服務內容",
    contentPlaceholder: "實際執行流程、使用品項與顧客反應。",
    aftercare: "後續與下次建議",
    aftercarePlaceholder: "後續注意事項與建議回訪時間。",
  },
  registration: {
    source: "對應課程／活動報名",
    empty: "請選擇課程或活動報名",
    assessment: "課前／學習狀況",
    assessmentPlaceholder: "學員課前程度、目標與需留意事項。",
    content: "本次課程／教學內容",
    contentPlaceholder: "本次教學內容、練習表現與完成狀況。",
    aftercare: "作業／練習與下次建議",
    aftercarePlaceholder: "課後作業、練習方向與下次進度。",
  },
  mixed: {
    source: "對應服務／課程來源",
    empty: "請選擇預約或報名",
    assessment: "開始前狀況",
    assessmentPlaceholder: "本次開始前的需求、程度與需留意事項。",
    content: "本次執行／教學內容",
    contentPlaceholder: "實際執行、教學內容與完成狀況。",
    aftercare: "後續與下次建議",
    aftercarePlaceholder: "後續注意事項、練習或下次安排。",
  },
} as const;

export function TreatmentRecordForm({ sources, focus, action }: { sources: ServiceRecordSourceOption[]; focus: OperationFocus; action: (fd: FormData) => Promise<string> }) {
  const orderedSources = useMemo(() => [...sources].sort((a, b) => focus === "registration" ? Number(b.kind === "registration") - Number(a.kind === "registration") : focus === "booking" ? Number(b.kind === "appointment") - Number(a.kind === "appointment") : 0), [focus, sources]);
  const [sourceOptions, setSourceOptions] = useState(orderedSources);
  const [sourceKey, setSourceKey] = useState(orderedSources[0] ? `${orderedSources[0].kind}:${orderedSources[0].id}` : "");
  const [sourceSearch, setSourceSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sourcePage, setSourcePage] = useState(0);
  const [sourceHasMore, setSourceHasMore] = useState(
    orderedSources.filter((item) => item.kind === "appointment").length >= 30 || orderedSources.filter((item) => item.kind === "registration").length >= 30,
  );
  const [searching, setSearching] = useState(false);
  const [photos, setPhotos] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const photoUrls = useRef(new Set<string>());
  const [recordId, setRecordId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedKind = sourceKey.startsWith("registration:") ? "registration" : sourceKey.startsWith("appointment:") ? "booking" : focus;
  const copy = COPY[selectedKind];
  useEffect(() => () => { for (const url of photoUrls.current) URL.revokeObjectURL(url); }, []);

  function clearPhotos() {
    for (const photo of photos) { URL.revokeObjectURL(photo.previewUrl); photoUrls.current.delete(photo.previewUrl); }
    setPhotos([]);
  }

  async function findSources(nextPage: number, append: boolean) {
    const query = append ? appliedSearch : sourceSearch.trim();
    if (query.length === 1) { setError("請輸入至少兩個字或數字"); return; }
    setSearching(true); setError(null);
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage) });
      const response = await fetch(`/api/admin/service-record-sources?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: { sources?: ServiceRecordSourceOption[]; hasMore?: boolean }; error?: string };
      if (!response.ok || !body.ok || !Array.isArray(body.data?.sources) || typeof body.data.hasMore !== "boolean") {
        throw new Error(body.error ?? "搜尋服務來源失敗，請稍後再試");
      }
      const incoming = body.data.sources;
      setSourceOptions((current) => append
        ? [...current, ...incoming.filter((item) => !current.some((existing) => existing.kind === item.kind && existing.id === item.id))]
        : incoming);
      setSourcePage(nextPage);
      setSourceHasMore(body.data.hasMore);
      if (!append) {
        setAppliedSearch(query);
        setSourceKey(incoming[0] ? `${incoming[0].kind}:${incoming[0].id}` : "");
        clearPhotos();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "搜尋服務來源失敗，請稍後再試"); }
    finally { setSearching(false); }
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    if (photos.length + incoming.length > 6) { setError("每筆紀錄最多 6 張圖片"); return; }
    if (incoming.some((file) => file.size === 0 || file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))) {
      setError("僅支援 5 MB 以下的 PNG、JPG、WebP 圖片"); return;
    }
    const added = incoming.map((file) => { const previewUrl = URL.createObjectURL(file); photoUrls.current.add(previewUrl); return { file, previewUrl }; });
    setPhotos((current) => [...current, ...added]); setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    let savedId = recordId;
    try {
      const fd = new FormData(event.currentTarget);
      fd.set("photo_count", String(photos.length));
      savedId = savedId ?? await action(fd);
      if (!recordId) setRecordId(savedId);
      for (const photo of photos) {
        const uploadForm = new FormData(); uploadForm.set("record_id", savedId); uploadForm.set("file", photo.file);
        const response = await fetch("/api/admin/beauty-photo", { method: "POST", body: uploadForm });
        const body = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !body.ok) throw new Error(body.error ?? "圖片上傳失敗");
        URL.revokeObjectURL(photo.previewUrl); photoUrls.current.delete(photo.previewUrl);
        setPhotos((current) => current.filter((item) => item !== photo));
      }
      window.location.reload();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "儲存服務紀錄失敗";
      setError(savedId ? `紀錄已儲存；${message}。請重試剩餘照片。` : message);
    } finally { setSaving(false); }
  }

  return <form onSubmit={(event) => { void submit(event); }} className="admin-section space-y-4 p-5">
    <div><h2 className="font-semibold text-slate-900">新增服務過程紀錄</h2><p className="mt-1 text-sm leading-6 text-slate-500">同一入口可記錄預約服務、課程與活動的實際過程；附件只存於私密空間。</p></div>
    <div><label htmlFor="service-source-search" className="label">搜尋預約或報名來源</label><div className="flex flex-col gap-2 sm:flex-row"><input id="service-source-search" type="search" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!searching && !recordId) void findSources(0, false); } }} className="input flex-1" maxLength={80} placeholder="顧客姓名或電話" disabled={saving || Boolean(recordId)} /><button type="button" className="btn btn-secondary shrink-0" disabled={searching || saving || Boolean(recordId)} onClick={() => void findSources(0, false)}>{searching ? "搜尋中…" : "搜尋來源"}</button></div><p className="mt-1 text-xs text-slate-500">預設顯示近期來源；可搜尋較早的預約或報名。</p></div>
    <label className="block"><span className="label">{copy.source}</span><select name="source_key" value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); clearPhotos(); setError(null); }} className="input" required disabled={saving || Boolean(recordId)}><option value="" disabled>{copy.empty}</option><optgroup label="預約服務">{sourceOptions.filter((source) => source.kind === "appointment").map((source) => <option key={`appointment:${source.id}`} value={`appointment:${source.id}`}>{source.label}</option>)}</optgroup><optgroup label="課程／活動報名">{sourceOptions.filter((source) => source.kind === "registration").map((source) => <option key={`registration:${source.id}`} value={`registration:${source.id}`}>{source.label}</option>)}</optgroup></select></label>
    {sourceOptions.length === 0 && <p className="text-sm text-slate-500" role="status">找不到符合條件的服務來源，請換姓名或電話再試。</p>}
    {sourceHasMore && <button type="button" className="btn btn-secondary" disabled={searching || saving || Boolean(recordId)} onClick={() => void findSources(sourcePage + 1, true)}>顯示更多來源</button>}
    <label className="block"><span className="label">紀錄標題</span><input name="treatment_name" className="input" required maxLength={160} placeholder={selectedKind === "registration" ? "例如：第二堂學習紀錄" : "例如：初次評估或本次服務"} disabled={saving || Boolean(recordId)} /></label>
    <label className="block"><span className="label">{copy.assessment}</span><textarea name="assessment" className="input min-h-24" maxLength={3000} placeholder={copy.assessmentPlaceholder} disabled={saving || Boolean(recordId)} /></label>
    <label className="block"><span className="label">{copy.content}</span><textarea name="content" className="input min-h-28" required maxLength={5000} placeholder={copy.contentPlaceholder} disabled={saving || Boolean(recordId)} /></label>
    <label className="block"><span className="label">{copy.aftercare}</span><textarea name="aftercare" className="input min-h-24" maxLength={3000} placeholder={copy.aftercarePlaceholder} disabled={saving || Boolean(recordId)} /></label>
    <div>
      <span className="label">私密圖片／過程照片（選填）</span>
      <p className="mt-1 text-xs leading-5 text-slate-500">建議尺寸 1200 × 1200 像素（1:1）。照片在儲存紀錄並確認同意後才上傳；離開未儲存的表單不會留下檔案。單張上限 5 MB，最多 6 張。</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {photos.map((photo) => <div key={photo.previewUrl} className="relative h-24 w-24 overflow-hidden rounded border border-slate-200 bg-slate-50">
          <img src={photo.previewUrl} alt="待儲存私密圖片" className="h-full w-full object-cover" />
          <button type="button" disabled={saving} onClick={() => { URL.revokeObjectURL(photo.previewUrl); photoUrls.current.delete(photo.previewUrl); setPhotos((current) => current.filter((item) => item !== photo)); }} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/70 text-white" aria-label="移除圖片">×</button>
        </div>)}
        <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-center text-xs leading-5 text-slate-500 hover:border-brand-400 hover:text-brand-700">＋ 選擇圖片
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={saving || !sourceKey || photos.length >= 6} onChange={(event) => { addPhotos(event.target.files); event.currentTarget.value = ""; }} />
        </label>
      </div>
    </div>
    <label className="flex items-start gap-2 text-sm leading-6 text-slate-600"><input type="checkbox" name="photo_consent" className="mt-1.5" required={photos.length > 0 && !recordId} disabled={saving || Boolean(recordId)} />已確認當事人同意保存本次私密圖片；沒有圖片可不勾選。</label>
    {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <button type="submit" className="btn btn-primary w-full" disabled={!sourceKey || saving || searching}>{saving ? "儲存中…" : recordId ? "重試剩餘照片" : "儲存服務過程紀錄"}</button>
  </form>;
}
