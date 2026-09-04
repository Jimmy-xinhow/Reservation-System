import { headers } from "next/headers";
import { requireNonProvider } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/SubmitButton";
import { cancelDocumentRequestAction, createDocumentTemplateAction, issueDocumentRequestAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { consent: "服務同意書", waiver: "風險告知與免責", intake: "顧客初次資料表" };
const STATUS_LABEL: Record<string, string> = { pending: "待簽署", signed: "已簽署", expired: "已過期", cancelled: "已取消" };
type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ request_id?: string; sign_token?: string }> }) {
  const member = await requireNonProvider();
  const params = await searchParams;
  const supabase = await createSupabaseServer();
  const [templatesResult, patientsResult, requestsResult] = await Promise.all([
    supabase.from("document_templates").select("id,name,kind,version,active,created_at").eq("clinic_id", member.clinicId).eq("active", true).order("created_at", { ascending: false }),
    supabase.from("patients").select("id,name,phone").eq("clinic_id", member.clinicId).eq("active", true).order("name").limit(500),
    supabase.from("customer_document_requests").select("id,status,expires_at,signer_name,signed_at,created_at,patients(name,phone),document_templates(name,kind,version)").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }).limit(100),
  ]);
  const error = templatesResult.error ?? patientsResult.error ?? requestsResult.error;
  if (error) throw new Error(error.message);
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const signUrl = params.sign_token && host ? `${protocol}://${host}/sign/${encodeURIComponent(params.sign_token)}` : null;

  return <div className="admin-page">
    <div className="admin-page-header"><div><p className="eyebrow">顧客文件</p><h1 className="admin-page-title">同意書與電子簽署</h1><p className="admin-page-description">建立版本化範本，發出限時簽署連結，並保存當時內容與簽署時間。</p></div></div>
    {signUrl && <section className="admin-section border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-900">簽署連結已建立</p><p className="mt-1 text-sm text-emerald-800">這個連結只在本次建立後顯示，請複製後交給顧客。</p><div className="mt-3 flex flex-wrap gap-2"><input readOnly value={signUrl} className="input min-w-0 flex-1 bg-white" /><a href={signUrl} target="_blank" rel="noreferrer" className="btn btn-primary">預覽簽署頁</a></div></section>}
    <section className="admin-workbench-grid">
      <form action={createDocumentTemplateAction} className="admin-section p-4"><h2 className="font-semibold">建立文件範本</h2><div className="mt-3 space-y-3"><label className="block"><span className="label">範本名稱</span><input name="name" className="input" required placeholder="例如：美容療程服務同意書" /></label><label className="block"><span className="label">文件用途</span><select name="kind" className="input" defaultValue="consent"><option value="consent">服務同意書</option><option value="waiver">風險告知與免責</option><option value="intake">顧客初次資料表</option></select></label><label className="block"><span className="label">顧客看到的完整內容</span><textarea name="body" className="input min-h-52" required maxLength={20000} placeholder="請放入服務內容、注意事項、風險與同意條款。" /></label><SubmitButton className="btn btn-primary">儲存範本</SubmitButton></div></form>
      <form action={issueDocumentRequestAction} className="admin-section p-4"><h2 className="font-semibold">發出簽署要求</h2><p className="mt-1 text-sm text-slate-500">系統會把目前範本內容固定保存，日後修改範本不會改動已發出的文件。</p><div className="mt-3 space-y-3"><label className="block"><span className="label">顧客</span><select name="patient_id" className="input" required defaultValue=""><option value="" disabled>選擇顧客</option>{(patientsResult.data ?? []).map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}</select></label><label className="block"><span className="label">文件範本</span><select name="template_id" className="input" required defaultValue=""><option value="" disabled>選擇範本</option>{(templatesResult.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.name} · 第 {template.version} 版</option>)}</select></label><label className="block"><span className="label">連結有效天數</span><input name="expires_in_days" type="number" min="1" max="30" defaultValue="7" className="input" /></label><SubmitButton className="btn btn-primary" disabled={(templatesResult.data ?? []).length === 0 || (patientsResult.data ?? []).length === 0}>建立簽署連結</SubmitButton></div></form>
    </section>
    <section className="admin-table-shell"><div className="admin-section-header"><h2 className="font-semibold">簽署紀錄</h2><span className="text-xs text-slate-500">最近 100 筆</span></div><table className="tbl"><thead><tr><th>顧客</th><th>文件</th><th>狀態</th><th>期限／簽署時間</th><th>操作</th></tr></thead><tbody>{(requestsResult.data ?? []).map((request) => { const patient = one(request.patients); const template = one(request.document_templates); const expired = request.status === "pending" && new Date(request.expires_at).getTime() < Date.now(); return <tr key={request.id}><td>{patient?.name}<div className="text-xs text-slate-400">{patient?.phone}</div></td><td>{template?.name}<div className="text-xs text-slate-400">{KIND_LABEL[template?.kind ?? ""] ?? template?.kind} · 第 {template?.version} 版</div></td><td><span className={`badge ${request.status === "signed" ? "bg-emerald-50 text-emerald-700" : expired ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{expired ? "已過期" : STATUS_LABEL[request.status] ?? request.status}</span></td><td>{request.signed_at ? new Date(request.signed_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : new Date(request.expires_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}{request.signer_name && <div className="text-xs text-slate-400">簽署人：{request.signer_name}</div>}</td><td>{request.status === "pending" && !expired ? <form action={cancelDocumentRequestAction}><input type="hidden" name="id" value={request.id} /><SubmitButton className="btn btn-secondary">取消</SubmitButton></form> : "—"}</td></tr>; })}{(requestsResult.data ?? []).length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">尚未發出簽署要求</td></tr>}</tbody></table></section>
  </div>;
}
