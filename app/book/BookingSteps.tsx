"use client";

import { formatDateSession, formatTime } from "@/lib/slots";
import {
  BookingFields,
  SectionTitle,
  ServiceAddons,
  TypeToggle,
} from "./BookingFlowUi";
import type { BoundPatient, Config, Service, Session, Slot } from "./types";

function IdentityIcon({ group = false }: { group?: boolean }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {group ? <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 19c.6-3.5 2.4-5.3 5.5-5.3s4.9 1.8 5.5 5.3M14 14.7c2.9-.8 5.5.7 6.5 3.8" /></> : <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-4.2 3.1-6.3 7-6.3s6.2 2.1 7 6.3" /></>}
      </svg>
    </span>
  );
}

export function BookingIdentityChoice({
  onChooseSelf,
  onChooseOther,
}: {
  onChooseSelf: () => void;
  onChooseOther: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm font-medium text-slate-600">請問這次要為誰預約？</p>
      <button
        type="button"
        onClick={onChooseSelf}
        className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
      >
        <IdentityIcon />
        <span>
          <span className="block font-semibold text-slate-900">為我自己</span>
          <span className="block text-xs text-slate-400">用本人資料預約</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onChooseOther}
        className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
      >
        <IdentityIcon group />
        <span>
          <span className="block font-semibold text-slate-900">幫別人預約</span>
          <span className="block text-xs text-slate-400">家人 / 朋友（填寫對方資料）</span>
        </span>
      </button>
    </div>
  );
}

export function BookingCustomerStep({
  config,
  bound,
  selectedPatientId,
  selectedBlocked,
  addingNew,
  complete,
  email,
  name,
  phone,
  birthday,
  today,
  membershipCode,
  onResetChoice,
  onPatientChange,
  onEmailChange,
  onNameChange,
  onPhoneChange,
  onBirthdayChange,
  onMembershipCodeChange,
}: {
  config: Config;
  bound: BoundPatient[];
  selectedPatientId: string;
  selectedBlocked: boolean;
  addingNew: boolean;
  complete: boolean;
  email: string;
  name: string;
  phone: string;
  birthday: string;
  today: string;
  membershipCode: string;
  onResetChoice: () => void;
  onPatientChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onBirthdayChange: (value: string) => void;
  onMembershipCodeChange: (value: string) => void;
}) {
  return (
    <>
      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle n={1} title="顧客資料" done={complete} />
          <button type="button" onClick={onResetChoice} className="text-xs text-slate-400 hover:text-brand-600">
            重新選擇
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">預約對象</label>
            <select className="input" value={selectedPatientId} onChange={(event) => onPatientChange(event.target.value)}>
              {bound.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}（{patient.phone}）
                </option>
              ))}
              {config.allow_multi_patient_per_phone && bound.length < config.max_patients_per_phone && (
                <option value="__new__">+ 新增顧客</option>
              )}
            </select>
          </div>
          {selectedBlocked && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              此顧客目前暫停線上預約，請洽服務人員。
            </p>
          )}
          <div>
            <label className="label">Email（選填，用於提醒）</label>
            <input
              type="email"
              name="email"
              className="input"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
            />
          </div>
          {addingNew && (
            <>
              <div>
                <label className="label">姓名</label>
                <input className="input" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="顧客姓名" />
              </div>
              <div>
                <label className="label">電話</label>
                <input className="input" value={phone} inputMode="tel" onChange={(event) => onPhoneChange(event.target.value)} placeholder="聯絡電話" />
              </div>
              <div>
                <label className="label">出生年月日</label>
                <input type="date" className="input" value={birthday} max={today} onChange={(event) => onBirthdayChange(event.target.value)} />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-2">
          <label className="label">套票序號（選填）</label>
          <input
            className="input uppercase"
            value={membershipCode}
            onChange={(event) => onMembershipCodeChange(event.target.value.toUpperCase())}
            autoComplete="off"
            placeholder="使用套票時輸入序號"
          />
        </div>
        <p className="text-xs leading-5 text-slate-500">符合方案時會在成功預約後扣除一堂額度；套票限本人電話綁定的會員使用。</p>
      </section>
    </>
  );
}

export function BookingServiceStep({
  config,
  selectedService,
  serviceId,
  visitType,
  bookingAnswers,
  selectedAddonIds,
  complete,
  onServiceChange,
  onVisitTypeChange,
  onBookingAnswerChange,
  onAddonIdsChange,
}: {
  config: Config;
  selectedService: Service | null;
  serviceId: string;
  visitType: "first" | "return";
  bookingAnswers: Record<string, unknown>;
  selectedAddonIds: string[];
  complete: boolean;
  onServiceChange: (value: string) => void;
  onVisitTypeChange: (value: "first" | "return") => void;
  onBookingAnswerChange: (key: string, value: unknown) => void;
  onAddonIdsChange: (ids: string[]) => void;
}) {
  return (
    <section className="card p-5">
      <SectionTitle n={2} title="服務項目" done={complete} />
      <div className="space-y-4">
        {config.services.length > 0 && (
          <div>
            <label className="label">服務項目</label>
            <select className="input" value={serviceId} onChange={(event) => onServiceChange(event.target.value)}>
              <option value="">請選擇服務</option>
              {config.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">預約類型（請確認）</label>
          <div className="grid grid-cols-2 gap-2">
            <TypeToggle active={visitType === "return"} onClick={() => onVisitTypeChange("return")}>再次服務</TypeToggle>
            <TypeToggle active={visitType === "first"} onClick={() => onVisitTypeChange("first")}>首次服務</TypeToggle>
          </div>
          {visitType === "first" && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
              🕒 首次服務可能需要較完整的資料確認，所需時間可能比再次服務長，請預留充足時間。
            </p>
          )}
        </div>
        <BookingFields fields={selectedService?.booking_fields ?? []} answers={bookingAnswers} onChange={onBookingAnswerChange} />
        <ServiceAddons addons={selectedService?.service_addons ?? []} selectedIds={selectedAddonIds} onChange={onAddonIdsChange} />
      </div>
    </section>
  );
}

export function BookingTimeStep({
  config,
  selectedService,
  providerRequired,
  canChooseTime,
  complete,
  doctorId,
  date,
  minDate,
  maxDate,
  loading,
  message,
  slots,
  waitlistSlots,
  sessions,
  waitlistSessions,
  pickedStart,
  pickedTemplate,
  joiningWaitlist,
  recurrenceCount,
  onDoctorChange,
  onDateChange,
  onPickTime,
  onPickSession,
  onRecurrenceChange,
}: {
  config: Config;
  selectedService: Service | null;
  providerRequired: boolean;
  canChooseTime: boolean;
  complete: boolean;
  doctorId: string;
  date: string;
  minDate: string;
  maxDate: string;
  loading: boolean;
  message: string | null;
  slots: Slot[];
  waitlistSlots: Slot[];
  sessions: Session[];
  waitlistSessions: Session[];
  pickedStart: string | null;
  pickedTemplate: string | null;
  joiningWaitlist: boolean;
  recurrenceCount: number;
  onDoctorChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onPickTime: (value: string, waitlist: boolean) => void;
  onPickSession: (value: string, waitlist: boolean) => void;
  onRecurrenceChange: (value: number) => void;
}) {
  return (
    <section className={`card p-5 ${!canChooseTime ? "pointer-events-none opacity-50" : ""}`}>
      <SectionTitle n={3} title="選擇時間" done={complete} />
      {!canChooseTime && <p className="mb-3 text-sm text-slate-400">請先完成上方顧客資料與服務，再選擇時間。</p>}
      <div className="space-y-4">
        {(providerRequired || selectedService?.booking_target === "provider_optional") && (
          <div>
            <label className="label">服務提供者</label>
            <select className="input" value={doctorId} onChange={(event) => onDoctorChange(event.target.value)}>
              <option value="">{selectedService?.booking_target === "provider_optional" ? "不指定，由系統安排" : "請選擇服務提供者"}</option>
              {config.doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}{doctor.specialty ? `（${doctor.specialty}）` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {selectedService?.booking_target === "resource_only" && (
          <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">此服務依場地／設備容量安排，不需要指定服務提供者。</p>
        )}
        <div>
          <label className="label">日期</label>
          <input type="date" className="input" value={date} min={minDate} max={maxDate} onChange={(event) => onDateChange(event.target.value)} />
        </div>

        {date && (!providerRequired || !!doctorId) && (
          <div>
            <p className="label">{config.booking_mode === "time" ? "時段" : "場次"}</p>
            {loading && <p className="text-sm text-slate-400">查詢中…</p>}
            {message && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{message}</p>}
            {config.booking_mode === "time" && !loading && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => (
                  <button key={slot.slot_start} type="button" onClick={() => onPickTime(slot.slot_start, false)} className={`pill flex flex-col items-center ${pickedStart === slot.slot_start ? "pill-active" : ""}`}>
                    <span className="font-medium">{formatTime(slot.slot_start)}</span>
                    <span className="text-[11px] opacity-70">剩 {slot.remaining}</span>
                  </button>
                ))}
              </div>
            )}
            {config.booking_mode === "time" && !loading && waitlistSlots.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-amber-700">額滿可候補</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {waitlistSlots.map((slot) => (
                    <button key={slot.slot_start} type="button" onClick={() => onPickTime(slot.slot_start, true)} className={`pill flex min-h-11 flex-col items-center border-amber-200 ${joiningWaitlist && pickedStart === slot.slot_start ? "bg-amber-100 text-amber-900 ring-2 ring-amber-400" : "bg-amber-50 text-amber-800"}`}>
                      <span className="font-medium">{formatTime(slot.slot_start)}</span>
                      <span className="text-[11px]">加入候補</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {config.booking_mode === "number" && !loading && (
              <div className="space-y-2">
                {sessions.map((session) => {
                  const full = session.remaining <= 0;
                  return (
                    <button
                      key={session.template_id}
                      type="button"
                      disabled={full}
                      onClick={() => { if (!full) onPickSession(session.template_id, false); }}
                      className={`pill flex w-full items-center justify-between ${full ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400" : pickedTemplate === session.template_id ? "pill-active" : ""}`}
                    >
                      <span className="font-medium">{formatDateSession(session.session_start)}　{formatTime(session.session_start)}–{formatTime(session.session_end)}</span>
                      {full ? <span className="text-xs font-medium text-red-500">名額已滿</span> : <span className="text-xs opacity-70">剩 {session.remaining} 號</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {config.booking_mode === "number" && !loading && waitlistSessions.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-amber-700">額滿可候補</p>
                {waitlistSessions.map((session) => (
                  <button key={session.template_id} type="button" onClick={() => onPickSession(session.template_id, true)} className={`pill flex min-h-11 w-full items-center justify-between border-amber-200 ${joiningWaitlist && pickedTemplate === session.template_id ? "bg-amber-100 text-amber-900 ring-2 ring-amber-400" : "bg-amber-50 text-amber-800"}`}>
                    <span>{formatDateSession(session.session_start)}　{formatTime(session.session_start)}–{formatTime(session.session_end)}</span>
                    <span className="text-xs font-medium">加入候補</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {complete && config.recurring_booking_enabled && selectedService && !joiningWaitlist && (
          <label className="block rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm">
            <span className="label">每週重複預約</span>
            <select className="input" value={recurrenceCount} onChange={(event) => onRecurrenceChange(Number(event.target.value))} disabled={config.deposit_enabled}>
              {Array.from({ length: config.max_recurring_occurrences }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>{count === 1 ? "只預約本次" : `連續 ${count} 週`}</option>
              ))}
            </select>
            <span className="mt-2 block text-xs text-slate-500">
              {config.deposit_enabled ? "啟用訂金時，請逐筆完成預約與付款。" : "系統會先確認每一週都有名額，再一次建立全部預約。"}
            </span>
          </label>
        )}
      </div>
    </section>
  );
}
