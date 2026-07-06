"use client";

import { useState } from "react";
import { BTN_ACTION_OPTIONS, type MsgKind, type MsgData, type MsgCard, type MsgButton } from "@/lib/lineMessage";

type ServerAction = (fd: FormData) => Promise<void>;

const emptyCard = (): MsgCard => ({ imageUrl: "", title: "", text: "", buttons: [] });

export default function MessageComposer({
  initial,
  saveAction,
}: {
  initial: { id: string; name: string; kind: MsgKind; data: MsgData } | null;
  saveAction: ServerAction;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<MsgKind>(initial?.kind ?? "text");
  const [text, setText] = useState(initial?.data.text ?? "");
  const [card, setCard] = useState<MsgCard>(initial?.data.card ?? emptyCard());
  const [cards, setCards] = useState<MsgCard[]>(
    initial?.data.cards && initial.data.cards.length ? initial.data.cards : [emptyCard()],
  );

  const data: MsgData =
    kind === "text" ? { text } : kind === "card" ? { card } : { cards };

  return (
    <form action={saveAction} className="card space-y-4 p-5">
      <h2 className="font-semibold text-slate-900">{initial ? "編輯訊息" : "新增訊息"}</h2>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="data" value={JSON.stringify(data)} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">訊息名稱(內部辨識)</span>
          <input name="name" required value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">類型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as MsgKind)} className="input">
            <option value="text">文字訊息</option>
            <option value="card">圖文卡(單張)</option>
            <option value="carousel">多頁訊息(輪播)</option>
          </select>
        </label>
      </div>

      {kind === "text" && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">文字內容</span>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} className="input" />
        </label>
      )}

      {kind === "card" && <CardEditor card={card} onChange={setCard} />}

      {kind === "carousel" && (
        <div className="space-y-4">
          {cards.map((c, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">第 {i + 1} 頁</span>
                {cards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCards(cards.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-500 hover:underline"
                  >
                    刪除此頁
                  </button>
                )}
              </div>
              <CardEditor card={c} onChange={(nc) => setCards(cards.map((x, idx) => (idx === i ? nc : x)))} />
            </div>
          ))}
          {cards.length < 10 && (
            <button
              type="button"
              onClick={() => setCards([...cards, emptyCard()])}
              className="btn btn-secondary"
            >
              ＋ 新增一頁
            </button>
          )}
        </div>
      )}

      <button className="btn btn-primary">儲存訊息</button>
    </form>
  );
}

function CardEditor({ card, onChange }: { card: MsgCard; onChange: (c: MsgCard) => void }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      onChange({ ...card, imageUrl: json.url });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  const setBtn = (i: number, patch: Partial<MsgButton>) =>
    onChange({ ...card, buttons: card.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-600">圖片</span>
        {card.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt="" className="mb-2 h-28 w-full rounded-lg object-cover" />
        )}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white"
        />
        {uploading && <p className="mt-1 text-xs text-slate-400">上傳中…</p>}
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">標題</span>
        <input value={card.title ?? ""} onChange={(e) => onChange({ ...card, title: e.target.value })} className="input" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">內文</span>
        <textarea rows={2} value={card.text ?? ""} onChange={(e) => onChange({ ...card, text: e.target.value })} className="input" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">
          整張卡片點擊開啟(選填網址)
        </span>
        <input
          value={card.linkUrl ?? ""}
          onChange={(e) => onChange({ ...card, linkUrl: e.target.value })}
          placeholder="https://…(設了之後點卡片圖片/內文就會開此頁)"
          className="input"
        />
      </label>

      <div className="space-y-2">
        <span className="text-sm font-medium text-slate-600">按鈕</span>
        {card.buttons.map((b, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input
              placeholder="按鈕文字"
              value={b.label}
              onChange={(e) => setBtn(i, { label: e.target.value })}
              className="input"
            />
            <select value={b.action} onChange={(e) => setBtn(i, { action: e.target.value as MsgButton["action"] })} className="input">
              {BTN_ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              placeholder={b.action === "uri" ? "https://..." : b.action === "text" ? "送出文字" : "(免填)"}
              value={b.value ?? ""}
              disabled={b.action !== "uri" && b.action !== "text"}
              onChange={(e) => setBtn(i, { value: e.target.value })}
              className="input disabled:bg-slate-100"
            />
            <button
              type="button"
              onClick={() => onChange({ ...card, buttons: card.buttons.filter((_, idx) => idx !== i) })}
              className="text-xs text-red-500 hover:underline"
            >
              移除
            </button>
            {(() => {
              const noLabel = !b.label.trim();
              const noValue = (b.action === "uri" || b.action === "text") && !(b.value ?? "").trim();
              return noLabel || noValue ? (
                <p className="text-xs text-amber-600 sm:col-span-4">
                  ⚠ 此按鈕{noLabel ? "缺按鈕文字" : "缺連結/文字內容"},將不會顯示。
                </p>
              ) : null;
            })()}
          </div>
        ))}
        {card.buttons.length < 3 && (
          <button
            type="button"
            onClick={() => onChange({ ...card, buttons: [...card.buttons, { label: "按鈕", action: "booking" }] })}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            ＋ 新增按鈕
          </button>
        )}
      </div>
    </div>
  );
}
