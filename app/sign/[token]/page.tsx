import { createHash } from "node:crypto";
import { Brand } from "@/components/Brand";
import { SubmitButton } from "@/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase";
import { signCustomerDocumentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SignDocumentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ completed?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await createServiceClient().from("customer_document_requests").select("status,content_snapshot,template_version,expires_at,signer_name,signed_at,clinics(name),document_templates(name,kind)").eq("token_hash", hash).maybeSingle();
  if (error) throw new Error(error.message);
  const expired = data ? new Date(data.expires_at).getTime() < Date.now() : true;
  const clinic = data && (Array.isArray(data.clinics) ? data.clinics[0] : data.clinics);
  const template = data && (Array.isArray(data.document_templates) ? data.document_templates[0] : data.document_templates);
  const completed = query.completed === "1" || data?.status === "signed";
  return <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-6"><Brand subtitle={clinic?.name ? `${clinic.name}・顧客文件` : "顧客文件"} /></header>{!data || expired || ["cancelled", "expired"].includes(data.status) ? <section className="card p-8 text-center"><h1 className="text-xl font-bold text-slate-900">這個簽署連結目前無法使用</h1><p className="mt-2 text-sm leading-6 text-slate-500">連結可能已過期或已由品牌取消，請向服務人員索取新的連結。</p></section> : completed ? <section className="card p-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700">✓</div><h1 className="mt-4 text-xl font-bold text-slate-900">文件已完成簽署</h1><p className="mt-2 text-sm text-slate-500">簽署人：{data.signer_name}。品牌後台已保存簽署時間與當時文件內容。</p></section> : <section className="card overflow-hidden"><header className="border-b border-slate-100 p-5"><p className="eyebrow">電子簽署</p><h1 className="mt-1 text-xl font-bold text-slate-900">{template?.name ?? "顧客同意書"}</h1><p className="mt-1 text-sm text-slate-500">第 {data.template_version} 版 · 連結有效至 {new Date(data.expires_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p></header><article className="whitespace-pre-wrap p-5 text-sm leading-8 text-slate-700">{data.content_snapshot}</article><form action={signCustomerDocumentAction} className="space-y-4 border-t border-slate-100 bg-slate-50 p-5"><input type="hidden" name="token" value={token} /><label className="block"><span className="label">簽署人姓名</span><input name="signer_name" className="input bg-white" required maxLength={100} autoComplete="name" /></label><label className="flex items-start gap-3 text-sm leading-6 text-slate-700"><input type="checkbox" name="accepted" value="yes" required className="mt-1 h-4 w-4" /><span>本人已完整閱讀上述內容，理解其說明，並同意以輸入姓名作為本次電子簽署紀錄。</span></label><SubmitButton className="btn btn-primary w-full">確認並完成簽署</SubmitButton></form></section>}</main>;
}
