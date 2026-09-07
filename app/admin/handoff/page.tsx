import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { createHandoffTaskAction, updateHandoffTaskAction } from "./actions";
import { saveAttendanceSettingsAction, saveAttendanceStaffAction } from "./attendance-actions";
import { AttendanceClockPanel, AttendanceQrBoard } from "./AttendancePanels";

export const dynamic = "force-dynamic";

interface Task {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_to: string | null;
  note: string | null;
  created_at: string;
}

interface AttendanceEvent { id: string; user_id: string; event_type: "clock_in" | "clock_out"; method: "button" | "qr" | "line"; occurred_at: string; }
interface AttendanceStaff { user_id: string; display_name: string | null; line_user_id: string | null; active: boolean; }
interface AttendanceSummary { userId: string; minutes: number; firstAt: string | null; lastAt: string | null; eventCount: number; exceptions: number; }

const CATEGORY: Record<string, string> = { appointment: "預約", payment: "付款", customer: "顧客", channel: "渠道", other: "其他" };
const STATUS: Record<string, string> = { open: "待處理", in_progress: "處理中", done: "已完成" };
const PRIORITY: Record<string, string> = { low: "低", normal: "一般", high: "高" };
const METHOD: Record<string, string> = { button: "後台按鈕", qr: "QR 掃碼", line: "LINE" };

function validDate(value: string | undefined, fallback: string): string { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback; }
function attendanceSummary(events: AttendanceEvent[]): AttendanceSummary[] {
  const grouped = new Map<string, AttendanceEvent[]>();
  for (const event of events) grouped.set(event.user_id, [...(grouped.get(event.user_id) ?? []), event]);
  return [...grouped.entries()].map(([userId, rows]) => {
    rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    let opened: Date | null = null;
    let minutes = 0;
    let exceptions = 0;
    for (const row of rows) {
      if (row.event_type === "clock_in") { if (opened) exceptions += 1; else opened = new Date(row.occurred_at); }
      else if (!opened) exceptions += 1;
      else { minutes += Math.max(0, Math.round((new Date(row.occurred_at).getTime() - opened.getTime()) / 60000)); opened = null; }
    }
    if (opened) exceptions += 1;
    return { userId, minutes, firstAt: rows[0]?.occurred_at ?? null, lastAt: rows.at(-1)?.occurred_at ?? null, eventCount: rows.length, exceptions };
  }).sort((a, b) => b.minutes - a.minutes);
}
function hours(minutes: number): string { return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`; }
function dateTime(value: string | null): string { return value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "—"; }

export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string; priority?: string; assignee?: string; from?: string; to?: string }> }) {
  const member = await requireOperator();
  const params = await searchParams;
  let query = member.supabase
    .from("handoff_tasks")
    .select("id, title, category, status, priority, due_at, assigned_to, note, created_at")
    .eq("clinic_id", member.clinicId)
    .order("status")
    .order("priority", { ascending: false })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (["open", "in_progress", "done"].includes(params.status ?? "")) query = query.eq("status", params.status!);
  if (Object.hasOwn(CATEGORY, params.category ?? "")) query = query.eq("category", params.category!);
  if (Object.hasOwn(PRIORITY, params.priority ?? "")) query = query.eq("priority", params.priority!);
  if (params.assignee) query = query.eq("assigned_to", params.assignee);

  const [{ data, error }, { data: members, error: membersError }] = await Promise.all([
    query,
    member.supabase.from("clinic_members").select("user_id, access_type").eq("clinic_id", member.clinicId),
  ]);
  if (error || membersError) throw new Error(error?.message ?? membersError?.message ?? "讀取交班待辦失敗");

  const service = createServiceClient();
  const { data: authUsers } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map(authUsers.users.map((user) => [user.id, user.email ?? user.id]));
  const tasks = (data ?? []) as Task[];
  const openCount = tasks.filter((task) => task.status !== "done").length;
  const highPriorityCount = tasks.filter((task) => task.priority === "high" && task.status !== "done").length;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const from = validDate(params.from, `${today.slice(0, 8)}01`);
  const to = validDate(params.to, today);
  const isBrandAdmin = member.accessType === "brand_admin";
  let attendanceQuery = service.from("attendance_events").select("id, user_id, event_type, method, occurred_at").eq("clinic_id", member.clinicId).gte("occurred_at", new Date(`${from}T00:00:00+08:00`).toISOString()).lte("occurred_at", new Date(`${to}T23:59:59.999+08:00`).toISOString()).order("occurred_at", { ascending: false }).limit(2000);
  if (!isBrandAdmin) attendanceQuery = attendanceQuery.eq("user_id", member.user.id);
  const [{ data: attendanceSettings, error: attendanceSettingsError }, { data: attendanceStaff, error: attendanceStaffError }, { data: attendanceEvents, error: attendanceEventsError }] = await Promise.all([
    service.from("attendance_settings").select("click_enabled, qr_enabled, line_enabled, qr_refresh_seconds").eq("clinic_id", member.clinicId).maybeSingle(),
    isBrandAdmin ? service.from("attendance_staff").select("user_id, display_name, line_user_id, active").eq("clinic_id", member.clinicId) : Promise.resolve({ data: [], error: null }),
    attendanceQuery,
  ]);
  const attendanceError = attendanceSettingsError ?? attendanceStaffError ?? attendanceEventsError;
  if (attendanceError && attendanceError.code !== "42P01") throw new Error(`讀取出勤資料失敗：${attendanceError.message}`);
  const settings = attendanceSettings ?? { click_enabled: true, qr_enabled: false, line_enabled: false, qr_refresh_seconds: 60 };
  const staffBindings = (attendanceStaff ?? []) as AttendanceStaff[];
  const bindingByUser = new Map(staffBindings.map((staff) => [staff.user_id, staff]));
  const eventRows = (attendanceEvents ?? []) as AttendanceEvent[];
  const summaries = attendanceSummary(eventRows);
  const myLastEvent = eventRows.find((event) => event.user_id === member.user.id);

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">日常交接</p>
          <h1 className="admin-page-title">交班待辦</h1>
          <p className="admin-page-description">集中交接預約、付款、顧客與渠道問題，讓下一位負責人清楚知道狀態與期限。</p>
        </div>
      </header>

      <section className="admin-metric-strip grid-cols-3" aria-label="交班摘要">
        <Metric label="目前清單" value={tasks.length} />
        <Metric label="未完成" value={openCount} />
        <Metric label="高優先" value={highPriorityCount} />
      </section>

      <section className="attendance-workspace">
        <AttendanceClockPanel clickEnabled={settings.click_enabled === true} qrEnabled={settings.qr_enabled === true} lastEvent={myLastEvent ? { eventType: myLastEvent.event_type, occurredAt: myLastEvent.occurred_at } : undefined} />
        {isBrandAdmin && <section className="attendance-admin-panel">
          <div className="attendance-panel-heading"><div><p className="eyebrow">管理者工具</p><h2>打卡方式與動態 QR</h2><p>可同時開放多種方式；QR 會依設定時間自動換碼。</p></div></div>
          <form action={saveAttendanceSettingsAction} className="attendance-settings-form">
            <label><input type="checkbox" name="click_enabled" defaultChecked={settings.click_enabled === true} />員工點擊按鈕</label>
            <label><input type="checkbox" name="qr_enabled" defaultChecked={settings.qr_enabled === true} />掃描管理者 QR</label>
            <label><input type="checkbox" name="line_enabled" defaultChecked={settings.line_enabled === true} />LINE 關鍵字打卡</label>
            <label className="attendance-refresh-field"><span className="label">QR 更新頻率</span><select name="qr_refresh_seconds" className="input" defaultValue={String(settings.qr_refresh_seconds ?? 60)}><option value="30">30 秒</option><option value="60">1 分鐘</option><option value="300">5 分鐘</option><option value="600">10 分鐘</option><option value="1800">30 分鐘</option></select></label>
            <SubmitButton className="btn btn-secondary">儲存打卡設定</SubmitButton>
          </form>
          <AttendanceQrBoard enabled={settings.qr_enabled === true} refreshSeconds={Number(settings.qr_refresh_seconds ?? 60)} />
        </section>}
      </section>

      {isBrandAdmin && <section className="admin-section attendance-binding-section">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">員工與 LINE 綁定</h2><p className="mt-0.5 text-xs text-slate-500">只有在此啟用並綁定的 LINE User ID，傳送「上班打卡」或「下班打卡」才會寫入出勤。</p></div></div>
        <div className="attendance-binding-list">{(members ?? []).map((staff) => { const binding = bindingByUser.get(staff.user_id); return <form action={saveAttendanceStaffAction} key={staff.user_id} className="attendance-binding-row"><input type="hidden" name="user_id" value={staff.user_id} /><div className="attendance-staff-account"><strong>{emailById.get(staff.user_id) ?? "品牌成員"}</strong><span>{staff.access_type === "brand_admin" ? "品牌管理者" : "品牌員工"}</span></div><label><span className="label">顯示名稱</span><input name="display_name" className="input" defaultValue={binding?.display_name ?? ""} placeholder="例如：林老師" /></label><label><span className="label">LINE User ID</span><input name="line_user_id" className="input font-mono" defaultValue={binding?.line_user_id ?? ""} placeholder="U 開頭識別碼" /></label><label className="attendance-active"><input type="checkbox" name="active" defaultChecked={binding?.active !== false} />啟用</label><SubmitButton className="btn btn-secondary">儲存綁定</SubmitButton></form>; })}</div>
      </section>}

      <section className="admin-section attendance-records">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">出勤紀錄與工時</h2><p className="mt-0.5 text-xs text-slate-500">依上班／下班順序配對計算；重複或缺少配對會保留並標示異常，不覆蓋資料。</p></div><form className="attendance-range-form"><input type="date" name="from" className="input" defaultValue={from} /><span>至</span><input type="date" name="to" className="input" defaultValue={to} /><button className="btn btn-secondary" type="submit">查詢</button></form></div>
        {summaries.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">此日期範圍尚無出勤紀錄</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>員工</th><th>第一筆</th><th>最後一筆</th><th>打卡筆數</th><th>配對工時</th><th>異常</th></tr></thead><tbody>{summaries.map((row) => <tr key={row.userId}><td className="font-medium">{bindingByUser.get(row.userId)?.display_name || emailById.get(row.userId) || "品牌成員"}</td><td>{dateTime(row.firstAt)}</td><td>{dateTime(row.lastAt)}</td><td>{row.eventCount}</td><td className="font-semibold">{hours(row.minutes)}</td><td>{row.exceptions > 0 ? <span className="badge bg-amber-50 text-amber-700">{row.exceptions} 筆待確認</span> : <span className="badge bg-emerald-50 text-emerald-700">正常</span>}</td></tr>)}</tbody></table></div>}
        {eventRows.length > 0 && <div className="attendance-latest"><h3>最近打卡明細</h3>{eventRows.slice(0, 20).map((event) => <div key={event.id}><span className={`status-dot ${event.event_type === "clock_in" ? "status-confirmed" : "status-done"}`} /><strong>{event.event_type === "clock_in" ? "上班" : "下班"}</strong><span>{bindingByUser.get(event.user_id)?.display_name || emailById.get(event.user_id) || "品牌成員"}</span><time>{dateTime(event.occurred_at)}</time><em>{METHOD[event.method]}</em></div>)}</div>}
      </section>

      <div className="admin-workbench-grid-wide">
        <section className="admin-section">
          <div className="admin-section-header">
            <div><h2 className="font-semibold text-slate-900">新增交班事項</h2><p className="mt-0.5 text-xs text-slate-500">留下明確行動、期限與負責人，避免只寫問題現象。</p></div>
          </div>
          <form action={createHandoffTaskAction} className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2"><span className="label">待辦標題</span><input name="title" className="input" maxLength={160} required placeholder="例如：確認明日上午訂金未入帳" /></label>
            <label className="text-sm"><span className="label">分類</span><select name="category" className="input" defaultValue="appointment">{Object.entries(CATEGORY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-sm"><span className="label">優先度</span><select name="priority" className="input" defaultValue="normal">{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-sm"><span className="label">完成期限（台北時間）</span><input type="datetime-local" name="due_at" className="input" /></label>
            <label className="text-sm"><span className="label">負責人</span><select name="assigned_to" className="input" defaultValue=""><option value="">未指派</option>{(members ?? []).map((staff) => <option key={staff.user_id} value={staff.user_id}>{emailById.get(staff.user_id) ?? "品牌成員（未設定 Email）"}</option>)}</select></label>
            <label className="text-sm sm:col-span-2"><span className="label">交班備註</span><textarea name="note" className="input min-h-20" maxLength={1000} /></label>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-primary min-h-11">新增交班待辦</SubmitButton></div>
          </form>
        </section>

        <section className="admin-section self-start">
          <div className="admin-section-header">
            <div><h2 className="font-semibold text-slate-900">篩選清單</h2><p className="mt-0.5 text-xs text-slate-500">縮小範圍後再處理或交班。</p></div>
          </div>
          <form className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm"><span className="label">狀態</span><select name="status" className="input" defaultValue={params.status ?? ""}><option value="">全部</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-sm"><span className="label">分類</span><select name="category" className="input" defaultValue={params.category ?? ""}><option value="">全部</option>{Object.entries(CATEGORY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-sm"><span className="label">優先度</span><select name="priority" className="input" defaultValue={params.priority ?? ""}><option value="">全部</option>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-sm"><span className="label">負責人</span><select name="assignee" className="input" defaultValue={params.assignee ?? ""}><option value="">全部</option>{(members ?? []).map((staff) => <option key={staff.user_id} value={staff.user_id}>{emailById.get(staff.user_id) ?? "品牌成員（未設定 Email）"}</option>)}</select></label>
            <button className="btn btn-secondary min-h-11 sm:col-span-2" type="submit">套用交班篩選</button>
          </form>
        </section>
      </div>

      <section className="admin-section">
        <div className="admin-section-header">
          <div><h2 className="font-semibold text-slate-900">交班清單</h2><p className="mt-0.5 text-xs text-slate-500">可直接更新每一項的處理狀態與優先度。</p></div>
          <span className="text-xs tabular-nums text-slate-500">{tasks.length} 筆</span>
        </div>
        {tasks.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">目前篩選沒有交班待辦</p> : (
          <div className="divide-y divide-slate-200">
            {tasks.map((task) => (
              <article key={task.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-900">{task.title}</h3>
                    <span className={`badge ${task.priority === "high" ? "bg-red-50 text-red-700" : task.priority === "low" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{PRIORITY[task.priority]}優先</span>
                    <span className="badge bg-brand-50 text-brand-700">{CATEGORY[task.category]}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{task.assigned_to ? `負責：${emailById.get(task.assigned_to) ?? "品牌成員"}` : "未指派"}{task.due_at ? ` · 期限：${new Date(task.due_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` : ""}</p>
                  {task.note && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{task.note}</p>}
                </div>
                <form action={updateHandoffTaskAction} className="grid grid-cols-2 items-end gap-2 sm:flex">
                  <input type="hidden" name="id" value={task.id} />
                  <label className="text-xs"><span className="label">處理狀態</span><select name="status" defaultValue={task.status} className="input h-10 py-1 text-xs">{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <label className="text-xs"><span className="label">優先度</span><select name="priority" defaultValue={task.priority} className="input h-10 py-1 text-xs">{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <SubmitButton className="btn btn-secondary min-h-10 px-3 text-xs max-sm:col-span-2">儲存交班狀態</SubmitButton>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="admin-metric"><span className="admin-metric-label">{label}</span><strong className="admin-metric-value">{value}</strong></div>;
}
