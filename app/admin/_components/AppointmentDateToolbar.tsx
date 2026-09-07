"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface DoctorOption { id: string; name: string; }

const STATUS = [
  ["", "全部狀態"],
  ["booked", "已預約"],
  ["confirmed", "已確認"],
  ["cancelled", "已取消"],
  ["done", "完成"],
  ["no_show", "未到"],
] as const;

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function AppointmentDateToolbar({
  initialDate,
  today,
  initialDoctor,
  initialStatus,
  doctors,
  count,
}: {
  initialDate: string;
  today: string;
  initialDoctor: string;
  initialStatus: string;
  doctors: DoctorOption[];
  count: number;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [doctor, setDoctor] = useState(initialDoctor);
  const [status, setStatus] = useState(initialStatus);

  function open(nextDate = date, nextDoctor = doctor, nextStatus = status) {
    const query = new URLSearchParams({ date: nextDate });
    if (nextDoctor) query.set("doctor", nextDoctor);
    if (nextStatus) query.set("status", nextStatus);
    router.push(`/admin?${query.toString()}`);
  }

  return (
    <section className="admin-toolbar appointment-list-toolbar text-sm" aria-label="預約日期與篩選">
      <div className="appointment-day-navigation">
        <button type="button" onClick={() => { const next = shiftDate(date, -1); setDate(next); open(next); }} className="btn btn-secondary">← 前一天</button>
        <button type="button" onClick={() => { setDate(today); open(today); }} className="btn btn-ghost">今天</button>
        <button type="button" onClick={() => { const next = shiftDate(date, 1); setDate(next); open(next); }} className="btn btn-secondary">後一天 →</button>
        <label className="appointment-toolbar-field appointment-toolbar-date">
          <span className="label">日期</span>
          <input type="date" value={date} className="input" onChange={(event) => { const next = event.target.value; setDate(next); if (next) open(next); }} />
        </label>
      </div>
      {doctors.length > 1 && <label className="appointment-toolbar-field"><span className="label">服務人員</span><select value={doctor} className="input" onChange={(event) => setDoctor(event.target.value)}><option value="">全部人員</option>{doctors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="appointment-toolbar-field"><span className="label">狀態</span><select value={status} className="input" onChange={(event) => setStatus(event.target.value)}>{STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className="btn btn-secondary" onClick={() => open()}>套用篩選</button>
      {(doctor || status) && <button type="button" className="btn btn-ghost" onClick={() => { setDoctor(""); setStatus(""); open(date, "", ""); }}>清除篩選</button>}
      <span className="appointment-toolbar-count">{count} 筆</span>
    </section>
  );
}
