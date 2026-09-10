"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { LINE_UI_CATEGORIES, LINE_UI_TEMPLATES, type LineUiCategory, type LineUiTemplateDefinition } from "@/lib/line-ui-templates";
import {
  LINE_FLEX_STYLE_PRESETS,
  LINE_FLEX_WELCOME_PRESETS,
  isLineFlexTemplateKey,
  parseLineFlexDesignSettings,
  type LineFlexDesignConfig,
  type LineFlexStyleKey,
  type LineFlexTemplateKey,
} from "@/lib/line-flex-design";
import { publishLineFlexDesignAction, saveLineFlexDesignAction } from "@/app/admin/line-actions";

type PreviewKind =
  | "welcome" | "menu" | "story" | "selector" | "calendar" | "appointment" | "payment"
  | "reminder" | "change" | "queue" | "offer" | "rebook" | "event" | "feature"
  | "ticket" | "membership" | "identity" | "campaign" | "support" | "chat" | "staff";

const PREVIEW_KIND: Record<string, PreviewKind> = {
  welcome: "welcome",
  service_hub: "menu",
  brand_story: "story",
  booking_service_select: "selector",
  booking_date_select: "calendar",
  booking_confirmed: "appointment",
  payment_pending: "payment",
  appointment_reminder: "reminder",
  appointment_changed: "change",
  waitlist_joined: "queue",
  waitlist_offer: "offer",
  quick_rebook: "rebook",
  registration_confirmed: "event",
  event_feature: "feature",
  ticket_ready: "ticket",
  membership_balance: "membership",
  account_link: "identity",
  campaign: "campaign",
  support_handoff: "support",
  support_active: "chat",
  staff_today: "staff",
};

const PREVIEW_IMAGE: Partial<Record<PreviewKind, string>> = {
  story: "/showcase/forme-pilates-detail-v2.webp",
  feature: "/showcase/openroom-course-hero-v2.webp",
  campaign: "/showcase/elan-skincare-detail-v2.webp",
};

interface LineTemplateGalleryProps {
  clinicName: string;
  initialDesigns: unknown;
  initialTemplateKey?: string;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

const DEFAULT_STYLE: Partial<Record<LineFlexTemplateKey, LineFlexStyleKey>> = {
  welcome: "signature", service_hub: "action_grid", brand_story: "editorial",
  booking_service_select: "action_grid", booking_date_select: "minimal", booking_confirmed: "signature",
  payment_pending: "timeline", appointment_reminder: "timeline", appointment_changed: "timeline",
  waitlist_joined: "timeline", waitlist_offer: "timeline", quick_rebook: "soft_panel",
  registration_confirmed: "ticket", event_feature: "poster", ticket_ready: "ticket",
  membership_balance: "member_pass", account_link: "concierge", campaign: "editorial",
  support_handoff: "timeline", support_active: "soft_panel", staff_today: "minimal",
};

function createDesign(template: LineUiTemplateDefinition, primary: string | null, marker: string | null): LineFlexDesignConfig {
  return {
    templateKey: template.key as LineFlexTemplateKey,
    styleKey: DEFAULT_STYLE[template.key as LineFlexTemplateKey] ?? "signature",
    name: `${template.title}－品牌版本`,
    badge: template.badge,
    title: template.headline,
    body: template.body,
    imageUrl: PREVIEW_IMAGE[PREVIEW_KIND[template.key]] ?? "",
    accent: primary && /^#[0-9A-Fa-f]{6}$/.test(primary) ? primary : template.accent,
    markerColor: marker && /^#[0-9A-Fa-f]{6}$/.test(marker) ? marker : "#D8B26A",
    showImage: ["brand_story", "event_feature", "campaign"].includes(template.key),
    showDetails: true,
    detailLabels: template.details.map(([label]) => label),
    primaryActionLabel: template.primaryAction,
    secondaryActionLabel: template.secondaryAction ?? "",
  };
}

export default function LineTemplateGallery({ clinicName, initialDesigns, initialTemplateKey, brandPrimaryColor, brandAccentColor }: LineTemplateGalleryProps) {
  const [category, setCategory] = useState<"all" | LineUiCategory>("all");
  const savedDesigns = useMemo(() => parseLineFlexDesignSettings(initialDesigns), [initialDesigns]);
  const firstTemplateKey = isLineFlexTemplateKey(initialTemplateKey) ? initialTemplateKey : "welcome";
  const initialTemplate = LINE_UI_TEMPLATES.find((item) => item.key === firstTemplateKey) ?? LINE_UI_TEMPLATES[0];
  const [selectedKey, setSelectedKey] = useState<LineFlexTemplateKey>(firstTemplateKey);
  const [design, setDesign] = useState<LineFlexDesignConfig>(() => savedDesigns[firstTemplateKey]?.draft ?? createDesign(initialTemplate, brandPrimaryColor, brandAccentColor));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const templates = category === "all" ? LINE_UI_TEMPLATES : LINE_UI_TEMPLATES.filter((template) => template.category === category);
  const selectedTemplate = LINE_UI_TEMPLATES.find((item) => item.key === selectedKey) ?? initialTemplate;

  function selectTemplate(template: LineUiTemplateDefinition) {
    if (!isLineFlexTemplateKey(template.key)) return;
    setSelectedKey(template.key);
    setDesign(savedDesigns[template.key]?.draft ?? createDesign(template, brandPrimaryColor, brandAccentColor));
    requestAnimationFrame(() => document.getElementById("line-flex-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function update<K extends keyof LineFlexDesignConfig>(key: K, value: LineFlexDesignConfig[K]) {
    setDesign((current) => ({ ...current, [key]: value }));
  }

  function applyStyle(styleKey: LineFlexStyleKey) {
    update("styleKey", styleKey);
    if (["editorial", "poster"].includes(styleKey)) update("showImage", true);
  }

  function applyWelcomePreset(presetKey: string) {
    const preset = LINE_FLEX_WELCOME_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    setDesign((current) => ({ ...current, ...preset.design, name: `${preset.name}－品牌版本` }));
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const result = await response.json() as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "圖片上傳失敗");
      setDesign((current) => ({ ...current, imageUrl: result.url ?? "", showImage: true }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="line-template-workbench" aria-label="LINE 訊息範本清單">
      <FlexDesignEditor
        clinicName={clinicName}
        template={selectedTemplate}
        design={design}
        publishedVersion={savedDesigns[selectedKey]?.version}
        onUpdate={update}
        onApplyStyle={applyStyle}
        onApplyWelcomePreset={applyWelcomePreset}
        onUploadImage={uploadImage}
        uploading={uploading}
        uploadError={uploadError}
      />
      <div className="platform-command-tabs overflow-x-auto" role="tablist" aria-label="LINE UI 模板分類">
        {LINE_UI_CATEGORIES.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={category === item.key} onClick={() => setCategory(item.key)} className="platform-command-tab shrink-0" data-selected={category === item.key}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="line-template-list">
        {templates.map((template) => (
          <article key={template.key} className="line-panel overflow-hidden p-0">
            <div className="line-template-row">
              <div className="line-template-meta">
                <div className="flex flex-wrap items-center gap-2"><span className="badge bg-slate-100 text-slate-600">{template.trigger}</span><span className={`badge ${template.systemManaged ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{template.systemManaged ? "系統依狀態傳送" : "圖片與文字皆可編輯"}</span></div>
                <h2 className="mt-3 text-lg font-bold text-slate-950">{template.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{template.body}</p>
                <dl className="line-template-details">
                  <div><dt>顧客會看到</dt><dd>{template.badge} · {template.headline}</dd></div>
                  <div><dt>主要動作</dt><dd>{template.primaryAction}</dd></div>
                  {template.secondaryAction && <div><dt>次要動作</dt><dd>{template.secondaryAction}</dd></div>}
                  <div><dt>版面邏輯</dt><dd>{layoutDescription(PREVIEW_KIND[template.key] ?? "appointment")}</dd></div>
                  <div><dt>資料來源</dt><dd>{template.systemManaged ? "系統依顧客與即時狀態帶入" : "品牌自行上傳圖片並編輯圖文"}</dd></div>
                </dl>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <button type="button" className="btn btn-primary min-h-11" onClick={() => selectTemplate(template)}>套用並編輯</button>
                  {savedDesigns[template.key as LineFlexTemplateKey]?.published && <span className="line-flex-published-state">已發布 v{savedDesigns[template.key as LineFlexTemplateKey]?.version ?? 1}</span>}
                  {!template.systemManaged && <Link href="/admin/messages" className="btn btn-secondary min-h-11">另存行銷素材</Link>}
                </div>
              </div>
              <div className="line-message-demo" aria-label={`${template.title} 訊息預覽`}>
                <p className="line-message-demo-label">功能專屬版型・依實際閱讀順序排列</p>
                <TemplatePreview template={template} kind={PREVIEW_KIND[template.key] ?? "appointment"} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FlexDesignEditor({
  clinicName,
  template,
  design,
  publishedVersion,
  onUpdate,
  onApplyStyle,
  onApplyWelcomePreset,
  onUploadImage,
  uploading,
  uploadError,
}: {
  clinicName: string;
  template: LineUiTemplateDefinition;
  design: LineFlexDesignConfig;
  publishedVersion?: number;
  onUpdate: <K extends keyof LineFlexDesignConfig>(key: K, value: LineFlexDesignConfig[K]) => void;
  onApplyStyle: (styleKey: LineFlexStyleKey) => void;
  onApplyWelcomePreset: (presetKey: string) => void;
  onUploadImage: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  uploading: boolean;
  uploadError: string;
}) {
  const previewTemplate: LineUiTemplateDefinition = {
    ...template,
    badge: design.badge || template.badge,
    headline: design.title || template.headline,
    body: design.body || template.body,
    accent: design.accent,
    primaryAction: design.primaryActionLabel || template.primaryAction,
    secondaryAction: design.secondaryActionLabel || undefined,
    details: design.showDetails
      ? template.details.map(([label, value], index) => [design.detailLabels[index] || label, value])
      : [],
  };
  const kind = PREVIEW_KIND[template.key] ?? "appointment";
  return (
    <section id="line-flex-editor" className="line-panel line-flex-studio overflow-hidden p-0" aria-label="品牌 Flex 設計工作區">
      <div className="line-panel-header line-flex-studio-head">
        <div>
          <p className="eyebrow">品牌 Flex 工作區</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">{template.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">範本只是起點；儲存是品牌草稿，發布後才會套用到實際 LINE 訊息。</p>
        </div>
        <div className="line-flex-status-stack">
          <span className="badge bg-slate-100 text-slate-600">目前編輯：{design.name}</span>
          <span className={`badge ${publishedVersion ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{publishedVersion ? `線上版本 v${publishedVersion}` : "尚未發布品牌版本"}</span>
        </div>
      </div>

      {template.key === "welcome" && <div className="line-flex-welcome-presets" aria-label="加入好友歡迎版型">
        <div className="line-flex-library-intro"><strong>加入好友不只一種長相</strong><span>選一個方向帶入後，仍可逐項修改。</span></div>
        <div className="line-flex-welcome-grid">
          {LINE_FLEX_WELCOME_PRESETS.map((preset) => <button key={preset.key} type="button" onClick={() => onApplyWelcomePreset(preset.key)} className="line-flex-preset-card" data-active={design.name.startsWith(preset.name)}>
            <span data-style={preset.design.styleKey}><i /><i /></span>
            <strong>{preset.name}</strong>
            <small>{preset.description}</small>
          </button>)}
        </div>
      </div>}

      <div className="line-flex-studio-grid">
        <form className="line-flex-controls" action={saveLineFlexDesignAction}>
          <input type="hidden" name="template_key" value={design.templateKey} />
          <input type="hidden" name="design" value={JSON.stringify(design)} />

          <fieldset className="line-flex-control-section">
            <legend>版面風格</legend>
            <div className="line-flex-style-grid">
              {LINE_FLEX_STYLE_PRESETS.map((style) => <button key={style.key} type="button" className="line-flex-style-card" data-active={design.styleKey === style.key} onClick={() => onApplyStyle(style.key)}>
                <span style={{ background: `linear-gradient(135deg,${style.swatch[0]} 0 58%,${style.swatch[1]} 58%)` }} />
                <b>{style.name}</b>
                <small>{style.description}</small>
              </button>)}
            </div>
          </fieldset>

          <fieldset className="line-flex-control-section">
            <legend>品牌文字</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm"><span className="label">版本名稱</span><input className="input" value={design.name} maxLength={60} onChange={(event) => onUpdate("name", event.target.value)} /></label>
              <label className="text-sm"><span className="label">小標籤</span><input className="input" value={design.badge} maxLength={30} onChange={(event) => onUpdate("badge", event.target.value)} /></label>
            </div>
            <label className="text-sm"><span className="label">主標題</span><input className="input" value={design.title} maxLength={100} onChange={(event) => onUpdate("title", event.target.value)} /></label>
            <label className="text-sm"><span className="label">說明文字</span><textarea className="input" rows={3} value={design.body} maxLength={300} onChange={(event) => onUpdate("body", event.target.value)} /></label>
          </fieldset>

          <fieldset className="line-flex-control-section">
            <legend>圖片與色彩</legend>
            <label className="text-sm"><span className="label">圖片網址</span><input type="url" className="input" value={design.imageUrl} maxLength={1000} onChange={(event) => onUpdate("imageUrl", event.target.value)} placeholder="https://..." /></label>
            <div className="line-flex-image-row">
              <label className="btn btn-secondary min-h-11 cursor-pointer">{uploading ? "上傳中…" : "從電腦上傳圖片"}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => void onUploadImage(event)} /></label>
              <span>建議 1200 × 780 像素（約 1.54:1），主體放中央；單張上限 5 MB。</span>
            </div>
            {uploadError && <p className="text-xs text-red-700" role="alert">{uploadError}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm"><span className="label">主色</span><span className="line-flex-color-field"><input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(design.accent) ? design.accent : "#31584D"} onChange={(event) => onUpdate("accent", event.target.value.toUpperCase())} /><input className="input" value={design.accent} maxLength={7} onChange={(event) => onUpdate("accent", event.target.value)} /></span></label>
              <label className="text-sm"><span className="label">細節強調色</span><span className="line-flex-color-field"><input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(design.markerColor) ? design.markerColor : "#D8B26A"} onChange={(event) => onUpdate("markerColor", event.target.value.toUpperCase())} /><input className="input" value={design.markerColor} maxLength={7} onChange={(event) => onUpdate("markerColor", event.target.value)} /></span></label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleButton checked={design.showImage} label="顯示主視覺圖片" onChange={(value) => onUpdate("showImage", value)} />
              <ToggleButton checked={design.showDetails} label="顯示資訊列" onChange={(value) => onUpdate("showDetails", value)} />
            </div>
          </fieldset>

          <fieldset className="line-flex-control-section">
            <legend>資訊列與按鈕</legend>
            {design.showDetails && <div className="line-flex-detail-labels">
              {template.details.map(([label, value], index) => <label key={`${label}-${index}`} className="text-sm"><span className="label">資訊名稱 {index + 1}<small>範例：{value}</small></span><input className="input" value={design.detailLabels[index] ?? label} maxLength={30} onChange={(event) => onUpdate("detailLabels", design.detailLabels.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}
            </div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm"><span className="label">主要按鈕文字</span><input className="input" value={design.primaryActionLabel} maxLength={40} onChange={(event) => onUpdate("primaryActionLabel", event.target.value)} /></label>
              <label className="text-sm"><span className="label">次要按鈕文字</span><input className="input" value={design.secondaryActionLabel} maxLength={40} onChange={(event) => onUpdate("secondaryActionLabel", event.target.value)} placeholder="留空不顯示" /></label>
            </div>
            <p className="text-xs leading-5 text-slate-500">按鈕文字可以改；系統通知的實際動作仍鎖定在正確流程，避免品牌誤設連結造成付款、票券或會員功能失效。</p>
          </fieldset>

          <div className="line-flex-savebar">
            <button type="submit" className="btn btn-secondary min-h-11">儲存品牌草稿</button>
            <button type="submit" formAction={publishLineFlexDesignAction} className="btn btn-primary min-h-11">發布到實際 LINE</button>
          </div>
        </form>

        <aside className="line-flex-preview-column">
          <div className="line-flex-preview-head"><div><span className="line-live-status">輸入即時更新</span><strong>{clinicName}</strong></div><small>LINE 實際閱讀比例預覽</small></div>
          <div className="line-flex-phone-canvas" data-flex-style={design.styleKey}>
            <TemplatePreview template={previewTemplate} kind={kind} imageUrl={design.showImage ? design.imageUrl : ""} />
          </div>
          <p className="line-flex-preview-note">動態日期、金額、服務與顧客資料會由系統帶入；此處編輯品牌外觀、文案與欄位名稱。</p>
        </aside>
      </div>
    </section>
  );
}

function ToggleButton({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className="line-preview-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function layoutDescription(kind: PreviewKind): string {
  const descriptions: Record<PreviewKind, string> = {
    welcome: "三入口導覽，不堆疊狀態資料",
    menu: "雙欄任務選單",
    story: "滿版圖片搭配短文",
    selector: "可點選服務清單",
    calendar: "近 30 天月曆與名額圖例",
    appointment: "日期票卡與服務摘要",
    payment: "金額優先的付款單",
    reminder: "行前時間軸與提醒事項",
    change: "新舊時間對照",
    queue: "候補順位牌",
    offer: "保留倒數與確認入口",
    rebook: "上次服務快速帶入",
    event: "電子報名憑證",
    feature: "活動主視覺與報名入口",
    ticket: "可辨識的票券與 QR 區",
    membership: "會員卡與餘額區",
    identity: "會員連結步驟",
    campaign: "主視覺導向的單一行動",
    support: "案件進度與回覆時間",
    chat: "LINE 對話狀態",
    staff: "三項工作指標",
  };
  return descriptions[kind];
}

function TemplatePreview({ template, kind, imageUrl }: { template: LineUiTemplateDefinition; kind: PreviewKind; imageUrl?: string }) {
  const action = <PreviewActions template={template} />;
  const media = imageUrl || PREVIEW_IMAGE[kind];
  if (kind === "calendar") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-message-card-body"><CalendarPreview accent={template.accent} /></div>{action}</PreviewFrame>;
  if (kind === "welcome") return <PreviewFrame kind={kind}>{media && <PreviewMedia src={media} label={template.title}><span>{template.badge}</span><strong>{template.headline}</strong></PreviewMedia>}<div className="line-preview-welcome"><small>{template.badge}</small><h3>{template.headline}</h3><p>{template.body}</p></div><div className="line-preview-entry-grid"><span>品牌介紹</span><span>{template.secondaryAction || "綁定會員"}</span><span className="primary">{template.primaryAction}</span></div></PreviewFrame>;
  if (kind === "menu") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-preview-menu-grid">{["立即預約", "我的預約", "活動／課程", "我的票券", "會員／套票", "LINE 客服"].map((item, index) => <span key={item}><b>0{index + 1}</b>{item}</span>)}</div></PreviewFrame>;
  if (kind === "story" || kind === "feature" || kind === "campaign") return <PreviewFrame kind={kind}><PreviewMedia src={media ?? ""} label={template.title}><span>{template.badge}</span><strong>{template.headline}</strong></PreviewMedia><div className="line-preview-editorial-copy"><p>{template.body}</p><small>圖片・標題・內文・按鈕皆可修改</small></div>{action}</PreviewFrame>;
  if (kind === "selector") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-preview-option-list">{["初次體驗", "一對一服務", "小班／團體課"].map((item, index) => <span key={item}><b>{item}</b><small>{index === 2 ? "尚有 4 個時段" : "可選日期與時間"}</small><i>→</i></span>)}</div><div className="line-preview-quiet-link">查看全部服務</div></PreviewFrame>;
  if (kind === "appointment") return <PreviewFrame kind={kind}><div className="line-preview-appointment-head"><div><b>18</b><span>八月・週二</span></div><p><small>{template.badge}</small><strong>14:30</strong></p></div><PreviewDetails details={template.details.slice(1)} />{action}</PreviewFrame>;
  if (kind === "payment") return <PreviewFrame kind={kind}><div className="line-preview-payment-head"><span>{template.badge}</span><strong>NT$ 500</strong><small>完成後才正式保留名額</small></div><div className="line-preview-payment-progress"><i /><span>資料已建立</span><i /><span>等待付款</span><i className="muted" /><span>預約確認</span></div>{action}</PreviewFrame>;
  if (kind === "reminder") return <PreviewFrame kind={kind}><div className="line-preview-reminder"><div><small>AUG</small><b>18</b><span>週二</span></div><section><small>{template.badge}</small><h3>{template.headline}</h3><strong>14:30・體驗諮詢</strong></section></div><ul className="line-preview-checklist"><li>請提早 10 分鐘抵達</li><li>無法前往請先改期或取消</li></ul>{action}</PreviewFrame>;
  if (kind === "change") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-preview-change"><div><small>原預約</small><del>08/18（二）14:30</del></div><b>↓</b><div className="current"><small>最新時間</small><strong>08/20（四）16:00</strong></div></div>{action}</PreviewFrame>;
  if (kind === "queue") return <PreviewFrame kind={kind}><div className="line-preview-queue"><span>目前順位</span><strong>02</strong><small>名額釋出會自動通知</small></div><div className="line-preview-target"><span>候補服務</span><b>{template.details[0]?.[1]}</b></div>{action}</PreviewFrame>;
  if (kind === "offer") return <PreviewFrame kind={kind}><div className="line-preview-offer"><span>{template.badge}</span><h3>{template.headline}</h3><div><small>保留至</small><strong>今天 18:30</strong></div></div><p className="line-preview-compact-copy">請在期限前確認，逾時將依序提供給下一位。</p>{action}</PreviewFrame>;
  if (kind === "rebook") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-preview-rebook"><span>上次服務</span><strong>{template.details[0]?.[1]}</strong><div><small>王老師</small><small>只需選日期時間</small></div></div>{action}</PreviewFrame>;
  if (kind === "event") return <PreviewFrame kind={kind}><div className="line-preview-event-ticket"><small>{template.badge}</small><h3>{template.details[0]?.[1]}</h3><strong>{template.details[1]?.[1]}</strong><span>REG-20260829-001</span></div><div className="line-preview-ticket-cut" />{action}</PreviewFrame>;
  if (kind === "ticket") return <PreviewFrame kind={kind}><div className="line-preview-ticket"><section><small>{template.badge}</small><h3>{template.headline}</h3><strong>一般票 × 2</strong><span>報到時開啟動態 QR</span></section><div className="line-preview-qr" aria-label="QR 圖示預覽"><i /><i /><i /><i /></div></div>{action}</PreviewFrame>;
  if (kind === "membership") return <PreviewFrame kind={kind}><div className="line-preview-member-pass"><small>MEMBER PASS</small><h3>安心體驗套票</h3><div><p><span>剩餘</span><strong>4</strong><em>堂</em></p><p><span>有效至</span><b>2026/12/31</b></p></div></div>{action}</PreviewFrame>;
  if (kind === "identity") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-preview-identity"><span><b>1</b><em>確認目前 LINE 帳號</em></span><i /><span><b>2</b><em>建立品牌會員連結</em></span></div>{action}</PreviewFrame>;
  if (kind === "support") return <PreviewFrame kind={kind}><div className="line-preview-case"><span>客服案件</span><b>等待接手</b><small>預計 1 個工作日內回覆</small></div><div className="line-preview-support-line"><i /><span>訊息已保留</span><i /><span>品牌客服接手</span></div>{action}</PreviewFrame>;
  if (kind === "chat") return <PreviewFrame kind={kind}><div className="line-preview-chat"><span>客服已連線</span><p>請直接輸入你的問題，我們會在同一段 LINE 對話回覆。</p><div>輸入訊息…</div></div>{action}</PreviewFrame>;
  if (kind === "staff") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-preview-staff-metrics">{template.details.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>{action}</PreviewFrame>;
  return <PreviewFrame kind={kind}><CompactHeader template={template} /><PreviewDetails details={template.details} />{action}</PreviewFrame>;
}

function PreviewFrame({ kind, children }: { kind: PreviewKind; children: ReactNode }) {
  return <div className="line-message-card line-functional-preview" data-layout={kind}>{children}</div>;
}

function CompactHeader({ template }: { template: LineUiTemplateDefinition }) {
  return <div className="line-preview-compact-head" style={{ borderTopColor: template.accent }}><div><span>品牌官方帳號</span><b style={{ color: template.accent }}>{template.badge}</b></div><h3>{template.headline}</h3><p>{template.body}</p></div>;
}

function PreviewDetails({ details }: { details: Array<[string, string]> }) {
  return <dl className="line-preview-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function PreviewActions({ template }: { template: LineUiTemplateDefinition }) {
  return <div className="line-message-card-actions"><span style={{ backgroundColor: template.accent, borderColor: template.accent }}>{template.primaryAction}</span>{template.secondaryAction && <span className="secondary">{template.secondaryAction}</span>}</div>;
}

function PreviewMedia({ src, label, children }: { src: string; label: string; children: ReactNode }) {
  return <div className="line-preview-media" role="img" aria-label={`${label}圖片預覽`} style={{ backgroundImage: `linear-gradient(180deg,rgba(9,18,15,.06),rgba(9,18,15,.72)),url(${src})` }}><div>{children}</div></div>;
}

function CalendarPreview({ accent }: { accent: string }) {
  const days = [
    { date: "", state: "空白" }, { date: "", state: "空白" }, { date: "", state: "空白" },
    { date: "9/10", state: "尚可預約" }, { date: "9/11", state: "尚可預約" }, { date: "9/12", state: "即將額滿" }, { date: "9/13", state: "額滿" },
    { date: "9/14", state: "尚可預約" }, { date: "9/15", state: "尚可預約" }, { date: "9/16", state: "額滿" }, { date: "9/17", state: "尚可預約" },
    { date: "9/18", state: "即將額滿" }, { date: "9/19", state: "尚可預約" }, { date: "9/20", state: "額滿" }, { date: "9/21", state: "尚可預約" },
    { date: "9/22", state: "尚可預約" }, { date: "9/23", state: "額滿" }, { date: "9/24", state: "尚可預約" }, { date: "9/25", state: "即將額滿" },
    { date: "9/26", state: "尚可預約" }, { date: "9/27", state: "尚可預約" }, { date: "9/28", state: "額滿" }, { date: "9/29", state: "尚可預約" },
    { date: "9/30", state: "即將額滿" }, { date: "10/1", state: "尚可預約" }, { date: "10/2", state: "尚可預約" }, { date: "10/3", state: "額滿" },
    { date: "10/4", state: "尚可預約" }, { date: "10/5", state: "即將額滿" }, { date: "10/6", state: "尚可預約" }, { date: "10/7", state: "額滿" },
    { date: "10/8", state: "尚可預約" }, { date: "10/9", state: "尚可預約" },
  ];
  return <div className="line-calendar-preview">
    <strong>近 30 天・2026/09/10–10/09</strong>
    <div className="line-calendar-legend"><span data-state="尚可預約">尚可預約 17</span><span data-state="即將額滿">即將額滿 6</span><span data-state="額滿">額滿 7</span></div>
    <div className="line-calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="line-calendar-days">{days.map((day, index) => <span key={`${day.date}-${index}`} data-state={day.state} style={day.state === "尚可預約" ? { borderColor: accent } : undefined}><b>{day.date}</b>{day.state !== "空白" && <em>{day.state}</em>}</span>)}</div>
  </div>;
}
