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
    <form action={createAction} className="card flex flex-wrap items-end gap-3 p-4">
      <label className="block text-sm font-medium text-slate-600">
        服務提供者（可不填）
        <select
          name="doctor_id"
          value={doctorId}
          onChange={(event) => resetTarget(event.target.value, serviceId)}
          className="input mt-1"
        >
          <option value="">不指定</option>
          {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
        </select>
      </label>

      <label className="block text-sm font-medium text-slate-600">
        服務（可不填）
        <select
          name="service_id"
          value={serviceId}
          onChange={(event) => resetTarget(doctorId, event.target.value)}
          className="input mt-1"
        >
          <option value="">不指定</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select>
      </label>

      <label className="block text-sm font-medium text-slate-600">
        日期{kind === "closed" && templateId ? "（可留空以停用時段）" : ""}
        <input type="date" name="date" required={kind === "extra" || (kind === "closed" && !templateId)} className="input mt-1" />
      </label>

      <label className="block text-sm font-medium text-slate-600">
        類型
        <select name="kind" value={kind} onChange={(event) => changeKind(event.target.value as "closed" | "extra")} className="input mt-1">
          <option value="closed">關閉服務</option>
          <option value="extra">加開服務</option>
        </select>
      </label>

      {kind === "closed" && (
        <>
          <label className="block text-sm font-medium text-slate-600">
            關閉哪個時段
            <select value={templateId} onChange={(event) => applyTemplate(event.target.value, false)} className="input mt-1" disabled={!targetReady}>
              <option value="">整天關閉</option>
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
          <label className="block text-sm font-medium text-slate-600">
            套用服務時段
            <select value={templateId} onChange={(event) => applyTemplate(event.target.value, true)} className="input mt-1" disabled={!targetReady}>
              <option value="">可直接輸入時間</option>
              {targetTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  週{WEEKDAYS[template.weekday]} {hhmm(template.start_time)}–{hhmm(template.end_time)}（每 {template.slot_minutes} 分鐘，容量 {template.capacity}）
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-600">
            開始
            <input name="start_time" value={start} onChange={(event) => setStart(event.target.value)} placeholder="09:00" inputMode="numeric" pattern="[0-9]{1,2}:[0-9]{2}" className="input mt-1 w-24" required />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            結束
            <input name="end_time" value={end} onChange={(event) => setEnd(event.target.value)} placeholder="12:00" inputMode="numeric" pattern="[0-9]{1,2}:[0-9]{2}" className="input mt-1 w-24" required />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            每次分鐘
            <input type="number" name="slot_minutes" value={slot} onChange={(event) => setSlot(event.target.value)} min="1" max="1440" className="input mt-1 w-20" />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            容量
            <input type="number" name="capacity" value={capacity} onChange={(event) => setCapacity(event.target.value)} min="1" max="10000" className="input mt-1 w-20" />
          </label>
        </>
      )}

      <p className="w-full text-xs text-slate-400">至少指定服務提供者或服務；未指定服務提供者的服務，請在服務排程建立「服務」時段。</p>
      <SubmitButton className="btn btn-primary">建立例外日期</SubmitButton>
    </form>
  );
}
