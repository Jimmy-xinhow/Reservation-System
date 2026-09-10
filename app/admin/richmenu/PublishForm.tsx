"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { customerEntryUrl, type CustomerEntryKey } from "@/lib/customer-entry";
import { ACTION_OPTIONS, LAYOUTS, type Layout, type RichMenuTemplateKey, type Slot } from "@/lib/richmenu";
import { publishRichMenuAction } from "../line-actions";

interface PublishFormProps {
  width: number;
  height: number;
  layout: Layout;
  slots: Slot[];
  baseUrl: string;
  clinicSlug: string | null;
  liffId: string | null;
  versionId: string | null;
  templateKey: RichMenuTemplateKey;
  hasPublishedImage?: boolean;
  disabled?: boolean;
}

function customerEntryKey(action: Slot["action"]): CustomerEntryKey | null {
  switch (action) {
    case "home":
      return "home";
    case "booking":
      return "booking";
    case "appointments":
    case "query":
      return "appointments";
    case "events":
      return "events";
    case "tickets":
      return "tickets";
    case "membership":
      return "membership";
    case "support":
      return "support";
    case "brand":
    case "info":
      return "brand";
    default:
      return null;
  }
}

function previewTarget(
  slot: Slot,
  context: Pick<PublishFormProps, "baseUrl" | "clinicSlug" | "liffId">,
  preferLiff: boolean,
): string | null {
  if (slot.action === "uri") return slot.value?.trim() || null;
  const key = customerEntryKey(slot.action);
  return key ? customerEntryUrl(key, { ...context, preferLiff }) : null;
}

// 上傳前用 canvas 自動把圖片裁成版型要求的精確尺寸(cover,置中),壓到 <1MB。
export default function PublishForm({
  width,
  height,
  layout,
  slots,
  baseUrl,
  clinicSlug,
  liffId,
  versionId,
  templateKey,
  hasPublishedImage = false,
  disabled,
}: PublishFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [showHotspots, setShowHotspots] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const spec = LAYOUTS[layout];
  const previewSlots = useMemo(() => slots.slice(0, spec.slots).map((slot) => ({
    slot,
    browserTarget: previewTarget(slot, { baseUrl, clinicSlug, liffId }, false),
    lineTarget: previewTarget(slot, { baseUrl, clinicSlug, liffId }, true),
    actionLabel: ACTION_OPTIONS.find((option) => option.value === slot.action)?.label ?? slot.action,
  })), [baseUrl, clinicSlug, liffId, slots, spec.slots]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(f: File | null) {
    setFile(f);
    setErr(null);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function useBuiltInArtwork() {
    if (templateKey === "custom") return;
    setLoadingTemplate(true);
    setErr(null);
    try {
      const response = await fetch("/api/admin/richmenu-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: templateKey, layout, slots: slots.slice(0, spec.slots) }),
      });
      if (!response.ok) throw new Error("內建圖稿產生失敗");
      const blob = await response.blob();
      pick(new File([blob], `richmenu-${templateKey}.png`, { type: "image/png" }));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "內建圖稿產生失敗");
    } finally {
      setLoadingTemplate(false);
    }
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
    throw new Error("圖片壓縮失敗，請換一張。");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !hasPublishedImage) {
      setErr("請選擇圖片");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      if (!versionId) throw new Error("請先另存草稿版本");
      fd.append("version_id", versionId);
      if (file) {
        const blob = await resizeToBlob(file);
        fd.append("image", new File([blob], "menu.jpg", { type: "image/jpeg" }));
      } else {
        fd.append("reuse_published_image", "1");
      }
      const res = await publishRichMenuAction(fd);
      if (res.ok) {
        router.push("/admin/richmenu?ok=1");
        router.refresh();
      } else {
        setErr(res.error ?? "發布失敗");
        setBusy(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "發布失敗");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="admin-section">
      <div className="admin-section-header">
        <div><h2 className="font-semibold text-slate-900">步驟 4　上傳圖稿、預覽並發布</h2><p className="mt-0.5 text-xs text-slate-500">預覽使用目前已儲存的草稿；剛修改內容時，請先儲存新的草稿版本。</p></div>
        <span className={`badge ${disabled ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{disabled ? "尚未可發布" : "可進行發布"}</span>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
      <p className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">
        系統會把圖片裁成 <strong>{width} × {height} 像素</strong>，並自動置中、裁切與壓縮。建議上傳比例接近、解析度足夠的圖片，避免失真。
      </p>
      {templateKey !== "custom" && (
        <div className="flex flex-col gap-2 border-y border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-900">可直接使用的品牌圖稿</p>
            <p className="mt-0.5 text-xs leading-5 text-emerald-700">依目前模板與已啟用模組產生 LINE 規格 PNG，套用後仍可先預覽熱區。</p>
          </div>
          <div className="flex min-h-11 flex-wrap gap-2">
            <button type="button" onClick={useBuiltInArtwork} disabled={loadingTemplate} className="btn btn-primary min-h-11 px-4">
              {loadingTemplate ? "產生中…" : "套用內建圖稿"}
            </button>
            <a href={`/api/admin/richmenu-template?template=${encodeURIComponent(templateKey)}&download=1`} className="btn btn-secondary min-h-11 px-4">下載 PNG</a>
          </div>
        </div>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-sm file:border-0 file:bg-emerald-800 file:px-4 file:py-2 file:text-white"
      />
      {hasPublishedImage && !file && (
        <p className="border-l-2 border-sky-500 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          未選擇新圖片時，會沿用目前線上圖稿，只更新此草稿的點擊動作與選單設定。
        </p>
      )}
      {preview && (
        <div className="flex flex-col gap-2 border-y border-slate-200 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-slate-600">
            預設畫面就是實際送往 LINE 的圖稿，不會覆蓋遮罩或操作文字。
          </p>
          <button
            type="button"
            aria-pressed={showHotspots}
            onClick={() => setShowHotspots((current) => !current)}
            className="btn btn-secondary min-h-11 shrink-0"
          >
            {showHotspots ? "隱藏點擊熱區" : "顯示點擊熱區"}
          </button>
        </div>
      )}
      {preview ? (
        <div
          className="relative isolate overflow-hidden rounded-sm border border-slate-300 bg-slate-100"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Rich Menu 背景與點擊區預覽" className="absolute inset-0 h-full w-full object-cover" />
          {showHotspots && (
            <div
              aria-label="LINE 點擊熱區輔助線"
              className="pointer-events-none absolute inset-0 grid"
              style={{
                gridTemplateColumns: `repeat(${spec.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${spec.rows}, minmax(0, 1fr))`,
              }}
            >
              {previewSlots.map(({ slot }, index) => (
                <div key={`${index}-${slot.label}`} className="relative border border-dashed border-amber-300/90">
                  <span className="absolute left-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-amber-300 px-2 text-xs font-bold text-slate-950 shadow-sm">
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-32 items-center justify-center rounded-sm border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
          {hasPublishedImage ? "這次會沿用右側的目前線上圖稿；選擇新圖片後可在此預覽替換結果。" : "選擇圖片後，這裡會原樣顯示實際送往 LINE 的圖稿。"}
        </div>
      )}

      <section aria-labelledby="richmenu-link-test-title" className="border-y border-slate-200 py-4">
        <h4 id="richmenu-link-test-title" className="text-sm font-semibold text-slate-900">逐格連結測試</h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {previewSlots.map(({ slot, browserTarget, lineTarget, actionLabel }, index) => (
            <div key={`${index}-${slot.label}`} className="border-l-2 border-slate-300 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">{index + 1}. {slot.showLabel !== false && slot.label.trim() ? slot.label : slot.accessibilityLabel || "不顯示文字"}</p>
              <p className="mt-0.5 text-xs text-slate-500">{actionLabel}</p>
              <div className="mt-2 flex min-h-11 flex-wrap items-center gap-2">
                {browserTarget ? <a href={browserTarget} target="_blank" rel="noreferrer" className="btn btn-secondary px-3 py-2 text-xs">瀏覽器測試</a> : <span className="text-xs text-amber-700">此動作只能在 LINE 內驗收</span>}
                {lineTarget && lineTarget !== browserTarget && <a href={lineTarget} target="_blank" rel="noreferrer" className="btn btn-secondary px-3 py-2 text-xs">在 LINE 內開啟</a>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <button className="btn btn-primary" disabled={disabled || busy}>
        {busy ? "處理中…" : "驗證並發布此草稿"}
      </button>
      </div>
    </form>
  );
}
