"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiff } from "@/lib/useLiff";
import { formatTime, formatDateSession } from "@/lib/slots";

interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
}
interface Config {
  booking_mode: "time" | "number";
  deposit_enabled: boolean;
  max_advance_days: number;
  doctors: Doctor[];
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
  total: number;
  taken: number;
  remaining: number;
}
interface ReserveResult {
  appointment_id: string;
  queue_number: number | null;
  deposit_status: string;
  deposit_amount: number;
  start_at: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!json) throw new Error("伺服器回應異常");
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function todayStr(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookPage() {
  const { ready, idToken, error: liffError } = useLiff();

  const [config, setConfig] = useState<Config | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [availMsg, setAvailMsg] = useState<string | null>(null);

  const [pickedStart, setPickedStart] = useState<string | null>(null); // time 模式 start_at
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null); // number 模式 template_id

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [visitType, setVisitType] = useState<"first" | "return">("return");
  const [isSelfPay, setIsSelfPay] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReserveResult | null>(null);

  // 載入設定 + 醫師
  useEffect(() => {
    api<Config>("/api/booking/config")
      .then(setConfig)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "載入失敗"));
  }, []);

  const maxDate = useMemo(
    () => (config ? todayStr(config.max_advance_days) : todayStr(30)),
    [config],
  );

  // 查空檔
  const loadAvailability = useCallback(async () => {
    if (!config || !doctorId || !date) return;
    setAvailLoading(true);
    setAvailMsg(null);
    setSlots([]);
    setSessions([]);
    setPickedStart(null);
    setPickedTemplate(null);
    try {
      if (config.booking_mode === "time") {
        const data = await api<{ slots: Slot[] }>(
          `/api/booking/availability?doctor_id=${doctorId}&date=${date}`,
        );
        setSlots(data.slots);
        if (data.slots.length === 0) setAvailMsg("這天沒有可預約的時段(休診或已額滿)");
      } else {
        const data = await api<{ sessions: Session[] }>(
          `/api/booking/availability?doctor_id=${doctorId}&date=${date}`,
        );
        setSessions(data.sessions);
        if (data.sessions.length === 0) setAvailMsg("這天沒有可掛號的診次(休診或已額滿)");
      }
    } catch (e) {
      setAvailMsg(e instanceof Error ? e.message : "查詢失敗");
    } finally {
      setAvailLoading(false);
    }
  }, [config, doctorId, date]);

  useEffect(() => {
    if (doctorId && date) loadAvailability();
  }, [doctorId, date, loadAvailability]);

  const canSubmit =
    ready &&
    !!name.trim() &&
    !!phone.trim() &&
    (config?.booking_mode === "time" ? !!pickedStart : !!pickedTemplate) &&
    !submitting;

  async function handleSubmit() {
    if (!config || !idToken) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      // 1) 建立/取得病患
      const { patient_id } = await api<{ patient_id: string }>("/api/booking/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, name: name.trim(), phone: phone.trim() }),
      });

      // 2) 訂位
      const payload: Record<string, unknown> = {
        idToken,
        patient_id,
        doctor_id: doctorId,
        visit_type: visitType,
        is_self_pay: isSelfPay,
      };
      if (config.booking_mode === "time") {
        payload.start_at = pickedStart;
      } else {
        payload.template_id = pickedTemplate;
        payload.date = date;
      }
      const res = await api<ReserveResult>("/api/booking/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setResult(res);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "預約失敗");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 畫面 ──
  if (liffError) return <Centered>{liffError}</Centered>;
  if (loadErr) return <Centered>{loadErr}</Centered>;
  if (!config) return <Centered>載入中…</Centered>;

  if (result) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <h1 className="mb-2 text-xl font-bold text-green-700">預約成功</h1>
          {result.queue_number != null && (
            <p className="my-3 text-3xl font-bold text-green-800">第 {result.queue_number} 號</p>
          )}
          {result.start_at && (
            <p className="text-gray-700">
              {config.booking_mode === "time"
                ? `${formatDateSession(result.start_at)} ${formatTime(result.start_at)}`
                : formatDateSession(result.start_at)}
            </p>
          )}
          {result.deposit_status === "pending" && (
            <p className="mt-4 rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
              需繳訂金 NT${result.deposit_amount},完成後即保留名額。詳情請洽櫃檯。
            </p>
          )}
          <p className="mt-4 text-sm text-gray-500">看診前會以 LINE 提醒您。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-xl font-bold">
        {config.booking_mode === "time" ? "預約看診" : "線上掛號"}
      </h1>

      <Field label="醫師">
        <select
          className="w-full rounded-lg border border-gray-300 p-2"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
        >
          <option value="">請選擇</option>
          {config.doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.specialty ? `(${d.specialty})` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="日期">
        <input
          type="date"
          className="w-full rounded-lg border border-gray-300 p-2"
          value={date}
          min={todayStr()}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>

      {doctorId && date && (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-gray-600">
            {config.booking_mode === "time" ? "可預約時段" : "可掛號診次"}
          </p>
          {availLoading && <p className="text-sm text-gray-500">查詢中…</p>}
          {availMsg && <p className="text-sm text-red-600">{availMsg}</p>}

          {config.booking_mode === "time" && (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((s) => (
                <button
                  key={s.slot_start}
                  type="button"
                  onClick={() => setPickedStart(s.slot_start)}
                  className={`rounded-lg border p-2 text-sm ${
                    pickedStart === s.slot_start
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  <div>{formatTime(s.slot_start)}</div>
                  <div className="text-xs opacity-80">剩 {s.remaining}</div>
                </button>
              ))}
            </div>
          )}

          {config.booking_mode === "number" && (
            <div className="flex flex-col gap-2">
              {sessions.map((s) => (
                <button
                  key={s.template_id}
                  type="button"
                  onClick={() => setPickedTemplate(s.template_id)}
                  className={`flex items-center justify-between rounded-lg border p-3 text-sm ${
                    pickedTemplate === s.template_id
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  <span>
                    {formatDateSession(s.session_start)}　{formatTime(s.session_start)}–
                    {formatTime(s.session_end)}
                  </span>
                  <span className="text-gray-500">剩 {s.remaining} 號</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Field label="姓名">
        <input
          className="w-full rounded-lg border border-gray-300 p-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="就診者姓名"
        />
      </Field>

      <Field label="電話">
        <input
          className="w-full rounded-lg border border-gray-300 p-2"
          value={phone}
          inputMode="tel"
          onChange={(e) => setPhone(e.target.value)}
          placeholder="聯絡電話"
        />
      </Field>

      <Field label="初診 / 複診">
        <div className="flex gap-4">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={visitType === "return"}
              onChange={() => setVisitType("return")}
            />
            複診
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={visitType === "first"}
              onChange={() => setVisitType("first")}
            />
            初診
          </label>
        </div>
      </Field>

      <label className="mb-4 flex items-center gap-2">
        <input type="checkbox" checked={isSelfPay} onChange={(e) => setIsSelfPay(e.target.checked)} />
        <span className="text-sm text-gray-700">自費就診</span>
      </label>

      {submitErr && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{submitErr}</p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:bg-gray-300"
      >
        {submitting ? "送出中…" : "確認預約"}
      </button>
      {!ready && !liffError && (
        <p className="mt-2 text-center text-xs text-gray-400">正在確認 LINE 身分…</p>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center text-gray-600">
      {children}
    </main>
  );
}
