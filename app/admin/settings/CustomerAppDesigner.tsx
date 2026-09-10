"use client";
/* eslint-disable @next/next/no-img-element -- tenant-managed preview URLs are validated when saved and may use arbitrary HTTPS hosts */

import { useState, type CSSProperties } from "react";
import type { BrandPageContent, CustomerAppCardStyle, CustomerAppLayout } from "@/lib/brand-page";
import styles from "./CustomerAppDesigner.module.css";

type AppContentKey = keyof Pick<BrandPageContent,
  | "app_layout" | "app_card_style" | "app_header_subtitle" | "app_hero_eyebrow"
  | "app_hero_title" | "app_hero_description" | "app_primary_cta_label" | "app_menu_title"
  | "app_privacy_note" | "app_hero_image_url" | "app_home_label" | "app_home_description"
  | "app_shortcut_title" | "app_shortcut_description" | "app_shortcut_button_label"
  | "app_booking_label" | "app_booking_description" | "app_appointments_label" | "app_appointments_description"
  | "app_events_label" | "app_events_description" | "app_tickets_label" | "app_tickets_description"
  | "app_membership_label" | "app_membership_description" | "app_support_label" | "app_support_description"
  | "app_brand_label" | "app_brand_description"
>;

type PreviewView = "home" | "booking" | "appointments" | "events" | "tickets" | "membership" | "support" | "brand";

const LAYOUTS: Array<{ value: CustomerAppLayout; label: string; note: string }> = [
  { value: "immersive", label: "沉浸影像", note: "大圖與漸層文字，適合美業、空間與運動品牌" },
  { value: "editorial", label: "品牌編輯誌", note: "圖片與文字分層，適合課程、顧問與內容品牌" },
  { value: "minimal", label: "純粹留白", note: "以品牌色和排版為主，操作路徑最直接" },
];

const CARD_STYLES: Array<{ value: CustomerAppCardStyle; label: string }> = [
  { value: "floating", label: "柔和浮層" },
  { value: "outlined", label: "精緻線框" },
  { value: "flat", label: "無框分隔" },
];

const ENTRY_FIELDS: Array<{ view: PreviewView; labelKey: AppContentKey; descriptionKey: AppContentKey; fallback: string }> = [
  { view: "home", labelKey: "app_home_label", descriptionKey: "app_home_description", fallback: "首頁" },
  { view: "booking", labelKey: "app_booking_label", descriptionKey: "app_booking_description", fallback: "立即預約" },
  { view: "appointments", labelKey: "app_appointments_label", descriptionKey: "app_appointments_description", fallback: "我的預約" },
  { view: "events", labelKey: "app_events_label", descriptionKey: "app_events_description", fallback: "活動／課程" },
  { view: "tickets", labelKey: "app_tickets_label", descriptionKey: "app_tickets_description", fallback: "我的票券" },
  { view: "membership", labelKey: "app_membership_label", descriptionKey: "app_membership_description", fallback: "會員／套票" },
  { view: "support", labelKey: "app_support_label", descriptionKey: "app_support_description", fallback: "LINE 客服" },
  { view: "brand", labelKey: "app_brand_label", descriptionKey: "app_brand_description", fallback: "品牌資訊" },
];

function AppGlyph({ view }: { view: PreviewView }) {
  const path = view === "home" ? "M4 11.5 12 4l8 7.5M6.5 10.5V20h11v-9.5M10 20v-6h4v6"
    : view === "booking" ? "M5 6h14v14H5zM8 3v6M16 3v6M5 11h14M12 14v4M10 16h4"
      : view === "appointments" ? "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"
        : view === "events" ? "M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11"
          : view === "tickets" ? "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7ZM12 8.5v7"
            : view === "membership" ? "M4 6h16v12H4zM8 10h4M8 14h2M15 10.5a1.5 1.5 0 1 0 0 3"
              : view === "support" ? "M4 5h16v11H9l-5 4V5ZM8 10h8M8 13h5"
                : "M12 21s6-5 6-11a6 6 0 1 0-12 0c0 6 6 11 6 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z";
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>;
}

function PreviewScreen({ view, content, clinicName, logoUrl }: { view: PreviewView; content: BrandPageContent; clinicName: string; logoUrl: string }) {
  if (view === "home") {
    return <>
      <section className={styles.previewHero}>
        {content.app_layout !== "minimal" && content.app_hero_image_url && <>
          {/* Brand-managed HTTPS or uploaded image URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.app_hero_image_url} alt="" />
        </>}
        <div className={styles.previewHeroShade} />
        <div className={styles.previewHeroCopy}><span>{content.app_hero_eyebrow}</span><h4>{content.app_hero_title}</h4><p>{content.app_hero_description}</p><button type="button" onClick={() => undefined}>{content.app_primary_cta_label}<b>→</b></button></div>
      </section>
      <p className={styles.previewSectionLabel}>{content.app_menu_title}</p>
      <div className={styles.previewMenu}>{ENTRY_FIELDS.filter((item) => item.view !== "home").slice(0, 4).map((item) => <div key={item.view} className={styles.previewMenuRow}><span className={styles.previewIcon}><AppGlyph view={item.view} /></span><span><strong>{String(content[item.labelKey])}</strong><small>{String(content[item.descriptionKey])}</small></span><b>›</b></div>)}</div>
      <div className={styles.previewShortcut}><span aria-hidden>↗</span><p><strong>{content.app_shortcut_title}</strong><small>{content.app_shortcut_description}</small></p><button type="button">{content.app_shortcut_button_label}</button></div>
      <p className={styles.previewPrivacy}>{content.app_privacy_note}</p>
    </>;
  }

  const selected = ENTRY_FIELDS.find((item) => item.view === view) ?? ENTRY_FIELDS[1];
  if (view === "booking") return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}><div className={styles.stepLabel}>選擇這次需要的服務</div>{["初次需求評估", "專業一對一服務", "進階保養方案"].map((label, index) => <div key={label} className={styles.serviceRow}><span><b>{label}</b><small>{index === 0 ? "30 分鐘" : `${50 + index * 10} 分鐘`}</small></span><strong>{index === 0 ? "NT$800" : `NT$${(1600 + index * 600).toLocaleString("zh-TW")}`}</strong></div>)}<button type="button" className={styles.previewPrimary}>繼續選擇時間</button></PreviewPage>;
  if (view === "appointments") return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}><div className={styles.appointmentCard}><span>即將到來</span><h5>9 月 18 日・14:30</h5><p>私人服務・品牌專員 Anya</p><div><button type="button">改期</button><button type="button">查看詳情</button></div></div></PreviewPage>;
  if (view === "events") return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}>{["秋季主題工作坊", "週末體驗小班"].map((label, index) => <div key={label} className={styles.eventRow}><span>{index === 0 ? "SEP 21" : "SEP 28"}</span><div><h5>{label}</h5><p>尚有 {index === 0 ? 6 : 3} 個名額・台北</p></div><b>›</b></div>)}</PreviewPage>;
  if (view === "tickets") return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}><div className={styles.ticket}><span>ADMISSION PASS</span><h5>秋季主題工作坊</h5><p>9 月 21 日・13:30</p><div className={styles.fakeQr}>▦</div></div></PreviewPage>;
  if (view === "membership") return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}><div className={styles.memberCard}><span>MEMBERSHIP PASS</span><h5>品牌尊享套票</h5><p>尚餘 6 / 10 次</p><div><i /><i /><i /><i /><i /><i /></div></div></PreviewPage>;
  if (view === "support") return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}><div className={styles.chat}><p>您好，想詢問哪一項服務呢？</p><p>我想了解第一次預約方式</p></div><div className={styles.chatInput}>輸入訊息…<button type="button">傳送</button></div></PreviewPage>;
  return <PreviewPage title={String(content[selected.labelKey])} description={String(content[selected.descriptionKey])}><div className={styles.brandPreview}>{logoUrl ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={logoUrl} alt="" /></> : <span>{clinicName.slice(0, 1)}</span>}<h5>{clinicName}</h5><p>品牌電話、地址、服務理念與聯絡方式會顯示在這裡。</p></div></PreviewPage>;
}

function PreviewPage({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className={styles.previewPage}><span className={styles.previewPageEyebrow}>CUSTOMER APP</span><h4>{title}</h4><p>{description}</p><div className={styles.previewPageBody}>{children}</div></section>;
}

export function CustomerAppDesigner({ content, clinicName, logoUrl, primaryColor, accentColor, onContentChange, onPrimaryColorChange, onAccentColorChange }: {
  content: BrandPageContent;
  clinicName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  onContentChange: (key: AppContentKey, value: string) => void;
  onPrimaryColorChange: (value: string) => void;
  onAccentColorChange: (value: string) => void;
}) {
  const [previewView, setPreviewView] = useState<PreviewView>("home");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewStyle = { "--app-primary": primaryColor, "--app-accent": accentColor } as CSSProperties;

  async function uploadHero(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const body = await response.json() as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !body.ok || !body.url) throw new Error(body.error ?? "圖片上傳失敗");
      onContentChange("app_hero_image_url", body.url);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  return <section className={styles.designer}>
    <div className={styles.controls}>
      <div className={styles.intro}><span>CUSTOMER APP STUDIO</span><h3>把顧客入口做成品牌自己的 App</h3><p>所有預覽都使用示例資料。修改會即時呈現在右側，按下頁面最下方儲存後才會套用到顧客入口；桌面捷徑會在品牌通過 LINE MINI App 驗證後自動出現。</p></div>

      <fieldset className={styles.controlGroup}><legend>首頁構圖</legend><div className={styles.choiceGrid}>{LAYOUTS.map((item) => <label key={item.value} data-active={content.app_layout === item.value}><input type="radio" name="app_layout" value={item.value} checked={content.app_layout === item.value} onChange={() => onContentChange("app_layout", item.value)} /><strong>{item.label}</strong><small>{item.note}</small></label>)}</div></fieldset>

      <fieldset className={styles.controlGroup}><legend>卡片與內容質感</legend><div className={styles.segmented}>{CARD_STYLES.map((item) => <label key={item.value} data-active={content.app_card_style === item.value}><input type="radio" name="app_card_style" value={item.value} checked={content.app_card_style === item.value} onChange={() => onContentChange("app_card_style", item.value)} />{item.label}</label>)}</div></fieldset>

      <fieldset className={styles.controlGroup}><legend>品牌色彩</legend><div className={styles.colorGrid}><ColorField label="品牌主色" name="brand_primary_color" value={primaryColor} onChange={onPrimaryColorChange} /><ColorField label="強調色" name="brand_accent_color" value={accentColor} onChange={onAccentColorChange} /></div></fieldset>

      <fieldset className={styles.controlGroup}><legend>App 頂部與首頁文字</legend><div className={styles.fieldGrid}>
        <TextField label="品牌名稱下方小字" name="app_header_subtitle" value={content.app_header_subtitle} maxLength={40} onChange={(value) => onContentChange("app_header_subtitle", value)} />
        <TextField label="首頁上方小標" name="app_hero_eyebrow" value={content.app_hero_eyebrow} maxLength={50} onChange={(value) => onContentChange("app_hero_eyebrow", value)} />
        <TextField wide label="首頁主標題" name="app_hero_title" value={content.app_hero_title} maxLength={80} onChange={(value) => onContentChange("app_hero_title", value)} />
        <TextArea label="首頁說明" name="app_hero_description" value={content.app_hero_description} maxLength={180} onChange={(value) => onContentChange("app_hero_description", value)} />
        <TextField label="主要按鈕文字" name="app_primary_cta_label" value={content.app_primary_cta_label} maxLength={30} onChange={(value) => onContentChange("app_primary_cta_label", value)} />
        <TextField label="功能區標題" name="app_menu_title" value={content.app_menu_title} maxLength={30} onChange={(value) => onContentChange("app_menu_title", value)} />
        <TextArea label="隱私與驗證提示" name="app_privacy_note" value={content.app_privacy_note} maxLength={180} onChange={(value) => onContentChange("app_privacy_note", value)} />
      </div></fieldset>

      <fieldset className={styles.controlGroup}><legend>App 首頁主視覺</legend><input type="url" name="app_hero_image_url" className="input min-h-12" value={content.app_hero_image_url} maxLength={1000} onChange={(event) => onContentChange("app_hero_image_url", event.target.value)} placeholder="HTTPS 圖片網址或上傳圖片" /><div className={styles.uploadRow}>{content.app_hero_image_url && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={content.app_hero_image_url} alt="目前 App 主視覺" /></>}<label className="btn btn-secondary min-h-11 cursor-pointer">{uploading ? "上傳中…" : "從電腦選擇圖片"}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadHero(file); event.currentTarget.value = ""; }} /></label></div>{uploadError && <p role="alert" className={styles.error}>{uploadError}</p>}<p className={styles.help}>建議使用直式或接近正方形的品牌實景照片；純粹留白版型會保留圖片設定但不顯示。</p></fieldset>

      <fieldset className={styles.controlGroup}><legend>手機桌面捷徑文字</legend><div className={styles.fieldGrid}>
        <TextField label="捷徑區標題" name="app_shortcut_title" value={content.app_shortcut_title} maxLength={50} onChange={(value) => onContentChange("app_shortcut_title", value)} />
        <TextField label="按鈕文字" name="app_shortcut_button_label" value={content.app_shortcut_button_label} maxLength={24} onChange={(value) => onContentChange("app_shortcut_button_label", value)} />
        <TextArea label="捷徑區說明" name="app_shortcut_description" value={content.app_shortcut_description} maxLength={120} onChange={(value) => onContentChange("app_shortcut_description", value)} />
      </div><p className={styles.help}>實際顧客頁只會在 LINE 確認裝置與已驗證 MINI App 都支援時顯示，不會讓顧客點到無效功能。</p></fieldset>

      <details className={styles.entryEditor} open><summary>修改 8 個功能入口的名稱與說明</summary><div>{ENTRY_FIELDS.map((item) => <fieldset key={item.view}><legend><AppGlyph view={item.view} />{item.fallback}</legend><TextField label="顯示名稱" name={item.labelKey} value={String(content[item.labelKey])} maxLength={24} onChange={(value) => onContentChange(item.labelKey, value)} /><TextField label="簡短說明" name={item.descriptionKey} value={String(content[item.descriptionKey])} maxLength={80} onChange={(value) => onContentChange(item.descriptionKey, value)} /></fieldset>)}</div></details>
    </div>

    <aside className={styles.previewColumn}>
      <div className={styles.previewHeading}><div><span>LIVE PREVIEW</span><strong>顧客看到的 App</strong></div><em>示例資料・不會送出</em></div>
      <div className={styles.viewTabs} role="tablist" aria-label="切換顧客 App 預覽頁面">{ENTRY_FIELDS.map((item) => <button key={item.view} type="button" role="tab" aria-selected={previewView === item.view} onClick={() => setPreviewView(item.view)}>{String(content[item.labelKey])}</button>)}</div>
      <div className={styles.phone} style={previewStyle} data-layout={content.app_layout} data-card-style={content.app_card_style}>
        <div className={styles.phoneBar}><span /><i /><span /></div>
        <header className={styles.previewHeader}><div>{logoUrl ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={logoUrl} alt="" /></> : <span>{clinicName.slice(0, 1)}</span>}<p><strong>{clinicName}</strong><small>{content.app_header_subtitle}</small></p></div><b>安全連線</b></header>
        <main className={`${styles.previewContent} ${previewView === "home" ? styles.previewContentHome : ""}`}><PreviewScreen view={previewView} content={content} clinicName={clinicName} logoUrl={logoUrl} /></main>
        {previewView !== "home" && <nav aria-label="顧客 App 快速切換預覽" className={styles.previewNav}>{(["home", "booking", "appointments", "membership"] as PreviewView[]).map((view) => { const item = ENTRY_FIELDS.find((candidate) => candidate.view === view)!; return <button key={view} type="button" aria-current={previewView === view ? "page" : undefined} onClick={() => setPreviewView(view)}><AppGlyph view={view} /><span>{String(content[item.labelKey])}</span></button>; })}</nav>}
      </div>
      <p className={styles.previewNote}>實際 LIFF 高度會依手機與 LINE 版本略有差異；文字、圖片、色彩與主要操作層級會與此設定一致。</p>
    </aside>
  </section>;
}

function TextField({ label, name, value, maxLength, wide, onChange }: { label: string; name: string; value: string; maxLength: number; wide?: boolean; onChange: (value: string) => void }) {
  return <label className={wide ? styles.wide : undefined}><span>{label}</span><input className="input min-h-11" name={name} value={value} maxLength={maxLength} required onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextArea({ label, name, value, maxLength, onChange }: { label: string; name: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return <label className={styles.wide}><span>{label}</span><textarea className="input leading-6" rows={3} name={name} value={value} maxLength={maxLength} required onChange={(event) => onChange(event.target.value)} /></label>;
}

function ColorField({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><div className={styles.colorField}><input type="color" value={value} aria-label={`${label}選色`} onChange={(event) => onChange(event.target.value)} /><input className="input min-h-11 font-mono uppercase" name={name} value={value} pattern="#[0-9A-Fa-f]{6}" maxLength={7} required onChange={(event) => onChange(event.target.value)} /></div></label>;
}
