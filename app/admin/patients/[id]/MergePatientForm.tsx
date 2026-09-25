"use client";

import { useState, type FormEvent } from "react";
import { mergePatientAction } from "../../patient-actions";
import MergeTargetPicker from "./MergeTargetPicker";

export default function MergePatientForm({ sourcePatientId, sourceName, sourcePhone }: { sourcePatientId: string; sourceName: string; sourcePhone: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const targetId = await mergePatientAction(formData);
      window.location.assign(`/admin/patients/${encodeURIComponent(targetId)}`);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes("兩筆資料綁定不同 LINE 帳號")
        ? "兩筆資料綁定不同 LINE 帳號，為避免誤合併已停止操作"
        : "無法確認合併結果，請重新整理後確認顧客狀態再決定是否重試");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3 border-t border-red-100 p-4">
      <input type="hidden" name="source_patient_id" value={sourcePatientId} />
      <p className="text-sm leading-6 text-slate-600">目前這筆「{sourceName} · {sourcePhone}」會停用，預約、報名、套票、互動、訂閱與回訪歷史移到選定的保留顧客。若兩筆綁定不同 LINE 帳號，系統會拒絕合併。</p>
      <MergeTargetPicker sourcePatientId={sourcePatientId} />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="confirmed" value="yes" required className="mt-1" />
        我已核對兩筆是同一位顧客，並確認要保留上方選擇的資料。
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" className="btn btn-danger" disabled={pending} aria-busy={pending}>{pending ? "合併中…" : "合併顧客"}</button>
    </form>
  );
}
