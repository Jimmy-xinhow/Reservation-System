import { SubmitButton } from "@/components/SubmitButton";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { requireAdmin } from "@/lib/admin";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { createServiceClient } from "@/lib/supabase";
import {
  assignPatientMembershipLevelAction,
  createMembershipLevelAction,
  saveMembershipPlanLevelPriceAction,
  toggleMembershipLevelAction,
} from "../memberships/actions";

export const dynamic = "force-dynamic";

interface Level { id: string; code: string; name: string; sort_order: number; discount_percent: number; active: boolean; }
interface Plan { id: string; name: string; price: number; }
interface Patient { id: string; name: string; phone: string; membership_level_id: string | null; }
interface PriceRule { id: string; plan_id: string; level_id: string; price: number; }

export default async function MembershipLevelsPage() {
  const { clinicId, supabase } = await requireAdmin();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "memberships"))) return <ModuleDisabled title="會員與套票" />;
  const service = createServiceClient();
  const [
    { data: levels, error: levelsError },
    { data: plans, error: plansError },
    { data: prices, error: pricesError },
    { data: patients, error: patientsError },
  ] = await Promise.all([
    service.from("membership_levels").select("id, code, name, sort_order, discount_percent, active").eq("clinic_id", clinicId).order("sort_order").order("name"),
    service.from("membership_plans").select("id, name, price").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("membership_plan_level_prices").select("id, plan_id, level_id, price").eq("clinic_id", clinicId),
    service.from("patients").select("id, name, phone, membership_level_id").eq("clinic_id", clinicId).eq("active", true).order("name").limit(500),
  ]);
  const firstError = levelsError ?? plansError ?? pricesError ?? patientsError;
  if (firstError) throw new Error(`讀取會員等級資料失敗：${firstError.message}`);

  const levelRows = (levels ?? []) as Level[];
  const planRows = (plans ?? []) as Plan[];
  const priceRows = (prices ?? []) as PriceRule[];
  const patientRows = (patients ?? []) as Patient[];
  const levelName = new Map(levelRows.map((level) => [level.id, level.name]));
  const planName = new Map(planRows.map((plan) => [plan.id, plan.name]));
  const activeLevelCount = levelRows.filter((level) => level.active).length;
  const assignedPatientCount = patientRows.filter((patient) => patient.membership_level_id).length;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">會員價格規則</p>
          <h1 className="admin-page-title">會員等級與專屬價格</h1>
          <p className="admin-page-description">先建立會員等級，再設定個別套票的專屬售價；未指定等級或價格時，顧客會使用方案原價。</p>
        </div>
      </div>

      <div className="admin-metric-strip grid-cols-3">
        <div className="admin-metric"><span className="admin-metric-label">啟用等級</span><strong className="admin-metric-value">{activeLevelCount}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">專屬價格</span><strong className="admin-metric-value">{priceRows.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">已指派顧客</span><strong className="admin-metric-value">{assignedPatientCount}</strong></div>
      </div>

      <div className="admin-workbench-grid">
        <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">建立會員等級</h2><p className="mt-0.5 text-xs text-slate-500">系統代號供內部辨認；顧客只會看到等級名稱。</p></div></div>
          <form action={createMembershipLevelAction} className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm"><span className="label">等級名稱</span><input className="input" name="name" placeholder="例如：年度 VIP" required /></label>
            <label className="text-sm"><span className="label">系統代號</span><input className="input" name="code" placeholder="例如：vip" required /><span className="help-text block">請使用小寫英文或數字。</span></label>
            <label className="text-sm"><span className="label">顯示順序</span><input className="input" name="sort_order" type="number" min="0" defaultValue="0" /></label>
            <label className="text-sm"><span className="label">預設折扣（%）</span><input className="input" name="discount_percent" type="number" min="0" max="100" defaultValue="0" /></label>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-primary">建立會員等級</SubmitButton></div>
          </form>
        </section>

        <section className="admin-section self-start">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">設定方案專屬價格</h2><p className="mt-0.5 text-xs text-slate-500">只覆蓋選定等級與方案的售價，不影響原價。</p></div></div>
          <form action={saveMembershipPlanLevelPriceAction} className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2"><span className="label">會員方案</span><select className="input" name="plan_id" required defaultValue=""><option value="" disabled>請選擇方案</option>{planRows.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}（原價 NT${plan.price.toLocaleString("zh-TW")}）</option>)}</select></label>
            <label className="text-sm"><span className="label">會員等級</span><select className="input" name="level_id" required defaultValue=""><option value="" disabled>請選擇等級</option>{levelRows.filter((level) => level.active).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
            <label className="text-sm"><span className="label">專屬價格</span><input className="input" name="price" type="number" min="0" required /></label>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-primary">儲存專屬價格</SubmitButton></div>
          </form>
        </section>
      </div>

      <div className="admin-workbench-grid">
        <section className="admin-table-shell admin-table-mobile-cards">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">目前會員等級</h2><p className="mt-0.5 text-xs text-slate-500">控制可選用的等級與預設折扣</p></div></div>
          <table className="tbl">
            <thead><tr><th>等級</th><th>系統代號</th><th>預設折扣</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {levelRows.length === 0 ? <tr><td colSpan={5} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未建立會員等級</td></tr> : levelRows.map((level) => (
                <tr key={level.id}>
                  <td data-label="等級" className="font-medium text-slate-800">{level.name}</td>
                  <td data-label="系統代號" className="font-mono text-xs">{level.code}</td>
                  <td data-label="預設折扣">{level.discount_percent}%</td>
                  <td data-label="狀態"><span className={`badge ${level.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{level.active ? "啟用" : "停用"}</span></td>
                  <td data-label="操作"><form action={toggleMembershipLevelAction}><input type="hidden" name="id" value={level.id} /><input type="hidden" name="active" value={String(level.active)} /><SubmitButton className="admin-inline-action">{level.active ? "停用等級" : "啟用等級"}</SubmitButton></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="admin-table-shell admin-table-mobile-cards">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">已設定專屬價格</h2><p className="mt-0.5 text-xs text-slate-500">同一組方案與等級再次儲存會更新價格</p></div></div>
          <table className="tbl">
            <thead><tr><th>會員方案</th><th>會員等級</th><th>專屬價格</th></tr></thead>
            <tbody>
              {priceRows.length === 0 ? <tr><td colSpan={3} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未設定專屬價格</td></tr> : priceRows.map((rule) => (
                <tr key={rule.id}>
                  <td data-label="會員方案">{planName.get(rule.plan_id) ?? "未知方案"}</td>
                  <td data-label="會員等級">{levelName.get(rule.level_id) ?? "未知等級"}</td>
                  <td data-label="專屬價格" className="font-medium tabular-nums">NT${rule.price.toLocaleString("zh-TW")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="admin-table-shell admin-table-mobile-cards">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">顧客等級指派</h2><p className="mt-0.5 text-xs text-slate-500">調整單一顧客的會員等級；選擇一般顧客可移除等級。</p></div><span className="text-xs tabular-nums text-slate-500">{patientRows.length} 位顧客</span></div>
        <table className="tbl">
          <thead><tr><th>顧客</th><th>目前等級</th><th>調整與儲存</th></tr></thead>
          <tbody>
            {patientRows.length === 0 ? <tr><td colSpan={3} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚無顧客資料</td></tr> : patientRows.map((patient) => (
              <tr key={patient.id}>
                <td data-label="顧客"><span className="font-medium text-slate-800">{patient.name}</span><div className="text-xs text-slate-500">{patient.phone}</div></td>
                <td data-label="目前等級">{patient.membership_level_id ? levelName.get(patient.membership_level_id) ?? "等級已移除" : "一般顧客"}</td>
                <td data-label="調整與儲存">
                  <form action={assignPatientMembershipLevelAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="patient_id" value={patient.id} />
                    <select className="input min-w-44 flex-1" name="level_id" defaultValue={patient.membership_level_id ?? ""}><option value="">一般顧客</option>{levelRows.filter((level) => level.active).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select>
                    <SubmitButton className="admin-inline-action">儲存顧客等級</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
