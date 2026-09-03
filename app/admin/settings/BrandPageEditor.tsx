"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  DEFAULT_BRAND_PAGE_CONTENT,
  type BrandPageContent,
  type BrandPageTemplate,
} from "@/lib/brand-page";
import { SHOWCASE_TEMPLATES } from "@/lib/showcase-templates";

interface BrandPageEditorProps {
  enabled: boolean;
  initialTemplate: BrandPageTemplate;
  initialContent: BrandPageContent;
  initialLogoUrl: string;
  publicUrl: string | null;
  action: (formData: FormData) => void | Promise<void>;
}

const TEXT_FIELDS: Array<{
  key: keyof Pick<BrandPageContent, "hero_eyebrow" | "hero_title" | "hero_highlight" | "primary_cta_label" | "secondary_cta_label" | "section_title">;
  label: string;
  hint: string;
  maxLength: number;
}> = [
  { key: "hero_eyebrow", label: "主視覺上方小標", hint: "適合放城市、服務類型或品牌標語", maxLength: 80 },
  { key: "hero_title", label: "主標題", hint: "建議 6–18 個中文字，保持版面張力", maxLength: 120 },
  { key: "hero_highlight", label: "主標題強調句", hint: "會依模板使用不同字色或字體呈現", maxLength: 120 },
  { key: "primary_cta_label", label: "主要按鈕文字", hint: "會連到真實預約或活動報名入口", maxLength: 40 },
  { key: "secondary_cta_label", label: "次要按鈕文字", hint: "連到頁面下方的服務／活動內容", maxLength: 40 },
  { key: "section_title", label: "第二區塊標題", hint: "用一句話說明服務或活動特色", maxLength: 160 },
];

function ImageUploadField({ label, hint, name, value, required, onChange }: { label: string; hint: string; name: "brand_logo_url" | "hero_image_url" | "detail_image_url" | "gallery_image_url"; value: string; required?: boolean; onChange: (value: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const body = await response.json() as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !body.ok || !body.url) throw new Error(body.error ?? "圖片上傳失敗");
      onChange(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <label className="block text-sm">
        <span className="label">{label}</span>
        <input name={name} value={value} onChange={(event) => onChange(event.target.value)} maxLength={1000} required={required} className="input min-h-12" placeholder="貼上 HTTPS 圖片網址，或使用下方按鈕上傳" />
      </label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={`${label}目前預覽`} className="h-24 w-full rounded-xl border border-slate-200 bg-white object-cover sm:w-36" />
        ) : <div className="grid h-24 w-full place-items-center rounded-xl border border-dashed border-slate-300 bg-white text-xs text-slate-400 sm:w-36">尚未設定</div>}
        <div className="min-w-0 flex-1">
          <label className="btn btn-secondary min-h-11 cursor-pointer">
            {uploading ? "上傳中…" : "從電腦選擇圖片"}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
          </label>
          <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
          {error && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function CopyPublicUrlButton({ publicUrl }: { publicUrl: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const absoluteUrl = new URL(publicUrl, window.location.origin).toString();
    await navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return <button type="button" onClick={() => void copy()} className="btn btn-secondary min-h-11">{copied ? "已複製網址" : "複製公開網址"}</button>;
}

export function BrandPageEditor({ enabled, initialTemplate, initialContent, initialLogoUrl, publicUrl, action }: BrandPageEditorProps) {
  const [template, setTemplate] = useState<BrandPageTemplate>(initialTemplate);
  const [content, setContent] = useState<BrandPageContent>(initialContent);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);

  function updateContent(key: keyof BrandPageContent, value: string) {
    setContent((current) => ({ ...current, [key]: value }));
  }

  function applyDefaults() {
    setContent(DEFAULT_BRAND_PAGE_CONTENT[template]);
  }

  return (
    <form action={action} className="space-y-8">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 border-b border-slate-200 bg-[#172f35] px-5 py-6 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-white/55">Brand landing page</p>
            <h2 className="mt-2 text-xl font-bold">品牌形象頁</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">選擇已確認的產業框架，再填入品牌自己的文字與圖片。服務、活動與按鈕會讀取現有系統資料，不需要重複維護。</p>
          </div>
          <label className="flex min-h-12 shrink-0 items-center gap-3 rounded-full border border-white/20 bg-white/10 px-5 text-sm font-semibold">
            <input type="checkbox" name="brand_page_enabled" defaultChecked={enabled} className="h-5 w-5 accent-[#d7ff58]" />
            啟用公開形象頁
          </label>
        </div>

        <div className="space-y-8 p-5 sm:p-7">
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">01 / 選擇框架</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">八套模板保留各自的字體與版型</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {publicUrl && <Link href={publicUrl} target="_blank" className="btn btn-primary min-h-11 shrink-0">查看目前品牌公開頁 ↗</Link>}
                <Link href={`/showcase/${template}`} target="_blank" className="btn btn-secondary min-h-11 shrink-0">查看空白模板</Link>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {SHOWCASE_TEMPLATES.map((item) => {
                const selected = item.slug === template;
                return (
                  <label key={item.slug} className={`group cursor-pointer overflow-hidden rounded-2xl border-2 transition ${selected ? "border-brand-500 shadow-[0_0_0_3px_rgba(39,109,120,.12)]" : "border-slate-200 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      name="brand_page_template"
                      value={item.slug}
                      checked={selected}
                      onChange={() => setTemplate(item.slug)}
                      className="sr-only"
                    />
                    <span className="relative block aspect-[16/10] overflow-hidden bg-slate-100">
                      <Image src={item.image} alt="" fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" />
                      <span className={`absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full border text-xs font-black ${selected ? "border-brand-500 bg-brand-600 text-white" : "border-white/80 bg-white/90 text-transparent"}`}>✓</span>
                    </span>
                    <span className="block p-4">
                      <span className="flex items-center justify-between gap-2">
                        <strong className="text-sm text-slate-900">{item.number}　{item.industry}</strong>
                        <span className="flex gap-1" aria-hidden="true">{item.palette.map((color) => <i key={color} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />)}</span>
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">{item.direction}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">02 / 品牌內容</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">填入要公開給顧客看的內容</h3>
              </div>
              <button type="button" onClick={applyDefaults} className="btn btn-ghost min-h-11 shrink-0">套用此模板預設文案</button>
            </div>

            <label className="mt-5 block max-w-xl text-sm">
              <span className="label">主要按鈕要帶顧客去哪裡</span>
              <select name="primary_entry" value={content.primary_entry} onChange={(event) => updateContent("primary_entry", event.target.value as BrandPageContent["primary_entry"])} className="input min-h-12">
                <option value="auto">依模板自動選擇</option>
                <option value="booking">預約服務／私人課</option>
                <option value="registration">活動或團體課報名</option>
              </select>
              <span className="mt-1 block text-xs leading-5 text-slate-400">同時開啟預約與報名時，可明確指定首頁主要按鈕；頁面下方仍會保留兩個入口。</span>
            </label>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              {TEXT_FIELDS.map((field) => (
                <label key={field.key} className="block text-sm">
                  <span className="label">{field.label}</span>
                  <input
                    name={field.key}
                    value={content[field.key]}
                    onChange={(event) => updateContent(field.key, event.target.value)}
                    maxLength={field.maxLength}
                    required={field.key !== "secondary_cta_label"}
                    className="input min-h-12"
                  />
                  <span className="mt-1 block text-xs leading-5 text-slate-400">{field.hint}</span>
                </label>
              ))}

              <label className="block text-sm lg:col-span-2">
                <span className="label">主視覺說明</span>
                <textarea name="hero_description" value={content.hero_description} onChange={(event) => updateContent("hero_description", event.target.value)} maxLength={500} rows={3} required className="input leading-7" />
              </label>
              <label className="block text-sm lg:col-span-2">
                <span className="label">第二區塊說明</span>
                <textarea name="section_description" value={content.section_description} onChange={(event) => updateContent("section_description", event.target.value)} maxLength={500} rows={3} required className="input leading-7" />
              </label>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8">
            <p className="eyebrow">03 / 品牌介紹與信任資訊</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">把顧客做決定前需要知道的事情說清楚</h3>
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <label className="block text-sm lg:col-span-2"><span className="label">品牌介紹標題</span><input name="about_title" value={content.about_title} onChange={(event) => updateContent("about_title", event.target.value)} maxLength={160} required className="input min-h-12" /></label>
              <label className="block text-sm lg:col-span-2"><span className="label">品牌介紹內容</span><textarea name="about_description" value={content.about_description} onChange={(event) => updateContent("about_description", event.target.value)} maxLength={600} rows={3} required className="input leading-7" /></label>
              {(["trust_point_1", "trust_point_2", "trust_point_3"] as const).map((key, index) => <label key={key} className="block text-sm"><span className="label">信任重點 {index + 1}</span><input name={key} value={content[key]} onChange={(event) => updateContent(key, event.target.value)} maxLength={80} required className="input min-h-12" /></label>)}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8">
            <p className="eyebrow">04 / 常見問題</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">預先回答顧客最常卡住的問題</h3>
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <label className="block text-sm"><span className="label">問題 1</span><input name="faq_1_question" value={content.faq_1_question} onChange={(event) => updateContent("faq_1_question", event.target.value)} maxLength={160} required className="input min-h-12" /></label>
              <label className="block text-sm"><span className="label">回答 1</span><textarea name="faq_1_answer" value={content.faq_1_answer} onChange={(event) => updateContent("faq_1_answer", event.target.value)} maxLength={600} rows={3} required className="input leading-7" /></label>
              <label className="block text-sm"><span className="label">問題 2</span><input name="faq_2_question" value={content.faq_2_question} onChange={(event) => updateContent("faq_2_question", event.target.value)} maxLength={160} required className="input min-h-12" /></label>
              <label className="block text-sm"><span className="label">回答 2</span><textarea name="faq_2_answer" value={content.faq_2_answer} onChange={(event) => updateContent("faq_2_answer", event.target.value)} maxLength={600} rows={3} required className="input leading-7" /></label>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8">
            <p className="eyebrow">05 / 圖片</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">使用品牌自己的實景照片</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">可直接上傳，也可貼上網站內路徑或 HTTPS 圖片網址。上傳後仍要按最下方「儲存並套用形象頁」才會正式使用。</p>
            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
              <div className="xl:col-span-2"><ImageUploadField label="品牌 Logo（選填）" name="brand_logo_url" value={logoUrl} onChange={setLogoUrl} hint="建議使用透明背景橫式 Logo；留空時顯示品牌名稱。" /></div>
              <ImageUploadField label="主視覺圖片" name="hero_image_url" value={content.hero_image_url} onChange={(value) => updateContent("hero_image_url", value)} required hint="建議至少 1600×1200，主體避免靠近邊緣。" />
              <ImageUploadField label="服務／課程情境圖片" name="detail_image_url" value={content.detail_image_url} onChange={(value) => updateContent("detail_image_url", value)} required hint="建議至少 1200×900，用來呈現空間、服務或上課情境。" />
              <div className="xl:col-span-2"><ImageUploadField label="補充情境圖片" name="gallery_image_url" value={content.gallery_image_url} onChange={(value) => updateContent("gallery_image_url", value)} required hint="用於品牌介紹與行動入口區塊，避免與主圖完全相同。" /></div>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-slate-200 pt-7 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm text-slate-500">
              <p className="font-semibold text-slate-800">公開網址</p>
              {publicUrl ? <><Link href={publicUrl} target="_blank" className="mt-1 block break-all text-brand-700 underline underline-offset-4">{publicUrl}</Link><div className="mt-3 flex flex-wrap gap-2"><CopyPublicUrlButton publicUrl={publicUrl} /><Link href={publicUrl} target="_blank" className="btn btn-secondary min-h-11">開啟公開頁</Link></div></> : <p className="mt-1 text-amber-700">請先在「品牌資料」設定品牌短網址。</p>}
            </div>
            <SubmitButton className="btn btn-primary min-h-12 shrink-0 px-7">儲存並套用形象頁</SubmitButton>
          </div>
        </div>
      </section>
    </form>
  );
}
