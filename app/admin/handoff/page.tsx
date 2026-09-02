import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { createHandoffTaskAction, updateHandoffTaskAction } from "./actions";

export const dynamic = "force-dynamic";

interface Task { id: string; title: string; category: string; status: string; priority: string; due_at: string | null; assigned_to: string | null; note: string | null; created_at: string; }
const CATEGORY: Record<string, string> = { appointment: "預約", payment: "付款", customer: "顧客", channel: "渠道", other: "其他" };
const STATUS: Record<string, string> = { open: "待處理", in_progress: "處理中", done: "已完成" };
const PRIORITY: Record<string, string> = { low: "低", normal: "一般", high: "高" };

export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string; priority?: string; assignee?: string }> }) {
  const member = await requireOperator();
  const params = await searchParams;
  let query = member.supabase.from("handoff_tasks").select("id, title, category, status, priority, due_at, assigned_to, note, created_at").eq("clinic_id", member.clinicId).order("status").order("priority", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (["open", "in_progress", "done"].includes(params.status ?? "")) query = query.eq("status", params.status!);
  if (Object.hasOwn(CATEGORY, params.category ?? "")) query = query.eq("category", params.category!);
  if (Object.hasOwn(PRIORITY, params.priority ?? "")) query = query.eq("priority", params.priority!);
  if (params.assignee) query = query.eq("assigned_to", params.assignee);
  const [{ data, error }, { data: members, error: membersError }] = await Promise.all([
    query,
    member.supabase.from("clinic_members").select("user_id, access_type").eq("clinic_id", member.clinicId),
  ]);
  if (error || membersError) throw new Error(error?.message ?? membersError?.message ?? "讀取交班待辦失敗");
  const service = createServiceClient();
  const { data: authUsers } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map(authUsers.users.map((user) => [user.id, user.email ?? user.id]));
  const tasks = (data ?? []) as Task[];
  const openCount = tasks.filter((task) => task.status !== "done").length;
  return (
    <div className="space-y-6">
      <header><p className="eyebrow">日常交接</p><h1 className="mt-1 text-2xl font-bold text-slate-900">交班待辦</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">把預約、付款、顧客與渠道問題集中交接；用狀態、分類、優先度與負責人快速篩選。</p></header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="目前清單" value={tasks.length} /><Metric label="未完成" value={openCount} /><Metric label="高優先" value={tasks.filter((task) => task.priority === "high" && task.status !== "done").length} /></div>
      <section className="card space-y-4 p-5"><h2 className="font-semibold text-slate-900">新增交班事項</h2><form action={createHandoffTaskAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label className="text-sm md:col-span-2 xl:col-span-2"><span className="label">標題</span><input name="title" className="input" maxLength={160} required placeholder="例如：確認明日上午訂金未入帳" /></label><label className="text-sm"><span className="label">分類</span><select name="category" className="input" defaultValue="appointment">{Object.entries(CATEGORY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm"><span className="label">優先度</span><select name="priority" className="input" defaultValue="normal">{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm"><span className="label">期限（台北）</span><input type="datetime-local" name="due_at" className="input" /></label><label className="text-sm"><span className="label">負責人</span><select name="assigned_to" className="input" defaultValue=""><option value="">未指派</option>{(members ?? []).map((staff) => <option key={staff.user_id} value={staff.user_id}>{emailById.get(staff.user_id) ?? "品牌成員（未設定 Email）"}</option>)}</select></label><label className="text-sm md:col-span-2 xl:col-span-5"><span className="label">交班備註</span><textarea name="note" className="input min-h-20" maxLength={1000} /></label><SubmitButton className="btn btn-primary min-h-11 self-end">新增待辦</SubmitButton></form></section>
      <form className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm"><span className="label">狀態</span><select name="status" className="input" defaultValue={params.status ?? ""}><option value="">全部</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm"><span className="label">分類</span><select name="category" className="input" defaultValue={params.category ?? ""}><option value="">全部</option>{Object.entries(CATEGORY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm"><span className="label">優先度</span><select name="priority" className="input" defaultValue={params.priority ?? ""}><option value="">全部</option>{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm"><span className="label">負責人</span><select name="assignee" className="input" defaultValue={params.assignee ?? ""}><option value="">全部</option>{(members ?? []).map((staff) => <option key={staff.user_id} value={staff.user_id}>{emailById.get(staff.user_id) ?? "品牌成員（未設定 Email）"}</option>)}</select></label><button className="btn btn-secondary min-h-11 self-end" type="submit">套用篩選</button></form>
      <section className="card overflow-hidden">{tasks.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">目前篩選沒有交班待辦。</p> : <div className="divide-y divide-slate-100">{tasks.map((task) => <article key={task.id} className="space-y-3 px-5 py-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium text-slate-900">{task.title}</h2><span className={`badge ${task.priority === "high" ? "bg-red-50 text-red-700" : task.priority === "low" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{PRIORITY[task.priority]}優先</span><span className="badge bg-brand-50 text-brand-700">{CATEGORY[task.category]}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{task.assigned_to ? `負責：${emailById.get(task.assigned_to) ?? "品牌成員"}` : "未指派"}{task.due_at ? ` · 期限：${new Date(task.due_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` : ""}</p>{task.note && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{task.note}</p>}</div><form action={updateHandoffTaskAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={task.id} /><label className="text-xs"><span className="sr-only">狀態</span><select name="status" defaultValue={task.status} className="input h-10 py-1 text-xs">{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs"><span className="sr-only">優先度</span><select name="priority" defaultValue={task.priority} className="input h-10 py-1 text-xs">{Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><SubmitButton className="btn btn-secondary min-h-10 px-3 text-xs">更新</SubmitButton></form></div></article>)}</div>}</section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>; }
