"use client";

import Link from "next/link";
import { useState } from "react";
import { LINE_UI_CATEGORIES, LINE_UI_TEMPLATES, type LineUiCategory } from "@/lib/line-ui-templates";

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
                <div className="flex flex-wrap items-center gap-2"><span className="badge bg-slate-100 text-slate-600">{template.trigger}</span><span className={`badge ${template.systemManaged ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{template.systemManaged ? "系統自動傳送" : "品牌可編輯"}</span></div>
                <h2 className="mt-3 text-lg font-bold text-slate-950">{template.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{template.body}</p>
                <dl className="line-template-details">
                  <div><dt>顧客會看到</dt><dd>{template.badge} · {template.headline}</dd></div>
                  <div><dt>主要動作</dt><dd>{template.primaryAction}</dd></div>
                  {template.secondaryAction && <div><dt>次要動作</dt><dd>{template.secondaryAction}</dd></div>}
                  <div><dt>資料來源</dt><dd>{template.systemManaged ? "系統依真實狀態帶入，不需人工製作" : "品牌可在行銷訊息中編輯內容"}</dd></div>
                </dl>
                {!template.systemManaged && <Link href="/admin/messages" className="btn btn-secondary mt-4 min-h-10">前往編輯行銷訊息</Link>}
              </div>
              <div className="line-message-demo" aria-label={`${template.title} 訊息預覽`}>
                <p className="line-message-demo-label">顧客實際閱讀順序</p>
                <div className="line-message-card">
                  <div className="line-message-card-status" style={{ backgroundColor: template.accent }}>
                    <span className="line-message-card-mark" />
                    <div className="line-message-card-head"><span>品牌官方帳號</span><b>{template.badge}</b></div>
                    <h3>{template.headline}</h3>
                    <p>{template.body}</p>
                  </div>
                  <div className="line-message-card-body">
                    {template.details[0] && <div className="line-message-card-highlight" style={{ backgroundColor: `${template.accent}12`, borderLeftColor: template.accent }}><span>{template.details[0][0]}</span><strong>{template.details[0][1]}</strong></div>}
                    <dl>{template.details.slice(1).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                  </div>
                  <div className="line-message-card-actions">
                    <span>{template.primaryAction}</span>
                    {template.secondaryAction && <span className="secondary">{template.secondaryAction}</span>}
                  </div>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
