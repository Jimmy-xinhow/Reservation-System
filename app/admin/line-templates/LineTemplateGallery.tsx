"use client";

import Link from "next/link";
import { useState } from "react";
import { LINE_UI_CATEGORIES, LINE_UI_TEMPLATES, type LineUiCategory } from "@/lib/line-ui-templates";

export default function LineTemplateGallery() {
  const [category, setCategory] = useState<"all" | LineUiCategory>("all");
  const templates = category === "all" ? LINE_UI_TEMPLATES : LINE_UI_TEMPLATES.filter((template) => template.category === category);
  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="LINE UI 模板分類">
        {LINE_UI_CATEGORIES.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={category === item.key} onClick={() => setCategory(item.key)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition ${category === item.key ? "bg-[#173F48] text-white" : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {templates.map((template) => (
          <article key={template.key} className="card overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(15rem,.82fr)_minmax(0,1.18fr)]">
              <div className="bg-[#E8E4DC] p-4 sm:p-6">
                <div className="mx-auto max-w-[19rem] overflow-hidden rounded-[2rem] border-[6px] border-[#1B2F35] bg-[#8FB5A8] shadow-[0_18px_50px_rgba(23,63,72,.22)]">
                  <div className="flex h-12 items-center justify-between bg-[#173F48] px-4 text-xs font-bold text-white"><span>‹</span><span>品牌官方帳號</span><span>⋮</span></div>
                  <div className="min-h-[30rem] space-y-3 bg-[#8FB5A8] p-3">
                    <p className="text-center text-[10px] font-medium text-white/80">今天</p>
                    <div className="ml-auto max-w-[75%] rounded-2xl rounded-tr-sm bg-[#9FE870] px-3 py-2 text-xs leading-5 text-[#173F48]">我想查看服務內容</div>
                    <div className="max-w-[94%] overflow-hidden rounded-2xl rounded-tl-sm bg-white shadow-sm">
                      <div className="px-4 py-4 text-white" style={{ backgroundColor: template.accent }}><p className="text-[10px] font-bold tracking-[.18em] text-white/75">{template.badge}</p><p className="mt-2 text-lg font-extrabold leading-6">{template.headline}</p></div>
                      <div className="p-4"><p className="text-xs leading-5 text-slate-500">{template.body}</p><div className="my-3 h-px bg-slate-100" />{template.details.map(([label, value]) => <div key={label} className="flex gap-2 py-1 text-xs"><span className="w-16 shrink-0 text-slate-400">{label}</span><span className="font-semibold text-[#173F48]">{value}</span></div>)}</div>
                      <div className="border-t border-slate-100 p-3"><div className="flex min-h-11 items-center justify-center rounded-lg bg-[#173F48] px-3 text-center text-xs font-bold text-white">{template.primaryAction}</div>{template.secondaryAction && <div className="mt-2 flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-center text-xs font-bold text-[#173F48]">{template.secondaryAction}</div>}</div>
                    </div>
                  </div>
                  <div className="flex h-12 items-center gap-2 bg-white px-3"><span className="text-slate-400">＋</span><span className="h-8 flex-1 rounded-full bg-slate-100" /><span className="text-slate-400">☺</span></div>
                </div>
              </div>
              <div className="flex flex-col p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2"><span className="badge bg-slate-100 text-slate-600">{template.trigger}</span><span className={`badge ${template.systemManaged ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{template.systemManaged ? "系統自動套用" : "可編輯行銷素材"}</span></div>
                <h2 className="mt-4 text-lg font-bold text-slate-900">{template.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{template.body}</p>
                <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-[.15em] text-slate-400">顧客下一步</p><p className="mt-2 text-sm font-semibold text-[#173F48]">{template.primaryAction}{template.secondaryAction ? `／${template.secondaryAction}` : ""}</p></div>
                <div className="mt-auto pt-5">{template.systemManaged ? <p className="text-xs leading-5 text-slate-400">由預約、候補、報名或會員狀態自動帶入真實資料，不需要員工逐則製作。</p> : <Link href="/admin/messages" className="btn btn-primary min-h-11 w-full">建立可編輯行銷訊息</Link>}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
