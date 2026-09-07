import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { requireMember, canViewSensitiveCustomerData, hasBrandPermission } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { AdminModal } from "@/components/AdminModal";
import { DeletePatientButton } from "./DeletePatientButton";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";
import { assignPatientMembershipLevelAction } from "../memberships/actions";
import { updatePatientDetailsAction } from "../patient-actions";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Patient {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
  gender: string | null;
  tags: string | null;
  blocked_until: string | null;
  membership_level_id: string | null;
  created_at: string;
}

interface MembershipLevel { id: string; name: string; active: boolean; }
interface PatientDetail extends Patient {
  email: string | null;
  marketing_opt_in: boolean;
}
interface RecentAppointment {
  id: string;
  start_at: string;
  status: string;
  doctors: { name: string } | { name: string }[] | null;
  services: { name: string } | { name: string }[] | null;
}
interface RecentRegistration {
  id: string;
  created_at: string;
  status: string;
  events: { title: string } | { title: string }[] | null;
  event_sessions: { name: string; start_at: string } | { name: string; start_at: string }[] | null;
}

const PAGE_SIZE = 30;
const SELECT = "id, name, phone, birthday, gender, tags, blocked_until, membership_level_id, created_at";

function isBlocked(p: Patient): boolean {
  return !!p.blocked_until && new Date(p.blocked_until) > new Date();
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function listHref(filters: { keyword: string; page: number; segmentId: string; patientId?: string }): string {
  const query = new URLSearchParams();
  if (filters.keyword) query.set("q", filters.keyword);
  if (filters.page > 1) query.set("page", String(filters.page));
  if (filters.segmentId) query.set("segment_id", filters.segmentId);
  if (filters.patientId) query.set("patient_id", filters.patientId);
  const suffix = query.toString();
  return `/admin/patients${suffix ? `?${suffix}` : ""}`;
}

const APPOINTMENT_STATUS: Record<string, string> = { booked: "已預約", confirmed: "已確認", cancelled: "已取消", done: "已完成", no_show: "未到" };
const REGISTRATION_STATUS: Record<string, string> = { pending: "待確認", confirmed: "已確認", cancelled: "已取消", waitlisted: "候補", attended: "已出席", no_show: "未到" };

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; segment_id?: string; patient_id?: string }>;
}) {
  const { q, page: pageStr, segment_id: segmentIdParam, patient_id: patientIdParam } = await searchParams;
  const keyword = (q ?? "").trim().replace(/[,%()*]/g, "");
  const page = Math.max(1, Number(pageStr) || 1);
  const segmentId = (segmentIdParam ?? "").trim();
  const selectedPatientId = (patientIdParam ?? "").trim();

  const member = await requireMember();
  const { clinicId, role } = member;
  if (!canViewSensitiveCustomerData(role)) {
    return <p className="card p-6 text-sm text-slate-500">目前角色只能查看被分配的工作，不開放完整顧客名單。</p>;
  }
  const supabase = await createSupabaseServer();
  const service = createServiceClient();
  const canManageMembershipLevels = hasBrandPermission(member, "brand.manage");
  const { data: membershipLevels, error: membershipLevelsError } = canManageMembershipLevels
    ? await service.from("membership_levels").select("id, name, active").eq("clinic_id", clinicId).order("sort_order").order("name")
    : { data: [] as MembershipLevel[], error: null };
  if (membershipLevelsError) throw new Error(`讀取會員等級失敗：${membershipLevelsError.message}`);
  const levelRows = (membershipLevels ?? []) as MembershipLevel[];
  const levelName = new Map(levelRows.map((level) => [level.id, level.name]));
  let segmentName: string | null = null;
  let segmentPatientIds: string[] | null = null;
  if (segmentId) {
    const [{ data: segment }, members] = await Promise.all([
      supabase.from("crm_segments").select("id, name").eq("id", segmentId).eq("clinic_id", clinicId).maybeSingle(),
      fetchAllSupabasePages((from, to) =>
        supabase
          .from("crm_segment_members")
          .select("patient_id")
          .eq("segment_id", segmentId)
          .eq("clinic_id", clinicId)
          .order("patient_id")
          .range(from, to),
      ),
    ]);
    segmentName = (segment?.name as string | undefined) ?? null;
    segmentPatientIds = members.map((member) => member.patient_id as string);
  }

  // 四碼數字 = 生日 MMDD;驗證月(01-12)日(01-31)才視為生日搜尋。
  const mmdd = /^\d{4}$/.test(keyword) ? keyword : null;
  const mm = mmdd ? Number(mmdd.slice(0, 2)) : 0;
  const dd = mmdd ? Number(mmdd.slice(2, 4)) : 0;
  const isMonthDay = !!mmdd && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(keyword);

  let patients: Patient[] = [];
  let total = 0;
  if (keyword && segmentPatientIds?.length !== 0) {
    const orParts = [`name.ilike.%${keyword}%`, `phone.ilike.%${keyword}%`];
    if (isFullDate) orParts.push(`birthday.eq.${keyword}`);
    let query = supabase
      .from("patients")
      .select(SELECT)
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .or(orParts.join(","));
    if (segmentPatientIds) query = query.in("id", segmentPatientIds);
    const { data } = await query.order("created_at", { ascending: false }).limit(100);
    patients = (data ?? []) as Patient[];

    // MMDD:PostgREST 無法對 date 抽月/日,改在此處掃描生日後合併。
    if (isMonthDay) {
      let birthdayQuery = supabase
        .from("patients")
        .select(SELECT)
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .eq("birthday_mmdd", mmdd);
      if (segmentPatientIds) birthdayQuery = birthdayQuery.in("id", segmentPatientIds);
      const { data: withBday } = await birthdayQuery.order("created_at", { ascending: false }).limit(100);
      patients = (withBday ?? []) as Patient[];
    }
  } else if (segmentPatientIds?.length !== 0) {
    let query = supabase
      .from("patients")
      .select(SELECT, { count: "exact" })
      .eq("clinic_id", clinicId)
      .eq("active", true);
    if (segmentPatientIds) query = query.in("id", segmentPatientIds);
    const { data, count } = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    patients = (data ?? []) as Patient[];
    total = count ?? 0;
  }

  // 各顧客的預約/未到統計
  const counts = new Map<string, { all: number; noShow: number }>();
  if (patients.length > 0) {
    const { data: appts } = await supabase
      .from("appointments")
      .select("patient_id, status")
      .eq("clinic_id", clinicId)
      .in(
        "patient_id",
        patients.map((p) => p.id),
      );
    for (const a of appts ?? []) {
      const c = counts.get(a.patient_id) ?? { all: 0, noShow: 0 };
      c.all += 1;
      if (a.status === "no_show") c.noShow += 1;
      counts.set(a.patient_id, c);
    }
  }

  let selectedPatient: PatientDetail | null = null;
  let recentAppointments: RecentAppointment[] = [];
  let recentRegistrations: RecentRegistration[] = [];
  if (selectedPatientId) {
    const [{ data: selectedData, error: selectedError }, { data: recentData, error: recentError }, { data: registrationData, error: registrationError }] = await Promise.all([
      supabase
        .from("patients")
        .select("id, name, phone, tags, blocked_until, membership_level_id, created_at, birthday, gender, email, marketing_opt_in")
        .eq("id", selectedPatientId)
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .maybeSingle(),
      supabase
        .from("appointments")
        .select("id, start_at, status, doctors(name), services(name)")
        .eq("clinic_id", clinicId)
        .eq("patient_id", selectedPatientId)
        .order("start_at", { ascending: false })
        .limit(8),
      supabase
        .from("registrations")
        .select("id, created_at, status, events(title), event_sessions(name,start_at)")
        .eq("clinic_id", clinicId)
        .eq("patient_id", selectedPatientId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    if (selectedError || recentError || registrationError) throw new Error(selectedError?.message ?? recentError?.message ?? registrationError?.message ?? "讀取顧客詳情失敗");
    selectedPatient = selectedData as PatientDetail | null;
    recentAppointments = (recentData ?? []) as unknown as RecentAppointment[];
    recentRegistrations = (registrationData ?? []) as unknown as RecentRegistration[];
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const closeDetailHref = listHref({ keyword, page, segmentId });
  const activeLevelRows = levelRows.filter((level) => level.active);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div><p className="eyebrow">顧客與會員</p><h1 className="admin-page-title">{segmentName ? `分眾顧客：${segmentName}` : "顧客名單"}</h1><p className="admin-page-description">集中搜尋顧客、查看預約紀錄、標籤與可服務狀態。</p></div>
        <div className="flex flex-wrap gap-2">
          {canManageMembershipLevels && <Link href="/admin/membership-levels" className="btn btn-secondary text-sm">會員等級設定</Link>}
          {segmentId && <Link href="/admin/patients" className="btn btn-ghost text-sm">清除分眾篩選</Link>}
        </div>
      </div>

      <form className="admin-toolbar">
        <label className="w-full max-w-md text-sm"><span className="label">搜尋顧客</span><input name="q" defaultValue={keyword} placeholder="姓名、電話或生日（月日四碼）" className="input" /><span className="help-text block">生日例如 3 月 8 日，可輸入 0308。</span></label>
        {segmentId && <input type="hidden" name="segment_id" value={segmentId} />}
        <SubmitButton className="btn btn-primary">搜尋</SubmitButton>
        {keyword && (
          <Link href={`/admin/patients${segmentId ? `?segment_id=${encodeURIComponent(segmentId)}` : ""}`} className="btn btn-ghost">
            清除
          </Link>
        )}
      </form>

      {canManageMembershipLevels && activeLevelRows.length === 0 && (
        <div className="notice notice-info flex flex-wrap items-center justify-between gap-3">
          <span>目前品牌尚未建立會員等級，因此名單只會顯示「一般顧客」。</span>
          <Link href="/admin/membership-levels" className="btn btn-secondary text-sm">建立會員等級</Link>
        </div>
      )}

      <div className="admin-table-shell admin-table-mobile-cards">
        <table className="tbl">
          <thead>
            <tr>
              <th>姓名</th>
              <th>電話</th>
              <th>性別</th>
              <th>生日</th>
              <th>標籤</th>
              <th>預約</th>
              <th>未到</th>
              <th>狀態</th>
              <th>會員等級</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patients.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400" data-mobile-empty="true">
                  {segmentId && !segmentName ? "找不到指定分眾" : keyword ? "查無符合的顧客" : segmentId ? "此分眾目前沒有顧客" : "尚無顧客"}
                </td>
              </tr>
            )}
            {patients.map((p) => {
              const c = counts.get(p.id) ?? { all: 0, noShow: 0 };
              const blocked = isBlocked(p);
              const tags = (p.tags ?? "")
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean);
              return (
                <tr key={p.id}>
                  <td className="font-medium text-slate-800" data-label="姓名">{p.name}</td>
                  <td className="text-slate-500" data-label="電話">{p.phone}</td>
                  <td className="text-slate-500" data-label="性別">{p.gender || "未填"}</td>
                  <td className="whitespace-nowrap text-slate-500" data-label="生日">{p.birthday ? p.birthday.replaceAll("-", "/") : "未填"}</td>
                  <td data-label="標籤">
                    <div className="flex flex-wrap gap-1">
                      {tags.slice(0, 3).map((t) => (
                        <span key={t} className="badge bg-brand-50 text-brand-700">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-slate-500" data-label="預約">{c.all}</td>
                  <td className={c.noShow >= 3 ? "font-semibold text-red-600" : "text-slate-500"} data-label="未到">
                    {c.noShow}
                  </td>
                  <td data-label="狀態">
                    {blocked ? (
                      <span className="badge bg-red-50 text-red-600">停權中</span>
                    ) : (
                      <span className="badge bg-accent-500/10 text-accent-600">正常</span>
                    )}
                  </td>
                  <td data-label="會員等級">
                    {canManageMembershipLevels ? <form action={assignPatientMembershipLevelAction} className="flex min-w-52 items-center gap-2"><input type="hidden" name="patient_id" value={p.id} /><select className="input py-1.5 text-xs" name="level_id" defaultValue={p.membership_level_id ?? ""}><option value="">一般顧客</option>{activeLevelRows.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select><SubmitButton className="btn btn-secondary px-2 py-1.5 text-xs">儲存</SubmitButton></form> : <span className="text-slate-500">{p.membership_level_id ? levelName.get(p.membership_level_id) ?? "會員" : "一般顧客"}</span>}
                  </td>
                  <td data-label="操作">
                    <div className="flex items-center gap-3">
                      <Link
                        href={listHref({ keyword, page, segmentId, patientId: p.id })}
                        className="btn btn-secondary px-3 py-1.5 text-xs"
                      >
                        詳情
                      </Link>
                      <DeletePatientButton id={p.id} name={p.name} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!keyword && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/admin/patients?page=${page - 1}${segmentId ? `&segment_id=${encodeURIComponent(segmentId)}` : ""}`} className="btn btn-secondary px-3 py-1.5">
              上一頁
            </Link>
          ) : (
            <span className="text-slate-300">上一頁</span>
          )}
          <span className="text-slate-500">
            {page} / {totalPages}(共 {total} 位)
          </span>
          {page < totalPages ? (
            <Link href={`/admin/patients?page=${page + 1}${segmentId ? `&segment_id=${encodeURIComponent(segmentId)}` : ""}`} className="btn btn-secondary px-3 py-1.5">
              下一頁
            </Link>
          ) : (
            <span className="text-slate-300">下一頁</span>
          )}
        </div>
      )}

      {selectedPatient && (
        <AdminModal
          title="顧客詳情"
          description="不離開顧客名單即可修改基本資料、會員等級並查看近期預約與課程報名。"
          closeHref={closeDetailHref}
          size="wide"
        >
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
            <form action={updatePatientDetailsAction} className="space-y-4 p-5">
              <input type="hidden" name="id" value={selectedPatient.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm"><span className="label">姓名</span><input name="name" defaultValue={selectedPatient.name} required maxLength={120} className="input" /></label>
                <label className="text-sm"><span className="label">電話</span><input name="phone" defaultValue={selectedPatient.phone} required maxLength={30} className="input" /></label>
                <label className="text-sm"><span className="label">Email</span><input type="email" name="email" defaultValue={selectedPatient.email ?? ""} maxLength={200} className="input" /></label>
                <label className="text-sm"><span className="label">生日</span><input type="date" name="birthday" defaultValue={selectedPatient.birthday ?? ""} className="input" /></label>
                <label className="text-sm"><span className="label">性別</span><select name="gender" defaultValue={selectedPatient.gender ?? ""} className="input"><option value="">未填</option><option value="女">女</option><option value="男">男</option><option value="其他">其他</option></select></label>
                {canManageMembershipLevels && (
                  <label className="text-sm"><span className="label">會員等級</span><select name="membership_level_id" defaultValue={selectedPatient.membership_level_id ?? ""} className="input"><option value="">一般顧客</option>{activeLevelRows.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
                )}
                <label className="text-sm sm:col-span-2"><span className="label">標籤</span><input name="tags" defaultValue={selectedPatient.tags ?? ""} maxLength={1000} placeholder="例如：長期會員，偏好晚間" className="input" /><span className="help-text block">多個標籤請用逗號分隔。</span></label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="marketing_opt_in" defaultChecked={selectedPatient.marketing_opt_in} className="h-4 w-4 accent-brand-600" />同意接收行銷訊息</label>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                {canManageMembershipLevels && <Link href="/admin/membership-levels" className="admin-inline-action text-brand-700">管理會員等級</Link>}
                <div className="ml-auto flex gap-2"><Link href={closeDetailHref} className="btn btn-secondary">取消</Link><SubmitButton className="btn btn-primary">儲存顧客資料</SubmitButton></div>
              </div>
            </form>

            <aside className="space-y-5 border-t border-slate-200 bg-slate-50/70 p-5 lg:border-l lg:border-t-0">
              <div>
                <p className="eyebrow">顧客摘要</p>
                <p className="mt-1 text-sm text-slate-500">建檔日期 {formatDateTime(selectedPatient.created_at)}</p>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden border border-slate-200 bg-slate-200 text-sm"><div className="bg-white p-3"><dt className="text-xs text-slate-500">性別</dt><dd className="mt-1 font-medium text-slate-800">{selectedPatient.gender || "未填"}</dd></div><div className="bg-white p-3"><dt className="text-xs text-slate-500">生日</dt><dd className="mt-1 font-medium text-slate-800">{selectedPatient.birthday?.replaceAll("-", "/") || "未填"}</dd></div><div className="bg-white p-3"><dt className="text-xs text-slate-500">會員等級</dt><dd className="mt-1 font-medium text-slate-800">{selectedPatient.membership_level_id ? levelName.get(selectedPatient.membership_level_id) ?? "會員" : "一般顧客"}</dd></div><div className="bg-white p-3"><dt className="text-xs text-slate-500">行銷通知</dt><dd className="mt-1 font-medium text-slate-800">{selectedPatient.marketing_opt_in ? "已同意" : "未同意"}</dd></div></dl>
              <div><h3 className="text-sm font-semibold text-slate-800">近期預約</h3>
              {recentAppointments.length === 0 ? (
                <p className="mt-2 border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">目前沒有預約紀錄。</p>
              ) : (
                <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                  {recentAppointments.map((appointment) => (
                    <div key={appointment.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-3 text-sm">
                      <span className="font-medium text-slate-800">{formatDateTime(appointment.start_at)}</span>
                      <span className="justify-self-end text-xs text-slate-500">{APPOINTMENT_STATUS[appointment.status] ?? appointment.status}</span>
                      <span className="col-span-2 text-slate-600">{one(appointment.services)?.name ?? "未指定服務"}{one(appointment.doctors)?.name ? ` · ${one(appointment.doctors)?.name}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              </div>
              <div><h3 className="text-sm font-semibold text-slate-800">近期課程／活動報名</h3>{recentRegistrations.length === 0 ? <p className="mt-2 border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">目前沒有報名紀錄。</p> : <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">{recentRegistrations.map((registration) => { const session = one(registration.event_sessions); return <div key={registration.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-3 text-sm"><span className="font-medium text-slate-800">{one(registration.events)?.title ?? session?.name ?? "課程／活動"}</span><span className="text-xs text-slate-500">{REGISTRATION_STATUS[registration.status] ?? registration.status}</span><span className="col-span-2 text-slate-600">{formatDateTime(session?.start_at ?? registration.created_at)}</span></div>; })}</div>}</div>
            </aside>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
