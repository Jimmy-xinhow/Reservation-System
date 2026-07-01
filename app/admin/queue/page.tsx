import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { getQueueForDate, taipeiToday } from "@/lib/queue";
import { advanceServingAction, setStatusAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  booked: "候診",
  confirmed: "候診",
  done: "完成",
  no_show: "未到",
};

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; doctor?: string }>;
}) {
  const sp = await searchParams;
  const today = taipeiToday();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const doctorId = sp.doctor || undefined;

  const supabase = await createSupabaseServer();
  const [{ data: settings }, { data: doctors }] = await Promise.all([
    supabase.from("clinic_settings").select("booking_mode").eq("clinic_id", CLINIC_ID).maybeSingle(),
    supabase.from("doctors").select("id, name").eq("clinic_id", CLINIC_ID).eq("active", true).order("name"),
  ]);
  const mode = (settings?.booking_mode as "time" | "number") ?? "time";
  const sessions = await getQueueForDate(supabase, CLINIC_ID, date, mode, doctorId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">
          叫號 · {date}
          {date === today && <span className="ml-2 text-sm font-normal text-accent-600">今天</span>}
        </h1>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">日期</label>
          <input type="date" name="date" defaultValue={date} className="input" />
        </div>
        {(doctors ?? []).length > 1 && (
          <div>
            <label className="label">醫師</label>
            <select name="doctor" defaultValue={doctorId ?? ""} className="input">
              <option value="">全部醫師</option>
              {(doctors ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className="btn btn-secondary">套用</button>
      </form>

      <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-xs leading-relaxed text-slate-500">
        線上與現場(後台建立)的預約已依{mode === "time" ? "看診時間" : "掛號順序"}統一排成同一組號碼,
        直接按「叫下一位」推進即可;可用每位下方的「完成 / 未到」記錄看診狀態。
      </p>

      {sessions.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-slate-400">本日無約診。</p>
      )}

      <div className="space-y-4">
        {sessions.map((s) => {
          const active = s.appts.filter((a) => a.status !== "no_show");
          const currentAppt = s.appts.find((a) => a.seq === s.current);
          const nextAppt = active.find((a) => a.seq > s.current);
          const waiting = active.filter((a) => a.seq > s.current).length;

          return (
            <section key={`${s.doctorId}-${s.key}`} className="card overflow-hidden">
              {/* 標頭 */}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div>
                  <span className="font-semibold text-slate-900">{s.doctorName}</span>
                  <span className="ml-2 text-sm text-slate-400">{s.label}</span>
                </div>
                <span className="text-xs text-slate-400">尚有 {waiting} 位候診</span>
              </div>

              {/* 現在看診 + 下一位 + 叫下一位 */}
              <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                <div className="rounded-xl bg-brand-50 p-4 text-center">
                  <div className="text-xs text-brand-700/70">現在看診</div>
                  <div className="text-4xl font-bold text-brand-700">{s.current || "—"}</div>
                  <div className="mt-0.5 truncate text-sm text-slate-600">
                    {currentAppt ? currentAppt.name : s.current ? "(此號無人/已略過)" : "尚未開始"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-center">
                  <div className="text-xs text-slate-400">下一位</div>
                  <div className="text-4xl font-bold text-slate-500">{nextAppt ? nextAppt.seq : "—"}</div>
                  <div className="mt-0.5 truncate text-sm text-slate-500">
                    {nextAppt ? nextAppt.name : "已無候診"}
                  </div>
                </div>
                <div className="flex gap-2 sm:flex-col">
                  <ServeBtn d={s.doctorId} date={date} k={s.key} op="next" label="叫下一位 →" cls="btn-primary" />
                  <ServeBtn d={s.doctorId} date={date} k={s.key} op="prev" label="上一號" cls="btn-secondary" />
                  <ServeBtn d={s.doctorId} date={date} k={s.key} op="reset" label="重設" cls="btn-ghost" />
                </div>
              </div>

              {/* 全部號碼清單 */}
              <div className="border-t border-slate-100 p-4">
                <div className="space-y-1.5">
                  {s.appts.map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                        a.seq === s.current
                          ? "bg-brand-600 text-white"
                          : a.status === "done"
                            ? "bg-slate-50 text-slate-400"
                            : a.status === "no_show"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-white"
                      }`}
                    >
                      <span className="w-8 shrink-0 text-center text-base font-bold">{a.seq}</span>
                      <span className="flex-1 truncate">{a.name}</span>
                      <span className={`shrink-0 text-xs ${a.seq === s.current ? "text-white/80" : "text-slate-400"}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                      {a.status !== "done" && a.status !== "no_show" && (
                        <div className="flex shrink-0 gap-1">
                          <StatusBtn id={a.id} status="done" label="完成" current={a.seq === s.current} />
                          <StatusBtn id={a.id} status="no_show" label="未到" current={a.seq === s.current} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ServeBtn({
  d,
  date,
  k,
  op,
  label,
  cls,
}: {
  d: string;
  date: string;
  k: string;
  op: string;
  label: string;
  cls: string;
}) {
  return (
    <form action={advanceServingAction} className="contents">
      <input type="hidden" name="doctor_id" value={d} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="session_key" value={k} />
      <input type="hidden" name="op" value={op} />
      <button className={`btn ${cls} w-full px-4 py-2 text-sm`}>{label}</button>
    </form>
  );
}

function StatusBtn({ id, status, label, current }: { id: string; status: string; label: string; current: boolean }) {
  return (
    <form action={setStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
          current ? "border-white/40 text-white hover:bg-white/10" : "border-slate-300 text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
      </button>
    </form>
  );
}
