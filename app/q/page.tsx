import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { getQueueForDate, taipeiToday } from "@/lib/queue";
import { Brand } from "@/components/Brand";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

// 公開叫號頁(候診區螢幕 / 病患手機)。只顯示醫師、時段、目前看診號,不顯示病患姓名。
export default async function QueueBoard() {
  const today = taipeiToday();
  let sessions: Awaited<ReturnType<typeof getQueueForDate>> = [];
  try {
    const svc = createServiceClient();
    const { data: settings } = await svc
      .from("clinic_settings")
      .select("booking_mode")
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle();
    const mode = (settings?.booking_mode as "time" | "number") ?? "time";
    sessions = await getQueueForDate(svc, CLINIC_ID, today, mode);
  } catch {
    sessions = [];
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:max-w-4xl">
      <AutoRefresh seconds={20} />
      <header className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <Brand subtitle="看診進度" />
        <span className="text-sm text-slate-400">{today}</span>
      </header>

      {sessions.length === 0 ? (
        <p className="card p-8 text-center text-slate-400">今日尚無看診資料。</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const waiting = s.appts.filter((a) => a.seq > s.current && a.status !== "no_show").length;
            return (
              <div key={`${s.doctorId}-${s.key}`} className="card flex items-center justify-between p-5 sm:p-6">
                <div>
                  <div className="text-lg font-semibold text-slate-900 sm:text-2xl">{s.doctorName}</div>
                  <div className="text-sm text-slate-400 sm:text-base">{s.label}</div>
                  <div className="mt-1 text-xs text-slate-400 sm:text-sm">尚有 {waiting} 位候診</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-400 sm:text-sm">目前看診號</div>
                  <div className="text-5xl font-bold text-brand-700 sm:text-7xl">{s.current || "—"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-5 text-center text-xs text-slate-400">畫面每 20 秒自動更新</p>
    </main>
  );
}
