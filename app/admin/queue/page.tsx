import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { getQueueForDate, taipeiToday, type QueueAppt } from "@/lib/queue";
import { advanceServingAction, setQueueAutoAction, setStatusAction } from "../actions";

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
      <h1 className="text-xl font-bold text-slate-900">
        叫號 · {date}
        {date === today && <span className="ml-2 text-sm font-normal text-accent-600">今天</span>}
      </h1>

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
        線上與現場各自一組號碼,互不影響。可分別「叫下一位」;或開啟自動穿插(每 N 位線上插 1 位現場),
        按「自動下一位」即依規則輪流叫號,現場病患不會被排到最後。
      </p>

      {sessions.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-slate-400">本日無約診。</p>
      )}

      <div className="space-y-4">
        {sessions.map((s) => {
          const maxOnline = s.online.filter((a) => a.status !== "no_show").length
            ? Math.max(0, ...s.online.map((a) => a.seq))
            : 0;
          const maxOffline = s.offline.length ? Math.max(0, ...s.offline.map((a) => a.seq)) : 0;
          const nextOnline = s.online.find((a) => a.seq > s.onlineCurrent && a.status !== "no_show");
          const nextOffline = s.offline.find((a) => a.seq > s.offlineCurrent && a.status !== "no_show");

          const hidden = (
            <>
              <input type="hidden" name="doctor_id" value={s.doctorId} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="session_key" value={s.key} />
              <input type="hidden" name="max_online" value={maxOnline} />
              <input type="hidden" name="max_offline" value={maxOffline} />
            </>
          );

          return (
            <section key={`${s.doctorId}-${s.key}`} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <div>
                  <span className="font-semibold text-slate-900">{s.doctorName}</span>
                  <span className="ml-2 text-sm text-slate-400">{s.label}</span>
                </div>
                {/* 自動穿插設定 */}
                <form action={setQueueAutoAction} className="flex flex-wrap items-center gap-2 text-sm">
                  {hidden}
                  <span className="text-slate-500">每</span>
                  <input
                    name="auto_every"
                    type="number"
                    min={0}
                    defaultValue={s.autoEvery}
                    className="input w-16 px-2 py-1"
                  />
                  <span className="text-slate-500">位線上插 1 位現場</span>
                  <button className="btn btn-ghost px-2 py-1 text-xs">儲存</button>
                </form>
              </div>

              {/* 自動下一位(依規則) */}
              <div className="border-b border-slate-100 px-5 py-3">
                <form action={advanceServingAction} className="flex flex-wrap items-center gap-3">
                  {hidden}
                  <input type="hidden" name="op" value="auto" />
                  <button className="btn btn-primary">自動下一位 →</button>
                  <span className="text-xs text-slate-400">
                    {s.autoEvery > 0 ? `自動:每 ${s.autoEvery} 位線上插 1 位現場` : "自動未開啟(等同叫線上)"}
                  </span>
                </form>
              </div>

              {/* 兩條序列 */}
              <div className="grid gap-0 sm:grid-cols-2">
                <StreamPanel
                  title="線上預約"
                  accent="brand"
                  current={s.onlineCurrent}
                  next={nextOnline}
                  appts={s.online}
                  opNext="next_online"
                  opPrev="prev_online"
                  hidden={hidden}
                />
                <StreamPanel
                  title="現場(後台建立)"
                  accent="accent"
                  current={s.offlineCurrent}
                  next={nextOffline}
                  appts={s.offline}
                  opNext="next_offline"
                  opPrev="prev_offline"
                  hidden={hidden}
                  bordered
                />
              </div>

              <div className="border-t border-slate-100 px-5 py-2">
                <form action={advanceServingAction}>
                  {hidden}
                  <input type="hidden" name="op" value="reset" />
                  <button className="text-xs text-slate-400 hover:text-red-600">重設此診叫號</button>
                </form>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StreamPanel({
  title,
  accent,
  current,
  next,
  appts,
  opNext,
  opPrev,
  hidden,
  bordered,
}: {
  title: string;
  accent: "brand" | "accent";
  current: number;
  next: QueueAppt | undefined;
  appts: QueueAppt[];
  opNext: string;
  opPrev: string;
  hidden: React.ReactNode;
  bordered?: boolean;
}) {
  const curAppt = appts.find((a) => a.seq === current);
  const color = accent === "brand" ? "text-brand-700" : "text-accent-600";
  const bg = accent === "brand" ? "bg-brand-50" : "bg-accent-500/10";
  return (
    <div className={`p-5 ${bordered ? "border-t border-slate-100 sm:border-l sm:border-t-0" : ""}`}>
      <div className="mb-3 text-sm font-semibold text-slate-700">{title}</div>
      <div className={`mb-3 rounded-xl ${bg} p-4 text-center`}>
        <div className="text-xs text-slate-500">現在看診</div>
        <div className={`text-4xl font-bold ${color}`}>{current || "—"}</div>
        <div className="mt-0.5 truncate text-sm text-slate-600">
          {curAppt ? curAppt.name : current ? "(此號略過)" : "尚未開始"}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          下一位:{next ? `${next.seq} ${next.name}` : "已無候診"}
        </div>
      </div>
      <div className="mb-3 flex gap-2">
        <form action={advanceServingAction} className="flex-1">
          {hidden}
          <input type="hidden" name="op" value={opNext} />
          <button className="btn btn-secondary w-full text-sm">叫下一位 →</button>
        </form>
        <form action={advanceServingAction}>
          {hidden}
          <input type="hidden" name="op" value={opPrev} />
          <button className="btn btn-ghost px-3 text-sm">上一號</button>
        </form>
      </div>
      <div className="space-y-1">
        {appts.length === 0 && <p className="text-xs text-slate-400">尚無</p>}
        {appts.map((a) => (
          <div
            key={a.id}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
              a.seq === current
                ? accent === "brand"
                  ? "bg-brand-600 text-white"
                  : "bg-accent-600 text-white"
                : a.status === "done"
                  ? "bg-slate-50 text-slate-400"
                  : a.status === "no_show"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-white"
            }`}
          >
            <span className="w-6 shrink-0 text-center font-bold">{a.seq}</span>
            <span className="flex-1 truncate">{a.name}</span>
            <span className={`shrink-0 text-xs ${a.seq === current ? "text-white/80" : "text-slate-400"}`}>
              {STATUS_LABEL[a.status] ?? a.status}
            </span>
            {a.status !== "done" && a.status !== "no_show" && (
              <div className="flex shrink-0 gap-1">
                <StatusBtn id={a.id} status="done" label="完成" light={a.seq === current} />
                <StatusBtn id={a.id} status="no_show" label="未到" light={a.seq === current} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBtn({ id, status, label, light }: { id: string; status: string; label: string; light: boolean }) {
  return (
    <form action={setStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        className={`rounded border px-1.5 py-0.5 text-xs font-medium ${
          light ? "border-white/40 text-white hover:bg-white/10" : "border-slate-300 text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
      </button>
    </form>
  );
}
