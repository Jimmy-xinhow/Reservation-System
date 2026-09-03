"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export interface BeautyAppointmentOption { id: string; label: string; }

export function TreatmentRecordForm({ appointments, action }: { appointments: BeautyAppointmentOption[]; action: (fd: FormData) => Promise<void> }) {
  const [appointmentId, setAppointmentId] = useState(appointments[0]?.id ?? "");
  const [photos, setPhotos] = useState<Array<{ path: string; previewUrl: string | null }>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!appointmentId) { setError("請先選擇預約"); return; }
    if (photos.length >= 6) { setError("每筆療程最多 6 張照片"); return; }
    setUploading(true); setError(null);
    try {
      const form = new FormData(); form.set("appointment_id", appointmentId); form.set("file", file);
      const response = await fetch("/api/admin/beauty-photo", { method: "POST", body: form });
      const body = await response.json() as { ok?: boolean; path?: string; preview_url?: string | null; error?: string };
      if (!response.ok || !body.ok || !body.path) throw new Error(body.error ?? "照片上傳失敗");
      setPhotos((current) => [...current, { path: body.path as string, previewUrl: body.preview_url ?? null }]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "照片上傳失敗"); }
    finally { setUploading(false); }
  }

  return (
    <form action={action} className="card space-y-4 p-5">
      <div><h2 className="font-semibold text-slate-900">新增療程紀錄</h2><p className="mt-1 text-sm leading-6 text-slate-500">把膚況、操作內容與居家照護留在該次預約；照片只放私密空間，不會出現在公開形象頁。</p></div>
      <label className="block"><span className="label">對應預約</span><select name="appointment_id" value={appointmentId} onChange={(event) => { setAppointmentId(event.target.value); setPhotos([]); setError(null); }} className="input" required><option value="" disabled>請選擇預約</option>{appointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{appointment.label}</option>)}</select></label>
      <label className="block"><span className="label">療程名稱</span><input name="treatment_name" className="input" required maxLength={160} placeholder="例如：保濕修護護膚" /></label>
      <label className="block"><span className="label">服務前觀察</span><textarea name="assessment" className="input min-h-24" maxLength={3000} placeholder="顧客當日狀況、敏感部位與需避開事項。" /></label>
      <label className="block"><span className="label">本次服務內容</span><textarea name="content" className="input min-h-28" required maxLength={5000} placeholder="實際使用的流程、產品與反應。" /></label>
      <label className="block"><span className="label">居家照護與下次建議</span><textarea name="aftercare" className="input min-h-24" maxLength={3000} placeholder="回家後注意事項與建議回訪時間。" /></label>
      <input type="hidden" name="private_photo_paths" value={JSON.stringify(photos.map((photo) => photo.path))} />
      <div><span className="label">療程照片（選填）</span><div className="mt-2 flex flex-wrap gap-3">{photos.map((photo) => <div key={photo.path} className="relative h-24 w-24 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{photo.previewUrl ? <img src={photo.previewUrl} alt="已上傳療程照片" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-slate-400">已上傳</span>}<button type="button" onClick={() => setPhotos((current) => current.filter((item) => item.path !== photo.path))} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/70 text-white" aria-label="移除照片">×</button></div>)}<label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-300 text-center text-xs leading-5 text-slate-500 hover:border-brand-400 hover:text-brand-700">{uploading ? "上傳中…" : "＋ 上傳照片"}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading || !appointmentId || photos.length >= 6} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></label></div></div>
      <label className="flex items-start gap-2 text-sm leading-6 text-slate-600"><input type="checkbox" name="photo_consent" className="mt-1.5" required={photos.length > 0} />已確認顧客同意保存本次療程照片；若沒有照片可不勾選。</label>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <SubmitButton className="btn btn-primary w-full" disabled={appointments.length === 0 || uploading}>儲存療程紀錄</SubmitButton>
    </form>
  );
}
