import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { canViewSensitiveCustomerData, hasBrandPermission, requireNonProvider } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import {
  adjustPointsAction,
  adjustWalletAction,
  createPatientSubscriptionAction,
  createSubscriptionPlanAction,
  setPatientSubscriptionStatusAction,
  toggleSubscriptionPlanAction,
} from "./actions";
import { MembershipManagementTabs } from "@/components/admin/ManagementTabs";

export const dynamic = "force-dynamic";

const INTERVAL: Record<string, string> = { monthly: "每月", quarterly: "每季", yearly: "每年" };
const STATUS: Record<string, string> = { active: "有效", paused: "暫停", past_due: "待處理", cancelled: "已取消" };
function money(value: number): string { return `NT$${Number(value).toLocaleString("zh-TW")}`; }
function date(value: string | null): string { return value ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "—"; }
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function CustomerValuePage() {
  const member = await requireNonProvider();
  if (!canViewSensitiveCustomerData(member.role)) return <p className="admin-section p-5 text-sm text-slate-500">目前角色不能查看顧客資產。</p>;
  const supabase = await createSupabaseServer();
  const [patients, wallets, points, plans, subscriptions] = await Promise.all([
    supabase.from("patients").select("id, name, phone").eq("clinic_id", member.clinicId).eq("active", true).order("name").limit(500),
    supabase.from("customer_wallets").select("id, balance, lifetime_credit, lifetime_debit, patients(id, name, phone)").eq("clinic_id", member.clinicId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("loyalty_accounts").select("id, points_balance, lifetime_earned, lifetime_redeemed, patients(id, name, phone)").eq("clinic_id", member.clinicId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("subscription_plans").select("id, name, description, price, billing_interval, included_credits, benefits, active").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }),
    supabase.from("patient_subscriptions").select("id, status, current_period_end, next_billing_at, note, patients(id, name, phone), subscription_plans(id, name, billing_interval)").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }).limit(200),
  ]);
  const error = [patients.error, wallets.error, points.error, plans.error, subscriptions.error].find(Boolean);
  if (error) throw new Error(error.message);

  const patientRows = patients.data ?? [];
  const planRows = plans.data ?? [];
  const walletRows = wallets.data ?? [];
  const pointRows = points.data ?? [];
  const subscriptionRows = subscriptions.data ?? [];
  const assetPatients = patientRows.filter((patient) => walletRows.some((row) => one(row.patients)?.id === patient.id) || pointRows.some((row) => one(row.patients)?.id === patient.id));
  const totalWallet = walletRows.reduce((sum, row) => sum + Number(row.balance), 0);
  const totalPoints = pointRows.reduce((sum, row) => sum + Number(row.points_balance), 0);
  const activeSubscriptions = subscriptionRows.filter((row) => row.status === "active").length;
  const canManagePlans = hasBrandPermission(member, "brand.manage");

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">顧客與會員</p>
          <h1 className="admin-page-title">顧客資產與訂閱</h1>
          <p className="admin-page-description">管理儲值金、點數與週期訂閱。每次人工調整都會留下流水紀錄；正式自動扣款需完成金流帳號接入。</p>
        </div>
      </div>

      <MembershipManagementTabs active="value" showPricing={canManagePlans} />

      <div className="admin-metric-strip grid-cols-3">
        <div className="admin-metric"><span className="admin-metric-label">儲值總餘額</span><strong className="admin-metric-value">{money(totalWallet)}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">未用點數</span><strong className="admin-metric-value">{totalPoints.toLocaleString("zh-TW")}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">有效訂閱</span><strong className="admin-metric-value">{activeSubscriptions}</strong></div>
      </div>

      <section className="admin-workbench-grid">
        <form action={adjustWalletAction} className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">記錄儲值金異動</h2><p className="mt-0.5 text-xs text-slate-500">儲值、消費、退款與人工調整都會保留操作流水。</p></div></div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2"><span className="label">顧客</span><select name="patient_id" className="input" required defaultValue=""><option value="" disabled>請選擇顧客</option>{patientRows.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}</select></label>
            <label className="text-sm"><span className="label">異動類型</span><select name="kind" className="input" defaultValue="top_up"><option value="top_up">儲值入帳</option><option value="purchase">扣除消費</option><option value="refund">退回儲值金</option><option value="adjust">人工調整</option></select></label>
            <label className="text-sm"><span className="label">調整方向</span><select name="direction" className="input"><option value="credit">增加</option><option value="debit">扣除</option></select></label>
            <label className="text-sm"><span className="label">金額</span><input name="amount" type="number" min="1" className="input" required /></label>
            <label className="text-sm"><span className="label">異動原因</span><input name="note" className="input" maxLength={300} required /></label>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-primary">確認儲值金異動</SubmitButton></div>
          </div>
        </form>

        <form action={adjustPointsAction} className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">記錄點數異動</h2><p className="mt-0.5 text-xs text-slate-500">獲得、兌換與到期均使用同一份可追溯流水。</p></div></div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2"><span className="label">顧客</span><select name="patient_id" className="input" required defaultValue=""><option value="" disabled>請選擇顧客</option>{patientRows.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}</select></label>
            <label className="text-sm"><span className="label">異動類型</span><select name="kind" className="input" defaultValue="earn"><option value="earn">消費獲得</option><option value="redeem">兌換扣除</option><option value="expire">到期扣除</option><option value="adjust">人工調整</option></select></label>
            <label className="text-sm"><span className="label">調整方向</span><select name="direction" className="input"><option value="credit">增加</option><option value="debit">扣除</option></select></label>
            <label className="text-sm"><span className="label">點數</span><input name="points" type="number" min="1" className="input" required /></label>
            <label className="text-sm"><span className="label">異動原因</span><input name="note" className="input" maxLength={300} required /></label>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-primary">確認點數異動</SubmitButton></div>
          </div>
        </form>
      </section>

      <section className="admin-workbench-grid">
        {canManagePlans && (
          <form action={createSubscriptionPlanAction} className="admin-section">
            <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">建立訂閱方案</h2><p className="mt-0.5 text-xs text-slate-500">定義週期費用、堂數與顧客可見權益。</p></div></div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <label className="text-sm"><span className="label">方案名稱</span><input name="name" className="input" required /></label>
              <label className="text-sm"><span className="label">週期費用</span><input name="price" type="number" min="0" defaultValue="0" className="input" required /></label>
              <label className="text-sm"><span className="label">扣款週期</span><select name="billing_interval" className="input"><option value="monthly">每月</option><option value="quarterly">每季</option><option value="yearly">每年</option></select></label>
              <label className="text-sm"><span className="label">每期包含堂數</span><input name="included_credits" type="number" min="0" defaultValue="0" className="input" required /></label>
              <label className="text-sm sm:col-span-2"><span className="label">會員權益（每行一項）</span><textarea name="benefits" rows={3} className="input" placeholder="每月一次免費體驗&#10;商品 95 折" /></label>
              <label className="text-sm sm:col-span-2"><span className="label">方案說明（選填）</span><input name="description" className="input" /></label>
              <div className="sm:col-span-2"><SubmitButton className="btn btn-primary">建立訂閱方案</SubmitButton></div>
            </div>
          </form>
        )}

        <form action={createPatientSubscriptionAction} className="admin-section self-start">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">啟用顧客訂閱</h2><p className="mt-0.5 text-xs text-slate-500">建立週期與權益紀錄；尚未完成金流接入前不會自動扣款。</p></div></div>
          <div className="grid gap-3 p-4">
            <label className="text-sm"><span className="label">顧客</span><select name="patient_id" className="input" required defaultValue=""><option value="" disabled>請選擇顧客</option>{patientRows.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}</select></label>
            <label className="text-sm"><span className="label">訂閱方案</span><select name="plan_id" className="input" required defaultValue=""><option value="" disabled>請選擇方案</option>{planRows.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {INTERVAL[plan.billing_interval]} {money(plan.price)}</option>)}</select></label>
            <label className="text-sm"><span className="label">啟用備註（選填）</span><input name="note" className="input" /></label>
            <SubmitButton className="btn btn-primary">確認啟用訂閱</SubmitButton>
          </div>
        </form>
      </section>

      <section className="admin-table-shell admin-table-mobile-cards">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">顧客儲值與點數</h2><p className="mt-0.5 text-xs text-slate-500">只顯示已有儲值金或點數紀錄的顧客</p></div><span className="text-xs tabular-nums text-slate-500">{assetPatients.length} 位</span></div>
        <table className="tbl">
          <thead><tr><th>顧客</th><th>儲值餘額</th><th>累計儲值／使用</th><th>點數餘額</th><th>累計獲得／兌換</th></tr></thead>
          <tbody>
            {assetPatients.length === 0 ? <tr><td colSpan={5} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚無儲值金或點數紀錄</td></tr> : assetPatients.map((patient) => {
              const wallet = walletRows.find((row) => one(row.patients)?.id === patient.id);
              const account = pointRows.find((row) => one(row.patients)?.id === patient.id);
              return (
                <tr key={patient.id}>
                  <td data-label="顧客"><Link href={`/admin/patients/${patient.id}`} className="font-medium text-brand-700 hover:underline">{patient.name}</Link><div className="text-xs text-slate-500">{patient.phone}</div></td>
                  <td data-label="儲值餘額" className="font-medium tabular-nums">{money(wallet?.balance ?? 0)}</td>
                  <td data-label="累計儲值／使用" className="text-xs text-slate-500">{money(wallet?.lifetime_credit ?? 0)}／{money(wallet?.lifetime_debit ?? 0)}</td>
                  <td data-label="點數餘額" className="font-medium tabular-nums">{Number(account?.points_balance ?? 0).toLocaleString("zh-TW")}</td>
                  <td data-label="累計獲得／兌換" className="text-xs text-slate-500">{Number(account?.lifetime_earned ?? 0).toLocaleString("zh-TW")}／{Number(account?.lifetime_redeemed ?? 0).toLocaleString("zh-TW")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="admin-table-shell admin-table-mobile-cards">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">訂閱會員</h2><p className="mt-0.5 text-xs text-slate-500">管理目前週期與下一次預計扣款日</p></div><span className="text-xs tabular-nums text-slate-500">{subscriptionRows.length} 筆</span></div>
        <table className="tbl">
          <thead><tr><th>顧客</th><th>方案</th><th>狀態</th><th>本期結束</th><th>下次扣款日</th><th>操作</th></tr></thead>
          <tbody>
            {subscriptionRows.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚無訂閱會員</td></tr> : subscriptionRows.map((subscription) => {
              const patient = one(subscription.patients);
              const plan = one(subscription.subscription_plans);
              return (
                <tr key={subscription.id}>
                  <td data-label="顧客"><span className="font-medium text-slate-800">{patient?.name ?? "—"}</span><div className="text-xs text-slate-500">{patient?.phone}</div></td>
                  <td data-label="方案">{plan?.name ?? "—"}</td>
                  <td data-label="狀態"><span className={`badge ${subscription.status === "active" ? "bg-emerald-50 text-emerald-700" : subscription.status === "past_due" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{STATUS[subscription.status] ?? subscription.status}</span></td>
                  <td data-label="本期結束">{date(subscription.current_period_end)}</td>
                  <td data-label="下次扣款日">{date(subscription.next_billing_at)}</td>
                  <td data-label="操作">{subscription.status !== "cancelled" ? <div className="flex flex-wrap gap-1">{subscription.status === "active" ? <StatusForm id={subscription.id} status="paused" label="暫停訂閱" /> : <StatusForm id={subscription.id} status="active" label="恢復訂閱" />}<StatusForm id={subscription.id} status="cancelled" label="取消訂閱" danger /></div> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="admin-table-shell admin-table-mobile-cards">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">訂閱方案</h2><p className="mt-0.5 text-xs text-slate-500">檢查費用、週期與顧客可見權益</p></div><span className="text-xs tabular-nums text-slate-500">{planRows.length} 筆</span></div>
        <table className="tbl">
          <thead><tr><th>方案</th><th>週期</th><th>費用</th><th>包含堂數</th><th>權益</th><th>狀態與操作</th></tr></thead>
          <tbody>
            {planRows.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未建立訂閱方案</td></tr> : planRows.map((plan) => (
              <tr key={plan.id}>
                <td data-label="方案" className="font-medium text-slate-800">{plan.name}</td>
                <td data-label="週期">{INTERVAL[plan.billing_interval]}</td>
                <td data-label="費用" className="tabular-nums">{money(plan.price)}</td>
                <td data-label="包含堂數">{plan.included_credits}</td>
                <td data-label="權益" className="text-xs text-slate-500">{Array.isArray(plan.benefits) ? plan.benefits.join("、") || "—" : "—"}</td>
                <td data-label="狀態與操作">{canManagePlans ? <form action={toggleSubscriptionPlanAction} className="flex flex-wrap items-center gap-2"><span className={`badge ${plan.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{plan.active ? "啟用" : "停用"}</span><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="active" value={String(plan.active)} /><SubmitButton className="admin-inline-action">{plan.active ? "停用方案" : "啟用方案"}</SubmitButton></form> : plan.active ? "啟用" : "停用"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatusForm({ id, status, label, danger = false }: { id: string; status: string; label: string; danger?: boolean }) {
  return (
    <form action={setPatientSubscriptionStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={`admin-inline-action ${danger ? "text-red-700" : ""}`}>{label}</SubmitButton>
    </form>
  );
}
