"use client";

import { useMemo, useState } from "react";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

interface Doctor {
  id: string;
  name: string;
}
interface Template {
  id: string;
  doctor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity: number;
  active: boolean;
}
type ServerAction = (fd: FormData) => Promise<void>;

function hhmm(t: string) {
  return (t ?? "").slice(0, 5);
}

export default function ExceptionForm({
  doctors,
  templates,
  createAction,
}: {
  doctors: Doctor[];
  templates: Template[];
  createAction: ServerAction;
}) {
  const [doctorId, setDoctorId] = useState("");
  const [kind, setKind] = useState<"closed" | "extra">("closed");
  const [tplId, setTplId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [slot, setSlot] = useState("15");
  const [cap, setCap] = useState("1");

  // 該醫師的門診段(可作為加診的「固定時段」來源)
  const docTemplates = useMemo(
    () => templates.filter((t) => t.doctor_id === doctorId && t.active),
    [templates, doctorId],
  );

  function applyTemplate(id: string) {
    setTplId(id);
    const t = docTemplates.find((x) => x.id === id);
    if (t) {
      setStart(hhmm(t.start_time));
      setEnd(hhmm(t.end_time));
      setSlot(String(t.slot_minutes));
      setCap(String(t.capacity));
    }
  }
  function applyClose(id: string) {
    setTplId(id);
    const t = docTemplates.find((x) => x.id === id);
    if (t) {
      setStart(hhmm(t.start_time));
      setEnd(hhmm(t.end_time));
    } else {
      setStart(""); // 整天休診
      setEnd("");
    }
  }
  function changeKind(k: "closed" | "extra") {
    setKind(k);
    setTplId("");
    setStart("");
    setEnd("");
  }

  return (
    <form action={createAction} className="card flex flex-wrap items-end gap-3 p-4">
      <label className="block text-sm font-medium text-slate-600">
        醫師
        <select
          name="doctor_id"
          required
          value={doctorId}
          onChange={(e) => {
            setDoctorId(e.target.value);
            setTplId("");
          }}
          className="input mt-1"
        >
          <option value="">選擇</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-slate-600">
        日期{kind === "closed" && tplId ? "(選填)" : ""}
        <input
          type="date"
          name="date"
          required={kind === "extra" || (kind === "closed" && !tplId)}
          className="input mt-1"
        />
      </label>

      <label className="block text-sm font-medium text-slate-600">
        類型
        <select
          name="kind"
          value={kind}
          onChange={(e) => changeKind(e.target.value as "closed" | "extra")}
          className="input mt-1"
        >
          <option value="closed">休診</option>
          <option value="extra">加診</option>
        </select>
      </label>

      {kind === "closed" && (
        <>
          <label className="block text-sm font-medium text-slate-600">
            休診範圍
            <select
              value={tplId}
              onChange={(e) => applyClose(e.target.value)}
              className="input mt-1"
              disabled={!doctorId}
            >
              <option value="">整天休診</option>
              {docTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  只休 週{WD[t.weekday]} {hhmm(t.start_time)}–{hhmm(t.end_time)}
                </option>
              ))}
            </select>
          </label>
          {/* 只休某診時帶出時段;整天休診則留空 */}
          <input type="hidden" name="start_time" value={start} />
          <input type="hidden" name="end_time" value={end} />
          <input type="hidden" name="template_id" value={tplId} />
          {tplId && (
            <p className="w-full text-xs text-slate-400">
              選門診段後:不選日期 = 永久停診此門診段(門診表可重新啟用);選日期 = 只休那天的這一診。
            </p>
          )}
        </>
      )}

      {kind === "extra" && (
        <>
          <label className="block text-sm font-medium text-slate-600">
            套用門診段
            <select
              value={tplId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="input mt-1"
              disabled={!doctorId}
            >
              <option value="">{doctorId ? "(選既有時段帶入)" : "請先選醫師"}</option>
              {docTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  週{WD[t.weekday]} {hhmm(t.start_time)}–{hhmm(t.end_time)}(每格{t.slot_minutes}分・容量{t.capacity})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-600">
            開始
            <input
              name="start_time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="09:00"
              inputMode="numeric"
              pattern="[0-9]{1,2}:[0-9]{2}"
              className="input mt-1 w-24"
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            結束
            <input
              name="end_time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="12:00"
              inputMode="numeric"
              pattern="[0-9]{1,2}:[0-9]{2}"
              className="input mt-1 w-24"
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            每格(分)
            <input
              type="number"
              name="slot_minutes"
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="input mt-1 w-20"
            />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            容量/總號
            <input
              type="number"
              name="capacity"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="input mt-1 w-20"
            />
          </label>
        </>
      )}

      <button className="btn btn-primary">新增</button>
    </form>
  );
}
