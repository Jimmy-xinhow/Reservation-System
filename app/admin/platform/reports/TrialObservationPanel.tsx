import { SubmitButton } from "@/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase";
import { completeTrialObservationAction, startTrialObservationAction, updateFeatureInterestAction } from "./actions";

interface Brand { id: string; name: string; active: boolean; created_at: string; }
interface Observation { id: string; clinic_id: string; status: "active" | "completed"; started_at: string; ended_at: string | null; notes: string | null; }
interface Metric { clinic_id: string; measurement_started_at: string; first_bookable_at: string | null; first_booking_at: string | null; }
interface ProductEvent { clinic_id: string; event_name: string; session_id: string; metadata: Record<string, unknown>; created_at: string; }
interface FunnelEvent { clinic_id: string; event_name: string; source: string | null; created_at: string; }
interface Interest { clinic_id: string; feature_key: string; interest: string; willingness_monthly: number | null; note: string | null; }

const FEATURES = [
  { key: "calendar_sync", label: "Google／Outlook 雙向同步" },
  { key: "refund_reconciliation", label: "完整退款與對帳" },
  { key: "pos_inventory", label: "POS／庫存" },
  { key: "commission", label: "抽成／分潤" },
  { key: "multilingual", label: "多語系" },
  { key: "white_label", label: "進階白牌" },
] as const;
const INTEREST_OPTIONS = [
  ["unknown", "尚未詢問"], ["interested", "有興趣"], ["not_interested", "無需求"], ["quoted", "已報價"], ["won", "已成交"],
] as const;

function inWindow(createdAt: string, observation: Observation): boolean {
  return createdAt >= observation.started_at && (!observation.ended_at || createdAt <= observation.ended_at);
}
function percent(value: number, total: number): string { return total === 0 ? "—" : `${((value / total) * 100).toFixed(1)}%`; }
function duration(from: string, to: string | null): string {
  if (!to) return "尚未達成";
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小時`;
}

export async function TrialObservationPanel({ brands, canManage }: { brands: Brand[]; canManage: boolean }) {
  const service = createServiceClient();
  const { data: observationData, error: observationError } = await service.from("trial_brand_observations").select("id, clinic_id, status, started_at, ended_at, notes").order("started_at", { ascending: false }).limit(30);
  if (observationError) throw new Error(`讀取試用觀察失敗：${observationError.message}`);
  const allObservations = (observationData ?? []) as Observation[];
  const active = allObservations.filter((item) => item.status === "active");
  const displayed = active.length > 0 ? active : allObservations.filter((item) => item.status === "completed").slice(0, 3);
  const ids = [...new Set(displayed.map((item) => item.clinic_id))];
  const earliest = displayed.reduce<string | null>((current, item) => !current || item.started_at < current ? item.started_at : current, null);
  const empty = { data: [], error: null };
  const [metricsResult, productResult, funnelResult, interestResult] = ids.length > 0 ? await Promise.all([
    service.from("clinic_activation_metrics").select("clinic_id, measurement_started_at, first_bookable_at, first_booking_at").in("clinic_id", ids),
    service.from("admin_product_events").select("clinic_id, event_name, session_id, metadata, created_at").in("clinic_id", ids).gte("created_at", earliest!),
    service.from("funnel_events").select("clinic_id, event_name, source, created_at").in("clinic_id", ids).gte("created_at", earliest!),
    service.from("feature_interest_signals").select("clinic_id, feature_key, interest, willingness_monthly, note").in("clinic_id", ids),
  ]) : [empty, empty, empty, empty];
  const readError = metricsResult.error ?? productResult.error ?? funnelResult.error ?? interestResult.error;
  if (readError) throw new Error(`讀取觀察指標失敗：${readError.message}`);
  const metrics = (metricsResult.data ?? []) as Metric[];
  const productEvents = (productResult.data ?? []) as ProductEvent[];
  const funnelEvents = (funnelResult.data ?? []) as FunnelEvent[];
  const interests = (interestResult.data ?? []) as Interest[];
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  const activeIds = new Set(active.map((item) => item.clinic_id));
  const available = brands.filter((brand) => brand.active && !activeIds.has(brand.id));

  const featureDecisions = FEATURES.map((feature) => {
    const values = interests.filter((item) => item.feature_key === feature.key && ids.includes(item.clinic_id));
    const positive = values.filter((item) => ["interested", "quoted", "won"].includes(item.interest)).length;
    const recorded = values.filter((item) => item.interest !== "unknown").length;
    const won = values.filter((item) => item.interest === "won").length;
    const amounts = values.map((item) => item.willingness_monthly).filter((value): value is number => typeof value === "number" && value > 0).sort((a, b) => a - b);
    const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : null;
    const decision = won > 0 || positive >= 2 ? "建議進入報價" : recorded >= 3 ? "暫緩開發" : "待蒐集三品牌資料";
    return { ...feature, positive, recorded, median, decision };
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">三品牌試用</p><h2 className="mt-1 text-xl font-bold text-slate-900">三品牌試用觀察</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">同時最多三個品牌；用固定口徑觀察首次可預約、設定退出、權限求助與預約完成率。未發生的行為顯示為「尚無資料」，不使用推估值。</p></div><span className="badge bg-indigo-50 text-indigo-700">{active.length} / 3 觀察中</span></div>
      {canManage && active.length < 3 && available.length > 0 && <form action={startTrialObservationAction} className="card grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="text-sm"><span className="label">加入試用品牌</span><select name="clinic_id" className="input" required defaultValue=""><option value="" disabled>選擇品牌</option>{available.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label><label className="text-sm"><span className="label">觀察備註</span><input name="notes" className="input" maxLength={1000} placeholder="例如：美容服務新客試用" /></label><SubmitButton className="btn btn-primary min-h-11">開始觀察</SubmitButton></form>}
      {displayed.length === 0 ? <div className="card px-5 py-10 text-center text-sm text-slate-400">尚未選定試用品牌。請先加入最多三個品牌，觀察資料才會開始累積。</div> : <div className="grid gap-4 xl:grid-cols-3">{displayed.map((observation) => {
        const brand = brandById.get(observation.clinic_id);
        const metric = metrics.find((item) => item.clinic_id === observation.clinic_id);
        const adminRows = productEvents.filter((item) => item.clinic_id === observation.clinic_id && inWindow(item.created_at, observation));
        const funnelRows = funnelEvents.filter((item) => item.clinic_id === observation.clinic_id && inWindow(item.created_at, observation));
        const views = new Set(adminRows.filter((item) => item.event_name === "settings_view").map((item) => item.session_id)).size;
        const exits = new Set(adminRows.filter((item) => item.event_name === "settings_exit" && item.metadata?.submitted !== true).map((item) => item.session_id)).size;
        const helps = adminRows.filter((item) => item.event_name === "permission_help_requested").length;
        const denied = adminRows.filter((item) => item.event_name === "permission_denied").length;
        const starts = funnelRows.filter((item) => item.event_name === "booking_start").length;
        const successes = funnelRows.filter((item) => item.event_name === "booking_success").length;
        const firstBookable = metric?.first_bookable_at && metric.first_bookable_at <= observation.started_at ? "觀察前已可預約" : duration(observation.started_at, metric?.first_bookable_at ?? null);
        return <article key={observation.id} className="card space-y-4 p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{brand?.name ?? "未知品牌"}</h3><p className="mt-1 text-xs text-slate-400">開始：{new Date(observation.started_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p></div><span className={`badge ${observation.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{observation.status === "active" ? "觀察中" : "已完成"}</span></div>{observation.notes && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">{observation.notes}</p>}<div className="grid grid-cols-2 gap-2"><Kpi label="首次可預約" value={firstBookable} /><Kpi label="設定退出率" value={percent(exits, views)} detail={`${exits} / ${views} 工作階段`} /><Kpi label="權限求助" value={`${helps} 次`} detail={`另有 ${denied} 次權限拒絕`} /><Kpi label="預約完成率" value={percent(successes, starts)} detail={`${successes} / ${starts} 次開始`} /></div>{observation.status === "active" && canManage && <form action={completeTrialObservationAction}><input type="hidden" name="observation_id" value={observation.id} /><SubmitButton className="btn btn-secondary min-h-11 w-full">結束本品牌觀察</SubmitButton></form>}</article>;
      })}</div>}

      {displayed.length > 0 && <><div><h3 className="text-lg font-semibold text-slate-900">第三階段加購決策</h3><p className="mt-1 text-sm text-slate-500">至少 2／3 品牌明確有興趣或已有成交，才建議進入報價；三品牌資料齊全但需求不足則暫緩。</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{featureDecisions.map((feature) => <div key={feature.key} className="card p-4"><p className="font-medium text-slate-900">{feature.label}</p><p className={`mt-2 text-sm font-semibold ${feature.decision === "建議進入報價" ? "text-emerald-700" : feature.decision === "暫緩開發" ? "text-slate-600" : "text-amber-700"}`}>{feature.decision}</p><p className="mt-1 text-xs leading-5 text-slate-500">有意願 {feature.positive}／已記錄 {feature.recorded}；月付意願中位數 {feature.median ? `NT$${feature.median.toLocaleString("zh-TW")}` : "—"}</p></div>)}</div><div className="space-y-3">{displayed.map((observation) => { const brand = brandById.get(observation.clinic_id); return <details key={`interest-${observation.id}`} className="card p-4"><summary className="cursor-pointer font-medium text-slate-900">記錄「{brand?.name ?? "未知品牌"}」付費意願</summary><div className="mt-4 grid gap-3 lg:grid-cols-2">{FEATURES.map((feature) => { const existing = interests.find((item) => item.clinic_id === observation.clinic_id && item.feature_key === feature.key); return <form key={feature.key} action={updateFeatureInterestAction} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><input type="hidden" name="clinic_id" value={observation.clinic_id} /><input type="hidden" name="feature_key" value={feature.key} /><p className="text-sm font-medium text-slate-800">{feature.label}</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><select name="interest" className="input h-10 py-1 text-xs" defaultValue={existing?.interest ?? "unknown"}>{INTEREST_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input name="willingness_monthly" type="number" min={0} max={1000000} className="input h-10 py-1 text-xs" defaultValue={existing?.willingness_monthly ?? ""} placeholder="可接受月費" /></div><input name="note" className="input mt-2 h-10 py-1 text-xs" maxLength={1000} defaultValue={existing?.note ?? ""} placeholder="訪談依據／條件" /><SubmitButton className="mt-2 text-xs font-medium text-indigo-700 hover:underline">保存意願</SubmitButton></form>; })}</div></details>; })}</div></>}
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-base font-bold text-slate-900">{value}</p>{detail && <p className="mt-1 text-[11px] leading-4 text-slate-400">{detail}</p>}</div>; }
