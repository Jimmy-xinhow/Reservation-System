import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { getQueueForDate, taipeiToday } from "@/lib/queue";
import { advanceServingAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
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
      <h1 className="text-xl font-bold text-slate-900">叫號</h1>

      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">日期</label>
          <input type="date" name="date" defaultValue={date} className="input" />
        </div>
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
        <button className="btn btn-secondary">套用</button>
      </form>

      {sessions.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-slate-400">本日無約診。</p>
      )}

      <div className="space-y-4">
        {sessions.map((s) => (
          <section key={`${s.doctorId}-${s.key}`} className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">{s.doctorName}</div>
                <div className="text-sm text-slate-400">{s.label}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-slate-400">目前看診號</div>
                <div className="text-3xl font-bold text-brand-700">{s.current || "—"}</div>
              </div>
              <div className="flex gap-2">
                <ServeBtn doctorId={s.doctorId} date={date} sessionKey={s.key} op="prev" label="上一號" cls="btn-secondary" />
                <ServeBtn doctorId={s.doctorId} date={date} sessionKey={s.key} op="next" label="下一號 →" cls="btn-primary" />
                <ServeBtn doctorId={s.doctorId} date={date} sessionKey={s.key} op="reset" label="重設" cls="btn-ghost" />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {s.appts.map((a) => (
                <span
                  key={a.id}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm ${
                    a.seq === s.current
                      ? "border-brand-600 bg-brand-600 text-white"
                      : a.status === "done"
                        ? "border-slate-200 bg-slate-100 text-slate-400"
                        : a.status === "no_show"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-white text-slate-700"
                  }`}
                  title={`${a.name}・${STATUS_LABEL[a.status] ?? a.status}`}
                >
                  <strong>{a.seq}</strong>
                  <span className="text-xs opacity-80">{a.name}</span>
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ServeBtn({
  doctorId,
  date,
  sessionKey,
  op,
  label,
  cls,
}: {
  doctorId: string;
  date: string;
  sessionKey: string;
  op: string;
  label: string;
  cls: string;
}) {
  return (
    <form action={advanceServingAction}>
      <input type="hidden" name="doctor_id" value={doctorId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="session_key" value={sessionKey} />
      <input type="hidden" name="op" value={op} />
      <button className={`btn ${cls} px-3 py-1.5 text-sm`}>{label}</button>
    </form>
  );
}
