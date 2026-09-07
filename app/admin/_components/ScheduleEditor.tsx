"use client";

import { useMemo, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

const WD = ["日", "一", "二", "三", "四", "五", "六"];

interface Doctor {
  id: string;
  name: string;
  active: boolean;
}
interface Template {
  id: string;
  doctor_id: string | null;
  service_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity: number;
  active: boolean;
}
interface Service { id: string; name: string; active: boolean; }
type ServerAction = (fd: FormData) => Promise<void>;

function hhmm(t: string): string {
  return (t ?? "").slice(0, 5);
}

export default function ScheduleEditor({
  doctors,
  services,
  templates,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
}: {
  doctors: Doctor[];
  services: Service[];
  templates: Template[];
  createAction: ServerAction;
  updateAction: ServerAction;
  toggleAction: ServerAction;
  deleteAction: ServerAction;
}) {
  const activeDocs = doctors.filter((d) => d.active);
  const activeServices = services.filter((s) => s.active);
  const docName = (id: string) => doctors.find((d) => d.id === id)?.name ?? "—";
  const serviceName = (id: string) => services.find((service) => service.id === id)?.name ?? "未命名服務";

  // 受控表單。editingId 有值 = 編輯既有列;null = 新增。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState(activeDocs[0]?.id ?? "");
  const [serviceId, setServiceId] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [slot, setSlot] = useState("15");
  const [cap, setCap] = useState("1");
  const [weekdayFilter, setWeekdayFilter] = useState("all");
  const formRef = useRef<HTMLFormElement>(null);
  const visibleTemplates = useMemo(
    () => weekdayFilter === "all" ? templates : templates.filter((template) => String(template.weekday) === weekdayFilter),
    [templates, weekdayFilter],
  );

  function fill(t: Template) {
    setDoctorId(t.doctor_id ?? "");
    setServiceId(t.service_id ?? "");
    setWeekday(String(t.weekday));
    setStart(hhmm(t.start_time));
    setEnd(hhmm(t.end_time));
    setSlot(String(t.slot_minutes));
    setCap(String(t.capacity));
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function editFrom(t: Template) {
    setEditingId(t.id);
    fill(t);
  }
  function copyFrom(t: Template) {
    setEditingId(null); // 複製 = 以此值新增一筆
    fill(t);
  }
  function cancelEdit() {
    setEditingId(null);
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2 className="font-semibold text-slate-900">每週服務時段</h2>
          <p className="mt-0.5 text-xs text-slate-500">同一位人員在同一天可以設定上午、下午等多段時段。</p>
        </div>
        <span className="text-xs tabular-nums text-slate-500">{templates.length} 個時段</span>
      </div>

      <form
        ref={formRef}
        action={editingId ? updateAction : createAction}
        className={`grid scroll-mt-24 gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4 ${editingId ? "bg-brand-50/40" : "bg-white"}`}
      >
        {editingId && <input type="hidden" name="id" value={editingId} />}
        <label className="text-sm">
          <span className="label">服務提供者</span>
          <select
            name="doctor_id"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="input"
          >
            <option value="">不指定</option>
            {activeDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">對應服務</span>
          <select name="service_id" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input">
            <option value="">共用服務提供者排程</option>
            {activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">星期</span>
          <select
            name="weekday"
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            className="input"
          >
            {WD.map((w, i) => (
              <option key={i} value={i}>
                週{w}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">開始時間</span>
          <input
            name="start_time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            type="time"
            className="input"
          />
        </label>
        <label className="text-sm">
          <span className="label">結束時間</span>
          <input
            name="end_time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            type="time"
            className="input"
          />
        </label>
        <label className="text-sm">
          <span className="label">預約間隔（分鐘）</span>
          <input
            name="slot_minutes"
            type="number"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            min="1"
            max="1440"
            className="input"
          />
        </label>
        <label className="text-sm">
          <span className="label">每時段容量／總號數</span>
          <input
            name="capacity"
            type="number"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            min="1"
            max="10000"
            className="input"
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <SubmitButton className="btn btn-primary">{editingId ? "儲存時段修改" : "新增服務時段"}</SubmitButton>
          {editingId && <button type="button" onClick={cancelEdit} className="btn btn-secondary">取消編輯</button>}
        </div>
        <p className="text-xs leading-5 text-slate-500 sm:col-span-2 lg:col-span-4">人員服務請選擇服務提供者；教室、器材等不指定人員的服務，請選擇對應服務。</p>
      </form>

      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">時段清單</p>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          顯示星期
          <select className="input h-9 min-w-28 py-1 text-xs" value={weekdayFilter} onChange={(event) => setWeekdayFilter(event.target.value)}>
            <option value="all">全部星期</option>
            {WD.map((day, index) => <option key={day} value={index}>週{day}</option>)}
          </select>
        </label>
      </div>

      <div className="admin-table-shell admin-table-mobile-cards border-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>星期</th>
              <th>服務提供者／服務</th>
              <th>時間</th>
              <th>每格</th>
              <th>容量/總號</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleTemplates.length === 0 && (
              <tr>
                <td colSpan={7} data-mobile-empty="true" className="py-8 text-center text-slate-400">
                  {templates.length === 0 ? "尚未建立服務時段" : "這個星期沒有服務時段"}
                </td>
              </tr>
            )}
            {visibleTemplates.map((t) => (
              <tr key={t.id} className={editingId === t.id ? "bg-brand-50/60" : ""}>
                <td data-label="星期">週{WD[t.weekday]}</td>
                <td data-label="服務提供者／服務">{t.service_id ? serviceName(t.service_id) : docName(t.doctor_id ?? "")}</td>
                <td data-label="時間">
                  {hhmm(t.start_time)}–{hhmm(t.end_time)}
                </td>
                <td data-label="預約間隔">{t.slot_minutes} 分</td>
                <td data-label="容量／總號數">{t.capacity}</td>
                <td data-label="狀態">
                  <span className={`badge ${t.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                    {t.active ? "啟用" : "停用"}
                  </span>
                </td>
                <td data-label="操作">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => editFrom(t)}
                      className="admin-inline-action text-brand-700"
                    >
                      編輯時段
                    </button>
                    <button
                      type="button"
                      onClick={() => copyFrom(t)}
                      className="admin-inline-action"
                    >
                      複製時段
                    </button>
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={String(t.active)} />
                      <SubmitButton className="admin-inline-action">
                        {t.active ? "停用時段" : "啟用時段"}
                      </SubmitButton>
                    </form>
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <ConfirmSubmitButton confirmMessage="刪除後將移除這個每週服務時段，既有預約不會刪除。確定繼續嗎？" className="admin-inline-action text-red-700">刪除時段</ConfirmSubmitButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
