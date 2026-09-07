"use client";

export type PreviewChannel = "line" | "email" | "phone" | "manual";

interface ChannelMessagePreviewProps {
  channel?: PreviewChannel;
  botName?: string;
  customerText?: string;
  title?: string;
  body: string;
  buttons?: string[];
  imageUrl?: string;
  subject?: string;
  label?: string;
  note?: string;
}

export default function ChannelMessagePreview({
  channel = "line",
  botName = "品牌官方帳號",
  customerText,
  title,
  body,
  buttons = [],
  imageUrl,
  subject,
  label = "顧客畫面即時預覽",
  note,
}: ChannelMessagePreviewProps) {
  const visibleButtons = buttons.map((item) => item.trim()).filter(Boolean);

  return (
    <aside className="message-composer-preview channel-live-preview" aria-label={label}>
      <div className="message-composer-preview-head">
        <strong>{label}</strong>
        <span className="line-live-status" role="status">輸入即時更新</span>
      </div>

      {channel === "line" ? (
        <div className="line-preview-canvas">
          <div className="line-phone">
            <div className="line-phone-header"><span className="status-dot bg-[#06c755]" /><strong>{botName}</strong></div>
            <div className="line-phone-conversation">
              {customerText?.trim() && <div className="line-customer-text-bubble">{customerText.trim()}</div>}
              {title || imageUrl || visibleButtons.length > 0 ? (
                <div className="line-message-bubble">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="LINE 訊息圖片預覽" className="aspect-[1.51/1] w-full object-cover" />
                  ) : null}
                  <div className="line-message-accent" />
                  <div className="line-message-body">
                    <p className="line-message-status">{botName}</p>
                    {title && <h3 className="line-message-title">{title}</h3>}
                    <p className="line-message-copy whitespace-pre-wrap">{body.trim() || "在左側輸入內容，這裡會同步顯示。"}</p>
                  </div>
                  {visibleButtons.length > 0 && <div className="line-message-actions">{visibleButtons.map((button, index) => <span key={`${button}-${index}`}>{button}</span>)}</div>}
                </div>
              ) : (
                <div className="line-text-bubble">{body.trim() || "在左側輸入內容，這裡會同步顯示。"}</div>
              )}
            </div>
          </div>
        </div>
      ) : channel === "email" ? (
        <div className="channel-email-canvas">
          <div className="channel-email-window">
            <div className="channel-email-meta"><span>寄件者</span><strong>{botName}</strong><span>主旨</span><strong>{subject?.trim() || "尚未輸入主旨"}</strong></div>
            <div className="channel-email-body whitespace-pre-wrap">{body.trim() || "在左側輸入內容，這裡會同步顯示。"}</div>
          </div>
        </div>
      ) : (
        <div className="channel-manual-preview">
          <span className="badge bg-slate-100 text-slate-600">{channel === "phone" ? "電話回訪" : "人工處理"}</span>
          <h3>{subject?.trim() || "回訪處理摘要"}</h3>
          <p>{body.trim() || "在左側輸入內容，這裡會整理成執行人員可直接使用的摘要。"}</p>
        </div>
      )}

      <p className="message-composer-preview-note">{note ?? "此區只預覽顧客或執行人員會看到的結果，不會儲存或送出。"}</p>
    </aside>
  );
}
