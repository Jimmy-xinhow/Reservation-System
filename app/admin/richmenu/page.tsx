import { createSupabaseServer } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase";
import { ACTION_OPTIONS, LAYOUTS, richMenuTemplate, slotBounds, type Layout, type RichMenuModuleAvailability, type RichMenuTemplateKey, type Slot } from "@/lib/richmenu";
import {
  cancelRichMenuScheduleAction,
  cloneRichMenuVersionAction,
  createRichMenuScheduleAction,
  removeRichMenuAliasAction,
  rollbackRichMenuVersionAction,
  saveRichMenuAction,
  syncRichMenuAliasAction,
  unpublishRichMenuAction,
} from "../line-actions";
import RichMenuEditor from "./RichMenuEditor";
import PublishForm from "./PublishForm";
import { requireAdmin } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { getRichMenuInsightSummary, lineAccessTokenForDestination, type RichMenuInsightSummary } from "@/lib/line";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { TechnicalDetails } from "@/components/TechnicalDetails";

export const dynamic = "force-dynamic";

interface VersionRow {
  id: string;
  version_no: number;
  name: string;
  template_key: RichMenuTemplateKey;
  layout: Layout;
  chat_bar_text: string;
  slots: Slot[];
  status: "draft" | "validating" | "ready" | "publishing" | "published" | "failed" | "archived";
  line_rich_menu_id: string | null;
  validation_errors: string[];
  published_at: string | null;
  created_at: string;
  source_version_id: string | null;
}

interface AliasRow {
  id: string;
  alias_id: string;
  label: string;
  version_id: string;
  status: "ready" | "error" | "removed";
  last_error: string | null;
  last_synced_at: string | null;
}

interface ScheduleRow {
  id: string;
  version_id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "activating" | "active" | "expiring" | "completed" | "cancelled" | "failed";
  attempt_count: number;
  last_error: string | null;
}

interface FunnelRow {
  event_name: string;
  metadata: Record<string, unknown>;
}

const STATUS_LABEL: Record<VersionRow["status"], string> = {
  draft: "草稿", validating: "驗證中", ready: "可發布", publishing: "發布中",
  published: "線上版本", failed: "失敗", archived: "歷史版本",
};

const SCHEDULE_STATUS: Record<ScheduleRow["status"], string> = {
  scheduled: "等待執行", activating: "切換中", active: "顯示中", expiring: "回復中",
  completed: "已完成", cancelled: "已取消", failed: "失敗",
};

const TEMPLATE_LABEL: Record<RichMenuTemplateKey, string> = {
  booking: "預約型",
  events: "活動型",
  mixed: "綜合型",
  custom: "自訂",
};

function formatTaipei(value: string): string {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function todayTaipei(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + offsetDays * 86400000));
}

function safeDate(value: string | undefined, fallback: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value as string : fallback;
}

function richMenuActionLabel(action: Slot["action"]): string {
  return ACTION_OPTIONS.find((option) => option.value === action)?.label ?? "其他動作";
}

function versionDifferences(target: VersionRow, baseline: VersionRow): string[] {
  const differences: string[] = [];
  if (target.name !== baseline.name) differences.push(`名稱：${baseline.name} → ${target.name}`);
  if (target.template_key !== baseline.template_key) differences.push(`模板：${TEMPLATE_LABEL[baseline.template_key]} → ${TEMPLATE_LABEL[target.template_key]}`);
  if (target.layout !== baseline.layout) differences.push(`版型：${LAYOUTS[baseline.layout]?.label ?? "未辨識版型"} → ${LAYOUTS[target.layout]?.label ?? "未辨識版型"}`);
  if (target.chat_bar_text !== baseline.chat_bar_text) differences.push(`選單列：${baseline.chat_bar_text} → ${target.chat_bar_text}`);
  const count = Math.max(target.slots.length, baseline.slots.length);
  for (let index = 0; index < count; index += 1) {
    const before = baseline.slots[index];
    const after = target.slots[index];
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      differences.push(`第 ${index + 1} 格：${before ? `${before.label}／${richMenuActionLabel(before.action)}` : "無"} → ${after ? `${after.label}／${richMenuActionLabel(after.action)}` : "無"}`);
    }
  }
  return differences;
}

export default async function RichMenuPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clinicId } = await requireAdmin();
  const raw = await searchParams;
  const oneParam = (key: string) => typeof raw[key] === "string" ? raw[key] as string : undefined;
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="Rich Menu" />;
  const service = createServiceClient();

  const [compatibilityResult, versionResult, messageResult, settingsResult, aliasResult, scheduleResult] = await Promise.all([
    supabase.from("line_richmenu").select("layout, chat_bar_text, slots, published_id, draft_version_id, published_version_id").eq("clinic_id", clinicId).maybeSingle(),
    supabase.from("line_richmenu_versions").select("id, version_no, name, template_key, layout, chat_bar_text, slots, status, line_rich_menu_id, validation_errors, published_at, created_at, source_version_id").eq("clinic_id", clinicId).order("version_no", { ascending: false }),
    supabase.from("line_messages").select("id, name").eq("clinic_id", clinicId).order("created_at"),
    supabase.from("clinic_settings").select("public_booking_enabled, events_enabled, public_registration_enabled, memberships_enabled, line_channel_enabled, legacy_progress_enabled").eq("clinic_id", clinicId).maybeSingle(),
    service.from("line_richmenu_aliases").select("id, alias_id, label, version_id, status, last_error, last_synced_at").eq("clinic_id", clinicId).order("updated_at", { ascending: false }),
    service.from("line_richmenu_schedules").select("id, version_id, starts_at, ends_at, status, attempt_count, last_error").eq("clinic_id", clinicId).order("starts_at", { ascending: false }).limit(30),
  ]);
  const queryError = compatibilityResult.error ?? versionResult.error ?? messageResult.error ?? settingsResult.error ?? aliasResult.error ?? scheduleResult.error;
  if (queryError) throw new Error(queryError.message);
  const compatibility = compatibilityResult.data;
  const settings = settingsResult.data;
  if (!settings) throw new Error("品牌設定不存在");

  const availability: RichMenuModuleAvailability = {
    booking: settings.public_booking_enabled === true,
    events: settings.events_enabled === true && settings.public_registration_enabled === true,
    tickets: settings.events_enabled === true,
    memberships: settings.memberships_enabled === true,
    line: settings.line_channel_enabled === true,
    legacyProgress: settings.legacy_progress_enabled === true,
  };
  const versions = (versionResult.data ?? []) as VersionRow[];
  const aliases = (aliasResult.data ?? []) as AliasRow[];
  const activeAliases = aliases.filter((alias) => alias.status === "ready");
  const schedules = (scheduleResult.data ?? []) as ScheduleRow[];
  const requestedDraftId = oneParam("draft")?.trim() || (compatibility?.draft_version_id as string | null) || null;
  const draft = versions.find((version) => version.id === requestedDraftId)
    ?? versions.find((version) => version.status === "draft" || version.status === "failed")
    ?? null;
  const fallback = richMenuTemplate("mixed", availability);
  const layout = draft?.layout ?? (compatibility?.layout as Layout | null) ?? fallback.layout;
  const chatBar = draft?.chat_bar_text ?? (compatibility?.chat_bar_text as string | null) ?? "選單";
  const slots = draft?.slots ?? (compatibility?.slots as Slot[] | null) ?? fallback.slots;
  const publishedVersionId = (compatibility?.published_version_id as string | null) ?? null;
  const publishedId = (compatibility?.published_id as string | null) ?? null;
  const spec = LAYOUTS[layout] ?? LAYOUTS["full-6"];
  const messages = (messageResult.data ?? []) as { id: string; name: string }[];
  const lineBackedVersions = versions.filter((version) => Boolean(version.line_rich_menu_id));

  let lineReady = false;
  let accessToken: string | null = null;
  let previewClinicSlug: string | null = null;
  let previewLiffId: string | null = null;
  let lineReadiness: Array<{ label: string; ready: boolean }> = [];
  try {
    const context = await getClinicLineChannelContext(supabase, clinicId);
    previewClinicSlug = context.clinicSlug;
    previewLiffId = context.liffId;
    try { accessToken = lineAccessTokenForDestination(context.destination ?? undefined); } catch { accessToken = null; }
    lineReadiness = [
      { label: "品牌 LINE 模組", ready: context.enabled },
      { label: "品牌訊息授權", ready: Boolean(context.destination && accessToken) },
      { label: "LINE 登入設定", ready: Boolean(context.loginChannelId) },
      { label: "LINE 顧客入口", ready: Boolean(context.liffId) },
      { label: "正式連線檢查", ready: context.verificationStatus === "ready" },
    ];
    lineReady = lineReadiness.every((item) => item.ready);
  } catch {
    lineReadiness = [{ label: "品牌 LINE 設定", ready: false }];
  }

  const compareBaseline = versions.find((version) => version.id === oneParam("compare"));
  const compareTarget = draft ?? versions.find((version) => version.id === publishedVersionId) ?? null;
  const differences = compareBaseline && compareTarget ? versionDifferences(compareTarget, compareBaseline) : [];

  const insightVersion = versions.find((version) => version.id === oneParam("insight_version") && version.line_rich_menu_id);
  const insightFrom = safeDate(oneParam("insight_from"), todayTaipei(-7));
  const insightTo = safeDate(oneParam("insight_to"), todayTaipei());
  let insight: RichMenuInsightSummary | null = null;
  let insightError: string | null = null;
  let funnelRows: FunnelRow[] = [];
  if (insightVersion && accessToken) {
    try {
      insight = await getRichMenuInsightSummary(insightVersion.line_rich_menu_id as string, insightFrom.replaceAll("-", ""), insightTo.replaceAll("-", ""), accessToken);
      const fromIso = new Date(`${insightFrom}T00:00:00+08:00`).toISOString();
      const toExclusive = new Date(new Date(`${insightTo}T00:00:00+08:00`).getTime() + 86400000).toISOString();
      const { data, error } = await service.from("funnel_events")
        .select("event_name, metadata")
        .eq("clinic_id", clinicId)
        .eq("source", "richmenu")
        .eq("metadata->>rm_version", insightVersion.id)
        .gte("created_at", fromIso)
        .lt("created_at", toExclusive);
      if (error) throw new Error(error.message);
      funnelRows = (data ?? []) as FunnelRow[];
    } catch (caught) {
      const errorId = crypto.randomUUID().slice(0, 8).toUpperCase();
      console.error(`[richmenu-insight:${errorId}]`, caught instanceof Error ? caught.message.slice(0, 500) : caught);
      insightError = `目前無法讀取成效資料，請稍後再試。錯誤識別碼：${errorId}`;
    }
  }

  const insightBounds = insightVersion ? slotBounds(insightVersion.layout) : [];
  const conversions = new Map<number, { booking: number; registration: number }>();
  for (const row of funnelRows) {
    const slot = Number(row.metadata.rm_slot);
    if (!Number.isInteger(slot) || slot < 1) continue;
    const current = conversions.get(slot) ?? { booking: 0, registration: 0 };
    if (row.event_name === "booking_success") current.booking += 1;
    if (row.event_name === "registration_success") current.registration += 1;
    conversions.set(slot, current);
  }

  return (
    <div className="space-y-6">
      <header><p className="eyebrow">LINE 顧客入口</p><h1 className="mt-1 text-2xl font-bold text-slate-900">LINE 圖文選單版本與發布</h1><p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">先建立草稿，確認內容後再發布。修改草稿不會直接影響顧客目前看到的選單。</p></header>

      {oneParam("err") && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">操作失敗：{oneParam("err")}{oneParam("error_id") ? `（錯誤識別碼：${oneParam("error_id")}）` : ""}</p>}
      {oneParam("ok") && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">已成功發布 LINE 圖文選單。</p>}
      {oneParam("saved") && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">草稿版本已儲存；線上選單沒有變更。</p>}
      {oneParam("cloned") && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">已複製為新草稿，可安全修改後再發布。</p>}
      {oneParam("alias_saved") && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">頁籤捷徑已同步至 LINE。</p>}
      {oneParam("alias_removed") && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">頁籤捷徑已從 LINE 移除。</p>}
      {oneParam("scheduled") && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">顯示期間已排程。</p>}
      {oneParam("schedule_cancelled") && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">尚未開始的排程已取消。</p>}

      <section className="card p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="font-semibold text-slate-900">發布前檢查</h2><p className="mt-1 text-sm leading-6 text-slate-600">全部通過後再發布或安排顯示時間；進階的快速切換功能會在對應區塊另外說明。</p></div><div className="flex flex-wrap gap-2">{lineReadiness.map((item) => <span key={item.label} className={`badge ${item.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.ready ? "✓" : "!"} {item.label}</span>)}</div></div></section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,.8fr)]">
        <div className="space-y-6">
          <RichMenuEditor initialLayout={layout} initialChatBar={chatBar} initialSlots={slots} initialName={draft?.name ?? "新的 LINE 圖文選單草稿"} initialTemplate={draft?.template_key ?? "mixed"} availability={availability} messages={messages} aliases={activeAliases.map(({ alias_id, label }) => ({ alias_id, label }))} saveAction={saveRichMenuAction} />
          <PublishForm
            width={spec.width}
            height={spec.height}
            layout={layout}
            slots={slots}
            baseUrl={process.env.APP_URL?.trim() || "http://localhost:3000"}
            clinicSlug={previewClinicSlug}
            liffId={previewLiffId}
            versionId={draft?.id ?? null}
            templateKey={draft?.template_key ?? "mixed"}
            disabled={!lineReady || !draft}
          />
        </div>
        <div className="space-y-6">
          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-900">目前線上版本</h2>
              <span className={`badge ${publishedId ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{publishedId ? "已發布" : "未發布"}</span>
            </div>
            {publishedId ? (
              <div className="mt-4 space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/admin/richmenu-image${publishedVersionId ? `?version=${encodeURIComponent(publishedVersionId)}` : ""}`} alt="目前已發布的 LINE 圖文選單" className="w-full rounded-xl border border-slate-200" />
                <form action={unpublishRichMenuAction}><SubmitButton className="btn btn-danger w-full">取消發布</SubmitButton></form>
              </div>
            ) : <p className="mt-3 text-sm text-slate-500">尚未設定 LINE 預設圖文選單。</p>}
          </section>
          <section className="card p-5">
            <h2 className="font-semibold text-slate-900">版本紀錄</h2>
            <div className="mt-4 space-y-3">
              {versions.length === 0 ? (
                <p className="text-sm text-slate-400">尚無版本。請先另存第一份草稿。</p>
              ) : versions.map((version) => (
                <article key={version.id} className={`rounded-xl border p-4 ${version.id === draft?.id ? "border-brand-300 bg-brand-50/50" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">v{version.version_no} · {version.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {TEMPLATE_LABEL[version.template_key]} · {LAYOUTS[version.layout]?.label ?? "未辨識版型"}{version.source_version_id ? " · 複製版本" : ""}
                      </p>
                    </div>
                    <span className="badge bg-slate-100 text-slate-600">{STATUS_LABEL[version.status]}</span>
                  </div>
                  {version.validation_errors?.length > 0 && <p className="mt-2 text-xs text-red-600">{version.validation_errors.join("；")}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={`/admin/richmenu?draft=${encodeURIComponent(version.id)}`} className="btn btn-secondary px-3 py-1.5 text-xs">檢視／另存</a>
                    {draft && version.id !== draft.id && <a href={`/admin/richmenu?draft=${encodeURIComponent(draft.id)}&compare=${encodeURIComponent(version.id)}`} className="btn btn-secondary px-3 py-1.5 text-xs">與草稿比較</a>}
                    <form action={cloneRichMenuVersionAction}>
                      <input type="hidden" name="version_id" value={version.id} />
                      <SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">複製為新草稿</SubmitButton>
                    </form>
                    {version.line_rich_menu_id && version.id !== publishedVersionId && (
                      <form action={rollbackRichMenuVersionAction}>
                        <input type="hidden" name="version_id" value={version.id} />
                        <SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">回復此版本</SubmitButton>
                      </form>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      {compareBaseline && compareTarget && <section className="card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">歷史比較</h2><p className="mt-1 text-sm text-slate-500">v{compareBaseline.version_no}「{compareBaseline.name}」→ v{compareTarget.version_no}「{compareTarget.name}」</p></div><a href={`/admin/richmenu?draft=${encodeURIComponent(compareTarget.id)}`} className="btn btn-secondary px-3 py-1.5 text-xs">關閉比較</a></div>{differences.length === 0 ? <p className="mt-4 text-sm text-slate-500">兩個版本的可發布設定相同。</p> : <ul className="mt-4 space-y-2 text-sm text-slate-600">{differences.map((difference) => <li key={difference} className="rounded-lg bg-slate-50 px-3 py-2">{difference}</li>)}</ul>}</section>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div>
            <h2 className="font-semibold text-slate-900">多頁選單捷徑</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">需要讓顧客在多個圖文選單之間切換時才使用。LINE 將這個捷徑稱為 Alias；每個捷徑只能連到同一品牌、且已上傳圖片的版本。</p>
          </div>
          <form action={syncRichMenuAliasAction} className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="label">捷徑代號（Alias ID）</span>
              <input name="alias_id" required pattern="[a-z0-9_-]{1,32}" maxLength={32} placeholder="main_menu" className="input" />
              <span className="help-text block">僅可使用小寫英文字母、數字、底線與連字號。</span>
            </label>
            <label className="text-sm"><span className="label">管理名稱</span><input name="label" required maxLength={40} placeholder="主選單" className="input" /></label>
            <label className="text-sm"><span className="label">要連到的版本</span><select name="version_id" required className="input"><option value="">請選擇</option>{lineBackedVersions.map((version) => <option key={version.id} value={version.id}>v{version.version_no} · {version.name}</option>)}</select></label>
            <div className="sm:col-span-3"><SubmitButton disabled={!lineReady || lineBackedVersions.length === 0} className="btn btn-primary">同步頁籤捷徑</SubmitButton></div>
          </form>
          <div className="mt-5 space-y-2">
            {aliases.length === 0 ? <p className="text-sm text-slate-600">尚未建立頁籤捷徑。</p> : aliases.map((alias) => (
              <div key={alias.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">{alias.label} <span className="font-mono text-xs text-slate-600">{alias.alias_id}</span></p>
                  <p className="mt-1 text-xs text-slate-600">{alias.status === "ready" ? `對應 v${versions.find((version) => version.id === alias.version_id)?.version_no ?? "?"}` : alias.status === "removed" ? "已移除" : "尚未就緒"}</p>
                  {alias.last_error && <TechnicalDetails summary="查看同步失敗原因" items={[{ label: "失敗原因", value: alias.last_error }]} />}
                </div>
                {alias.status !== "removed" && <form action={removeRichMenuAliasAction}><input type="hidden" name="alias_id" value={alias.alias_id} /><SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">移除</SubmitButton></form>}
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div><h2 className="font-semibold text-slate-900">顯示期間與排程</h2><p className="mt-1 text-sm text-slate-500">時間以台北時間輸入；開始時切換到指定版本，結束後回復排程開始前的版本。</p></div>
          <form action={createRichMenuScheduleAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2"><span className="label">顯示版本</span><select name="version_id" required className="input"><option value="">請選擇</option>{lineBackedVersions.map((version) => <option key={version.id} value={version.id}>v{version.version_no} · {version.name}</option>)}</select></label>
            <label className="text-sm"><span className="label">開始時間（台北）</span><input name="starts_at" type="datetime-local" required className="input" /></label>
            <label className="text-sm"><span className="label">結束時間（台北）</span><input name="ends_at" type="datetime-local" required className="input" /></label>
            <div className="sm:col-span-2"><SubmitButton disabled={!lineReady || lineBackedVersions.length === 0} className="btn btn-primary">建立排程</SubmitButton></div>
          </form>
          <div className="mt-5 space-y-2">
            {schedules.length === 0 ? <p className="text-sm text-slate-400">尚無顯示排程。</p> : schedules.map((schedule) => (
              <div key={schedule.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">v{versions.find((version) => version.id === schedule.version_id)?.version_no ?? "?"} · {SCHEDULE_STATUS[schedule.status]}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatTaipei(schedule.starts_at)} ～ {formatTaipei(schedule.ends_at)} · 已嘗試 {schedule.attempt_count} 次</p>
                    {schedule.last_error && <TechnicalDetails summary="查看排程失敗原因" items={[{ label: "失敗原因", value: schedule.last_error }]} />}
                  </div>
                  {schedule.status === "scheduled" && <form action={cancelRichMenuScheduleAction}><input type="hidden" name="schedule_id" value={schedule.id} /><SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">取消排程</SubmitButton></form>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card p-5"><div><h2 className="font-semibold text-slate-900">曝光、點擊與轉換</h2><p className="mt-1 text-sm text-slate-500">LINE 提供整份選單曝光與各點擊區域統計；每個區域會同步看見整份選單曝光。預約／報名轉換來自平台匿名漏斗事件，不含姓名、電話或 LINE 使用者識別碼。</p></div><form method="get" className="mt-4 grid gap-3 sm:grid-cols-4"><label className="text-sm sm:col-span-2"><span className="label">版本</span><select name="insight_version" required defaultValue={insightVersion?.id ?? ""} className="input"><option value="">請選擇</option>{lineBackedVersions.map((version) => <option key={version.id} value={version.id}>v{version.version_no} · {version.name}</option>)}</select></label><label className="text-sm"><span className="label">開始日期</span><input name="insight_from" type="date" defaultValue={insightFrom} required className="input" /></label><label className="text-sm"><span className="label">結束日期</span><input name="insight_to" type="date" defaultValue={insightTo} required className="input" /></label><div className="sm:col-span-4"><button type="submit" disabled={!lineReady || lineBackedVersions.length === 0} className="btn btn-primary">讀取官方洞察</button></div></form>{insightError && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{insightError}</p>}{insightVersion && insight && !insight.impression && !insight.clicks && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">LINE 因隱私門檻未回傳統計明細；指定期間的點擊不重複使用者少於 20 人時，只會回傳選單識別碼（Rich Menu ID）。</p>}{insightVersion && insight && (insight.impression || insight.clicks) && <div className="mt-5 overflow-x-auto"><table className="tbl"><thead><tr><th>區域</th><th>選單曝光</th><th>區域點擊</th><th>預約完成</th><th>報名完成</th></tr></thead><tbody>{insightVersion.slots.map((slot, index) => { const bounds = insightBounds[index]; const click = insight.clicks?.find((item) => item.bounds.x === bounds.x && item.bounds.y === bounds.y && item.bounds.width === bounds.width && item.bounds.height === bounds.height); const conversion = conversions.get(index + 1) ?? { booking: 0, registration: 0 }; return <tr key={`${insightVersion.id}-${index}`}><td><p className="font-medium text-slate-800">第 {index + 1} 格 · {slot.label}</p><p className="text-xs text-slate-400">{richMenuActionLabel(slot.action)}</p></td><td>{insight.impression?.metrics.count ?? "—"}<div className="text-xs text-slate-400">{insight.impression ? `${insight.impression.metrics.uniqueUsers} 人` : ""}</div></td><td>{click?.metrics.count ?? 0}<div className="text-xs text-slate-400">{click ? `${click.metrics.uniqueUsers} 人` : ""}</div></td><td>{conversion.booking}</td><td>{conversion.registration}</td></tr>; })}</tbody></table></div>}</section>
    </div>
  );
}
