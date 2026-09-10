"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

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

export function TreatmentRecordForm({ sources, focus, action }: { sources: ServiceRecordSourceOption[]; focus: OperationFocus; action: (fd: FormData) => Promise<void> }) {
  const orderedSources = useMemo(() => [...sources].sort((a, b) => focus === "registration" ? Number(b.kind === "registration") - Number(a.kind === "registration") : focus === "booking" ? Number(b.kind === "appointment") - Number(a.kind === "appointment") : 0), [focus, sources]);
  const [sourceKey, setSourceKey] = useState(orderedSources[0] ? `${orderedSources[0].kind}:${orderedSources[0].id}` : "");
  const [photos, setPhotos] = useState<Array<{ path: string; previewUrl: string | null }>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedKind = sourceKey.startsWith("registration:") ? "registration" : sourceKey.startsWith("appointment:") ? "booking" : focus;
  const copy = COPY[selectedKind];

  async function upload(file: File) {
    const [sourceKind, sourceId] = sourceKey.split(":", 2);
    if (!sourceId) { setError("請先選擇服務或課程來源"); return; }
    if (photos.length >= 6) { setError("每筆紀錄最多 6 張圖片"); return; }
    setUploading(true); setError(null);
    try {
      const form = new FormData(); form.set("source_kind", sourceKind); form.set("source_id", sourceId); form.set("file", file);
      const response = await fetch("/api/admin/beauty-photo", { method: "POST", body: form });
      const body = await response.json() as { ok?: boolean; path?: string; preview_url?: string | null; error?: string };
      if (!response.ok || !body.ok || !body.path) throw new Error(body.error ?? "圖片上傳失敗");
      setPhotos((current) => [...current, { path: body.path as string, previewUrl: body.preview_url ?? null }]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "圖片上傳失敗"); }
    finally { setUploading(false); }
  }

  return <form action={action} className="admin-section space-y-4 p-5">
    <div><h2 className="font-semibold text-slate-900">新增服務過程紀錄</h2><p className="mt-1 text-sm leading-6 text-slate-500">同一入口可記錄預約服務、課程與活動的實際過程；附件只存於私密空間。</p></div>
    <label className="block"><span className="label">{copy.source}</span><select name="source_key" value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); setPhotos([]); setError(null); }} className="input" required><option value="" disabled>{copy.empty}</option><optgroup label="預約服務">{orderedSources.filter((source) => source.kind === "appointment").map((source) => <option key={`appointment:${source.id}`} value={`appointment:${source.id}`}>{source.label}</option>)}</optgroup><optgroup label="課程／活動報名">{orderedSources.filter((source) => source.kind === "registration").map((source) => <option key={`registration:${source.id}`} value={`registration:${source.id}`}>{source.label}</option>)}</optgroup></select></label>
    <label className="block"><span className="label">紀錄標題</span><input name="treatment_name" className="input" required maxLength={160} placeholder={selectedKind === "registration" ? "例如：第二堂學習紀錄" : "例如：初次評估或本次服務"} /></label>
    <label className="block"><span className="label">{copy.assessment}</span><textarea name="assessment" className="input min-h-24" maxLength={3000} placeholder={copy.assessmentPlaceholder} /></label>
    <label className="block"><span className="label">{copy.content}</span><textarea name="content" className="input min-h-28" required maxLength={5000} placeholder={copy.contentPlaceholder} /></label>
    <label className="block"><span className="label">{copy.aftercare}</span><textarea name="aftercare" className="input min-h-24" maxLength={3000} placeholder={copy.aftercarePlaceholder} /></label>
    <input type="hidden" name="private_photo_paths" value={JSON.stringify(photos.map((photo) => photo.path))} />
    <div><span className="label">私密圖片／過程照片（選填）</span><p className="mt-1 text-xs leading-5 text-slate-500">建議尺寸 1200 × 1200 像素（1:1）；橫式紀錄可使用 1600 × 1200，單張上限 5 MB。</p><div className="mt-2 flex flex-wrap gap-3">{photos.map((photo) => <div key={photo.path} className="relative h-24 w-24 overflow-hidden rounded border border-slate-200 bg-slate-50">{photo.previewUrl ? <img src={photo.previewUrl} alt="已上傳私密圖片" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-slate-400">已上傳</span>}<button type="button" onClick={() => setPhotos((current) => current.filter((item) => item.path !== photo.path))} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/70 text-white" aria-label="移除圖片">×</button></div>)}<label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-center text-xs leading-5 text-slate-500 hover:border-brand-400 hover:text-brand-700">{uploading ? "上傳中…" : "＋ 上傳圖片"}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading || !sourceKey || photos.length >= 6} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></label></div></div>
    <label className="flex items-start gap-2 text-sm leading-6 text-slate-600"><input type="checkbox" name="photo_consent" className="mt-1.5" required={photos.length > 0} />已確認當事人同意保存本次私密圖片；沒有圖片可不勾選。</label>
    {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <SubmitButton className="btn btn-primary w-full" disabled={sources.length === 0 || uploading}>儲存服務過程紀錄</SubmitButton>
  </form>;
}
