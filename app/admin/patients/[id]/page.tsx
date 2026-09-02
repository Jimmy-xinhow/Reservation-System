import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { requireMember, canViewSensitiveCustomerData } from "@/lib/admin";
import { formatDateTime } from "@/lib/slots";
import {
  updatePatientAction,
  updatePatientBasicAction,
  addPatientRecordAction,
  deletePatientRecordAction,
  setPatientBlockAction,
} from "../../patient-actions";
import { SubmitButton } from "@/components/SubmitButton";

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

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { clinicId, role } = await requireMember();
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

  const [{ data: apptData }, { data: recData }, { data: interactionData }] = await Promise.all([
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
  ]);
  const history = (apptData ?? []) as unknown as Appt[];
  const records = (recData ?? []) as PatientRecord[];
  const interactions = (interactionData ?? []) as CrmInteraction[];
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
