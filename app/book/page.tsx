"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiff } from "@/lib/useLiff";
import { formatTime, formatDateSession } from "@/lib/slots";
import { Brand } from "@/components/Brand";

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

  const [pickedStart, setPickedStart] = useState<string | null>(null);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [visitType, setVisitType] = useState<"first" | "return">("return");
  const [isSelfPay, setIsSelfPay] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReserveResult | null>(null);

  const [tab, setTab] = useState<"book" | "my">("book");

  useEffect(() => {
    api<Config>("/api/booking/config")
      .then(setConfig)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "載入失敗"));
  }, []);

  const maxDate = useMemo(
    () => (config ? todayStr(config.max_advance_days) : todayStr(30)),
    [config],
  );

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

  const slotPicked = config?.booking_mode === "time" ? !!pickedStart : !!pickedTemplate;
  const canSubmit = ready && !!name.trim() && !!phone.trim() && slotPicked && !submitting;

  async function handleSubmit() {
    if (!config || !idToken) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const { patient_id } = await api<{ patient_id: string }>("/api/booking/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, name: name.trim(), phone: phone.trim() }),
      });

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
  if (liffError) return <Centered tone="error">{liffError}</Centered>;
  if (loadErr) return <Centered tone="error">{loadErr}</Centered>;
  if (!config) return <Centered>載入中…</Centered>;

  if (result) {
    return (
      <Shell>
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-500 to-accent-600 p-6 text-center text-white">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold">預約成功</h1>
            <p className="mt-1 text-sm text-white/80">看診前會以 LINE 提醒您</p>
          </div>

          <div className="space-y-4 p-6 text-center">
            {result.queue_number != null && (
              <div>
                <div className="text-sm text-slate-500">您的號次</div>
                <div className="text-4xl font-bold text-brand-700">
                  {result.queue_number}
                  <span className="ml-1 text-lg">號</span>
                </div>
              </div>
            )}
            {result.start_at && (
              <div className="rounded-xl bg-slate-50 p-3 text-slate-700">
                {config.booking_mode === "time"
                  ? `${formatDateSession(result.start_at)} ${formatTime(result.start_at)}`
                  : formatDateSession(result.start_at)}
              </div>
            )}
            {result.deposit_status === "pending" && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                需繳訂金 NT${result.deposit_amount},完成後即保留名額。詳情請洽櫃檯。
              </p>
            )}
            <button onClick={() => setResult(null)} className="btn btn-secondary w-full">
              再預約一筆
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const stepDone = { doctor: !!doctorId, date: !!date, slot: slotPicked };

  return (
    <Shell>
      {/* 分頁:預約 / 我的預約 */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        <TabButton active={tab === "book"} onClick={() => setTab("book")}>
          預約看診
        </TabButton>
        <TabButton active={tab === "my"} onClick={() => setTab("my")}>
          我的預約
        </TabButton>
      </div>

      {tab === "my" ? (
        <MyAppointments idToken={idToken} mode={config.booking_mode} />
      ) : (
      <>
      <div className="space-y-4">
        {/* 步驟 1:選醫師與日期 */}
        <section className="card p-5">
          <SectionTitle n={1} title="選擇醫師與日期" done={stepDone.doctor && stepDone.date} />
          <div className="space-y-4">
            <div>
              <label className="label">醫師</label>
              <select
                className="input"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
              >
                <option value="">請選擇醫師</option>
                {config.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? `(${d.specialty})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">日期</label>
              <input
                type="date"
                className="input"
                value={date}
                min={todayStr()}
                max={maxDate}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* 步驟 2:選時段/診次 */}
        {doctorId && date && (
          <section className="card p-5">
            <SectionTitle
              n={2}
              title={config.booking_mode === "time" ? "選擇時段" : "選擇診次"}
              done={stepDone.slot}
            />
            {availLoading && <p className="text-sm text-slate-400">查詢中…</p>}
            {availMsg && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{availMsg}</p>
            )}

            {config.booking_mode === "time" && !availLoading && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={s.slot_start}
                    type="button"
                    onClick={() => setPickedStart(s.slot_start)}
                    className={`pill flex flex-col items-center ${pickedStart === s.slot_start ? "pill-active" : ""}`}
                  >
                    <span className="font-medium">{formatTime(s.slot_start)}</span>
                    <span className="text-[11px] opacity-70">剩 {s.remaining}</span>
                  </button>
                ))}
              </div>
            )}

            {config.booking_mode === "number" && !availLoading && (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <button
                    key={s.template_id}
                    type="button"
                    onClick={() => setPickedTemplate(s.template_id)}
                    className={`pill flex w-full items-center justify-between ${pickedTemplate === s.template_id ? "pill-active" : ""}`}
                  >
                    <span className="font-medium">
                      {formatDateSession(s.session_start)}　{formatTime(s.session_start)}–
                      {formatTime(s.session_end)}
                    </span>
                    <span className="text-xs opacity-70">剩 {s.remaining} 號</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 步驟 3:就診資料 */}
        <section className="card p-5">
          <SectionTitle n={3} title="就診資料" done={!!name.trim() && !!phone.trim()} />
          <div className="space-y-4">
            <div>
              <label className="label">姓名</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="就診者姓名"
              />
            </div>
            <div>
              <label className="label">電話</label>
              <input
                className="input"
                value={phone}
                inputMode="tel"
                onChange={(e) => setPhone(e.target.value)}
                placeholder="聯絡電話"
              />
            </div>
            <div>
              <label className="label">看診類型</label>
              <div className="grid grid-cols-2 gap-2">
                <TypeToggle active={visitType === "return"} onClick={() => setVisitType("return")}>
                  複診
                </TypeToggle>
                <TypeToggle active={visitType === "first"} onClick={() => setVisitType("first")}>
                  初診
                </TypeToggle>
              </div>
            </div>
            <label className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={isSelfPay}
                onChange={(e) => setIsSelfPay(e.target.checked)}
              />
              自費就診
            </label>
          </div>
        </section>

        {submitErr && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitErr}</p>
        )}
      </div>

      {/* 固定底部送出列 */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-200 bg-white/90 p-4 backdrop-blur">
        <button type="button" disabled={!canSubmit} onClick={handleSubmit} className="btn btn-primary w-full">
          {submitting ? "送出中…" : "確認預約"}
        </button>
        {!ready && !liffError && (
          <p className="mt-2 text-center text-xs text-slate-400">正在確認 LINE 身分…</p>
        )}
      </div>
      </>
      )}
    </Shell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg py-2 text-sm font-medium transition-colors ${
        active ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}

interface MyAppt {
  id: string;
  start_at: string;
  queue_number: number | null;
  status: string;
  doctors: { name: string } | null;
  patients: { name: string } | null;
}

function MyAppointments({ idToken, mode }: { idToken: string | null; mode: "time" | "number" }) {
  const [list, setList] = useState<MyAppt[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!idToken) return;
    setErr(null);
    try {
      const data = await api<{ appointments: MyAppt[] }>("/api/booking/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      setList(data.appointments);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "查詢失敗");
    }
  }, [idToken]);

  useEffect(() => {
    load();
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "取消失敗");
    } finally {
      setCancelling(null);
    }
  }

  if (err) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>;
  if (list === null) return <p className="px-1 text-sm text-slate-400">載入中…</p>;
  if (list.length === 0)
    return (
      <div className="card p-6 text-center text-sm text-slate-400">目前沒有未來的預約。</div>
    );

  return (
    <div className="space-y-3">
      {list.map((a) => (
        <div key={a.id} className="card flex items-center justify-between p-4">
          <div>
            <div className="font-medium text-slate-900">
              {mode === "time"
                ? `${formatDateSession(a.start_at)} ${formatTime(a.start_at)}`
                : `${formatDateSession(a.start_at)} 第 ${a.queue_number} 號`}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {a.doctors?.name}
              {a.patients?.name ? ` · ${a.patients.name}` : ""} ·{" "}
              {a.status === "confirmed" ? "已確認" : "已預約"}
            </div>
          </div>
          <button
            type="button"
            disabled={cancelling === a.id}
            onClick={() => cancel(a.id)}
            className="btn btn-danger px-3 py-1.5 text-xs"
          >
            {cancelling === a.id ? "取消中…" : "取消"}
          </button>
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-4">
      <header className="flex items-center justify-between py-4">
        <Brand subtitle="線上預約" />
      </header>
      {children}
    </main>
  );
}

function SectionTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-accent-600 text-white" : "bg-brand-100 text-brand-700"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <h2 className="font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function TypeToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`pill text-center ${active ? "pill-active" : ""}`}>
      {children}
    </button>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <p className={tone === "error" ? "text-red-600" : "text-slate-500"}>{children}</p>
    </main>
  );
}
