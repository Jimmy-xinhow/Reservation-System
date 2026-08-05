import Link from "next/link";
import { canViewSensitiveCustomerData, requireMember } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import {
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_TRIGGER_TYPES,
  SEGMENT_RULE_LABELS,
  SEGMENT_RULE_TYPES,
  describeSegmentRule,
  type AutomationTriggerType,
  type SegmentRuleType,
} from "@/lib/crm";
import {
  createAutomationAction,
  createSegmentAction,
  deleteAutomationAction,
  deleteSegmentAction,
  refreshSegmentAction,
  toggleAutomationAction,
  toggleSegmentAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  rule_type: SegmentRuleType;
  rule_value: string;
  active: boolean;
  updated_at: string;
  memberCount: number;
}

interface AutomationRow {
  id: string;
  name: string;
  trigger_type: AutomationTriggerType;
  segment_id: string | null;
  channel: "line" | "email";
  delay_minutes: number;
  trigger_days: number;
  cooldown_days: number;
  subject: string | null;
  body: string;
  active: boolean;
}

export default async function CrmPage() {
  const { supabase, role, clinicId } = await requireMember();
  if (!canViewSensitiveCustomerData(role)) {
    return <p className="card p-6 text-sm text-slate-500">目前角色無法查看 CRM 顧客資料。</p>;
  }
  const [{ data: segmentData, error: segmentError }, { data: automationData, error: automationError }, { count: customerCount }] =
    await Promise.all([
      supabase
        .from("crm_segments")
        .select("id, name, description, rule_type, rule_value, active, updated_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false }),
      supabase
        .from("crm_automations")
        .select("id, name, trigger_type, segment_id, channel, delay_minutes, trigger_days, cooldown_days, subject, body, active")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false }),
      supabase.from("patients").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("active", true),
    ]);

  if (segmentError) throw new Error(segmentError.message);
  if (automationError) throw new Error(automationError.message);

  const rawSegments = (segmentData ?? []) as unknown as Omit<SegmentRow, "memberCount">[];
  const memberCounts = await Promise.all(
    rawSegments.map(async (segment) => {
      const { count } = await supabase
        .from("crm_segment_members")
        .select("patient_id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("segment_id", segment.id);
      return [segment.id, count ?? 0] as const;
    }),
  );
  const countMap = new Map(memberCounts);
  const segments: SegmentRow[] = rawSegments.map((segment) => ({
    ...segment,
    memberCount: countMap.get(segment.id) ?? 0,
  }));
  const automations = (automationData ?? []) as unknown as AutomationRow[];
  const segmentName = new Map(segments.map((segment) => [segment.id, segment.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">CRM Lite</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            管理顧客資料、分眾與規則式行銷。所有發送都只對已同意行銷的顧客執行，完整投遞紀錄會保留在系統內。
          </p>
        </div>
        <Link href="/admin/patients" className="btn btn-secondary w-fit">
          查看顧客資料
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="可管理顧客" value={customerCount ?? 0} />
        <Stat label="分眾" value={segments.length} />
        <Stat label="自動化" value={automations.length} />
      </div>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">建立顧客分眾</h2>
          <p className="mt-1 text-sm text-slate-500">先提供可查核的規則式分眾，不以黑盒 AI 推測顧客。</p>
        </div>
        {role === "admin" ? (
          <form action={createSegmentAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">分眾名稱</span>
              <input name="name" required className="input" placeholder="例如：近 90 天未回訪" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">規則</span>
              <select name="rule_type" defaultValue="no_booking_days" className="input">
                {SEGMENT_RULE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SEGMENT_RULE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">規則數值</span>
              <input name="rule_value" required className="input" placeholder="例如：90、VIP 或 3" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">備註</span>
              <input name="description" className="input" placeholder="這個分眾用於什麼情境" />
            </label>
            <div className="md:col-span-2">
              <SubmitButton className="btn btn-primary">建立分眾並計算名單</SubmitButton>
            </div>
          </form>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">只有管理員可以建立或修改分眾規則。</p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">分眾名單</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {segments.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">尚未建立分眾。</p>
          ) : (
            segments.map((segment) => (
              <div key={segment.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-800">{segment.name}</h3>
                    <span className={`badge ${segment.active ? "bg-accent-500/10 text-accent-700" : "bg-slate-100 text-slate-500"}`}>
                      {segment.active ? "啟用" : "停用"}
                    </span>
                    <span className="text-sm text-slate-500">{segment.memberCount} 人</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {describeSegmentRule(segment.rule_type, segment.rule_value)}
                    {segment.description ? `｜${segment.description}` : ""}
                  </p>
                </div>
                {role === "admin" && (
                  <div className="flex flex-wrap gap-2">
                    <form action={refreshSegmentAction}>
                      <input type="hidden" name="id" value={segment.id} />
                      <SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">重新計算</SubmitButton>
                    </form>
                    <form action={toggleSegmentAction}>
                      <input type="hidden" name="id" value={segment.id} />
                      <input type="hidden" name="active" value={String(segment.active)} />
                      <SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">{segment.active ? "停用" : "啟用"}</SubmitButton>
                    </form>
                    <form action={deleteSegmentAction}>
                      <input type="hidden" name="id" value={segment.id} />
                      <SubmitButton className="btn btn-danger px-3 py-1.5 text-xs">刪除</SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">建立規則式行銷自動化</h2>
          <p className="mt-1 text-sm text-slate-500">
            可用變數：&#123;&#123;customer_name&#125;&#125;、&#123;&#123;appointment_time&#125;&#125;、&#123;&#123;doctor_name&#125;&#125;、&#123;&#123;clinic_name&#125;&#125;。
          </p>
        </div>
        {role === "admin" ? (
          <form action={createAutomationAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">自動化名稱</span>
              <input name="name" required className="input" placeholder="例如：完成服務後回訪" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">觸發條件</span>
              <select name="trigger_type" defaultValue="appointment_done" className="input">
                {AUTOMATION_TRIGGER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {AUTOMATION_TRIGGER_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">套用分眾（選填）</span>
              <select name="segment_id" defaultValue="" className="input">
                <option value="">所有符合資格的顧客</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">發送渠道</span>
              <select name="channel" defaultValue="line" className="input">
                <option value="line">LINE</option>
                <option value="email">Email</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">完成後延遲分鐘</span>
              <input type="number" min="0" name="delay_minutes" defaultValue="0" className="input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">未回訪條件天數</span>
              <input type="number" min="1" name="trigger_days" defaultValue="30" className="input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">未回訪重複間隔天數</span>
              <input type="number" min="1" name="cooldown_days" defaultValue="30" className="input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Email 主旨（Email 必填）</span>
              <input name="subject" className="input" placeholder="回訪提醒" />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium text-slate-600">訊息內容</span>
              <textarea name="body" required rows={5} className="input" placeholder="您好 {{customer_name}}，謝謝您這次的使用。" />
            </label>
            <div className="md:col-span-2">
              <SubmitButton className="btn btn-primary">建立自動化</SubmitButton>
            </div>
          </form>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">只有管理員可以建立或修改行銷自動化。</p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">行銷自動化</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {automations.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">尚未建立自動化。</p>
          ) : (
            automations.map((automation) => (
              <div key={automation.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-800">{automation.name}</h3>
                    <span className={`badge ${automation.active ? "bg-accent-500/10 text-accent-700" : "bg-slate-100 text-slate-500"}`}>
                      {automation.active ? "啟用" : "停用"}
                    </span>
                    <span className="badge bg-brand-50 text-brand-700">{automation.channel.toUpperCase()}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {AUTOMATION_TRIGGER_LABELS[automation.trigger_type]}
                    {automation.segment_id ? `｜${segmentName.get(automation.segment_id) ?? "指定分眾"}` : "｜全部顧客"}
                    {automation.trigger_type === "appointment_done" ? `｜延遲 ${automation.delay_minutes} 分鐘` : ""}
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-400">{automation.body}</p>
                </div>
                {role === "admin" && (
                  <div className="flex flex-wrap gap-2">
                    <form action={toggleAutomationAction}>
                      <input type="hidden" name="id" value={automation.id} />
                      <input type="hidden" name="active" value={String(automation.active)} />
                      <SubmitButton className="btn btn-secondary px-3 py-1.5 text-xs">{automation.active ? "停用" : "啟用"}</SubmitButton>
                    </form>
                    <form action={deleteAutomationAction}>
                      <input type="hidden" name="id" value={automation.id} />
                      <SubmitButton className="btn btn-danger px-3 py-1.5 text-xs">刪除</SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <p className="text-xs leading-5 text-slate-400">
        自動化由排程執行，僅寄送給已勾選行銷同意且具備對應渠道資料的顧客。LINE 推播與 Email 服務商的外部費用依原方案規則計算。
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
