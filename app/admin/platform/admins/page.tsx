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
import {
  sendPlatformPasswordSetupAction,
  setPlatformAdminActiveAction,
  setPlatformAdminPasswordAction,
  upsertPlatformAdminAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface SystemMemberRow {
  user_id: string;
  access_type: PlatformAccessType;
  permissions: SystemPermission[] | null;
  active: boolean;
  created_at: string;
}

interface AuthAccountSummary {
  email: string;
  emailConfirmedAt: string | null;
  invitedAt: string | null;
  lastSignInAt: string | null;
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
  const usersById = new Map<string, AuthAccountSummary>(users.users.map((user) => [user.id, {
    email: user.email ?? "未設定 Email",
    emailConfirmedAt: user.email_confirmed_at ?? null,
    invitedAt: user.invited_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
  }]));
  const members = (rows ?? []) as SystemMemberRow[];

  return (
    <div className="platform-workbench">
      <header className="admin-page-header">
        <p className="eyebrow">系統人員管理</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">系統人員與權限</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">系統管理者擁有完整系統權限，並可新增其他系統管理者或依工作內容授權系統員工。品牌人員由各品牌管理者自行管理。</p>
      </header>

      <section className="platform-overview-grid" aria-label="管理者身分差異">
        <IdentityCard title="系統管理者" scope="跨品牌系統層級" description="管理所有品牌、系統人員、運作狀態、跨品牌報表、操作紀錄及系統設定。" />
        <IdentityCard title="品牌管理者" scope="單一或獲授權品牌" description="管理品牌人員、預約、報名、顧客、LINE、Rich Menu、CRM、報表與品牌設定。" />
      </section>

      <section className="platform-panel space-y-5 p-5 sm:p-6">
        <div><p className="eyebrow">新增人員</p><h2 className="mt-1 text-lg font-bold text-slate-900">新增系統人員</h2><p className="mt-1 text-sm leading-6 text-slate-500">可直接設定初始密碼並立即交付登入；若密碼兩欄都留空，系統會寄送邀請信，由人員自行設定密碼。</p></div>
        <form action={upsertPlatformAdminAction} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px_minmax(180px,0.72fr)_minmax(180px,0.72fr)] lg:items-end">
            <label className="text-sm"><span className="label">Email</span><input className="input" name="email" type="email" required autoComplete="email" placeholder="staff@example.com" /></label>
            <label className="text-sm"><span className="label">帳號身分</span><select className="input" name="access_type" defaultValue="employee"><option value="employee">系統員工</option><option value="system_admin">系統管理者</option></select></label>
            <label className="text-sm"><span className="label">初始密碼（至少 8 碼）</span><input className="input" name="password" type="password" minLength={8} autoComplete="new-password" placeholder="留空則寄邀請信" /></label>
            <label className="text-sm"><span className="label">再次輸入初始密碼</span><input className="input" name="password_confirmation" type="password" minLength={8} autoComplete="new-password" placeholder="再次輸入" /></label>
          </div>
          <p className="text-xs leading-5 text-slate-500">若 Email 已經是既有登入帳號，填寫初始密碼會重設該帳號密碼；未填密碼則保留原本登入憑證。</p>
          <PermissionChecklist />
          <div className="flex justify-end"><SubmitButton className="btn btn-primary min-h-11">新增帳號並授權</SubmitButton></div>
        </form>
      </section>

      <section className="platform-panel overflow-hidden p-0">
        <div className="platform-panel-header px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-slate-900">目前系統人員</h2><p className="mt-1 text-sm text-slate-500">共 {members.length} 位，至少保留一位啟用中的系統管理者。</p></div><span className="badge bg-slate-100 text-slate-700">系統層級</span></div>
        <div className="divide-y divide-slate-100">
          {members.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-500">尚未設定系統人員。</p> : members.map((member) => {
            const account = usersById.get(member.user_id);
            const email = account?.email ?? member.user_id;
            const permissions = normalizeSystemPermissions(member.permissions);
            const isSelf = member.user_id === actor.user.id;
            const credential = accountStatus(account);
            return (
              <article key={member.user_id} className="space-y-4 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-slate-900">{email}{isSelf && <span className="ml-2 badge bg-emerald-50 text-emerald-700">目前登入</span>}</p><p className="mt-1 text-xs text-slate-500">加入於 {formatDate(member.created_at)}</p><TechnicalDetails className="mt-1" summary="查看帳號識別碼" items={[{ label: "帳號識別碼", value: member.user_id }]} /></div><div className="flex flex-wrap items-center gap-2"><span className={`badge ${credential.className}`}>{credential.label}</span><span className={`badge ${member.access_type === "system_admin" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>{platformAccessLabel(member.access_type)}</span><span className={`badge ${member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{member.active ? "啟用中" : "已停用"}</span></div></div>
                {!isSelf && <form action={upsertPlatformAdminAction} className="space-y-3 border-l-2 border-slate-300 bg-slate-50 px-4 py-3"><input type="hidden" name="email" value={email} /><label className="block max-w-56 text-sm"><span className="label">帳號身分</span><select className="input" name="access_type" defaultValue={member.access_type}><option value="employee">系統員工</option><option value="system_admin">系統管理者</option></select></label><PermissionChecklist defaults={permissions} /><SubmitButton className="btn btn-secondary min-h-10 px-3 text-xs">更新身分與權限</SubmitButton></form>}
                {!isSelf && <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <form action={setPlatformAdminPasswordAction} className="grid gap-3 border-l-2 border-emerald-600 bg-emerald-50/50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                    <input type="hidden" name="user_id" value={member.user_id} />
                    <label className="text-sm"><span className="label">設定／重設登入密碼</span><input className="input bg-white" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="至少 8 碼" /></label>
                    <label className="text-sm"><span className="label">再次輸入新密碼</span><input className="input bg-white" name="password_confirmation" type="password" required minLength={8} autoComplete="new-password" placeholder="再次輸入" /></label>
                    <SubmitButton className="btn btn-primary min-h-11 whitespace-nowrap">儲存登入密碼</SubmitButton>
                  </form>
                  <form action={sendPlatformPasswordSetupAction} className="px-1 pb-3 lg:pb-0">
                    <input type="hidden" name="user_id" value={member.user_id} />
                    <SubmitButton className="btn btn-secondary min-h-11 whitespace-nowrap">寄送設定密碼信</SubmitButton>
                  </form>
                </div>}
                {!isSelf && <form action={setPlatformAdminActiveAction}><input type="hidden" name="user_id" value={member.user_id} /><input type="hidden" name="active" value={member.active ? "false" : "true"} /><SubmitButton className="admin-inline-action text-rose-700">{member.active ? "停用系統存取" : "重新啟用"}</SubmitButton></form>}
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
  return <article className="platform-panel p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">{title}</h2><span className="badge bg-slate-100 text-slate-700">{scope}</span></div><p className="mt-3 text-sm leading-6 text-slate-500">{description}</p></article>;
}

function formatDate(value: string): string { return new Date(value).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }); }

function accountStatus(account: AuthAccountSummary | undefined): { label: string; className: string } {
  if (!account) return { label: "登入帳號異常", className: "bg-rose-50 text-rose-700" };
  if (account.lastSignInAt) return { label: "曾登入", className: "bg-emerald-50 text-emerald-700" };
  if (account.invitedAt) return { label: "邀請待完成", className: "bg-amber-50 text-amber-700" };
  if (account.emailConfirmedAt) return { label: "可登入，尚未登入", className: "bg-sky-50 text-sky-700" };
  return { label: "帳號待啟用", className: "bg-amber-50 text-amber-700" };
}
