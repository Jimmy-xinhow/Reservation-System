"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import zhTwLocale from "@fullcalendar/core/locales/zh-tw";
import type { EventClickArg, EventInput, EventSourceFuncArg } from "@fullcalendar/core";
import { SubmitButton } from "@/components/SubmitButton";
import { auditStatusLabel } from "@/lib/admin-display";
import { cancelAppointmentAction, setStatusAction } from "../appointment-actions";

interface Doctor { id: string; name: string; }
interface CalendarAppointment {
  id: string;
  start: string;
  end: string;
  status: string;
  statusLabel: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  providerName: string;
  visitType: string;
  depositStatus: string;
}

const STATUS_LEGEND = [
  { key: "booked", label: "待確認", color: "#2563eb" },
  { key: "confirmed", label: "已確認", color: "#059669" },
  { key: "done", label: "已完成", color: "#64748b" },
  { key: "no_show", label: "未到", color: "#d97706" },
  { key: "cancelled", label: "已取消", color: "#dc2626" },
];

function taipeiDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function CalendarWorkspace({ doctors, initialDate, canOperate }: { doctors: Doctor[]; initialDate: string; canOperate: boolean }) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const didMount = useRef(false);
  const [doctorId, setDoctorId] = useState("");
  const [selected, setSelected] = useState<CalendarAppointment | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    calendarRef.current?.getApi().refetchEvents();
  }, [doctorId]);

  const loadEvents = useCallback(async (range: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (error: Error) => void) => {
    setLoading(true);
    setLoadError("");
    try {
      const query = new URLSearchParams({ start: range.startStr, end: range.endStr });
      if (doctorId) query.set("doctor", doctorId);
      const response = await fetch(`/api/admin/calendar?${query.toString()}`, { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json() as { events?: EventInput[]; error?: string };
      if (!response.ok || !payload.events) throw new Error(payload.error ?? "日曆資料載入失敗");
      success(payload.events);
    } catch (error) {
      const message = error instanceof Error ? error.message : "日曆資料載入失敗";
      setLoadError(message);
      failure(new Error(message));
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  function applyDoctorFilter(value: string) {
    setDoctorId(value);
    setSelected(null);
  }

  function handleDateClick(info: DateClickArg) {
    setSelected(null);
    calendarRef.current?.getApi().changeView("timeGridDay", info.date);
  }

  function handleEventClick(info: EventClickArg) {
    const props = info.event.extendedProps as Omit<CalendarAppointment, "id" | "start" | "end">;
    setSelected({ id: info.event.id, start: info.event.startStr, end: info.event.endStr, ...props });
  }

  async function updateStatus(formData: FormData) {
    await setStatusAction(formData);
    setSelected(null);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function cancelAppointment(formData: FormData) {
    await cancelAppointmentAction(formData);
    setSelected(null);
    calendarRef.current?.getApi().refetchEvents();
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div><p className="eyebrow">預約營運</p><h1 className="admin-page-title">預約日曆</h1><p className="admin-page-description">以月曆掌握全局，切換週／日檢視後查看人員工作量；點擊預約可直接處理狀態。</p></div>
        <Link href={`/admin?date=${initialDate}`} className="btn btn-primary"><span aria-hidden="true">＋</span>新增預約</Link>
      </div>

      <section className="admin-toolbar calendar-toolbar">
        <div className="calendar-filter">
          <label htmlFor="calendar-doctor">服務人員</label>
          <select id="calendar-doctor" value={doctorId} onChange={(event) => applyDoctorFilter(event.target.value)} className="input">
            <option value="">全部人員</option>
            {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
          </select>
        </div>
        <div className="calendar-legend" aria-label="預約狀態圖例">
          {STATUS_LEGEND.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}
        </div>
        <Link href="/admin" className="btn btn-secondary"><span aria-hidden="true">☷</span>切換預約列表</Link>
      </section>

      {loadError && <div className="notice notice-error" role="alert">{loadError}</div>}
      <section className="admin-section operations-calendar" aria-busy={loading}>
        {loading && <div className="calendar-loading"><span />載入日曆資料</div>}
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          locales={[zhTwLocale]}
          locale="zh-tw"
          timeZone="Asia/Taipei"
          initialDate={initialDate}
          initialView="dayGridMonth"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
          buttonText={{ today: "今天", month: "月", week: "週", day: "日", list: "列表" }}
          events={loadEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          dayMaxEvents={3}
          moreLinkText={(count) => `另 ${count} 筆`}
          nowIndicator
          allDaySlot={false}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          slotDuration="00:30:00"
          expandRows
          height="auto"
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          eventDidMount={(info) => { info.el.title = `${info.event.title}｜點擊查看詳情`; }}
        />
      </section>

      {selected && (
        <div className="calendar-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <aside className="calendar-detail" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title">
            <header><div><p className="eyebrow">預約詳情</p><h2 id="appointment-detail-title">{selected.customerName}</h2><p>{selected.serviceName}</p></div><button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="關閉預約詳情">×</button></header>
            <div className="calendar-detail-status"><span className={`status-dot status-${selected.status}`} />{selected.statusLabel}</div>
            <dl>
              <Detail label="日期" value={formatDate(selected.start)} />
              <Detail label="時間" value={`${formatTime(selected.start)} – ${formatTime(selected.end)}`} />
              <Detail label="服務人員" value={selected.providerName} />
              <Detail label="服務類型" value={selected.visitType === "first" ? "首次服務" : "再次服務"} />
              <Detail label="訂金狀態" value={auditStatusLabel(selected.depositStatus)} />
              <Detail label="聯絡電話" value={selected.customerPhone} />
            </dl>
            <div className="calendar-detail-actions">
              <Link href={`/admin?date=${taipeiDate(selected.start)}`} className="btn btn-secondary"><span aria-hidden="true">✎</span>編輯或重新排程</Link>
              {canOperate && (selected.status === "booked" || selected.status === "confirmed") && <>
                {selected.status === "booked" && <form action={updateStatus}><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="status" value="confirmed" /><SubmitButton className="btn btn-primary"><span aria-hidden="true">✓</span>確認預約</SubmitButton></form>}
                <div className="calendar-detail-secondary-actions">
                  <form action={updateStatus}><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="status" value="done" /><SubmitButton className="btn btn-secondary">標記完成</SubmitButton></form>
                  <form action={updateStatus}><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="status" value="no_show" /><SubmitButton className="btn btn-secondary">標記未到</SubmitButton></form>
                </div>
                <form action={cancelAppointment}><input type="hidden" name="id" value={selected.id} /><SubmitButton className="btn btn-danger"><span aria-hidden="true">×</span>取消預約</SubmitButton></form>
              </>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
