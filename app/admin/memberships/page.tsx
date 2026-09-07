import { SubmitButton } from "@/components/SubmitButton";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { canViewSensitiveCustomerData, requireMember } from "@/lib/admin";
import { auditStatusLabel } from "@/lib/admin-display";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import {
  createDiscountCodeAction,
  grantPatientMembershipAction,
  redeemPatientMembershipAction,
  saveMembershipPlanAction,
  toggleDiscountCodeAction,
  toggleMembershipPlanAction,
} from "./actions";
import { MembershipPlanDesigner } from "./MembershipPlanDesigner";

export const dynamic = "force-dynamic";

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  credits_total: number;
  valid_days: number | null;
  usage_scope: string;
  service_id: string | null;
  card_image_url: string | null;
  card_theme: string;
  card_accent: string;
  redeem_channels: string[];
  redemption_note: string | null;
  active: boolean;
}
interface ServiceRow { id: string; name: string; }
interface PatientRow { id: string; name: string; phone: string; }
interface CodeRow {
  id: string;
  code: string;
  benefit_type: string;
  kind: string;
  value: number;
  min_amount: number;
  used_count: number;
  max_uses: number | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}
interface MembershipRow {
  id: string;
  membership_code: string;
  status: string;
  credits_total: number;
  credits_remaining: number;
  expires_at: string | null;
  patients: { name: string; phone: string } | null;
  membership_plans: { name: string; redeem_channels: string[] } | null;
}

function usageScopeLabel(value: string): string {
  if (value === "both") return "預約與報名";
  if (value === "appointment") return "僅預約";
  return "僅報名";
}

export default async function MembershipsPage() {
  const { supabase, clinicId, role, clinicName } = await requireMember();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "memberships"))) return <ModuleDisabled title="會員與套票" />;
  if (!canViewSensitiveCustomerData(role)) return <p className="admin-section p-6 text-sm text-slate-500">目前角色無法查看顧客套票與聯絡資料。</p>;

  const [
    { data: plans, error: plansError },
    { data: services, error: servicesError },
    { data: patients, error: patientsError },
    { data: codes, error: codesError },
    { data: memberships, error: membershipsError },
  ] = await Promise.all([
    supabase.from("membership_plans").select("id, name, description, price, credits_total, valid_days, usage_scope, service_id, card_image_url, card_theme, card_accent, redeem_channels, redemption_note, active").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
    supabase.from("services").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    supabase.from("patients").select("id, name, phone").eq("clinic_id", clinicId).eq("active", true).order("name").limit(500),
    supabase.from("discount_codes").select("id, code, benefit_type, kind, value, min_amount, used_count, max_uses, recipient_name, recipient_phone, starts_at, ends_at, active").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
    supabase.from("patient_memberships").select("id, membership_code, status, credits_total, credits_remaining, expires_at, patients(name, phone), membership_plans(name, redeem_channels)").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(200),
  ]);
  const error = plansError ?? servicesError ?? patientsError ?? codesError ?? membershipsError;
  if (error) throw new Error(error.message);

  const planRows = (plans ?? []) as PlanRow[];
  const serviceRows = (services ?? []) as ServiceRow[];
  const patientRows = (patients ?? []) as PatientRow[];
  const codeRows = (codes ?? []) as CodeRow[];
  const membershipRows = (memberships ?? []) as unknown as MembershipRow[];
  const canEdit = role === "owner" || role === "admin";
  const activePlanCount = planRows.filter((plan) => plan.active).length;
  const activeCodeCount = codeRows.filter((code) => code.active).length;
  const activeMemberships = membershipRows.filter((membership) => membership.status === "active");
  const remainingCredits = activeMemberships.reduce((sum, membership) => sum + membership.credits_remaining, 0);
  const manuallyRedeemable = activeMemberships.filter((membership) => membership.credits_remaining > 0 && membership.membership_plans?.redeem_channels?.some((channel) => ["product", "course", "offline"].includes(channel)));

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">顧客優惠</p>
          <h1 className="admin-page-title">套票與優惠碼</h1>
          <p className="admin-page-description">{clinicName} 的堂數方案、顧客套票與促銷代碼集中管理；套票每次可扣抵一筆預約或一張活動票。</p>
        </div>
      </div>

      <div className="admin-metric-strip grid-cols-2 sm:grid-cols-4">
        <div className="admin-metric"><span className="admin-metric-label">啟用方案</span><strong className="admin-metric-value">{activePlanCount}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">啟用優惠</span><strong className="admin-metric-value">{activeCodeCount}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">使用中套票</span><strong className="admin-metric-value">{activeMemberships.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">未使用堂數</span><strong className="admin-metric-value">{remainingCredits.toLocaleString("zh-TW")}</strong></div>
      </div>

      {canEdit && <MembershipPlanDesigner plans={planRows} services={serviceRows} action={saveMembershipPlanAction} />}

      {canEdit && (
        <div className="admin-workbench-grid">
          <section className="admin-section self-start">
            <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">發放套票</h2><p className="mt-0.5 text-xs text-slate-500">選擇顧客與方案後，系統會產生專屬套票序號。</p></div></div>
            <form action={grantPatientMembershipAction} className="grid gap-3 p-4">
              <label className="text-sm"><span className="label">顧客</span><select name="patient_id" required className="input" defaultValue=""><option value="" disabled>請選擇顧客</option>{patientRows.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}</select></label>
              <label className="text-sm"><span className="label">套票方案</span><select name="plan_id" required className="input" defaultValue=""><option value="" disabled>請選擇方案</option>{planRows.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.credits_total} 堂</option>)}</select></label>
              <label className="text-sm"><span className="label">發放備註（選填）</span><input name="note" className="input" /></label>
              <SubmitButton className="btn btn-primary">確認發放套票</SubmitButton>
            </form>
          </section>
          <section className="admin-section self-start">
            <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">記錄商品／課程／線下兌換</h2><p className="mt-0.5 text-xs text-slate-500">每次送出扣除一次並新增不可覆蓋的使用紀錄。</p></div></div>
            <form action={redeemPatientMembershipAction} className="grid gap-3 p-4">
              <label className="text-sm"><span className="label">顧客套票</span><select name="membership_id" required className="input" defaultValue=""><option value="" disabled>請選擇可兌換套票</option>{manuallyRedeemable.map((membership) => <option key={membership.id} value={membership.id}>{membership.patients?.name ?? "顧客"} · {membership.membership_plans?.name ?? "套票"} · 剩 {membership.credits_remaining} 次</option>)}</select></label>
              <label className="text-sm"><span className="label">本次用途</span><select name="channel" required className="input" defaultValue=""><option value="" disabled>請選擇用途</option><option value="product">商品兌換</option><option value="course">課程購買／兌換</option><option value="offline">線下兌換</option></select></label>
              <label className="text-sm"><span className="label">兌換內容</span><input name="note" required className="input" placeholder="例如：兌換一組居家保養品" /></label>
              <SubmitButton className="btn btn-primary" disabled={manuallyRedeemable.length === 0}>確認扣除一次</SubmitButton>
            </form>
          </section>
        </div>
      )}

      {canEdit && (
        <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">建立優惠碼或禮券</h2><p className="mt-0.5 text-xs text-slate-500">優惠碼可多人使用；禮券固定單次使用，也可指定領用人。</p></div></div>
          <form action={createDiscountCodeAction} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm"><span className="label">用途</span><select name="benefit_type" className="input"><option value="coupon">優惠碼</option><option value="voucher">禮券（單次）</option></select></label>
            <label className="text-sm"><span className="label">代碼</span><input name="code" required className="input uppercase" placeholder="例如：FIRSTCLASS" /></label>
            <label className="text-sm"><span className="label">折扣類型</span><select name="kind" className="input"><option value="percent">百分比</option><option value="fixed">固定金額</option></select></label>
            <label className="text-sm"><span className="label">折扣值</span><input name="value" type="number" min="1" defaultValue="10" required className="input" /></label>
            <label className="text-sm"><span className="label">最低消費金額</span><input name="min_amount" type="number" min="0" defaultValue="0" className="input" /></label>
            <label className="text-sm"><span className="label">使用上限（優惠碼）</span><input name="max_uses" type="number" min="1" className="input" /></label>
            <label className="text-sm"><span className="label">領用人姓名（禮券）</span><input name="recipient_name" className="input" /></label>
            <label className="text-sm"><span className="label">領用人電話（禮券）</span><input name="recipient_phone" className="input" /></label>
            <label className="text-sm"><span className="label">開始時間（選填）</span><input name="starts_at" type="datetime-local" className="input" /></label>
            <label className="text-sm"><span className="label">結束時間（選填）</span><input name="ends_at" type="datetime-local" className="input" /></label>
            <div className="sm:col-span-2 lg:col-span-5"><SubmitButton className="btn btn-primary">建立優惠內容</SubmitButton></div>
          </form>
        </section>
      )}

      <div className="admin-workbench-grid">
        <section className="admin-section">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">套票方案</h2><p className="mt-0.5 text-xs text-slate-500">{planRows.length} 筆方案</p></div></div>
          {planRows.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">尚未建立套票方案</p> : <div className="grid gap-3 p-4 sm:grid-cols-2">{planRows.map((plan) => <article key={plan.id} className="relative min-h-48 overflow-hidden rounded-xl p-5 text-white shadow-sm" style={{ background: plan.card_theme === "sand" ? "linear-gradient(135deg,#d7c29f,#f2eadb)" : plan.card_theme === "clay" ? "linear-gradient(135deg,#824f43,#c27a64)" : plan.card_theme === "ink" ? "linear-gradient(135deg,#172033,#34415c)" : "linear-gradient(135deg,#12362f,#1d6a58)", color: plan.card_theme === "sand" ? "#29261f" : "#fff" }}>
            {plan.card_image_url && <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url(${plan.card_image_url})` }} />}
            <div className="relative flex h-full flex-col justify-between gap-5"><div><div className="flex items-start justify-between gap-3"><span className="text-[10px] font-semibold tracking-[.16em]" style={{ color: plan.card_accent }}>MEMBERSHIP PASS</span><span className="border border-current/30 px-2 py-1 text-xs">{plan.credits_total} 次</span></div><h3 className="mt-3 text-lg font-semibold">{plan.name}</h3><p className="mt-1 text-xs opacity-75">{usageScopeLabel(plan.usage_scope)} · {plan.valid_days ? `${plan.valid_days} 天` : "不限期"}</p></div><div className="flex items-end justify-between gap-3"><strong>NT${plan.price.toLocaleString("zh-TW")}</strong>{canEdit && <form action={toggleMembershipPlanAction}><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="active" value={String(plan.active)} /><SubmitButton className="border border-current/40 px-3 py-1.5 text-xs">{plan.active ? "停用" : "啟用"}</SubmitButton></form>}</div></div>
          </article>)}</div>}
        </section>

        <section className="admin-table-shell admin-table-mobile-cards">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">優惠碼與禮券</h2><p className="mt-0.5 text-xs text-slate-500">{codeRows.length} 筆優惠內容</p></div></div>
          <table className="tbl">
            <thead><tr><th>代碼</th><th>優惠</th><th>使用情況</th><th>對象</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {codeRows.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未建立優惠碼或禮券</td></tr> : codeRows.map((code) => (
                <tr key={code.id}>
                  <td data-label="代碼"><span className="font-mono font-medium text-slate-800">{code.code}</span><div className="text-xs text-slate-500">{code.benefit_type === "voucher" ? "禮券" : "優惠碼"}</div></td>
                  <td data-label="優惠">{code.kind === "percent" ? `${code.value}%` : `NT$${code.value.toLocaleString("zh-TW")}`}</td>
                  <td data-label="使用情況">{code.used_count}{code.max_uses ? ` / ${code.max_uses}` : " / 不限"}</td>
                  <td data-label="對象">{code.recipient_name || code.recipient_phone || "不限對象"}</td>
                  <td data-label="狀態"><span className={`badge ${code.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{code.active ? "啟用" : "停用"}</span></td>
                  <td data-label="操作">{canEdit ? <form action={toggleDiscountCodeAction}><input type="hidden" name="id" value={code.id} /><input type="hidden" name="active" value={String(code.active)} /><SubmitButton className="admin-inline-action">{code.active ? "停用優惠" : "啟用優惠"}</SubmitButton></form> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="admin-table-shell admin-table-mobile-cards">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">顧客持有套票</h2><p className="mt-0.5 text-xs text-slate-500">查看剩餘堂數、使用狀態與到期日</p></div><span className="text-xs tabular-nums text-slate-500">{membershipRows.length} 筆</span></div>
        <table className="tbl">
          <thead><tr><th>顧客</th><th>套票序號</th><th>方案</th><th>剩餘堂數</th><th>狀態</th><th>到期日</th></tr></thead>
          <tbody>
            {membershipRows.length === 0 ? <tr><td colSpan={6} data-mobile-empty="true" className="py-8 text-center text-slate-400">尚未發放套票</td></tr> : membershipRows.map((membership) => (
              <tr key={membership.id}>
                <td data-label="顧客"><span className="font-medium text-slate-800">{membership.patients?.name ?? "—"}</span><div className="text-xs text-slate-500">{membership.patients?.phone}</div></td>
                <td data-label="套票序號" className="font-mono text-xs">{membership.membership_code}</td>
                <td data-label="方案">{membership.membership_plans?.name ?? "—"}</td>
                <td data-label="剩餘堂數"><span className="font-medium tabular-nums">{membership.credits_remaining}</span> / {membership.credits_total}</td>
                <td data-label="狀態"><span className="badge bg-slate-100 text-slate-600">{auditStatusLabel(membership.status)}</span></td>
                <td data-label="到期日">{membership.expires_at ? new Date(membership.expires_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : "不限期"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
