"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LINE_UI_CATEGORIES, LINE_UI_TEMPLATES, type LineUiCategory, type LineUiTemplateDefinition } from "@/lib/line-ui-templates";

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

export default function LineTemplateGallery() {
  const [category, setCategory] = useState<"all" | LineUiCategory>("all");
  const templates = category === "all" ? LINE_UI_TEMPLATES : LINE_UI_TEMPLATES.filter((template) => template.category === category);
  return (
    <section className="line-template-workbench" aria-label="LINE 訊息範本清單">
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
                {!template.systemManaged && <Link href="/admin/messages" className="btn btn-secondary mt-4 min-h-11">開啟圖文訊息編輯器</Link>}
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

function TemplatePreview({ template, kind }: { template: LineUiTemplateDefinition; kind: PreviewKind }) {
  const action = <PreviewActions template={template} />;
  const media = PREVIEW_IMAGE[kind];
  if (kind === "calendar") return <PreviewFrame kind={kind}><CompactHeader template={template} /><div className="line-message-card-body"><CalendarPreview accent={template.accent} /></div>{action}</PreviewFrame>;
  if (kind === "welcome") return <PreviewFrame kind={kind}><div className="line-preview-welcome"><small>{template.badge}</small><h3>{template.headline}</h3><p>{template.body}</p></div><div className="line-preview-entry-grid"><span>品牌介紹</span><span>綁定會員</span><span className="primary">立即預約</span></div></PreviewFrame>;
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
