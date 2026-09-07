"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface DoctorOption { id: string; name: string; }

const STATUS = [
  ["", "全部狀態"],
  ["booked", "已預約"],
  ["confirmed", "已確認"],
  ["cancelled", "已取消"],
  ["done", "完成"],
  ["no_show", "未到"],
] as const;

export function AppointmentDateToolbar({
  initialDate,
  initialDoctor,
  initialStatus,
  doctors,
  count,
}: {
  initialDate: string;
  initialDoctor: string;
  initialStatus: string;
  doctors: DoctorOption[];
  count: number;
}) {
  const router = useRouter();
  const dateRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(initialDate);
  const [doctor, setDoctor] = useState(initialDoctor);
  const [status, setStatus] = useState(initialStatus);

  function open(nextDate = date, nextDoctor = doctor, nextStatus = status) {
    const query = new URLSearchParams({ date: nextDate });
    if (nextDoctor) query.set("doctor", nextDoctor);
    if (nextStatus) query.set("status", nextStatus);
    router.push(`/admin?${query.toString()}`);
  }

  function currentDate(): string { return dateRef.current?.value || date; }

  return (
    <section className="admin-toolbar appointment-list-toolbar text-sm" aria-label="預約日期與篩選">
      <label className="appointment-toolbar-field appointment-toolbar-date">
        <span className="label">日期</span>
        <input ref={dateRef} type="date" defaultValue={initialDate} className="input" onChange={(event) => { const next = event.target.value; setDate(next); if (next) open(next); }} />
      </label>
      {doctors.length > 1 && <label className="appointment-toolbar-field"><span className="label">服務人員</span><select value={doctor} className="input" onChange={(event) => setDoctor(event.target.value)}><option value="">全部人員</option>{doctors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="appointment-toolbar-field"><span className="label">狀態</span><select value={status} className="input" onChange={(event) => setStatus(event.target.value)}>{STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className="btn btn-secondary" onClick={() => open(currentDate())}>套用篩選</button>
      {(doctor || status) && <button type="button" className="btn btn-ghost" onClick={() => { setDoctor(""); setStatus(""); open(currentDate(), "", ""); }}>清除篩選</button>}
      <span className="appointment-toolbar-count">{count} 筆</span>
    </section>
  );
}
