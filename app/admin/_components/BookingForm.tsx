"use client";

import { useCallback, useEffect, useState } from "react";

interface Doctor {
  id: string;
  name: string;
}
interface Service {
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
  services,
  appointments,
  defaultDate,
  createAction,
  rescheduleAction,
}: {
  mode: "time" | "number";
  doctors: Doctor[];
  services: Service[];
  appointments: ApptOption[];
  defaultDate?: string;
  createAction: ServerAction;
  rescheduleAction: ServerAction;
}) {
  const singleDoctor = doctors.length === 1 ? doctors[0] : null;
  const [targetId, setTargetId] = useState(""); // 空=新增,有值=改期
  const [doctorId, setDoctorId] = useState(singleDoctor?.id ?? "");
  const [date, setDate] = useState(defaultDate ?? todayStr());
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
    <form action={action} className="card p-5">
      <h2 className="mb-4 font-semibold text-slate-900">建立 / 改期預約</h2>
      <input type="hidden" name="mode" value={mode} />
      {isReschedule && <input type="hidden" name="old_id" value={targetId} />}
      <input
        type="hidden"
        name={mode === "time" ? "start_at" : "template_id"}
        value={picked}
      />
      {mode === "number" && <input type="hidden" name="date" value={date} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-600">
          動作
          <select
            className="input mt-1"
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

        {singleDoctor ? (
          <input type="hidden" name="doctor_id" value={singleDoctor.id} />
        ) : (
          <label className="block text-sm font-medium text-slate-600">
            醫師
            <select
              name="doctor_id"
              className="input mt-1"
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
        )}

        <label className="block text-sm font-medium text-slate-600">
          日期
          <input
            type="date"
            className="input mt-1"
            value={date}
            min={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>

        {!isReschedule && (
          <>
            <label className="block text-sm font-medium text-slate-600">
              姓名
              <input name="name" className="input mt-1" required />
            </label>
            <label className="block text-sm font-medium text-slate-600">
              電話
              <input name="phone" className="input mt-1" required />
            </label>
          </>
        )}

        <label className="block text-sm font-medium text-slate-600">
          初/複診
          <select name="visit_type" className="input mt-1">
            <option value="return">複診</option>
            <option value="first">初診</option>
          </select>
        </label>
        {services.length > 0 && (
          <label className="block text-sm font-medium text-slate-600">
            看診服務
            <select name="service_id" className="input mt-1">
              <option value="">不指定</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 self-end rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          <input type="checkbox" name="is_self_pay" className="h-4 w-4 accent-brand-600" /> 自費
        </label>
      </div>

      {doctorId && date && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-600">
            {mode === "time" ? "選時段" : "選診次"}
          </p>
          {msg && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {mode === "time" &&
              slots.map((s) => (
                <button
                  key={s.slot_start}
                  type="button"
                  onClick={() => setPicked(s.slot_start)}
                  className={`pill ${picked === s.slot_start ? "pill-active" : ""}`}
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
                  className={`pill ${picked === s.template_id ? "pill-active" : ""}`}
                >
                  {timeOf(s.session_start)}–{timeOf(s.session_end)}(剩{s.remaining}號)
                </button>
              ))}
          </div>
        </div>
      )}

      <button type="submit" disabled={!picked || !doctorId} className="btn btn-primary mt-5">
        {isReschedule ? "確認改期" : "建立預約"}
      </button>
    </form>
  );
}
