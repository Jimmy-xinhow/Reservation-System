import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { formatTime } from "@/lib/slots";
import BookingForm from "./_components/BookingForm";
import {
  setStatusAction,
  cancelAppointmentAction,
  setDepositAction,
  createAppointmentAction,
  rescheduleAppointmentAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  start_at: string;
  queue_number: number | null;
  visit_type: string;
  status: string;
  deposit_status: string;
  deposit_amount: number;
  doctors: { name: string } | null;
  patients: { name: string; phone: string } | null;
  services: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  cancelled: "已取消",
  done: "完成",
  no_show: "未到",
};

const STATUS_STYLE: Record<string, string> = {
  booked: "bg-brand-50 text-brand-700",
  confirmed: "bg-accent-500/10 text-accent-600",
  done: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-600",
  no_show: "bg-amber-50 text-amber-700",
};

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ doctor?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const fDoctor = sp.doctor ?? "";
  const fStatus = sp.status ?? "";

  const supabase = await createSupabaseServer();
  const today = taipeiToday();
  const dayStart = new Date(`${today}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${today}T23:59:59.999+08:00`).toISOString();

  let apptQuery = supabase
    .from("appointments")
    .select(
      "id, start_at, queue_number, visit_type, status, deposit_status, deposit_amount, doctor_id, doctors(name), patients(name, phone), services(name)",
    )
    .eq("clinic_id", CLINIC_ID)
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd);
  if (fDoctor) apptQuery = apptQuery.eq("doctor_id", fDoctor);
  if (fStatus) apptQuery = apptQuery.eq("status", fStatus);

  const [{ data: settings }, { data: doctors }, { data: appts }] = await Promise.all([
    supabase.from("clinic_settings").select("booking_mode").eq("clinic_id", CLINIC_ID).maybeSingle(),
    supabase.from("doctors").select("id, name").eq("clinic_id", CLINIC_ID).eq("active", true).order("name"),
    apptQuery.order("start_at").order("queue_number", { nullsFirst: true }),
  ]);

  // 注意:settings 為 null 代表「讀不到設定」(權限/RLS/未建),不要靜默當成 time 制掩蓋,
  // 以 settingsUnavailable 明確提示;mode 僅用於排版,真正的狀態以警示呈現。
  const settingsUnavailable = !settings;
  const mode = (settings?.booking_mode as "time" | "number") ?? "time";
  const rows = (appts ?? []) as unknown as Row[];
  const rescheduleOptions = rows
    .filter((r) => r.status === "booked" || r.status === "confirmed")
    .map((r) => ({
      id: r.id,
      label: `${r.patients?.name ?? ""} ${mode === "time" ? formatTime(r.start_at) : `第${r.queue_number}號`}`,
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">今日約診</h1>
          <p className="text-sm text-slate-400">{today}</p>
        </div>
        <span className="badge bg-brand-50 text-brand-700">
          {settingsUnavailable ? "讀不到設定" : mode === "time" ? "時間制" : "號次制"}
        </span>
      </div>

      {settingsUnavailable && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          讀不到此診所設定(clinic_settings)。請確認登入帳號已對應到本診所(clinic_members),
          否則畫面模式與部分功能會不正確。
        </p>
      )}

      {(doctors ?? []).length === 0 ? (
        <div className="card flex flex-col items-start gap-2 p-5">
          <p className="text-sm text-slate-600">尚未建立任何醫師,病患無法預約。</p>
          <a href="/admin/schedules" className="btn btn-primary">
            前往門診表新增醫師
          </a>
        </div>
      ) : (
        <BookingForm
          mode={mode}
          doctors={doctors ?? []}
          appointments={rescheduleOptions}
          createAction={createAppointmentAction}
          rescheduleAction={rescheduleAppointmentAction}
        />
      )}

      {/* 篩選列 + 今日筆數 */}
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">醫師</label>
          <select name="doctor" defaultValue={fDoctor} className="input">
            <option value="">全部醫師</option>
            {(doctors ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">狀態</label>
          <select name="status" defaultValue={fStatus} className="input">
            <option value="">全部狀態</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary">套用</button>
        {(fDoctor || fStatus) && (
          <a href="/admin" className="btn btn-ghost">
            清除
          </a>
        )}
        <span className="ml-auto self-center text-sm text-slate-400">今日 {rows.length} 筆</span>
      </form>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{mode === "time" ? "時間" : "號次"}</th>
              <th>醫師</th>
              <th>病患</th>
              <th>服務</th>
              <th>初/複</th>
              <th>狀態</th>
              <th>訂金</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-400">
                  今日尚無約診
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold text-slate-900">
                  {mode === "time" ? formatTime(r.start_at) : `第 ${r.queue_number} 號`}
                </td>
                <td>{r.doctors?.name}</td>
                <td>
                  <div className="font-medium text-slate-800">{r.patients?.name}</div>
                  <div className="text-xs text-slate-400">{r.patients?.phone}</div>
                </td>
                <td>
                  {r.services?.name ? (
                    <span className="badge bg-slate-100 text-slate-600">{r.services.name}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td>
                  {r.visit_type === "first" ? (
                    <span className="badge bg-accent-500/10 text-accent-600">初診</span>
                  ) : (
                    <span className="text-slate-500">複診</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td>
                  {r.deposit_status === "none" ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <form action={setDepositAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={r.id} />
                      <select
                        name="deposit_status"
                        defaultValue={r.deposit_status}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="pending">待繳</option>
                        <option value="paid">已繳</option>
                        <option value="waived">免收</option>
                        <option value="refunded">已退</option>
                      </select>
                      <button className="text-xs font-medium text-brand-600 hover:underline">更新</button>
                      <span className="text-xs text-slate-400">${r.deposit_amount}</span>
                    </form>
                  )}
                </td>
                <td>
                  {r.status !== "cancelled" && r.status !== "done" && (
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBtn id={r.id} status="confirmed" label="確認" />
                      <StatusBtn id={r.id} status="done" label="完成" />
                      <StatusBtn id={r.id} status="no_show" label="未到" />
                      <form action={cancelAppointmentAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                          取消
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBtn({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
        {label}
      </button>
    </form>
  );
}
