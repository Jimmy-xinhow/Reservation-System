"use client";

import { useCallback, useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

interface Doctor {
  id: string;
  name: string;
}
interface Service {
  id: string;
  name: string;
  booking_target?: "provider_required" | "provider_optional" | "resource_only";
  booking_fields?: BookingField[];
}
interface ApptOption {
  id: string;
  label: string;
  doctor_id: string | null;
  service_id: string | null;
}
interface BookingField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
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
interface PatientHit {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
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
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
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
  const [serviceId, setServiceId] = useState(services.length === 1 ? services[0].id : "");
  const [visitType, setVisitType] = useState<"first" | "return">("return");
  const [date, setDate] = useState(defaultDate ?? todayStr());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [picked, setPicked] = useState(""); // start_at 或 template_id
  const [msg, setMsg] = useState<string | null>(null);

  // 顧客:可搜尋既有顧客套入,或手動輸入新顧客
  const [patientId, setPatientId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PatientHit[]>([]);
  const [showResults, setShowResults] = useState(false);
  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  const providerRequired = !selectedService || selectedService.booking_target === "provider_required";
  const providerOptional = selectedService?.booking_target === "provider_optional";

  useEffect(() => {
    if (selectedService && !providerRequired) setDoctorId("");
  }, [providerRequired, selectedService]);

  useEffect(() => {
    if (!providerRequired || doctorId) return;
    setDoctorId(singleDoctor?.id ?? "");
  }, [doctorId, providerRequired, singleDoctor?.id]);

  useEffect(() => {
    const current = appointments.find((appointment) => appointment.id === targetId);
    if (current) {
      setDoctorId(current.doctor_id ?? "");
      setServiceId(current.service_id ?? "");
    } else if (!targetId) {
      setDoctorId(singleDoctor?.id ?? "");
      if (services.length !== 1) setServiceId("");
    }
  }, [appointments, services.length, singleDoctor?.id, targetId]);

  // 依姓名/電話/生日搜尋既有顧客(debounce 250ms)
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/patients/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.ok) {
          setResults(json.data.patients as PatientHit[]);
          setShowResults(true);
        }
      } catch {
        /* 搜尋失敗不打斷 */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  function selectPatient(p: PatientHit) {
    setPatientId(p.id);
    setName(p.name);
    setPhone(p.phone);
    setBirthday(p.birthday ?? "");
    setSearch("");
    setResults([]);
    setShowResults(false);
  }
  function clearSelection() {
    // 一旦手動改欄位,視為新顧客(不再綁定既有 id)
    if (patientId) setPatientId("");
  }

  const loadAvail = useCallback(async () => {
    setSlots([]);
    setSessions([]);
    setPicked("");
    setMsg(null);
    if (!date || (providerRequired && !doctorId) || (services.length > 0 && !serviceId)) return;
    try {
      const params = new URLSearchParams({ date, visit_type: visitType });
      if (doctorId) params.set("doctor_id", doctorId);
      if (serviceId) params.set("service_id", serviceId);
      const res = await fetch(`/api/booking/availability?${params.toString()}`);
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
  }, [doctorId, date, mode, providerRequired, serviceId, services.length, visitType]);

  useEffect(() => {
    loadAvail();
  }, [loadAvail]);

  const isReschedule = !!targetId;
  const action = isReschedule ? rescheduleAction : createAction;

  return (
    <form action={action} className="card overflow-hidden">
      {/* 表頭 + 動作切換 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <h2 className="font-semibold text-slate-900">
          {isReschedule ? "改期預約" : "建立預約"}
        </h2>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          動作
          <select
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">＋ 新增預約</option>
            {appointments.map((a) => (
              <option key={a.id} value={a.id}>
                改期:{a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <input type="hidden" name="mode" value={mode} />
      {isReschedule && <input type="hidden" name="old_id" value={targetId} />}
      <input type="hidden" name={mode === "time" ? "start_at" : "template_id"} value={picked} />
      {mode === "number" && <input type="hidden" name="date" value={date} />}
      <input type="hidden" name="doctor_id" value={doctorId} />

      <div className="space-y-5 p-5">
        {/* 主要:顧客 */}
        {!isReschedule && (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">顧客</p>

            {/* 搜尋既有顧客(姓名/電話/生日)→ 直接套入 */}
            <div className="relative mb-3">
              <input
                className="input"
                placeholder="🔍 搜尋既有顧客(姓名 / 電話 / 生日 MMDD)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => results.length > 0 && setShowResults(true)}
              />
              {showResults && results.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowResults(false)} />
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    {results.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => selectPatient(p)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50"
                        >
                          <span className="font-medium text-slate-800">{p.name}</span>
                          <span className="text-xs text-slate-400">
                            {p.phone}
                            {p.birthday ? ` · ${p.birthday}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {patientId && (
                <p className="mt-1 text-xs text-accent-600">已套入既有顧客資料,可直接建立預約。</p>
              )}
            </div>

            {!isReschedule && <input type="hidden" name="patient_id" value={patientId} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-sm font-medium text-slate-600">
                姓名
                <input
                  name="name"
                  className="input mt-1"
                  placeholder="顧客姓名"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearSelection();
                  }}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                電話
                <input
                  name="phone"
                  className="input mt-1"
                  inputMode="tel"
                  placeholder="聯絡電話"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearSelection();
                  }}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                生日
                <input
                  type="date"
                  name="birthday"
                  className="input mt-1"
                  max={todayStr()}
                  value={birthday}
                  onChange={(e) => {
                    setBirthday(e.target.value);
                    clearSelection();
                  }}
                />
              </label>
            </div>
          </section>
        )}

        {/* 主要:時間 */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">預約時間</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(providerRequired || providerOptional) && (
              <label className="block text-sm font-medium text-slate-600">
                服務提供者{providerOptional ? "（可不指定）" : ""}
                <select
                  className="input mt-1"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  required={providerRequired}
                >
                  <option value="">{providerRequired ? "請選擇" : "由系統安排"}</option>
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
            {services.length > 0 && (
              <label className="block text-sm font-medium text-slate-600">
                服務項目
                <select name="service_id" className="input mt-1" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  <option value="">請選擇服務</option>
                  {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {date && (!providerRequired || doctorId) && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="mb-2 text-xs text-slate-500">{mode === "time" ? "選擇時段" : "選擇服務場次"}</p>
              {msg && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</p>}
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
                {mode === "time" && slots.length === 0 && !msg && (
                  <p className="text-sm text-slate-400">此日無可用時段</p>
                )}
                {mode === "number" && sessions.length === 0 && !msg && (
                  <p className="text-sm text-slate-400">此日無可預約場次</p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 次要:預約細節 */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">預約細節</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium text-slate-600">
              預約類型
              <select name="visit_type" className="input mt-1" value={visitType} onChange={(event) => setVisitType(event.target.value as "first" | "return")}>
                <option value="return">再次服務</option>
                <option value="first">首次服務</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <input type="checkbox" name="is_self_pay" className="h-4 w-4 accent-brand-600" /> 自費
            </label>
          </div>
        </section>
      </div>

      {/* 送出列 */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
        <span className="text-xs text-slate-400">
          {picked ? "已選擇時段" : "請先選擇日期與時段"}
        </span>
        <SubmitButton disabled={!picked || (providerRequired && !doctorId) || (services.length > 0 && !serviceId)} className="btn btn-primary">
          {isReschedule ? "確認改期" : "建立預約"}
        </SubmitButton>
      </div>
    </form>
  );
}
