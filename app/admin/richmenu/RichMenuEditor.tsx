"use client";

import { useState } from "react";
import { LAYOUTS, ACTION_OPTIONS, RICH_MENU_TEMPLATES, richMenuTemplate, type Layout, type RichMenuModuleAvailability, type RichMenuTemplateKey, type Slot } from "@/lib/richmenu";
import { SubmitButton } from "@/components/SubmitButton";

type ServerAction = (fd: FormData) => Promise<void>;

export default function RichMenuEditor({
  initialLayout,
  initialChatBar,
  initialSlots,
  initialName,
  initialTemplate,
  availability,
  messages,
  aliases,
  saveAction,
}: {
  initialLayout: Layout;
  initialChatBar: string;
  initialSlots: Slot[];
  initialName: string;
  initialTemplate: RichMenuTemplateKey;
  availability: RichMenuModuleAvailability;
  messages: { id: string; name: string }[];
  aliases: { alias_id: string; label: string }[];
  saveAction: ServerAction;
}) {
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const [template, setTemplate] = useState<RichMenuTemplateKey>(initialTemplate);
  const [name, setName] = useState(initialName);
  const [chatBar, setChatBar] = useState(initialChatBar);
  const spec = LAYOUTS[layout];
  const [slots, setSlots] = useState<Slot[]>(() => normalize(initialSlots, spec.slots));

  function changeLayout(l: Layout) {
    setTemplate("custom");
    setLayout(l);
    setSlots((prev) => normalize(prev, LAYOUTS[l].slots));
  }
  function applyTemplate(key: RichMenuTemplateKey) {
    setTemplate(key);
    if (key === "custom") return;
    const next = richMenuTemplate(key, availability);
    setLayout(next.layout);
    setSlots(normalize(next.slots, LAYOUTS[next.layout].slots));
  }
  function setSlot(i: number, patch: Partial<Slot>) {
    setTemplate("custom");
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <form action={saveAction} className="admin-section">
      <input type="hidden" name="layout" value={layout} />
      <input type="hidden" name="template_key" value={template} />
      <div className="admin-section-header">
        <div><h2 className="font-semibold text-slate-900">編輯草稿內容</h2><p className="mt-0.5 text-xs text-slate-500">依序完成基本資料、版型與每一格動作，儲存後才會進入發布步驟。</p></div>
        <span className="badge bg-slate-100 text-slate-600">尚未影響線上版本</span>
      </div>
      <div className="richmenu-live-editor-grid">
      <div className="space-y-6 p-4 sm:p-5">

      {/* ① 基本設定 */}
      <section className="space-y-2">
        <h3 className="font-semibold text-slate-900">步驟 1　基本設定</h3>
        <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">草稿名稱</span>
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} className="input" maxLength={120} required />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">聊天室下方的選單名稱</span>
          <input name="chat_bar_text" value={chatBar} onChange={(event) => setChatBar(event.target.value)} className="input" maxLength={14} required />
        </label>
        <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">快速模板</span><select value={template} onChange={(event) => applyTemplate(event.target.value as RichMenuTemplateKey)} className="input"><option value="custom">自訂</option>{Object.entries(RICH_MENU_TEMPLATES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        </div>
      </section>

      {/* ② 版型 */}
      <section className="space-y-3 border-t border-slate-200 pt-5">
        <h3 className="font-semibold text-slate-900">步驟 2　選擇版型</h3>
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
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">
          背景圖片尺寸需為 <strong>{spec.width} × {spec.height} 像素</strong>，共 {spec.slots} 格。上傳時系統會自動裁成此尺寸。
        </div>
        {/* 實際圖稿與版面示意 */}
        <div
          className="relative isolate grid gap-1 overflow-hidden rounded-sm border border-slate-300 bg-slate-100 p-1"
          style={{
            gridTemplateColumns: `repeat(${spec.cols}, 1fr)`,
            aspectRatio: `${spec.width} / ${spec.height}`,
          }}
        >
          {template !== "custom" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/admin/richmenu-template?template=${encodeURIComponent(template)}`} alt={`${RICH_MENU_TEMPLATES[template].label}實際 PNG 圖稿`} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          )}
          {slots.map((s, i) => (
            <div key={i} className={`relative z-10 flex items-end justify-center rounded border border-white/80 px-1 pb-2 text-center text-[11px] font-semibold sm:text-xs ${template === "custom" ? "bg-white text-slate-500" : "bg-slate-950/5 text-slate-700"}`}>
              <span className="rounded-sm border border-slate-200 bg-white/90 px-2 py-1">{i + 1}. {ACTION_OPTIONS.find((o) => o.value === s.action)?.label ?? "尚未設定"}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ③ 每格動作 */}
      <section className="space-y-3 border-t border-slate-200 pt-5">
        <h3 className="font-semibold text-slate-900">步驟 3　設定每格動作</h3>
        <p className="text-sm text-slate-500">設定顧客點選每一格後要前往哪裡；格號與上方示意圖一致。</p>
        {slots.map((s, i) => (
          <div key={i} className="border-t border-slate-200 py-3 first:border-t-0">
            <div className="mb-2 text-sm font-medium text-slate-700">
              第 {i + 1} 格
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-sm"><span className="mb-1 block text-slate-500">顯示名稱</span><input name={`label_${i}`} value={s.label ?? ""} onChange={(e) => setSlot(i, { label: e.target.value })} className="input" maxLength={40} required /></label>
              <label className="text-sm"><span className="mb-1 block text-slate-500">無障礙標籤（LINE 上限 20 字）</span><input name={`accessibility_label_${i}`} value={s.accessibilityLabel ?? ""} onChange={(e) => setSlot(i, { accessibilityLabel: e.target.value })} className="input" maxLength={20} required /></label>
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
                  {s.action === "uri" ? "連結網址" : s.action === "message" ? "選擇訊息素材" : s.action === "richmenuswitch" ? "切換到另一個選單" : "(此動作免填)"}
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
                ) : s.action === "richmenuswitch" ? (
                  <>
                    <select
                      name={`value_${i}`}
                      value={s.value ?? ""}
                      onChange={(e) => setSlot(i, { value: e.target.value })}
                      className="input"
                    >
                      <option value="">請選擇頁籤捷徑</option>
                      {aliases.map((alias) => <option key={alias.alias_id} value={alias.alias_id}>{alias.label}（{alias.alias_id}）</option>)}
                    </select>
                    {aliases.length === 0 && <span className="mt-1 block text-xs text-amber-700">請先在下方建立至少一個頁籤捷徑。</span>}
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

      <SubmitButton className="btn btn-primary">儲存為新的草稿版本</SubmitButton>
      </div>
      <aside className="richmenu-live-preview" aria-label="LINE 圖文選單即時預覽">
        <div className="message-composer-preview-head"><strong>LINE 圖文選單即時預覽</strong><span className="line-live-status" role="status">輸入即時更新</span></div>
        <div className="line-preview-canvas">
          <div className="line-phone line-richmenu-phone">
            <div className="line-phone-header"><span className="status-dot bg-[#06c755]" /><strong>品牌官方帳號</strong></div>
            <div className="line-richmenu-chat"><span>圖文選單會固定顯示在聊天室下方</span></div>
            <div
              className="line-richmenu-grid"
              style={{
                gridTemplateColumns: `repeat(${spec.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${spec.rows}, minmax(0, 1fr))`,
                aspectRatio: `${spec.width} / ${spec.height}`,
              }}
            >
              {template !== "custom" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/admin/richmenu-template?template=${encodeURIComponent(template)}`} alt="目前模板預覽" className="absolute inset-0 h-full w-full object-cover" />
              )}
              {slots.map((slot, index) => (
                <div key={`${index}-${slot.label}`} className="line-richmenu-slot">
                  <strong>{slot.label.trim() || `第 ${index + 1} 格`}</strong>
                  <span>{ACTION_OPTIONS.find((option) => option.value === slot.action)?.label ?? "尚未設定"}</span>
                </div>
              ))}
            </div>
            <div className="line-richmenu-chatbar">{chatBar.trim() || "選單"}</div>
          </div>
        </div>
        <dl className="richmenu-live-summary"><div><dt>草稿</dt><dd>{name.trim() || "未命名草稿"}</dd></div><div><dt>版型</dt><dd>{spec.label}</dd></div><div><dt>格數</dt><dd>{spec.slots} 格</dd></div></dl>
        <p className="message-composer-preview-note">模板、格數、顯示名稱、點擊動作與聊天室選單名稱會同步更新；自訂背景圖會在發布步驟疊合預覽。</p>
      </aside>
      </div>
    </form>
  );
}

function normalize(slots: Slot[], count: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const slot = slots[i];
    out.push(slot ? { ...slot, action: slot.action === "query" ? "appointments" : slot.action === "info" ? "brand" : slot.action, accessibilityLabel: slot.accessibilityLabel || slot.label } : { label: "", accessibilityLabel: "", action: "none" });
  }
  return out;
}
