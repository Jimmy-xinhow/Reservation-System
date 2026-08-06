import {
  listStaff,
  createStaffAction,
  listClinicDoctors,
  removeStaffAction,
  resetStaffPasswordAction,
  setStaffRoleAction,
  setDoctorAssignmentsAction,
} from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const [staff, doctors] = await Promise.all([listStaff(), listClinicDoctors()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">使用者管理</h1>
          <p className="text-sm text-slate-400">
          管理可登入後台的帳號與角色。管理員可管理設定；櫃檯／營運處理日常流程；服務提供者只查看必要工作資料。
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
            <option value="frontdesk">營運</option>
            <option value="provider">服務提供者</option>
            <option value="admin">管理員</option>
          </select>
        </label>
        <SubmitButton className="btn btn-primary">新增帳號</SubmitButton>
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
                      <option value="frontdesk">營運</option>
                      <option value="provider">服務提供者</option>
                      <option value="admin">管理員</option>
                    </select>
                    <SubmitButton className="text-xs font-medium text-brand-600 hover:underline">更新</SubmitButton>
                  </form>
                  {m.role === "provider" && (
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
                      <SubmitButton className="text-[11px] font-medium text-brand-600 hover:underline">儲存指派</SubmitButton>
                    </form>
                  )}
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
                    <SubmitButton className="text-xs font-medium text-brand-600 hover:underline">更新</SubmitButton>
                  </form>
                </td>
                <td>
                  {m.isSelf ? (
                    <span className="text-xs text-slate-300">—</span>
                  ) : (
                    <form action={removeStaffAction}>
                      <input type="hidden" name="user_id" value={m.userId} />
                      <SubmitButton className="text-xs font-medium text-red-600 hover:underline">移除權限</SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        「移除權限」僅取消該帳號存取本品牌後台的權限,不會刪除其登入帳號。系統至少保留一位管理員,無法把最後一位管理員降級或移除。
      </p>
    </div>
  );
}
