"use client";

import { useState } from "react";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

interface Doctor {
  id: string;
  name: string;
  active: boolean;
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

function hhmm(t: string): string {
  return (t ?? "").slice(0, 5);
}

export default function ScheduleEditor({
  doctors,
  templates,
  createAction,
  toggleAction,
  deleteAction,
}: {
  doctors: Doctor[];
  templates: Template[];
  createAction: ServerAction;
  toggleAction: ServerAction;
  deleteAction: ServerAction;
}) {
  const activeDocs = doctors.filter((d) => d.active);
  const docName = (id: string) => doctors.find((d) => d.id === id)?.name ?? "—";

  // 受控表單(可被「複製」帶入,送出後保留值方便連續新增)
  const [doctorId, setDoctorId] = useState(activeDocs[0]?.id ?? "");
  const [weekday, setWeekday] = useState("1");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [slot, setSlot] = useState("15");
  const [cap, setCap] = useState("1");

  function copyFrom(t: Template) {
    setDoctorId(t.doctor_id);
    setWeekday(String(t.weekday));
    setStart(hhmm(t.start_time));
    setEnd(hhmm(t.end_time));
    setSlot(String(t.slot_minutes));
    setCap(String(t.capacity));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-900">門診段(同醫師同一天可多診次)</h2>

      <form action={createAction} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="block text-sm font-medium text-slate-600">
          醫師
          <select
            name="doctor_id"
            required
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="input mt-1"
          >
            <option value="">選擇</option>
            {activeDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-600">
          星期
          <select
            name="weekday"
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            className="input mt-1"
          >
            {WD.map((w, i) => (
              <option key={i} value={i}>
                週{w}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-600">
          開始
          <input
            name="start_time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="09:00"
            inputMode="numeric"
            pattern="[0-9]{1,2}:[0-9]{2}"
            className="input mt-1 w-24"
          />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          結束
          <input
            name="end_time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder="12:00"
            inputMode="numeric"
            pattern="[0-9]{1,2}:[0-9]{2}"
            className="input mt-1 w-24"
          />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          每格(分)
          <input
            name="slot_minutes"
            type="number"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            className="input mt-1 w-20"
          />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          容量/總號
          <input
            name="capacity"
            type="number"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="input mt-1 w-20"
          />
        </label>
        <button className="btn btn-primary">新增門診段</button>
      </form>
      <p className="text-xs text-slate-400">
        時間直接輸入(例 09:00)。送出後表單會保留,改個星期或時間即可快速再新增;也可在下方按「複製」帶入某列。
      </p>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>星期</th>
              <th>醫師</th>
              <th>時間</th>
              <th>每格</th>
              <th>容量/總號</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  尚無門診段
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id}>
                <td>週{WD[t.weekday]}</td>
                <td>{docName(t.doctor_id)}</td>
                <td>
                  {hhmm(t.start_time)}–{hhmm(t.end_time)}
                </td>
                <td>{t.slot_minutes} 分</td>
                <td>{t.capacity}</td>
                <td>
                  <span className={`badge ${t.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                    {t.active ? "啟用" : "停用"}
                  </span>
                </td>
                <td>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => copyFrom(t)}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      複製
                    </button>
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={String(t.active)} />
                      <button className="text-xs font-medium text-slate-600 hover:underline">
                        {t.active ? "停用" : "啟用"}
                      </button>
                    </form>
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-xs font-medium text-red-600 hover:underline">刪除</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
