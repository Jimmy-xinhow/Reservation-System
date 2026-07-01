import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { taipeiDateString } from "@/lib/slots";
import { getQueueForDate } from "@/lib/queue";
import { advanceServingAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  done: "完成",
  no_show: "未到",
  cancelled: "已取消",
};
const STATUS_COLOR: Record<string, string> = {
  booked: "bg-brand-500",
  confirmed: "bg-accent-500",
  done: "bg-slate-400",
  no_show: "bg-amber-500",
  cancelled: "bg-red-400",
};

interface Appt {
  start_at: string;
  status: string;
  doctors: { name: string } | null;
}

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}
function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await searchParams;

  const supabase = await createSupabaseServer();
  const today = taipeiToday();
  const winStart = shiftDate(today, -6); // 近兩週視窗:前 6 天 ~ 後 7 天
  const winEnd = shiftDate(today, 7);
  const winStartIso = new Date(`${winStart}T00:00:00+08:00`).toISOString();
  const winEndIso = new Date(`${winEnd}T23:59:59.999+08:00`).toISOString();

  const [{ data: apptData }, { count: patientCount }, { data: cs }] = await Promise.all([
    supabase
      .from("appointments")
      .select("start_at, status, doctors(name)")
      .eq("clinic_id", CLINIC_ID)
      .gte("start_at", winStartIso)
      .lte("start_at", winEndIso),
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", CLINIC_ID),
    supabase.from("clinic_settings").select("booking_mode").eq("clinic_id", CLINIC_ID).maybeSingle(),
  ]);

  // 今日叫號狀態
  const mode = (cs?.booking_mode as "time" | "number") ?? "time";
  const queue = await getQueueForDate(supabase, CLINIC_ID, today, mode);

  const appts = (apptData ?? []) as unknown as Appt[];
  const active = appts.filter((a) => a.status !== "cancelled");

  // 每日(近 14 日)
  const days = Array.from({ length: 14 }, (_, i) => shiftDate(winStart, i));
  const perDay = days.map((d) => ({
    date: d,
    count: active.filter((a) => taipeiDateString(a.start_at) === d).length,
  }));
  const maxDay = Math.max(1, ...perDay.map((d) => d.count));

  // 狀態分佈 / 醫師分佈(整個視窗)
  const statusCounts = countBy(appts, (a) => a.status);
  const doctorCounts = countBy(active, (a) => a.doctors?.name ?? "(未指定)");
  const maxDoctor = Math.max(1, ...Object.values(doctorCounts));

  const todayCount = active.filter((a) => taipeiDateString(a.start_at) === today).length;
  const weekCount = active.filter((a) => {
    const d = taipeiDateString(a.start_at);
    return d >= today && d <= shiftDate(today, 6);
  }).length;
  const todayConfirmed = active.filter(
    (a) => taipeiDateString(a.start_at) === today && a.status === "confirmed",
  ).length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">總覽</h1>

      {/* 統計卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="今日預約" value={todayCount} accent />
        <Stat label="今日已確認" value={todayConfirmed} />
        <Stat label="未來 7 日預約" value={weekCount} />
        <Stat label="病患總數" value={patientCount ?? 0} />
      </div>

      {/* 今日叫號狀態 */}
      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">今日叫號</h2>
          <Link href="/admin/queue" className="text-sm text-brand-600 hover:underline">
            前往叫號 →
          </Link>
        </div>
        {queue.length === 0 ? (
          <p className="text-sm text-slate-400">今日無看診門診段。</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {queue.map((s) => {
              const onWait = s.online.filter((a) => a.seq > s.onlineCurrent && a.status !== "no_show").length;
              const offWait = s.offline.filter((a) => a.seq > s.offlineCurrent && a.status !== "no_show").length;
              const maxOnline = s.online.length ? Math.max(0, ...s.online.map((a) => a.seq)) : 0;
              const maxOffline = s.offline.length ? Math.max(0, ...s.offline.map((a) => a.seq)) : 0;
              const hidden = (
                <>
                  <input type="hidden" name="doctor_id" value={s.doctorId} />
                  <input type="hidden" name="date" value={today} />
                  <input type="hidden" name="session_key" value={s.key} />
                  <input type="hidden" name="max_online" value={maxOnline} />
                  <input type="hidden" name="max_offline" value={maxOffline} />
                </>
              );
              return (
                <div key={`${s.doctorId}-${s.key}`} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-medium text-slate-800">{s.doctorName}</span>
                    <span className="text-xs text-slate-400">{s.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-brand-50 p-2 text-center">
                      <div className="text-[11px] text-brand-700/70">線上目前 · 候診 {onWait}</div>
                      <div className="text-2xl font-bold text-brand-700">{s.onlineCurrent || "—"}</div>
                      <form action={advanceServingAction} className="mt-1">
                        {hidden}
                        <input type="hidden" name="op" value="next_online" />
                        <button className="btn btn-primary w-full px-2 py-1 text-xs">叫下一位</button>
                      </form>
                    </div>
                    <div className="rounded-lg bg-accent-500/10 p-2 text-center">
                      <div className="text-[11px] text-accent-600/80">現場目前 · 候診 {offWait}</div>
                      <div className="text-2xl font-bold text-accent-600">{s.offlineCurrent || "—"}</div>
                      <form action={advanceServingAction} className="mt-1">
                        {hidden}
                        <input type="hidden" name="op" value="next_offline" />
                        <button className="btn btn-secondary w-full px-2 py-1 text-xs">叫下一位</button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 每日趨勢 */}
      <section className="card p-5">
        <h2 className="mb-4 font-semibold text-slate-900">近 14 日每日預約</h2>
        <div className="flex h-36 items-end gap-1.5">
          {perDay.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-t ${d.date === today ? "bg-brand-600" : "bg-brand-200"}`}
                  style={{ height: `${(d.count / maxDay) * 100}%` }}
                  title={`${d.date}:${d.count} 筆`}
                />
              </div>
              <span className="text-[10px] text-slate-400">{d.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 狀態分佈 */}
        <section className="card p-5">
          <h2 className="mb-4 font-semibold text-slate-900">狀態分佈(近兩週)</h2>
          <div className="space-y-2.5">
            {Object.keys(STATUS_LABEL).map((k) => {
              const n = statusCounts[k] ?? 0;
              const total = appts.length || 1;
              return (
                <div key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-14 shrink-0 text-slate-600">{STATUS_LABEL[k]}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${STATUS_COLOR[k]}`} style={{ width: `${(n / total) * 100}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-slate-500">{n}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 醫師分佈 */}
        <section className="card p-5">
          <h2 className="mb-4 font-semibold text-slate-900">醫師分佈(近兩週)</h2>
          {Object.keys(doctorCounts).length === 0 ? (
            <p className="text-sm text-slate-400">尚無資料</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(doctorCounts).map(([name, n]) => (
                <div key={name} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 truncate text-slate-600">{name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-accent-500" style={{ width: `${(n / maxDoctor) * 100}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-slate-500">{n}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "bg-gradient-to-br from-brand-500 to-accent-600 text-white" : ""}`}>
      <div className={`text-xs ${accent ? "text-white/80" : "text-slate-400"}`}>{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-white" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function countBy<T>(arr: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) {
    const k = key(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
