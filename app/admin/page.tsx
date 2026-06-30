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
}

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  cancelled: "已取消",
  done: "完成",
  no_show: "未到",
};

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export default async function TodayPage() {
  const supabase = await createSupabaseServer();
  const today = taipeiToday();
  const dayStart = new Date(`${today}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${today}T23:59:59.999+08:00`).toISOString();

  const [{ data: settings }, { data: doctors }, { data: appts }] = await Promise.all([
    supabase.from("clinic_settings").select("booking_mode").eq("clinic_id", CLINIC_ID).maybeSingle(),
    supabase.from("doctors").select("id, name").eq("clinic_id", CLINIC_ID).eq("active", true).order("name"),
    supabase
      .from("appointments")
      .select(
        "id, start_at, queue_number, visit_type, status, deposit_status, deposit_amount, doctors(name), patients(name, phone)",
      )
      .eq("clinic_id", CLINIC_ID)
      .gte("start_at", dayStart)
      .lte("start_at", dayEnd)
      .order("start_at")
      .order("queue_number", { nullsFirst: true }),
  ]);

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
        <h1 className="text-xl font-bold">今日約診 · {today}</h1>
        <span className="text-sm text-gray-500">
          模式:{mode === "time" ? "時間制" : "號次制"}
        </span>
      </div>

      <BookingForm
        mode={mode}
        doctors={doctors ?? []}
        appointments={rescheduleOptions}
        createAction={createAppointmentAction}
        rescheduleAction={rescheduleAppointmentAction}
      />

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-2">{mode === "time" ? "時間" : "號次"}</th>
              <th className="p-2">醫師</th>
              <th className="p-2">病患</th>
              <th className="p-2">初/複</th>
              <th className="p-2">狀態</th>
              <th className="p-2">訂金</th>
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-400">
                  今日尚無約診
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-2 font-medium">
                  {mode === "time" ? formatTime(r.start_at) : `第 ${r.queue_number} 號`}
                </td>
                <td className="p-2">{r.doctors?.name}</td>
                <td className="p-2">
                  <div>{r.patients?.name}</div>
                  <div className="text-xs text-gray-400">{r.patients?.phone}</div>
                </td>
                <td className="p-2">{r.visit_type === "first" ? "初診" : "複診"}</td>
                <td className="p-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="p-2">
                  {r.deposit_status === "none" ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    <form action={setDepositAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <select
                        name="deposit_status"
                        defaultValue={r.deposit_status}
                        className="rounded border p-1 text-xs"
                      >
                        <option value="pending">待繳</option>
                        <option value="paid">已繳</option>
                        <option value="waived">免收</option>
                        <option value="refunded">已退</option>
                      </select>
                      <button className="text-xs text-blue-600">更新</button>
                      <span className="text-xs text-gray-400">${r.deposit_amount}</span>
                    </form>
                  )}
                </td>
                <td className="p-2">
                  {r.status !== "cancelled" && r.status !== "done" && (
                    <div className="flex flex-wrap gap-1">
                      <StatusBtn id={r.id} status="confirmed" label="確認" />
                      <StatusBtn id={r.id} status="done" label="完成" />
                      <StatusBtn id={r.id} status="no_show" label="未到" />
                      <form action={cancelAppointmentAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600">
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
      <button className="rounded border px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
        {label}
      </button>
    </form>
  );
}
