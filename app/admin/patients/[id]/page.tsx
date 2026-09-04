import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { requireMember, canViewSensitiveCustomerData, hasBrandPermission } from "@/lib/admin";
import { formatDateTime } from "@/lib/slots";
import {
  updatePatientAction,
  updatePatientBasicAction,
  addPatientRecordAction,
  deletePatientRecordAction,
  setPatientBlockAction,
  mergePatientAction,
} from "../../patient-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { createScheduledFollowupAction, setScheduledFollowupStatusAction } from "../../followups/actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  cancelled: "已取消",
  done: "完成",
  no_show: "未到",
};

interface Patient {
  id: string;
  name: string;
  phone: string;
  tags: string | null;
  birthday: string | null;
  gender: string | null;
  email: string | null;
  marketing_opt_in: boolean;
  blocked_until: string | null;
}
interface Appt {
  id: string;
  start_at: string;
  status: string;
  queue_number: number | null;
  doctors: { name: string } | null;
  services: { name: string } | null;
}
interface PatientRecord {
  id: string;
  content: string;
  created_at: string;
}
interface CrmInteraction {
  id: string;
  kind: "note" | "booking" | "message" | "campaign";
  channel: string | null;
  title: string | null;
  body: string;
  created_at: string;
}
interface Subscription { id: string; status: string; current_period_end: string; subscription_plans: { name: string } | { name: string }[] | null; }
interface Followup { id: string; channel: string; body: string; scheduled_for: string; status: string; last_error: string | null; }
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = await requireMember();
  const { clinicId, role } = member;
  if (!canViewSensitiveCustomerData(role)) {
    return <p className="card p-6 text-sm text-slate-500">目前角色沒有查看完整顧客資料的權限。</p>;
  }
  const supabase = await createSupabaseServer();

  const { data } = await supabase
    .from("patients")
    .select("id, name, phone, tags, birthday, gender, email, marketing_opt_in, blocked_until")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const p = data as Patient | null;

  if (!p) {
    return (
      <div className="space-y-3">
        <Link href="/admin/patients" className="text-sm text-brand-600 hover:underline">
          ← 返回顧客查詢
        </Link>
        <p className="text-slate-500">查無此顧客。</p>
      </div>
    );
  }

  const [{ data: apptData }, { data: recData }, { data: interactionData }, { data: walletData }, { data: pointData }, { data: subscriptionData }, { data: followupData }, { data: mergeTargetData }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, start_at, status, queue_number, doctors(name), services(name)")
      .eq("clinic_id", clinicId)
      .eq("patient_id", id)
      .order("start_at", { ascending: false }),
    supabase
      .from("patient_records")
      .select("id, content, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("crm_interactions")
      .select("id, kind, channel, title, body, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("customer_wallets").select("balance, lifetime_credit, lifetime_debit").eq("clinic_id", clinicId).eq("patient_id", id).maybeSingle(),
    supabase.from("loyalty_accounts").select("points_balance, lifetime_earned, lifetime_redeemed").eq("clinic_id", clinicId).eq("patient_id", id).maybeSingle(),
    supabase.from("patient_subscriptions").select("id, status, current_period_end, subscription_plans(name)").eq("clinic_id", clinicId).eq("patient_id", id).in("status", ["active", "paused", "past_due"]).order("created_at", { ascending: false }),
    supabase.from("scheduled_followups").select("id, channel, body, scheduled_for, status, last_error").eq("clinic_id", clinicId).eq("patient_id", id).order("scheduled_for", { ascending: false }).limit(20),
    hasBrandPermission(member, "brand.manage") ? supabase.from("patients").select("id, name, phone, email").eq("clinic_id", clinicId).eq("active", true).neq("id", id).order("name").limit(500) : Promise.resolve({ data: [] }),
  ]);
  const history = (apptData ?? []) as unknown as Appt[];
  const records = (recData ?? []) as PatientRecord[];
  const interactions = (interactionData ?? []) as CrmInteraction[];
  const subscriptions = (subscriptionData ?? []) as unknown as Subscription[];
  const followups = (followupData ?? []) as Followup[];
  const noShow = history.filter((a) => a.status === "no_show").length;
  const blocked = !!p.blocked_until && new Date(p.blocked_until) > new Date();

  return (
    <div className="space-y-5">
      <Link href="/admin/patients" className="text-sm text-brand-600 hover:underline">
        ← 返回顧客查詢
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">{p.name}</h1>
        <span className="text-sm text-slate-500">{p.phone}</span>
        {blocked ? (
          <span className="badge bg-red-50 text-red-600">停權至 {formatDateTime(p.blocked_until!)}</span>
        ) : (
          <span className="badge bg-accent-500/10 text-accent-600">正常</span>
        )}
        <span className="text-sm text-slate-400">未到 {noShow} 次</span>
      </div>

      <section className="admin-metric-strip">
        <div className="admin-metric"><span className="admin-metric-label">儲值餘額</span><strong className="admin-metric-value">NT${Number(walletData?.balance ?? 0).toLocaleString("zh-TW")}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">點數餘額</span><strong className="admin-metric-value">{Number(pointData?.points_balance ?? 0).toLocaleString("zh-TW")}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">有效訂閱</span><strong className="admin-metric-value">{subscriptions.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">待回訪</span><strong className="admin-metric-value">{followups.filter((item) => item.status === "pending" || item.status === "failed").length}</strong></div>
      </section>

      {subscriptions.length > 0 && <section className="admin-section p-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">目前訂閱</h2><Link href="/admin/customer-value" className="text-xs font-medium text-brand-700 hover:underline">管理顧客資產</Link></div><div className="mt-3 divide-y divide-slate-100">{subscriptions.map((subscription) => <div key={subscription.id} className="flex items-center justify-between py-2 text-sm"><span>{one(subscription.subscription_plans)?.name ?? "訂閱方案"}</span><span className="text-slate-500">{subscription.status === "active" ? "有效" : subscription.status === "paused" ? "暫停" : "待處理"} · 至 {new Date(subscription.current_period_end).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}</span></div>)}</div></section>}

      <section className="grid gap-5 lg:grid-cols-2">
        <form action={createScheduledFollowupAction} className="admin-section p-4"><h2 className="font-semibold text-slate-900">安排指定日期回訪</h2><input type="hidden" name="patient_id" value={p.id} /><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm"><span className="label">處理方式</span><select name="channel" className="input"><option value="phone">電話</option><option value="manual">人工處理</option><option value="line">LINE</option><option value="email">Email</option></select></label><label className="text-sm"><span className="label">用途</span><select name="purpose" className="input"><option value="service">服務關懷</option><option value="marketing">行銷（需顧客同意）</option></select></label><label className="text-sm"><span className="label">日期時間</span><input name="scheduled_for" type="datetime-local" className="input" required /></label><label className="text-sm"><span className="label">主旨</span><input name="subject" className="input" /></label><label className="text-sm sm:col-span-2"><span className="label">回訪內容</span><textarea name="body" rows={3} className="input" required /></label><SubmitButton className="btn btn-primary sm:col-span-2">安排回訪</SubmitButton></div></form>
        <section className="admin-section p-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">最近回訪</h2><Link href="/admin/followups" className="text-xs font-medium text-brand-700 hover:underline">查看全部</Link></div>{followups.length === 0 ? <p className="mt-4 text-sm text-slate-400">尚未安排回訪</p> : <div className="mt-3 divide-y divide-slate-100">{followups.slice(0, 6).map((followup) => <div key={followup.id} className="py-2 text-sm"><div className="flex items-center justify-between gap-2"><span>{formatDateTime(followup.scheduled_for)} · {followup.channel.toUpperCase()}</span><span className="text-xs text-slate-500">{followup.status === "pending" ? "待處理" : followup.status === "failed" ? "失敗" : followup.status === "completed" ? "已完成" : followup.status === "sent" ? "已發送" : "已取消"}</span></div><p className="mt-1 line-clamp-2 text-xs text-slate-500">{followup.body}</p>{followup.last_error && <p className="mt-1 text-xs text-red-700">{followup.last_error}</p>}{["pending", "failed"].includes(followup.status) && ["phone", "manual"].includes(followup.channel) && <form action={setScheduledFollowupStatusAction} className="mt-1"><input type="hidden" name="id" value={followup.id} /><input type="hidden" name="status" value="completed" /><SubmitButton className="admin-inline-action">標記完成</SubmitButton></form>}</div>)}</div>}</section>
      </section>

      {hasBrandPermission(member, "brand.manage") && (mergeTargetData ?? []).length > 0 && <details className="admin-section"><summary className="cursor-pointer px-4 py-3 font-semibold text-red-800">合併重複顧客資料</summary><form action={mergePatientAction} className="space-y-3 border-t border-red-100 p-4"><input type="hidden" name="source_patient_id" value={p.id} /><p className="text-sm leading-6 text-slate-600">目前這筆「{p.name} · {p.phone}」會停用，預約、報名、套票、互動、訂閱與回訪歷史移到選定的保留顧客。若兩筆綁定不同 LINE 帳號，系統會拒絕合併。</p><label className="text-sm"><span className="label">保留哪一筆顧客</span><select name="target_patient_id" className="input" required defaultValue=""><option value="" disabled>選擇要保留的顧客</option>{(mergeTargetData ?? []).map((target) => <option key={target.id} value={target.id}>{target.name} · {target.phone}{target.email ? ` · ${target.email}` : ""}</option>)}</select></label><label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" name="confirmed" value="yes" required className="mt-1" />我已核對兩筆是同一位顧客，並確認要保留上方選擇的資料。</label><SubmitButton className="btn btn-danger">合併顧客</SubmitButton></form></details>}

      {/* 基本資料(修正顧客自填錯誤) */}
      <form action={updatePatientBasicAction} className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">基本資料</h2>
          <p className="text-xs text-slate-400">顧客一開始填錯時可在此更正姓名或電話。</p>
        </div>
        <input type="hidden" name="id" value={p.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">姓名</span>
            <input name="name" defaultValue={p.name} required className="input" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">電話</span>
            <input name="phone" defaultValue={p.phone} required inputMode="tel" className="input" />
          </label>
        </div>
        <SubmitButton className="btn btn-primary">儲存基本資料</SubmitButton>
      </form>

      {/* 黑名單 */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm text-slate-600">
          預約限制(啟用後將無法線上預約)。三次未出席會自動限制一個月,也可在此手動調整。
        </div>
        <form action={setPatientBlockAction}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="block" value={blocked ? "0" : "1"} />
          {blocked ? (
            <SubmitButton className="btn btn-secondary">解除黑名單</SubmitButton>
          ) : (
            <SubmitButton className="btn btn-danger">加入黑名單(停權1個月)</SubmitButton>
          )}
        </form>
      </section>

      {/* 建檔記錄 */}
      <form action={updatePatientAction} className="card space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">建檔記錄 / 行銷資訊</h2>
        <input type="hidden" name="id" value={p.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">生日</span>
            <input type="date" name="birthday" defaultValue={p.birthday ?? ""} className="input" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">性別</span>
            <select name="gender" defaultValue={p.gender ?? ""} className="input">
              <option value="">未填</option>
              <option value="男">男</option>
              <option value="女">女</option>
              <option value="其他">其他</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Email</span>
            <input type="email" name="email" defaultValue={p.email ?? ""} className="input" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">標籤（以逗號分隔）</span>
            <input name="tags" defaultValue={p.tags ?? ""} placeholder="例如：重要顧客，會員，待回訪" className="input" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="marketing_opt_in"
            defaultChecked={p.marketing_opt_in}
            className="h-4 w-4 accent-brand-600"
          />
          同意接收行銷訊息
        </label>
        <SubmitButton className="btn btn-primary">儲存建檔</SubmitButton>
      </form>

      {/* 新增服務備註(輸入欄放此,列表在右欄) */}
      <form action={addPatientRecordAction} className="card space-y-2 p-5">
        <h2 className="font-semibold text-slate-900">新增服務備註</h2>
        <input type="hidden" name="patient_id" value={p.id} />
        <textarea
          name="content"
          rows={2}
          required
          placeholder="輸入服務備註、顧客需求或處理內容，送出即新增一筆…"
          className="input"
        />
        <SubmitButton className="btn btn-primary">新增服務備註</SubmitButton>
      </form>

      {/* 預約歷史(左)+ 服務備註(右)雙欄 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 預約歷史 */}
        <section className="card p-5">
          <h2 className="mb-3 font-semibold text-slate-900">預約歷史</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">無預約紀錄</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {history.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-slate-700">
                  <span className="font-medium">{formatDateTime(a.start_at)}</span>
                  <span className="text-slate-500">{a.doctors?.name}</span>
                  {a.services?.name && (
                    <span className="badge bg-slate-100 text-slate-600">{a.services.name}</span>
                  )}
                  {a.queue_number != null && <span className="text-slate-500">第 {a.queue_number} 號</span>}
                  <span
                    className={`badge ml-auto ${a.status === "no_show" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                  >
                    {STATUS_LABEL[a.status] ?? "其他狀態"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 服務備註(列表) */}
        <section className="card p-5">
          <h2 className="mb-3 font-semibold text-slate-900">服務備註</h2>
          {records.length === 0 ? (
            <p className="text-sm text-slate-400">尚無服務備註</p>
          ) : (
            <ul className="space-y-3">
              {records.map((rec) => (
                <li key={rec.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-slate-400">{formatDateTime(rec.created_at)}</span>
                    <form action={deletePatientRecordAction}>
                      <input type="hidden" name="id" value={rec.id} />
                      <input type="hidden" name="patient_id" value={p.id} />
                      <SubmitButton className="text-xs text-red-500 hover:underline">刪除</SubmitButton>
                    </form>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{rec.content}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold text-slate-900">互動時間軸</h2>
          {interactions.length === 0 ? (
            <p className="text-sm text-slate-400">尚無行銷或客服互動紀錄。</p>
          ) : (
            <ul className="space-y-3">
              {interactions.map((interaction) => (
                <li key={interaction.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">{interaction.title ?? interaction.kind}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(interaction.created_at)}</span>
                  </div>
                  <p className="mb-1 text-xs text-slate-400">{interaction.channel ?? "system"}</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{interaction.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
