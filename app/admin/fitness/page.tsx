import Link from "next/link";
import { requireNonProvider } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/SubmitButton";
import { freezeSubscriptionAction } from "./actions";

export const dynamic = "force-dynamic";
type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
const SUB_STATUS: Record<string, string> = { active: "使用中", paused: "凍結中", past_due: "待續費", cancelled: "已取消" };
const FREEZE_STATUS: Record<string, string> = { scheduled: "已排定", active: "凍結中", completed: "已完成", cancelled: "已取消" };

export default async function FitnessOperationsPage() {
  const member = await requireNonProvider();
  const supabase = await createSupabaseServer();
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  const [sessionsResult, registrationsResult, subscriptionsResult, freezesResult] = await Promise.all([
    supabase.from("event_sessions").select("id,name,start_at,end_at,venue,capacity,events(title)").eq("clinic_id", member.clinicId).eq("active", true).gte("start_at", now.toISOString()).lte("start_at", horizon.toISOString()).order("start_at").limit(100),
    supabase.from("registrations").select("id,session_id,status").eq("clinic_id", member.clinicId).in("status", ["pending", "confirmed", "attended", "waitlisted"]),
    supabase.from("patient_subscriptions").select("id,status,current_period_end,next_billing_at,patients(name,phone),subscription_plans(name,billing_interval)").eq("clinic_id", member.clinicId).in("status", ["active", "paused", "past_due"]).order("created_at", { ascending: false }).limit(300),
    supabase.from("subscription_freezes").select("id,starts_on,ends_on,freeze_days,status,reason,patients(name),patient_subscriptions(subscription_plans(name))").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }).limit(100),
  ]);
  const error = sessionsResult.error ?? registrationsResult.error ?? subscriptionsResult.error ?? freezesResult.error;
  if (error) throw new Error(error.message);
  const registrations = registrationsResult.data ?? [];
  const sessionRows = (sessionsResult.data ?? []).map((session) => {
    const related = registrations.filter((registration) => registration.session_id === session.id);
    const occupied = related.filter((registration) => ["pending", "confirmed", "attended"].includes(registration.status)).length;
    const waitlisted = related.filter((registration) => registration.status === "waitlisted").length;
    return { ...session, occupied, waitlisted, remaining: Math.max(0, session.capacity - occupied) };
  });
  const subscriptions = subscriptionsResult.data ?? [];
  const attendanceTotal = sessionRows.reduce((sum, session) => sum + session.occupied, 0);
  const capacityTotal = sessionRows.reduce((sum, session) => sum + session.capacity, 0);

  return <div className="admin-page">
    <div className="admin-page-header"><div><p className="eyebrow">皮拉提斯／瑜珈產業包</p><h1 className="admin-page-title">教室與會籍營運</h1><p className="admin-page-description">集中查看未來 30 天班表滿班率、候補與會員凍結；班級與票種仍由既有活動模組維護。</p></div><div className="flex gap-2"><Link href="/admin/events" className="btn btn-secondary">管理班級</Link><Link href="/admin/customer-value" className="btn btn-secondary">管理會籍方案</Link></div></div>
    <section className="admin-metric-strip grid-cols-2 sm:grid-cols-4"><div className="admin-metric"><span className="admin-metric-label">未來班次</span><strong className="admin-metric-value">{sessionRows.length}</strong></div><div className="admin-metric"><span className="admin-metric-label">已占名額</span><strong className="admin-metric-value">{attendanceTotal}</strong></div><div className="admin-metric"><span className="admin-metric-label">總容量</span><strong className="admin-metric-value">{capacityTotal}</strong></div><div className="admin-metric"><span className="admin-metric-label">有效會籍</span><strong className="admin-metric-value">{subscriptions.filter((item) => ["active", "paused"].includes(item.status)).length}</strong></div></section>
    <section className="admin-table-shell"><div className="admin-section-header"><div><h2 className="font-semibold">未來 30 天班表</h2><p className="text-xs text-slate-500">占位包含待確認、已確認與已報到；候補另外列示。</p></div></div><table className="tbl"><thead><tr><th>日期時間</th><th>課程／班次</th><th>場地</th><th>名額</th><th>狀況</th></tr></thead><tbody>{sessionRows.map((session) => { const event = one(session.events); const ratio = session.capacity ? Math.round(session.occupied / session.capacity * 100) : 0; return <tr key={session.id}><td>{new Date(session.start_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" })}</td><td><strong>{event?.title ?? "課程"}</strong><div className="text-xs text-slate-400">{session.name}</div></td><td>{session.venue || "未指定"}</td><td>{session.occupied}／{session.capacity}<div className="text-xs text-slate-400">剩餘 {session.remaining} · 候補 {session.waitlisted}</div></td><td><span className={`badge ${ratio >= 100 ? "bg-rose-50 text-rose-700" : ratio >= 80 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{ratio >= 100 ? "已滿班" : ratio >= 80 ? "接近滿班" : `${ratio}%`}</span></td></tr>; })}{sessionRows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">未來 30 天尚無班次</td></tr>}</tbody></table></section>
    <section className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]"><form action={freezeSubscriptionAction} className="admin-section self-start p-4"><h2 className="font-semibold">安排會籍凍結</h2><p className="mt-1 text-sm leading-6 text-slate-500">最多 90 天；會籍到期日與下次續費日會自動順延，排程每日依台北日期切換狀態。</p><div className="mt-3 space-y-3"><label className="block"><span className="label">顧客會籍</span><select name="subscription_id" className="input" required defaultValue=""><option value="" disabled>選擇會籍</option>{subscriptions.filter((subscription) => ["active", "paused"].includes(subscription.status)).map((subscription) => { const patient = one(subscription.patients); const plan = one(subscription.subscription_plans); return <option key={subscription.id} value={subscription.id}>{patient?.name} · {plan?.name} · {SUB_STATUS[subscription.status]}</option>; })}</select></label><div className="grid grid-cols-2 gap-3"><label><span className="label">開始日期</span><input name="starts_on" type="date" className="input" required /></label><label><span className="label">結束日期</span><input name="ends_on" type="date" className="input" required /></label></div><label className="block"><span className="label">原因</span><input name="reason" className="input" maxLength={300} placeholder="例如：出國、受傷休養" /></label><SubmitButton className="btn btn-primary">確認凍結與順延</SubmitButton></div></form>
    <div className="admin-table-shell"><div className="admin-section-header"><h2 className="font-semibold">最近凍結紀錄</h2></div><table className="tbl"><thead><tr><th>會員／方案</th><th>凍結期間</th><th>狀態</th><th>原因</th></tr></thead><tbody>{(freezesResult.data ?? []).map((freeze) => { const patient = one(freeze.patients); const subscription = one(freeze.patient_subscriptions); const plan = subscription ? one(subscription.subscription_plans) : null; return <tr key={freeze.id}><td>{patient?.name}<div className="text-xs text-slate-400">{plan?.name}</div></td><td>{freeze.starts_on} ～ {freeze.ends_on}<div className="text-xs text-slate-400">{freeze.freeze_days} 天</div></td><td><span className="badge bg-slate-100 text-slate-600">{FREEZE_STATUS[freeze.status] ?? freeze.status}</span></td><td>{freeze.reason || "—"}</td></tr>; })}{(freezesResult.data ?? []).length === 0 && <tr><td colSpan={4} className="py-10 text-center text-sm text-slate-400">尚無凍結紀錄</td></tr>}</tbody></table></div></section>
  </div>;
}
