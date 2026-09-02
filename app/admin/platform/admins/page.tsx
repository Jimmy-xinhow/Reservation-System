import { SubmitButton } from "@/components/SubmitButton";
import { SystemPermissionPicker } from "@/components/PermissionPresetPicker";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { requireSystemAdmin } from "@/lib/platform";
import {
  normalizeSystemPermissions,
  platformAccessLabel,
  type PlatformAccessType,
  type SystemPermission,
} from "@/lib/platform-roles";
import { createServiceClient } from "@/lib/supabase";
import { setPlatformAdminActiveAction, upsertPlatformAdminAction } from "./actions";

export const dynamic = "force-dynamic";

interface SystemMemberRow {
  user_id: string;
  access_type: PlatformAccessType;
  permissions: SystemPermission[] | null;
  active: boolean;
  created_at: string;
}

export default async function SystemPeoplePage() {
  const actor = await requireSystemAdmin();
  const service = createServiceClient();
  const [{ data: rows, error: rowsError }, { data: users, error: usersError }] = await Promise.all([
    service.from("platform_admins").select("user_id, access_type, permissions, active, created_at").order("created_at", { ascending: true }),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (rowsError) throw new Error(`讀取系統人員失敗：${rowsError.message}`);
  if (usersError) throw new Error(`讀取帳號清單失敗：${usersError.message}`);
  const usersById = new Map(users.users.map((user) => [user.id, user.email ?? "未設定 Email"]));
  const members = (rows ?? []) as SystemMemberRow[];

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">系統人員管理</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">系統人員與權限</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">系統管理者擁有完整系統權限，並可新增其他系統管理者或依工作內容授權系統員工。品牌人員由各品牌管理者自行管理。</p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="管理者身分差異">
        <IdentityCard title="系統管理者" scope="跨品牌系統層級" description="管理所有品牌、系統人員、運作狀態、跨品牌報表、操作紀錄及系統設定。" />
        <IdentityCard title="品牌管理者" scope="單一或獲授權品牌" description="管理品牌人員、預約、報名、顧客、LINE、Rich Menu、CRM、報表與品牌設定。" />
      </section>

      <section className="card space-y-5 border-indigo-100 bg-indigo-50/40 p-5 sm:p-6">
        <div><p className="eyebrow">新增人員</p><h2 className="mt-1 text-lg font-bold text-slate-900">新增系統人員</h2><p className="mt-1 text-sm leading-6 text-slate-500">選擇「系統管理者」即取得完整權限；選擇「系統員工」時，再勾選實際需要的工作權限。</p></div>
        <form action={upsertPlatformAdminAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end">
            <label className="text-sm"><span className="label">Email</span><input className="input" name="email" type="email" required autoComplete="email" placeholder="staff@example.com" /></label>
            <label className="text-sm"><span className="label">帳號身分</span><select className="input" name="access_type" defaultValue="employee"><option value="employee">系統員工</option><option value="system_admin">系統管理者</option></select></label>
            <SubmitButton className="btn btn-primary min-h-11">儲存人員權限</SubmitButton>
          </div>
          <PermissionChecklist />
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-slate-900">目前系統人員</h2><p className="mt-1 text-sm text-slate-500">共 {members.length} 位，至少保留一位啟用中的系統管理者。</p></div><span className="badge bg-indigo-50 text-indigo-700">系統層級</span></div>
        <div className="divide-y divide-slate-100">
          {members.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-500">尚未設定系統人員。</p> : members.map((member) => {
            const email = usersById.get(member.user_id) ?? member.user_id;
            const permissions = normalizeSystemPermissions(member.permissions);
            const isSelf = member.user_id === actor.user.id;
            return (
              <article key={member.user_id} className="space-y-4 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-slate-900">{email}{isSelf && <span className="ml-2 badge bg-indigo-50 text-indigo-700">目前登入</span>}</p><p className="mt-1 text-xs text-slate-500">加入於 {formatDate(member.created_at)}</p><TechnicalDetails className="mt-1" summary="查看帳號識別碼" items={[{ label: "帳號識別碼", value: member.user_id }]} /></div><div className="flex items-center gap-2"><span className={`badge ${member.access_type === "system_admin" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{platformAccessLabel(member.access_type)}</span><span className={`badge ${member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{member.active ? "啟用中" : "已停用"}</span></div></div>
                {!isSelf && <form action={upsertPlatformAdminAction} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><input type="hidden" name="email" value={email} /><label className="block max-w-56 text-sm"><span className="label">帳號身分</span><select className="input" name="access_type" defaultValue={member.access_type}><option value="employee">系統員工</option><option value="system_admin">系統管理者</option></select></label><PermissionChecklist defaults={permissions} /><SubmitButton className="btn btn-secondary min-h-10 px-3 text-xs">更新身分與權限</SubmitButton></form>}
                {!isSelf && <form action={setPlatformAdminActiveAction}><input type="hidden" name="user_id" value={member.user_id} /><input type="hidden" name="active" value={member.active ? "false" : "true"} /><SubmitButton className="text-xs font-medium text-rose-700 hover:underline">{member.active ? "停用系統存取" : "重新啟用"}</SubmitButton></form>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PermissionChecklist({ defaults = ["platform.overview"] }: { defaults?: readonly SystemPermission[] }) {
  return <SystemPermissionPicker defaults={defaults} />;
}

function IdentityCard({ title, scope, description }: { title: string; scope: string; description: string }) {
  return <article className="card p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">{title}</h2><span className="badge bg-indigo-50 text-indigo-700">{scope}</span></div><p className="mt-3 text-sm leading-6 text-slate-500">{description}</p></article>;
}

function formatDate(value: string): string { return new Date(value).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }); }
