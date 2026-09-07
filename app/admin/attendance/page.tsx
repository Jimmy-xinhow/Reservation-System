import Link from "next/link";
import { requireMember } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { saveAttendanceSettingsAction, saveAttendanceStaffAction } from "../handoff/attendance-actions";
import { AttendanceClockPanel, AttendanceQrBoard } from "../handoff/AttendancePanels";

export const dynamic = "force-dynamic";

interface AttendanceEvent {
  id: string;
  user_id: string;
  event_type: "clock_in" | "clock_out";
  method: "button" | "qr" | "line";
  occurred_at: string;
}

interface AttendanceStaff {
  user_id: string;
  display_name: string | null;
  line_user_id: string | null;
  active: boolean;
}

interface AttendanceSummary {
  userId: string;
  minutes: number;
  firstAt: string | null;
  lastAt: string | null;
  eventCount: number;
  exceptions: number;
}

const METHOD: Record<string, string> = { button: "後台按鈕", qr: "QR 掃碼", line: "LINE" };

function validDate(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function buildSummaries(events: AttendanceEvent[]): AttendanceSummary[] {
  const grouped = new Map<string, AttendanceEvent[]>();
  for (const event of events) grouped.set(event.user_id, [...(grouped.get(event.user_id) ?? []), event]);
  return [...grouped.entries()].map(([userId, rows]) => {
    rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    let opened: Date | null = null;
    let minutes = 0;
    let exceptions = 0;
    for (const row of rows) {
      if (row.event_type === "clock_in") {
        if (opened) exceptions += 1;
        else opened = new Date(row.occurred_at);
      } else if (!opened) exceptions += 1;
      else {
        minutes += Math.max(0, Math.round((new Date(row.occurred_at).getTime() - opened.getTime()) / 60000));
        opened = null;
      }
    }
    if (opened) exceptions += 1;
    return { userId, minutes, firstAt: rows[0]?.occurred_at ?? null, lastAt: rows.at(-1)?.occurred_at ?? null, eventCount: rows.length, exceptions };
  }).sort((a, b) => b.minutes - a.minutes);
}

function hours(minutes: number): string {
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "—";
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const member = await requireMember();
  const params = await searchParams;
  const service = createServiceClient();
  const isBrandAdmin = member.accessType === "brand_admin";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const from = validDate(params.from, `${today.slice(0, 8)}01`);
  const to = validDate(params.to, today);

  let eventsQuery = service
    .from("attendance_events")
    .select("id, user_id, event_type, method, occurred_at")
    .eq("clinic_id", member.clinicId)
    .gte("occurred_at", new Date(`${from}T00:00:00+08:00`).toISOString())
    .lte("occurred_at", new Date(`${to}T23:59:59.999+08:00`).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(2000);
  if (!isBrandAdmin) eventsQuery = eventsQuery.eq("user_id", member.user.id);

  const [{ data: settingsData, error: settingsError }, { data: staffData, error: staffError }, { data: eventsData, error: eventsError }, { data: members, error: membersError }, { data: authUsers, error: authError }] = await Promise.all([
    service.from("attendance_settings").select("click_enabled, qr_enabled, line_enabled, qr_refresh_seconds").eq("clinic_id", member.clinicId).maybeSingle(),
    isBrandAdmin ? service.from("attendance_staff").select("user_id, display_name, line_user_id, active").eq("clinic_id", member.clinicId) : Promise.resolve({ data: [], error: null }),
    eventsQuery,
    isBrandAdmin
      ? member.supabase.from("clinic_members").select("user_id, access_type").eq("clinic_id", member.clinicId)
      : Promise.resolve({ data: [{ user_id: member.user.id, access_type: member.accessType }], error: null }),
    isBrandAdmin
      ? service.auth.admin.listUsers({ page: 1, perPage: 1000 })
      : Promise.resolve({ data: { users: [] }, error: null }),
  ]);
  const attendanceError = settingsError ?? staffError ?? eventsError ?? membersError ?? authError;
  if (attendanceError && attendanceError.code !== "42P01") throw new Error(`讀取出勤資料失敗：${attendanceError.message}`);

  const emailById = new Map<string, string>();
  if (isBrandAdmin) {
    for (const user of authUsers?.users ?? []) emailById.set(user.id, user.email ?? user.id);
  } else emailById.set(member.user.id, member.user.email ?? "我的帳號");

  const settings = settingsData ?? { click_enabled: true, qr_enabled: false, line_enabled: false, qr_refresh_seconds: 60 };
  const staffBindings = (staffData ?? []) as AttendanceStaff[];
  const bindingByUser = new Map(staffBindings.map((staff) => [staff.user_id, staff]));
  const eventRows = (eventsData ?? []) as AttendanceEvent[];
  const summaries = buildSummaries(eventRows);
  const pairedMinutes = summaries.reduce((sum, row) => sum + row.minutes, 0);
  const exceptionCount = summaries.reduce((sum, row) => sum + row.exceptions, 0);
  const myLastEvent = eventRows.find((event) => event.user_id === member.user.id);

  return <div className="admin-page">
    <header className="admin-page-header">
      <div><p className="eyebrow">員工管理</p><h1 className="admin-page-title">出勤打卡</h1><p className="admin-page-description">上下班打卡、動態 QR、LINE 綁定與工時紀錄集中在這裡，不再混入交班待辦。</p></div>
      <Link href="/admin/handoff" className="btn btn-secondary">前往交班待辦</Link>
    </header>

    <section className="admin-metric-strip grid-cols-3" aria-label="出勤摘要">
      <Metric label="期間打卡" value={`${eventRows.length} 筆`} />
      <Metric label="已配對工時" value={hours(pairedMinutes)} />
      <Metric label="待確認異常" value={`${exceptionCount} 筆`} />
    </section>

    <section id="attendance-scanner" className="attendance-workspace scroll-mt-6">
      <AttendanceClockPanel clickEnabled={settings.click_enabled === true} qrEnabled={settings.qr_enabled === true} lastEvent={myLastEvent ? { eventType: myLastEvent.event_type, occurredAt: myLastEvent.occurred_at } : undefined} />
      {isBrandAdmin && <section id="attendance-manager" className="attendance-admin-panel scroll-mt-6">
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
      <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">員工與 LINE 綁定</h2><p className="mt-0.5 text-xs text-slate-500">只有已啟用並綁定的 LINE User ID，傳送「上班打卡」或「下班打卡」才會寫入出勤。</p></div></div>
      <div className="attendance-binding-list">{(members ?? []).map((staff) => { const binding = bindingByUser.get(staff.user_id); return <form action={saveAttendanceStaffAction} key={staff.user_id} className="attendance-binding-row"><input type="hidden" name="user_id" value={staff.user_id} /><div className="attendance-staff-account"><strong>{emailById.get(staff.user_id) ?? "品牌成員"}</strong><span>{staff.access_type === "brand_admin" ? "品牌管理者" : "品牌員工"}</span></div><label><span className="label">顯示名稱</span><input name="display_name" className="input" defaultValue={binding?.display_name ?? ""} placeholder="例如：林老師" /></label><label><span className="label">LINE User ID</span><input name="line_user_id" className="input font-mono" defaultValue={binding?.line_user_id ?? ""} placeholder="U 開頭識別碼" /></label><label className="attendance-active"><input type="checkbox" name="active" defaultChecked={binding?.active !== false} />啟用</label><SubmitButton className="btn btn-secondary">儲存綁定</SubmitButton></form>; })}</div>
    </section>}

    <section className="admin-section attendance-records">
      <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">出勤紀錄與工時</h2><p className="mt-0.5 text-xs text-slate-500">依上班／下班順序配對計算；重複或缺少配對會保留並標示異常。</p></div><form className="attendance-range-form"><input type="date" name="from" className="input" defaultValue={from} /><span>至</span><input type="date" name="to" className="input" defaultValue={to} /><button className="btn btn-secondary" type="submit">查詢</button></form></div>
      {summaries.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">此日期範圍尚無出勤紀錄</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>員工</th><th>第一筆</th><th>最後一筆</th><th>打卡筆數</th><th>配對工時</th><th>異常</th></tr></thead><tbody>{summaries.map((row) => <tr key={row.userId}><td className="font-medium">{bindingByUser.get(row.userId)?.display_name || emailById.get(row.userId) || "品牌成員"}</td><td>{dateTime(row.firstAt)}</td><td>{dateTime(row.lastAt)}</td><td>{row.eventCount}</td><td className="font-semibold">{hours(row.minutes)}</td><td>{row.exceptions > 0 ? <span className="badge bg-amber-50 text-amber-700">{row.exceptions} 筆待確認</span> : <span className="badge bg-emerald-50 text-emerald-700">正常</span>}</td></tr>)}</tbody></table></div>}
      {eventRows.length > 0 && <div className="attendance-latest"><h3>最近打卡明細</h3>{eventRows.slice(0, 20).map((event) => <div key={event.id}><span className={`status-dot ${event.event_type === "clock_in" ? "status-confirmed" : "status-done"}`} /><strong>{event.event_type === "clock_in" ? "上班" : "下班"}</strong><span>{bindingByUser.get(event.user_id)?.display_name || emailById.get(event.user_id) || "品牌成員"}</span><time>{dateTime(event.occurred_at)}</time><em>{METHOD[event.method]}</em></div>)}</div>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="admin-metric"><span className="admin-metric-label">{label}</span><strong className="admin-metric-value">{value}</strong></div>;
}
