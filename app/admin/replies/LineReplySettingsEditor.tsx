"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import ChannelMessagePreview from "@/app/admin/_components/ChannelMessagePreview";

type ServerAction = (fd: FormData) => Promise<void>;

interface InitialLineReplySettings {
  welcomeText: string;
  fallbackText: string;
  menuTitle: string;
  booking: boolean;
  query: boolean;
  progress: boolean;
  info: boolean;
  linkLabel: string;
  linkUrl: string;
}

export default function LineReplySettingsEditor({ action, clinicName, initial }: { action: ServerAction; clinicName: string; initial: InitialLineReplySettings }) {
  const [previewMode, setPreviewMode] = useState<"welcome" | "fallback">("welcome");
  const [welcomeText, setWelcomeText] = useState(initial.welcomeText);
  const [fallbackText, setFallbackText] = useState(initial.fallbackText);
  const [menuTitle, setMenuTitle] = useState(initial.menuTitle);
  const [booking, setBooking] = useState(initial.booking);
  const [query, setQuery] = useState(initial.query);
  const [progress, setProgress] = useState(initial.progress);
  const [info, setInfo] = useState(initial.info);
  const [linkLabel, setLinkLabel] = useState(initial.linkLabel);
  const [linkUrl, setLinkUrl] = useState(initial.linkUrl);
  const buttons = [booking ? "立即預約" : "", query ? "查詢我的預約" : "", progress ? "服務進度" : "", info ? "品牌資訊" : "", linkLabel.trim() && linkUrl.trim() ? linkLabel : ""].filter(Boolean);
  const body = previewMode === "welcome"
    ? welcomeText || "您可以在這裡線上預約、查詢或取消預約。請點下方按鈕開始。"
    : fallbackText || "請問需要什麼服務?請點下方按鈕。";
  const title = menuTitle || (previewMode === "welcome" ? `歡迎加入${clinicName} 🌿` : clinicName);

  return (
    <form action={action} className="admin-section">
      <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">歡迎詞與找不到指令時的回覆</h2><p className="mt-0.5 text-xs text-slate-500">左側輸入會立即顯示在右側預覽；按下儲存前不會影響顧客。</p></div></div>
      <div className="line-live-editor-layout">
        <div className="line-live-editor-fields">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm"><span className="label">加好友歡迎訊息</span><textarea name="line_welcome_text" rows={3} value={welcomeText} onChange={(event) => setWelcomeText(event.target.value)} placeholder="留空則使用系統預設歡迎詞" className="input" /></label>
            <label className="block text-sm"><span className="label">找不到對應指令時的回覆</span><textarea name="line_fallback_text" rows={3} value={fallbackText} onChange={(event) => setFallbackText(event.target.value)} placeholder="留空則使用系統預設選單提示" className="input" /></label>
          </div>

          <details className="technical-details">
            <summary>進階設定：主選單卡片按鈕</summary>
            <div className="mt-3 border-y border-slate-200 bg-slate-50 p-4">
              <label className="mb-3 block text-sm"><span className="label">卡片標題（留空使用預設）</span><input name="line_menu_title" value={menuTitle} onChange={(event) => setMenuTitle(event.target.value)} className="input" /></label>
              <fieldset><legend className="label">顯示哪些按鈕</legend><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Toggle name="line_menu_btn_booking" label="立即預約" checked={booking} onChange={setBooking} />
                <Toggle name="line_menu_btn_query" label="查詢預約" checked={query} onChange={setQuery} />
                <Toggle name="line_menu_btn_progress" label="服務進度" checked={progress} onChange={setProgress} />
                <Toggle name="line_menu_btn_info" label="品牌資訊" checked={info} onChange={setInfo} />
              </div></fieldset>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-sm"><span className="label">自訂按鈕文字（選填）</span><input name="line_menu_link_label" value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="例如：官方網站" className="input" /></label>
                <label className="text-sm"><span className="label">自訂按鈕連結</span><input name="line_menu_link_url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." className="input" /></label>
              </div>
            </div>
          </details>
          <SubmitButton className="btn btn-primary">儲存歡迎與預設回覆</SubmitButton>
        </div>

        <div className="line-live-preview-column">
          <div className="line-preview-switch" role="tablist" aria-label="選擇預覽情境">
            <button type="button" role="tab" aria-selected={previewMode === "welcome"} onClick={() => setPreviewMode("welcome")}>加好友歡迎</button>
            <button type="button" role="tab" aria-selected={previewMode === "fallback"} onClick={() => setPreviewMode("fallback")}>找不到指令</button>
          </div>
          <ChannelMessagePreview botName={clinicName} customerText={previewMode === "fallback" ? "我想找其他服務" : undefined} title={title} body={body} buttons={buttons} label={previewMode === "welcome" ? "加好友後的顧客畫面" : "找不到指令時的顧客畫面"} note="預覽使用目前輸入的標題、內文與按鈕順序；不會實際傳送 LINE 訊息。" />
        </div>
      </div>
    </form>
  );
}

function Toggle({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="line-preview-toggle"><input type="checkbox" name={name} checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
