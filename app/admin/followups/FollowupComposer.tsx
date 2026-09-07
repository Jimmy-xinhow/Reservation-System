"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import ChannelMessagePreview, { type PreviewChannel } from "@/app/admin/_components/ChannelMessagePreview";

type ServerAction = (fd: FormData) => Promise<void>;

interface PatientOption { id: string; name: string; phone: string }

export default function FollowupComposer({ action, patients, fixedPatient, className = "", compact = false }: { action: ServerAction; patients?: PatientOption[]; fixedPatient?: PatientOption; className?: string; compact?: boolean }) {
  const [channel, setChannel] = useState<PreviewChannel>("phone");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <form action={action} className={className}>
      {fixedPatient && <input type="hidden" name="patient_id" value={fixedPatient.id} />}
      <div className={`line-live-editor-layout ${compact ? "compact" : ""}`}>
        <div className="line-live-editor-fields compact">
          {fixedPatient ? <div><h2 className="font-semibold text-slate-900">安排指定日期回訪</h2><p className="mt-1 text-xs text-slate-500">顧客：{fixedPatient.name} · {fixedPatient.phone}</p></div> : <label className="text-sm"><span className="label">顧客</span><select name="patient_id" className="input" required defaultValue=""><option value="" disabled>選擇顧客</option>{(patients ?? []).map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}</select></label>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm"><span className="label">處理方式</span><select name="channel" value={channel} onChange={(event) => setChannel(event.target.value as PreviewChannel)} className="input"><option value="phone">電話</option><option value="manual">人工處理</option><option value="line">LINE</option><option value="email">Email</option></select></label>
            <label className="text-sm"><span className="label">用途</span><select name="purpose" className="input"><option value="service">服務關懷</option><option value="marketing">行銷（需顧客同意）</option></select></label>
            <label className="text-sm"><span className="label">指定日期時間</span><input name="scheduled_for" type="datetime-local" className="input" required /></label>
            <label className="text-sm"><span className="label">主旨</span><input name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="input" maxLength={160} /></label>
          </div>
          <label className="text-sm"><span className="label">回訪內容</span><textarea name="body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} className="input" required maxLength={3000} /></label>
          <SubmitButton className="btn btn-primary w-fit">安排回訪</SubmitButton>
        </div>
        <div className="line-live-preview-column">
          <ChannelMessagePreview channel={channel} subject={subject} body={body} label={channel === "line" ? "LINE 回訪即時預覽" : channel === "email" ? "Email 回訪即時預覽" : "執行內容即時預覽"} note="這是排程送出或執行人員實際看到的內容；按下安排回訪前不會儲存。" />
        </div>
      </div>
    </form>
  );
}
