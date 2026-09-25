import {
  listStaff,
  createStaffAction,
  listClinicDoctors,
  removeStaffAction,
  sendStaffPasswordSetupAction,
  setStaffRoleAction,
  setDoctorAssignmentsAction,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { BRAND_PERMISSION_DEFINITIONS, brandAccessLabel } from "@/lib/access-control";
import { BrandPermissionPicker } from "@/components/PermissionPresetPicker";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [staff, doctors, params] = await Promise.all([listStaff(), listClinicDoctors(), searchParams]);
  const notice = params.notice === "invited"
    ? "已寄出邀請信。新員工可從信中的連結自行設定密碼。"
    : params.notice === "existing"
      ? "既有帳號已加入本品牌，可沿用原帳號登入。若忘記密碼，可從下方寄送設定信。"
      : params.notice === "password-email"
        ? "密碼設定信已寄出，請員工從最新郵件自行設定。"
        : null;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div><p className="eyebrow">員工管理</p><h1 className="admin-page-title">員工與權限</h1><p className="admin-page-description">以 Email 邀請新員工自行設定密碼，再依工作內容設定操作權限與可查看的服務提供者。已有帳號者可用原帳號登入。</p></div>
      </header>
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      {/* 新增帳號 */}
      <form action={createStaffAction} className="admin-section flex flex-wrap items-end gap-3 p-5">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Email</span>
          <input name="email" type="email" required autoComplete="email" className="input" placeholder="staff@clinic.com" />
        </label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-600">帳號身分</span><select name="access_type" defaultValue="employee" className="input"><option value="employee">品牌員工</option><option value="brand_admin">品牌管理者</option></select></label>
        <BrandPermissionPicker />
        <SubmitButton className="btn btn-primary">邀請或加入員工</SubmitButton>
      </form>

      {/* 手機以人員卡片呈現完整操作，避免寬表格只露出 Email。 */}
      <div className="space-y-3 md:hidden">
        {staff.length === 0 && <p className="admin-section px-5 py-8 text-center text-sm text-slate-500">尚無帳號</p>}
        {staff.map((m) => (
          <details key={m.userId} className="group admin-section overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900" title={m.email}>{m.email}</span>
                <span className="mt-1 block text-xs text-slate-500">{brandAccessLabel(m.accessType)}{m.isSelf ? " · 目前登入" : ""}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-brand-700">管理設定 <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-180">⌄</span></span>
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div>
                <p className="text-xs font-medium text-slate-500">目前工作權限</p>
                <p className="mt-1 text-sm text-slate-700">{m.permissions.map((permission) => BRAND_PERMISSION_DEFINITIONS.find((item) => item.key === permission)?.label ?? permission).join("、")}</p>
              </div>
              <p className="text-xs text-slate-500">加入日期：{m.createdAt ? m.createdAt.slice(0, 10) : "—"}</p>
              {!m.isSelf && (
                <form action={setStaffRoleAction} className="space-y-3">
                  <input type="hidden" name="user_id" value={m.userId} />
                  <label className="block text-sm font-medium text-slate-700">帳號身分
                    <select name="access_type" defaultValue={m.accessType} className="input mt-1 w-full">
                      <option value="employee">品牌員工</option>
                      <option value="brand_admin">品牌管理者</option>
                    </select>
                  </label>
                  <BrandPermissionPicker defaults={m.permissions} compact />
                  <SubmitButton className="btn btn-primary w-full">儲存身分與權限</SubmitButton>
                </form>
              )}
              {m.permissions.includes("provider.assigned") && (
                <form action={setDoctorAssignmentsAction} className="space-y-3 rounded-xl bg-slate-50 p-3">
                  <input type="hidden" name="user_id" value={m.userId} />
                  <p className="text-sm font-medium text-slate-700">可查看的服務提供者</p>
                  {doctors.length === 0 ? <p className="text-xs text-slate-500">尚未建立服務提供者</p> : doctors.map((doctor) => (
                    <label key={doctor.id} className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="doctor_ids" value={doctor.id} defaultChecked={m.assignedDoctors.some((assigned) => assigned.id === doctor.id)} />
                      {doctor.name}
                    </label>
                  ))}
                  <SubmitButton className="btn btn-secondary w-full">儲存指派</SubmitButton>
                </form>
              )}
              {m.accessType === "employee" && !m.isSelf && (
                <form action={sendStaffPasswordSetupAction}>
                  <input type="hidden" name="user_id" value={m.userId} />
                  <SubmitButton className="btn btn-secondary w-full">寄送密碼設定信</SubmitButton>
                </form>
              )}
              {!m.isSelf && (
                <form action={removeStaffAction}>
                  <input type="hidden" name="user_id" value={m.userId} />
                  <SubmitButton className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700">移除本品牌權限</SubmitButton>
                </form>
              )}
            </div>
          </details>
        ))}
      </div>

      {/* 帳號列表 */}
      <div className="admin-section hidden overflow-x-auto md:block">
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>身分與權限</th>
              <th>建立日期</th>
              <th>登入協助</th>
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
                    <span className="text-xs text-slate-400">由管理者自行設定</span>
                  ) : (
                    <form action={sendStaffPasswordSetupAction}>
                      <input type="hidden" name="user_id" value={m.userId} />
                      <SubmitButton className="admin-inline-action text-brand-700">寄送密碼設定信</SubmitButton>
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
