"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

interface Doctor {
  id: string;
  name: string;
}

interface Service {
  id: string;
  name: string;
}

interface Template {
  id: string;
  doctor_id: string | null;
  service_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity: number;
  active: boolean;
}

type ServerAction = (fd: FormData) => Promise<void>;

function hhmm(value: string) {
  return (value ?? "").slice(0, 5);
}

export default function ExceptionForm({
  doctors,
  services,
  templates,
  createAction,
}: {
  doctors: Doctor[];
  services: Service[];
  templates: Template[];
  createAction: ServerAction;
}) {
  const singleDoctor = doctors.length === 1 ? doctors[0] : null;
  const [doctorId, setDoctorId] = useState(singleDoctor?.id ?? "");
  const [serviceId, setServiceId] = useState("");
  const [kind, setKind] = useState<"closed" | "extra">("closed");
  const [templateId, setTemplateId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [slot, setSlot] = useState("15");
  const [capacity, setCapacity] = useState("1");

  const targetTemplates = useMemo(
    () => templates.filter((template) => template.active && (template.doctor_id ?? "") === doctorId && (template.service_id ?? "") === serviceId),
    [templates, doctorId, serviceId],
  );

  function resetTarget(nextDoctorId: string, nextServiceId: string) {
    setDoctorId(nextDoctorId);
    setServiceId(nextServiceId);
    setTemplateId("");
    setStart("");
    setEnd("");
  }

  function applyTemplate(id: string, includeCapacity: boolean) {
    setTemplateId(id);
    const template = targetTemplates.find((item) => item.id === id);
    if (!template) {
      setStart("");
      setEnd("");
      return;
    }
    setStart(hhmm(template.start_time));
    setEnd(hhmm(template.end_time));
    if (includeCapacity) {
      setSlot(String(template.slot_minutes));
      setCapacity(String(template.capacity));
    }
  }

  function changeKind(nextKind: "closed" | "extra") {
    setKind(nextKind);
    setTemplateId("");
    setStart("");
    setEnd("");
  }

  const targetReady = Boolean(doctorId || serviceId);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div><h2 className="font-semibold text-slate-900">新增例外日期</h2><p className="mt-0.5 text-xs text-slate-500">先選擇日期與類型，再指定受影響的人員或服務。</p></div>
      </div>
    <form action={createAction} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">
        <span className="label">日期</span>
        <input type="date" name="date" required={kind === "extra" || (kind === "closed" && !templateId)} className="input" />
      </label>

      <label className="text-sm">
        <span className="label">設定類型</span>
        <select name="kind" value={kind} onChange={(event) => changeKind(event.target.value as "closed" | "extra")} className="input">
          <option value="closed">休假／關閉服務</option>
          <option value="extra">臨時加開服務</option>
        </select>
      </label>

      <label className="text-sm">
        <span className="label">服務提供者（可不填）</span>
        <select
          name="doctor_id"
          value={doctorId}
          onChange={(event) => resetTarget(event.target.value, serviceId)}
          className="input"
        >
          <option value="">不指定</option>
          {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
        </select>
      </label>

      <label className="text-sm">
        <span className="label">服務（可不填）</span>
        <select
          name="service_id"
          value={serviceId}
          onChange={(event) => resetTarget(doctorId, event.target.value)}
          className="input"
        >
          <option value="">不指定</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select>
      </label>

      {kind === "closed" && (
        <>
          <label className="text-sm sm:col-span-2">
            <span className="label">關閉範圍</span>
            <select value={templateId} onChange={(event) => applyTemplate(event.target.value, false)} className="input" disabled={!targetReady}>
              <option value="">整天休假／停課</option>
              {targetTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  週{WEEKDAYS[template.weekday]} {hhmm(template.start_time)}–{hhmm(template.end_time)}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="start_time" value={start} />
          <input type="hidden" name="end_time" value={end} />
          <input type="hidden" name="template_id" value={templateId} />
        </>
      )}

      {kind === "extra" && (
        <>
          <label className="text-sm sm:col-span-2">
            <span className="label">從固定排班帶入（選填）</span>
            <select value={templateId} onChange={(event) => applyTemplate(event.target.value, true)} className="input" disabled={!targetReady}>
              <option value="">可直接輸入時間</option>
              {targetTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  週{WEEKDAYS[template.weekday]} {hhmm(template.start_time)}–{hhmm(template.end_time)}（每 {template.slot_minutes} 分鐘，容量 {template.capacity}）
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="label">開始時間</span>
            <input name="start_time" type="time" value={start} onChange={(event) => setStart(event.target.value)} className="input" required />
          </label>
          <label className="text-sm">
            <span className="label">結束時間</span>
            <input name="end_time" type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="input" required />
          </label>
          <label className="text-sm">
            <span className="label">預約間隔（分鐘）</span>
            <input type="number" name="slot_minutes" value={slot} onChange={(event) => setSlot(event.target.value)} min="1" max="1440" className="input" />
          </label>
          <label className="text-sm">
            <span className="label">每時段容量／總號數</span>
            <input type="number" name="capacity" value={capacity} onChange={(event) => setCapacity(event.target.value)} min="1" max="10000" className="input" />
          </label>
        </>
      )}

      <p className="text-xs leading-5 text-slate-500 sm:col-span-2 lg:col-span-4">至少指定服務提供者或服務。加開服務可從固定排班帶入後再調整；休假設定刪除後會恢復原本排班。</p>
      <div className="sm:col-span-2 lg:col-span-4"><SubmitButton className="btn btn-primary">{kind === "closed" ? "新增休假／關閉設定" : "新增臨時加開時段"}</SubmitButton></div>
    </form>
    </section>
  );
}
