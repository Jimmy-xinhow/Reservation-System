import {
  listStaff,
  createStaffAction,
  listClinicDoctors,
  removeStaffAction,
  resetStaffPasswordAction,
  setStaffRoleAction,
  setDoctorAssignmentsAction,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { brandAccessLabel } from "@/lib/access-control";
import { BrandPermissionPicker } from "@/components/PermissionPresetPicker";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const [staff, doctors] = await Promise.all([listStaff(), listClinicDoctors()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">品牌人員與權限</h1>
        <p className="text-sm text-slate-400">品牌管理者擁有完整品牌權限；其他帳號統一為品牌員工，再依工作內容授予權限。</p>
      </div>

      {/* 新增帳號 */}
      <form action={createStaffAction} className="card flex flex-wrap items-end gap-3 p-5">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Email</span>
          <input name="email" type="email" required autoComplete="email" className="input" placeholder="staff@clinic.com" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">初始密碼(至少 8 碼)</span>
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" placeholder="至少 8 碼" />
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">帳號身分</span><select name="access_type" defaultValue="employee" className="input"><option value="employee">品牌員工</option><option value="brand_admin">品牌管理者</option></select></label>
        <BrandPermissionPicker />
        <SubmitButton className="btn btn-primary">新增帳號</SubmitButton>
      </form>

      {/* 帳號列表 */}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>身分與權限</th>
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
                  <form action={setStaffRoleAction} className="min-w-64 space-y-2">
                    <input type="hidden" name="user_id" value={m.userId} />
                    <select
                      name="access_type"
                      defaultValue={m.accessType}
                      disabled={m.isSelf}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                    >
                      <option value="employee">品牌員工</option>
                      <option value="brand_admin">品牌管理者</option>
                    </select>
                    {m.isSelf ? <p className="text-xs text-slate-500">{brandAccessLabel(m.accessType)} · 目前登入帳號不可自行降級</p> : <><BrandPermissionPicker defaults={m.permissions} compact /><SubmitButton className="admin-inline-action text-brand-700">儲存身分與權限</SubmitButton></>}
                  </form>
                  {m.permissions.includes("provider.assigned") && (
                    <form action={setDoctorAssignmentsAction} className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2">
                      <input type="hidden" name="user_id" value={m.userId} />
                      <div className="text-[11px] font-medium text-slate-500">可查看的服務提供者</div>
                      {doctors.length === 0 ? (
                        <div className="text-[11px] text-slate-400">尚未建立服務提供者</div>
                      ) : (
                        <div className="grid gap-1 sm:grid-cols-2">
                          {doctors.map((doctor) => (
                            <label key={doctor.id} className="flex items-center gap-1 text-[11px] text-slate-600">
                              <input
                                type="checkbox"
                                name="doctor_ids"
                                value={doctor.id}
                                defaultChecked={m.assignedDoctors.some((assigned) => assigned.id === doctor.id)}
                              />
                              {doctor.name}
                            </label>
                          ))}
                        </div>
                      )}
                      <SubmitButton className="admin-inline-action text-brand-700">儲存指派</SubmitButton>
                    </form>
                  )}
                </td>
                <td className="text-slate-400">{m.createdAt ? m.createdAt.slice(0, 10) : "—"}</td>
                <td>
                  {m.accessType === "brand_admin" ? (
                    <span className="text-xs text-slate-400">管理者密碼不在此頁代改</span>
                  ) : (
                    <form action={resetStaffPasswordAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="user_id" value={m.userId} />
                      <input type="email" value={m.email} autoComplete="username" readOnly tabIndex={-1} className="sr-only" aria-hidden="true" />
                      <input
                        name="password"
                        type="password"
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="新密碼"
                        className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                      <SubmitButton className="admin-inline-action text-brand-700">更新</SubmitButton>
                    </form>
                  )}
                </td>
                <td>
                  {m.isSelf ? (
                    <span className="text-xs text-slate-300">—</span>
                  ) : (
                    <form action={removeStaffAction}>
                      <input type="hidden" name="user_id" value={m.userId} />
                      <SubmitButton className="admin-inline-action text-red-700">移除權限</SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        「移除權限」只取消該帳號存取本品牌後台的權限，不會刪除登入帳號。每個品牌至少保留一位品牌管理者；員工無法管理其他人員或自行提高權限。
      </p>
    </div>
  );
}
