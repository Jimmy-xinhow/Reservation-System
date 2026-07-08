import {
  listStaff,
  createStaffAction,
  removeStaffAction,
  resetStaffPasswordAction,
  setStaffRoleAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const staff = await listStaff();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">使用者管理</h1>
        <p className="text-sm text-slate-400">
          管理可登入後台的帳號與角色。<b>管理員</b>可管理使用者與 LINE 設定;<b>櫃檯</b>只能做日常看診作業。
        </p>
      </div>

      {/* 新增帳號 */}
      <form action={createStaffAction} className="card flex flex-wrap items-end gap-3 p-5">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Email</span>
          <input name="email" type="email" required className="input" placeholder="staff@clinic.com" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">初始密碼(至少 8 碼)</span>
          <input name="password" type="text" required minLength={8} className="input" placeholder="至少 8 碼" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">角色</span>
          <select name="role" defaultValue="staff" className="input">
            <option value="staff">櫃檯</option>
            <option value="admin">管理員</option>
          </select>
        </label>
        <button className="btn btn-primary">新增帳號</button>
      </form>

      {/* 帳號列表 */}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>角色</th>
              <th>建立日期</th>
              <th>重設密碼</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  尚無帳號
                </td>
              </tr>
            )}
            {staff.map((m) => (
              <tr key={m.userId}>
                <td className="font-medium text-slate-800">
                  {m.email}
                  {m.isSelf && <span className="ml-2 badge bg-brand-50 text-brand-700">目前登入</span>}
                </td>
                <td>
                  <form action={setStaffRoleAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="user_id" value={m.userId} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="staff">櫃檯</option>
                      <option value="admin">管理員</option>
                    </select>
                    <button className="text-xs font-medium text-brand-600 hover:underline">更新</button>
                  </form>
                </td>
                <td className="text-slate-400">{m.createdAt ? m.createdAt.slice(0, 10) : "—"}</td>
                <td>
                  <form action={resetStaffPasswordAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="user_id" value={m.userId} />
                    <input
                      name="password"
                      type="text"
                      minLength={8}
                      placeholder="新密碼"
                      className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    />
                    <button className="text-xs font-medium text-brand-600 hover:underline">更新</button>
                  </form>
                </td>
                <td>
                  {m.isSelf ? (
                    <span className="text-xs text-slate-300">—</span>
                  ) : (
                    <form action={removeStaffAction}>
                      <input type="hidden" name="user_id" value={m.userId} />
                      <button className="text-xs font-medium text-red-600 hover:underline">移除權限</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        「移除權限」僅取消該帳號存取本診所後台的權限,不會刪除其登入帳號。系統至少保留一位管理員,無法把最後一位管理員降級或移除。
      </p>
    </div>
  );
}
