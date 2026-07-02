"use client";

import { useState } from "react";
import { publishRichMenuAction } from "../actions";

// 上傳前用 canvas 自動把圖片裁成版型要求的精確尺寸(cover,置中),壓到 <1MB。
export default function PublishForm({
  width,
  height,
  disabled,
}: {
  width: number;
  height: number;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pick(f: File | null) {
    setFile(f);
    setErr(null);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function loadImage(f: File): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(f);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("圖片讀取失敗"));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function resizeToBlob(f: File): Promise<Blob> {
    const img = await loadImage(f);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法處理圖片");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    // cover:等比放大到填滿,置中裁切
    const scale = Math.max(width / img.width, height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
    // 壓到 1MB 以內
    for (const q of [0.92, 0.85, 0.75, 0.6, 0.45, 0.3]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (blob && (blob.size <= 1024 * 1024 || q === 0.3)) return blob;
    }
    throw new Error("圖片壓縮失敗,請換一張");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("請選擇圖片");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const blob = await resizeToBlob(file);
      const fd = new FormData();
      fd.append("image", new File([blob], "menu.jpg", { type: "image/jpeg" }));
      await publishRichMenuAction(fd); // 成功/失敗都會 redirect 回本頁顯示結果
    } catch (e) {
      setErr(e instanceof Error ? e.message : "發布失敗");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="font-semibold text-slate-900">上傳圖片並發布</h2>
      <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
        系統會自動把圖片裁成 <strong>{width} × {height} px</strong>(等比填滿、置中裁切)並壓縮,
        你不必自己調尺寸;建議上傳解析度足夠、比例接近的圖較不失真。
      </p>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-white"
      />
      {preview && (
        <div className="overflow-hidden rounded-lg border border-slate-200" style={{ aspectRatio: `${width} / ${height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="預覽" className="h-full w-full object-cover" />
        </div>
      )}
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <button className="btn btn-primary" disabled={disabled || busy}>
        {busy ? "處理中…" : "發布圖文選單"}
      </button>
    </form>
  );
}
