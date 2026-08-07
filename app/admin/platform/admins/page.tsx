import { SubmitButton } from "@/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase";
import { requirePlatformOwner } from "@/lib/platform";
import { setPlatformAdminActiveAction, upsertPlatformAdminAction } from "./actions";

export const dynamic = "force-dynamic";

interface PlatformAdminRow { user_id: string; role: "owner" | "admin"; active: boolean; created_at: string; }

export default async function PlatformAdminsPage() {
  await requirePlatformOwner();
  const service = createServiceClient();
  const [{ data: rows, error: rowsError }, { data: users, error: usersError }] = await Promise.all([
    service.from("platform_admins").select("user_id, role, active, created_at").order("created_at", { ascending: true }),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (rowsError) throw new Error(`讀取平台管理員失敗：${rowsError.message}`);
  if (usersError) throw new Error(`讀取帳號清單失敗：${usersError.message}`);
  const usersById = new Map(users.users.map((user) => [user.id, user.email ?? "未設定 Email"]));
  const admins = (rows ?? []) as PlatformAdminRow[];

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Access control</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">平台管理員</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">這裡管理 XINHOW 系統層級管理者，不管理任何品牌的員工帳號。只有平台 owner 可以新增、變更或停用平台管理員。</p>
      </header>

      <section className="card space-y-5 border-indigo-100 bg-indigo-50/40 p-5 sm:p-6">
        <div>
          <p className="eyebrow">Invite platform staff</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">新增平台管理員</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">已存在的帳號會直接授權；尚未註冊的 Email 會收到 Supabase 邀請。平台權限與品牌 owner 權限分開管理。</p>
        </div>
        <form action={upsertPlatformAdminAction} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
          <label className="text-sm"><span className="label">管理員 Email</span><input className="input" name="email" type="email" required placeholder="admin@example.com" /></label>
          <label className="text-sm"><span className="label">平台角色</span><select className="input" name="role" defaultValue="admin"><option value="admin">Platform admin</option><option value="owner">Platform owner</option></select></label>
          <SubmitButton className="btn btn-primary min-h-11">儲存平台權限</SubmitButton>
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div><h2 className="font-semibold text-slate-900">目前平台管理員</h2><p className="mt-1 text-sm text-slate-500">共 {admins.length} 位，至少保留一位啟用中的 owner。</p></div>
          <span className="badge bg-indigo-50 text-indigo-700">系統層級</span>
        </div>
        <div className="divide-y divide-slate-100">
          {admins.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-500">尚未設定平台管理員。</p> : admins.map((admin) => (
            <div key={admin.user_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0"><p className="truncate font-medium text-slate-900">{usersById.get(admin.user_id) ?? admin.user_id}</p><p className="mt-1 text-xs text-slate-400">加入於 {formatDate(admin.created_at)} · ID {admin.user_id}</p></div>
              <div className="flex items-center gap-2"><span className={`badge ${admin.role === "owner" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{admin.role === "owner" ? "Platform owner" : "Platform admin"}</span><span className={`badge ${admin.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{admin.active ? "啟用中" : "已停用"}</span><form action={setPlatformAdminActiveAction}><input type="hidden" name="user_id" value={admin.user_id} /><input type="hidden" name="active" value={admin.active ? "false" : "true"} /><SubmitButton className="btn btn-secondary min-h-11 px-3 text-xs">{admin.active ? "停用" : "重新啟用"}</SubmitButton></form></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string): string { return new Date(value).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }); }
