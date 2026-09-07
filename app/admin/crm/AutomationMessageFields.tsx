"use client";

import { useState } from "react";
import ChannelMessagePreview from "@/app/admin/_components/ChannelMessagePreview";
import { previewAutomationTemplate } from "@/lib/crm";

export default function AutomationMessageFields({ initialChannel = "line", initialSubject = "", initialBody = "" }: { initialChannel?: "line" | "email"; initialSubject?: string; initialBody?: string }) {
  const [channel, setChannel] = useState<"line" | "email">(initialChannel);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  return (
    <div className="line-live-editor-layout md:col-span-2">
      <div className="line-live-editor-fields compact">
        <label className="text-sm"><span className="label">發送渠道</span><select name="channel" value={channel} onChange={(event) => setChannel(event.target.value as "line" | "email")} className="input"><option value="line">LINE</option><option value="email">Email</option></select></label>
        <label className="text-sm"><span className="label">Email 主旨{channel === "email" ? "（必填）" : "（切換 Email 時使用）"}</span><input name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="回訪提醒" required={channel === "email"} /></label>
        <label className="text-sm"><span className="label">訊息內容</span><textarea name="body" required rows={5} value={body} onChange={(event) => setBody(event.target.value)} className="input" placeholder="您好 {{customer_name}}，謝謝您這次的使用。" /><span className="mt-1 block text-xs text-slate-500">右側以示例顧客資料代入變數，實際發送會使用每位顧客的資料。</span></label>
      </div>
      <div className="line-live-preview-column">
        <ChannelMessagePreview channel={channel} subject={previewAutomationTemplate(subject)} body={previewAutomationTemplate(body)} label={channel === "line" ? "LINE 自動訊息即時預覽" : "Email 自動訊息即時預覽"} note="預覽只呈現內容與變數代入結果；不會建立自動化或實際發送。" />
      </div>
    </div>
  );
}
