"use client";

import { useState } from "react";
import { LAYOUTS, ACTION_OPTIONS, type Layout, type Slot } from "@/lib/richmenu";

type ServerAction = (fd: FormData) => Promise<void>;

export default function RichMenuEditor({
  initialLayout,
  initialChatBar,
  initialSlots,
  messages,
  saveAction,
}: {
  initialLayout: Layout;
  initialChatBar: string;
  initialSlots: Slot[];
  messages: { id: string; name: string }[];
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
    <form action={saveAction} className="card space-y-6 p-5">
      <input type="hidden" name="layout" value={layout} />

      {/* ① 基本設定 */}
      <section className="space-y-2">
        <h3 className="font-semibold text-slate-900">① 基本設定</h3>
        <label className="block text-sm sm:max-w-xs">
          <span className="mb-1 block font-medium text-slate-600">選單列文字(聊天室下方那條)</span>
          <input name="chat_bar_text" defaultValue={initialChatBar} className="input" />
        </label>
      </section>

      {/* ② 版型 */}
      <section className="space-y-2">
        <h3 className="font-semibold text-slate-900">② 版型</h3>
        <label className="block text-sm sm:max-w-xs">
          <span className="mb-1 block font-medium text-slate-600">選擇格數</span>
          <select value={layout} onChange={(e) => changeLayout(e.target.value as Layout)} className="input">
            {(Object.keys(LAYOUTS) as Layout[]).map((k) => (
              <option key={k} value={k}>
                {LAYOUTS[k].label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
          背景圖片尺寸需為 <strong>{spec.width} × {spec.height} px</strong>(共 {spec.slots} 格)。上傳時系統會自動裁成此尺寸。
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
            <div key={i} className="flex items-center justify-center rounded bg-white px-1 text-center text-xs text-slate-500">
              {i + 1}. {ACTION_OPTIONS.find((o) => o.value === s.action)?.label ?? "(未設定)"}
            </div>
          ))}
        </div>
      </section>

      {/* ③ 每格動作 */}
      <section className="space-y-3">
        <h3 className="font-semibold text-slate-900">③ 每格動作</h3>
        <p className="text-sm text-slate-400">設定病患點每一格時要做什麼(格號對應上方示意圖)。</p>
        {slots.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">
              第 {i + 1} 格
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  {s.action === "uri" ? "連結網址" : s.action === "message" ? "選擇訊息素材" : "(此動作免填)"}
                </span>
                {s.action === "message" ? (
                  <>
                    <select
                      name={`value_${i}`}
                      value={s.value ?? ""}
                      onChange={(e) => setSlot(i, { value: e.target.value })}
                      className="input"
                    >
                      <option value="">請選擇</option>
                      {messages.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    {messages.length === 0 && (
                      <span className="mt-1 block text-xs text-amber-600">
                        尚無訊息素材,請先到「訊息素材」建立。
                      </span>
                    )}
                  </>
                ) : (
                  <input
                    name={`value_${i}`}
                    value={s.value ?? ""}
                    onChange={(e) => setSlot(i, { value: e.target.value })}
                    disabled={s.action !== "uri"}
                    placeholder={s.action === "uri" ? "https://..." : ""}
                    className="input disabled:bg-slate-50"
                  />
                )}
              </label>
            </div>
          </div>
        ))}
      </section>

      <button className="btn btn-primary">儲存選單設定</button>
    </form>
  );
}

function normalize(slots: Slot[], count: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    out.push(slots[i] ?? { label: "", action: "none" });
  }
  return out;
}
