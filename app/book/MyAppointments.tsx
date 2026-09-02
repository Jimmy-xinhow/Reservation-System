"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateSession, formatTime } from "@/lib/slots";
import { bookingApi as api } from "./client-api";

export interface MyAppt {
  id: string;
  start_at: string;
  end_at: string | null;
  queue_number: number | null;
  status: string;
  doctor_id: string | null;
  service_id: string | null;
  visit_type: "first" | "return";
  deposit_status: string;
  deposit_amount: number;
  doctors: { name: string } | null;
  services: { name: string } | null;
  patients: { name: string } | null;
}

interface MyWaitlist {
  id: string;
  patient_id: string;
  booking_mode: "time" | "number";
  requested_date: string;
  requested_start_at: string | null;
  position: number;
  status: "waiting" | "offered";
  offer_expires_at: string | null;
  appointment_id: string | null;
  doctors: { name: string } | null;
  services: { name: string } | null;
  patients: { name: string } | null;
}

interface ProgressItem {
  doctorName: string;
  label: string;
  yourNumber: number;
  current: number;
  status: string;
  source: "online" | "offline";
}

export default function MyAppointments({
  idToken,
  mode,
  onRebook,
}: {
  idToken: string | null;
  mode: "time" | "number";
  onRebook: (appointment: MyAppt) => void;
}) {
  const [list, setList] = useState<MyAppt[] | null>(null);
  const [waitlists, setWaitlists] = useState<MyWaitlist[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!idToken) return;
    setErr(null);
    try {
      const data = await api<{
        appointments: MyAppt[];
        waitlists: MyWaitlist[];
        progress: ProgressItem[];
      }>("/api/booking/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      setList(data.appointments);
      setWaitlists(data.waitlists ?? []);
      setProgress(data.progress ?? []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "查詢失敗");
    }
  }, [idToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    if (!idToken) return;
    setCancelling(id);
    setErr(null);
    try {
      await api("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, appointment_id: id }),
      });
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "取消失敗");
    } finally {
      setCancelling(null);
    }
  }

  async function waitlistAction(id: string, action: "accept" | "cancel", patientId: string) {
    if (!idToken) return;
    setCancelling(id);
    setErr(null);
    try {
      await api("/api/booking/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, patient_id: patientId, waitlist_id: id, action }),
      });
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "候補操作失敗");
    } finally {
      setCancelling(null);
    }
  }

  async function payAppointment(appointmentId: string) {
    if (!idToken) return;
    setCancelling(appointmentId);
    setErr(null);
    try {
      const data = await api<{ form: { action: string; fields: Record<string, string> } }>("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_id: appointmentId,
          idToken,
          return_path: window.location.pathname + window.location.search,
        }),
      });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.form.action;
      form.style.display = "none";
      for (const [name, value] of Object.entries(data.form.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "付款頁開啟失敗");
      setCancelling(null);
    }
  }

  function openReschedule(id: string) {
    const source = new URLSearchParams(window.location.search);
    const params = new URLSearchParams({ appointment_id: id });
    const clinicSlug = source.get("clinic_slug")?.trim();
    const clinicId = source.get("clinic_id")?.trim();
    if (clinicSlug) params.set("clinic_slug", clinicSlug);
    else if (clinicId) params.set("clinic_id", clinicId);
    window.location.assign(`/book/reschedule?${params.toString()}`);
  }

  if (err) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>;
  if (list === null) return <p className="px-1 text-sm text-slate-400">載入中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-medium text-slate-600">
          {progress.length > 0 ? "今日服務進度" : "我的預約"}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 text-sm text-brand-600 hover:underline"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.311h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
          </svg>
          重新整理
        </button>
      </div>

      {progress.length > 0 && (
        <div className="space-y-2">
          {progress.map((item, index) => (
            <div
              key={`${item.doctorName}-${item.yourNumber}-${index}`}
              className="card flex items-center justify-between bg-gradient-to-br from-brand-500 to-accent-600 p-4 text-white"
            >
              <div>
                <div className="text-sm">{item.doctorName} · {item.label}</div>
                <div className="text-xs text-white/80">
                  您的號碼:{item.source === "offline" ? "現場" : "線上"} {item.yourNumber} 號
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-white/80">目前服務號次</div>
                <div className="text-3xl font-bold">{item.current || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {waitlists.length > 0 && (
        <section className="space-y-2">
          <p className="px-1 text-sm font-medium text-slate-600">我的候補</p>
          {waitlists.map((item) => {
            const offered = item.status === "offered";
            const when = item.requested_start_at
              ? `${formatDateSession(item.requested_start_at)} ${formatTime(item.requested_start_at)}`
              : item.requested_date;
            return (
              <div key={item.id} className={`card space-y-3 border p-4 ${offered ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{when}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.services?.name ?? item.doctors?.name ?? "預約候補"}
                      {item.patients?.name ? ` · ${item.patients.name}` : ""}
                    </p>
                  </div>
                  <span className={`badge ${offered ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-600"}`}>
                    {offered ? "名額保留中" : `第 ${item.position} 位`}
                  </span>
                </div>
                {offered && (
                  <p className="text-xs text-amber-800">
                    請於 {item.offer_expires_at ? `${formatDateSession(item.offer_expires_at)} ${formatTime(item.offer_expires_at)}` : "通知期限內"} 接受，逾時會自動提供給下一位。
                  </p>
                )}
                <div className="flex gap-2">
                  {offered && (
                    <button type="button" disabled={cancelling === item.id} onClick={() => void waitlistAction(item.id, "accept", item.patient_id)} className="btn btn-primary min-h-11 flex-1">
                      {cancelling === item.id ? "處理中…" : "接受名額"}
                    </button>
                  )}
                  <button type="button" disabled={cancelling === item.id} onClick={() => void waitlistAction(item.id, "cancel", item.patient_id)} className="btn btn-secondary min-h-11 flex-1">
                    取消候補
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {list.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-400">目前沒有未來的預約。</div>
      ) : (
        <div className="space-y-3">
          {list.map((appointment) => (
            <div key={appointment.id} className="card flex flex-col items-stretch justify-between gap-3 p-4 sm:flex-row sm:items-center">
              <div>
                <div className="font-medium text-slate-900">
                  {mode === "time"
                    ? `${formatDateSession(appointment.start_at)} ${formatTime(appointment.start_at)}`
                    : `${formatDateSession(appointment.start_at)} 第 ${appointment.queue_number} 號`}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {appointment.doctors?.name}
                  {appointment.patients?.name ? ` · ${appointment.patients.name}` : ""} · 預約成功
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {appointment.deposit_status === "pending" && (
                  <button type="button" disabled={cancelling === appointment.id} onClick={() => void payAppointment(appointment.id)} className="btn btn-primary px-3 py-1.5 text-xs">
                    {cancelling === appointment.id ? "處理中…" : `付訂金 $${appointment.deposit_amount}`}
                  </button>
                )}
                {appointment.service_id && (
                  <button type="button" onClick={() => onRebook(appointment)} className="btn btn-secondary px-3 py-1.5 text-xs">
                    再次預約
                  </button>
                )}
                <button type="button" onClick={() => openReschedule(appointment.id)} className="btn btn-secondary px-3 py-1.5 text-xs">
                  改期
                </button>
                <button type="button" disabled={cancelling === appointment.id} onClick={() => void cancel(appointment.id)} className="btn btn-danger px-3 py-1.5 text-xs">
                  {cancelling === appointment.id ? "取消中…" : "取消"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
