"use client";

import { useCallback, useEffect, useState } from "react";

interface Doctor {
  id: string;
  name: string;
}
interface ApptOption {
  id: string;
  label: string;
}
interface Slot {
  slot_start: string;
  slot_end: string;
  remaining: number;
}
interface Session {
  template_id: string;
  session_start: string;
  session_end: string;
  remaining: number;
}

type ServerAction = (fd: FormData) => Promise<void>;

function timeOf(iso: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookingForm({
  mode,
  doctors,
  appointments,
  createAction,
  rescheduleAction,
}: {
  mode: "time" | "number";
  doctors: Doctor[];
  appointments: ApptOption[];
  createAction: ServerAction;
  rescheduleAction: ServerAction;
}) {
  const [targetId, setTargetId] = useState(""); // 空=新增,有值=改期
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [picked, setPicked] = useState(""); // start_at 或 template_id
  const [msg, setMsg] = useState<string | null>(null);

  const loadAvail = useCallback(async () => {
    setSlots([]);
    setSessions([]);
    setPicked("");
    setMsg(null);
    if (!doctorId || !date) return;
    try {
      const res = await fetch(`/api/booking/availability?doctor_id=${doctorId}&date=${date}`);
      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error);
        return;
      }
      if (mode === "time") setSlots(json.data.slots ?? []);
      else setSessions(json.data.sessions ?? []);
    } catch {
      setMsg("查詢空檔失敗");
    }
  }, [doctorId, date, mode]);

  useEffect(() => {
    loadAvail();
  }, [loadAvail]);

  const isReschedule = !!targetId;
  const action = isReschedule ? rescheduleAction : createAction;

  return (
    <form action={action} className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-bold">建立 / 改期預約</h2>
      <input type="hidden" name="mode" value={mode} />
      {isReschedule && <input type="hidden" name="old_id" value={targetId} />}
      <input
        type="hidden"
        name={mode === "time" ? "start_at" : "template_id"}
        value={picked}
      />
      {mode === "number" && <input type="hidden" name="date" value={date} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          動作
          <select
            className="mt-1 w-full rounded border p-2"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">新增預約</option>
            {appointments.map((a) => (
              <option key={a.id} value={a.id}>
                改期:{a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          醫師
          <select
            name="doctor_id"
            className="mt-1 w-full rounded border p-2"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            required
          >
            <option value="">請選擇</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          日期
          <input
            type="date"
            className="mt-1 w-full rounded border p-2"
            value={date}
            min={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>

        {!isReschedule && (
          <>
            <label className="text-sm">
              姓名
              <input name="name" className="mt-1 w-full rounded border p-2" required />
            </label>
            <label className="text-sm">
              電話
              <input name="phone" className="mt-1 w-full rounded border p-2" required />
            </label>
          </>
        )}

        <label className="text-sm">
          初/複診
          <select name="visit_type" className="mt-1 w-full rounded border p-2">
            <option value="return">複診</option>
            <option value="first">初診</option>
          </select>
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" name="is_self_pay" /> 自費
        </label>
      </div>

      {doctorId && date && (
        <div className="mt-3">
          <p className="mb-1 text-sm text-gray-600">
            {mode === "time" ? "選時段" : "選診次"}
          </p>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            {mode === "time" &&
              slots.map((s) => (
                <button
                  key={s.slot_start}
                  type="button"
                  onClick={() => setPicked(s.slot_start)}
                  className={`rounded border px-2 py-1 text-sm ${
                    picked === s.slot_start ? "bg-blue-600 text-white" : "bg-white"
                  }`}
                >
                  {timeOf(s.slot_start)}(剩{s.remaining})
                </button>
              ))}
            {mode === "number" &&
              sessions.map((s) => (
                <button
                  key={s.template_id}
                  type="button"
                  onClick={() => setPicked(s.template_id)}
                  className={`rounded border px-2 py-1 text-sm ${
                    picked === s.template_id ? "bg-blue-600 text-white" : "bg-white"
                  }`}
                >
                  {timeOf(s.session_start)}–{timeOf(s.session_end)}(剩{s.remaining}號)
                </button>
              ))}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!picked || !doctorId}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
      >
        {isReschedule ? "確認改期" : "建立預約"}
      </button>
    </form>
  );
}
