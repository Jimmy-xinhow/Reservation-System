"use client";

import { useState } from "react";
import { LAYOUTS, ACTION_OPTIONS, type Layout, type Slot } from "@/lib/richmenu";

type ServerAction = (fd: FormData) => Promise<void>;

export default function RichMenuEditor({
  initialLayout,
  initialChatBar,
  initialSlots,
  saveAction,
}: {
  initialLayout: Layout;
  initialChatBar: string;
  initialSlots: Slot[];
  saveAction: ServerAction;
}) {
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const spec = LAYOUTS[layout];
  const [slots, setSlots] = useState<Slot[]>(() => normalize(initialSlots, spec.slots));

  function changeLayout(l: Layout) {
    setLayout(l);
    setSlots((prev) => normalize(prev, LAYOUTS[l].slots));
  }
  function setSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <form action={saveAction} className="card space-y-4 p-5">
      <h2 className="font-semibold text-slate-900">選單版型與按鈕</h2>

      <input type="hidden" name="layout" value={layout} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">版型</span>
          <select value={layout} onChange={(e) => changeLayout(e.target.value as Layout)} className="input">
            {(Object.keys(LAYOUTS) as Layout[]).map((k) => (
              <option key={k} value={k}>
                {LAYOUTS[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">選單列文字(聊天室下方)</span>
          <input name="chat_bar_text" defaultValue={initialChatBar} className="input" />
        </label>
      </div>

      {/* 尺寸標示 */}
      <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
        圖片尺寸需為 <strong>{spec.width} × {spec.height} px</strong>(
        {spec.cols}×{spec.rows} 格,共 {spec.slots} 個按鈕);格式 JPG/PNG,檔案 &lt; 1MB。
      </div>

      {/* 版面示意 */}
      <div
        className="grid gap-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1"
        style={{
          gridTemplateColumns: `repeat(${spec.cols}, 1fr)`,
          aspectRatio: `${spec.width} / ${spec.height}`,
        }}
      >
        {slots.map((s, i) => (
          <div key={i} className="flex items-center justify-center rounded bg-white text-center text-xs text-slate-500">
            {i + 1}. {s.label}
          </div>
        ))}
      </div>

      {/* 各格設定 */}
      <div className="space-y-3">
        {slots.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">按鈕 {i + 1}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">顯示文字</span>
                <input
                  name={`label_${i}`}
                  value={s.label}
                  onChange={(e) => setSlot(i, { label: e.target.value })}
                  className="input"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">動作</span>
                <select
                  name={`action_${i}`}
                  value={s.action}
                  onChange={(e) => setSlot(i, { action: e.target.value as Slot["action"] })}
                  className="input"
                >
                  {ACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">
                  {s.action === "uri" ? "連結網址" : s.action === "text" ? "送出的文字" : "(此動作免填)"}
                </span>
                <input
                  name={`value_${i}`}
                  value={s.value ?? ""}
                  onChange={(e) => setSlot(i, { value: e.target.value })}
                  disabled={s.action !== "uri" && s.action !== "text"}
                  placeholder={s.action === "uri" ? "https://..." : ""}
                  className="input disabled:bg-slate-50"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn-primary">儲存選單設定</button>
    </form>
  );
}

function normalize(slots: Slot[], count: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    out.push(slots[i] ?? { label: `按鈕${i + 1}`, action: "none" });
  }
  return out;
}
