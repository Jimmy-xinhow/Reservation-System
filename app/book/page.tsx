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
interface Service {
  id: string;
  name: string;
  description: string | null;
}
interface Config {
  booking_mode: "time" | "number";
  deposit_enabled: boolean;
  max_advance_days: number;
  allow_multi_patient_per_phone: boolean;
  max_patients_per_phone: number;
  doctors: Doctor[];
  services: Service[];
}
interface BoundPatient {
  id: string;
  name: string;
  phone: string;
  blocked_until: string | null;
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
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [availMsg, setAvailMsg] = useState<string | null>(null);

  const [pickedStart, setPickedStart] = useState<string | null>(null);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [visitType, setVisitType] = useState<"first" | "return">("return");
  const [isSelfPay, setIsSelfPay] = useState(false);

  // 綁定:此 LINE 身分已綁定的病患(null = 載入中)
  const [bound, setBound] = useState<BoundPatient[] | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState(""); // 病患 id 或 "__new__"
  const [forWhom, setForWhom] = useState<"" | "self" | "other">(""); // 為自己 / 幫別人

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReserveResult | null>(null);

  const [tab, setTab] = useState<"book" | "my">("book");

  useEffect(() => {
    api<Config>("/api/booking/config")
      .then(setConfig)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "載入失敗"));
  }, []);

  // 取得此 LINE 身分已綁定的病患
  const loadBound = useCallback(async () => {
    if (!idToken) return;
    try {
      const data = await api<{ patients: BoundPatient[] }>("/api/booking/patients-of-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      setBound(data.patients);
      setSelectedPatientId(data.patients[0]?.id ?? "__new__");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "讀取綁定失敗");
    }
  }, [idToken]);

  useEffect(() => {
    if (ready && idToken) loadBound();
  }, [ready, idToken, loadBound]);

  const maxDate = useMemo(
    () => (config ? todayStr(config.max_advance_days) : todayStr(30)),
    [config],
  );

  // 單一醫師診所:只有一位醫師時自動選取,不顯示選單
  const singleDoctor = config?.doctors.length === 1 ? config.doctors[0] : null;
  useEffect(() => {
    if (singleDoctor && doctorId !== singleDoctor.id) setDoctorId(singleDoctor.id);
  }, [singleDoctor, doctorId]);

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
  const addingNew = selectedPatientId === "__new__";
  const selectedBound = (bound ?? []).find((p) => p.id === selectedPatientId) ?? null;
  const selectedBlocked =
    !!selectedBound?.blocked_until && new Date(selectedBound.blocked_until) > new Date();
  const patientReady = addingNew
    ? !!name.trim() && !!phone.trim() && /^\d{4}-\d{2}-\d{2}$/.test(birthday)
    : !!selectedPatientId && !selectedBlocked;
  const serviceReady = config ? config.services.length === 0 || !!serviceId : false;
  const canSubmit = ready && patientReady && serviceReady && slotPicked && !submitting;

  async function handleSubmit() {
    if (!config || !idToken) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      // 已綁定病患直接用其 id;選「新增就診者」才建立新病患
      let patient_id = selectedPatientId;
      if (addingNew) {
        const created = await api<{ patient_id: string }>("/api/booking/patient", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, name: name.trim(), phone: phone.trim(), birthday }),
        });
        patient_id = created.patient_id;
      }

      const payload: Record<string, unknown> = {
        idToken,
        patient_id,
        doctor_id: doctorId,
        service_id: serviceId || undefined,
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
      loadBound(); // 若剛新增就診者,刷新綁定清單
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
            <p className="rounded-xl bg-red-50 p-3 text-left text-xs leading-relaxed text-red-700">
              ⚠️ 提醒:無法前來請務必提前取消。<strong>累計三次未提前取消而未到,將暫停一個月的線上預約資格。</strong>
            </p>
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
      ) : bound === null ? (
        <div className="card p-6 text-center text-sm text-slate-400">確認身分中…</div>
      ) : forWhom === "" ? (
        // 先選:為自己 / 幫別人
        <div className="space-y-3">
          <p className="px-1 text-sm font-medium text-slate-600">請問這次要為誰預約?</p>
          <button
            type="button"
            onClick={() => {
              setForWhom("self");
              setSelectedPatientId(bound[0]?.id ?? "__new__");
            }}
            className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="text-2xl">🧑</span>
            <span>
              <span className="block font-semibold text-slate-900">為我自己</span>
              <span className="block text-xs text-slate-400">用本人資料預約</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setForWhom("other");
              setSelectedPatientId("__new__");
            }}
            className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="text-2xl">👪</span>
            <span>
              <span className="block font-semibold text-slate-900">幫別人預約</span>
              <span className="block text-xs text-slate-400">家人 / 朋友(填寫對方資料)</span>
            </span>
          </button>
        </div>
      ) : (
      <>
      <div className="space-y-4">
        {/* 步驟 1:就診者資料 */}
        <section className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle n={1} title="就診者資料" done={patientReady} />
            <button
              type="button"
              onClick={() => setForWhom("")}
              className="text-xs text-slate-400 hover:text-brand-600"
            >
              重新選擇
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="label">為誰預約</label>
              <select
                className="input"
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
              >
                {(bound ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}({p.phone})
                  </option>
                ))}
                {config.allow_multi_patient_per_phone &&
                  (bound?.length ?? 0) < config.max_patients_per_phone && (
                    <option value="__new__">+ 新增就診者</option>
                  )}
              </select>
            </div>
            {selectedBlocked && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                此就診者目前暫停線上預約,請洽櫃檯。
              </p>
            )}
            {addingNew && (
              <>
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
                  <label className="label">出生年月日</label>
                  <input
                    type="date"
                    className="input"
                    value={birthday}
                    max={todayStr()}
                    onChange={(e) => setBirthday(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        {/* 步驟 2:看診服務與類型 */}
        <section className="card p-5">
          <SectionTitle n={2} title="看診服務" done={serviceReady} />
          <div className="space-y-4">
            {config.services.length > 0 && (
              <div>
                <label className="label">服務項目</label>
                <select
                  className="input"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">請選擇服務</option>
                  {config.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">看診類型(請確認)</label>
              <div className="grid grid-cols-2 gap-2">
                <TypeToggle active={visitType === "return"} onClick={() => setVisitType("return")}>
                  複診
                </TypeToggle>
                <TypeToggle active={visitType === "first"} onClick={() => setVisitType("first")}>
                  初診
                </TypeToggle>
              </div>
              {visitType === "first" && (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                  🕒 初診需較完整的問診與評估,看診時間會比複診長,請預留充足時間前來。
                </p>
              )}
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

        {/* 步驟 3:選醫師、日期與時段(資料填妥後) */}
        <section className={`card p-5 ${!patientReady || !serviceReady ? "pointer-events-none opacity-50" : ""}`}>
          <SectionTitle n={3} title="選擇時間" done={stepDone.slot} />
          {(!patientReady || !serviceReady) && (
            <p className="mb-3 text-sm text-slate-400">請先完成上方就診者資料與服務,再選擇時間。</p>
          )}
          <div className="space-y-4">
            {!singleDoctor && (
              <div>
                <label className="label">醫師</label>
                <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">請選擇醫師</option>
                  {config.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.specialty ? `(${d.specialty})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
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

            {doctorId && date && (
              <div>
                <p className="label">{config.booking_mode === "time" ? "時段" : "診次"}</p>
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
              </div>
            )}
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
interface ProgressItem {
  doctorName: string;
  label: string;
  yourNumber: number;
  current: number;
  status: string;
}

function MyAppointments({ idToken, mode }: { idToken: string | null; mode: "time" | "number" }) {
  const [list, setList] = useState<MyAppt[] | null>(null);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!idToken) return;
    setErr(null);
    try {
      const data = await api<{ appointments: MyAppt[]; progress: ProgressItem[] }>("/api/booking/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      setList(data.appointments);
      setProgress(data.progress ?? []);
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

  return (
    <div className="space-y-4">
      {/* 今日看診進度 */}
      {progress.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-sm font-medium text-slate-600">今日看診進度</p>
          {progress.map((pr, i) => (
            <div
              key={i}
              className="card flex items-center justify-between bg-gradient-to-br from-brand-500 to-accent-600 p-4 text-white"
            >
              <div>
                <div className="text-sm">{pr.doctorName} · {pr.label}</div>
                <div className="text-xs text-white/80">您的號碼 {pr.yourNumber}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-white/80">目前看診號</div>
                <div className="text-3xl font-bold">{pr.current || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-400">目前沒有未來的預約。</div>
      ) : (
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
      )}
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
