import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { requireMember, canViewSensitiveCustomerData } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { DeletePatientButton } from "./DeletePatientButton";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";
import { assignPatientMembershipLevelAction } from "../memberships/actions";

export const dynamic = "force-dynamic";

interface Patient {
  id: string;
  name: string;
  phone: string;
  tags: string | null;
  blocked_until: string | null;
  membership_level_id: string | null;
  created_at: string;
}

interface MembershipLevel { id: string; name: string; active: boolean; }

const PAGE_SIZE = 30;
const SELECT = "id, name, phone, tags, blocked_until, membership_level_id, created_at";

function isBlocked(p: Patient): boolean {
  return !!p.blocked_until && new Date(p.blocked_until) > new Date();
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; segment_id?: string }>;
}) {
  const { q, page: pageStr, segment_id: segmentIdParam } = await searchParams;
  const keyword = (q ?? "").trim().replace(/[,%()*]/g, "");
  const page = Math.max(1, Number(pageStr) || 1);
  const segmentId = (segmentIdParam ?? "").trim();

  const { clinicId, role } = await requireMember();
  if (!canViewSensitiveCustomerData(role)) {
    return <p className="card p-6 text-sm text-slate-500">目前角色只能查看被分配的工作，不開放完整顧客名單。</p>;
  }
  const supabase = await createSupabaseServer();
  const canManageMembershipLevels = role === "owner" || role === "admin";
  const { data: membershipLevels, error: membershipLevelsError } = canManageMembershipLevels
    ? await supabase.from("membership_levels").select("id, name, active").eq("clinic_id", clinicId).order("sort_order").order("name")
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div><p className="eyebrow">顧客與會員</p><h1 className="admin-page-title">{segmentName ? `分眾顧客：${segmentName}` : "顧客名單"}</h1><p className="admin-page-description">集中搜尋顧客、查看預約紀錄、標籤與可服務狀態。</p></div>
        {segmentId && <Link href="/admin/patients" className="btn btn-ghost text-sm">清除分眾篩選</Link>}
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

      <div className="admin-table-shell admin-table-mobile-cards">
        <table className="tbl">
          <thead>
            <tr>
              <th>姓名</th>
              <th>電話</th>
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
                <td colSpan={8} className="py-8 text-center text-slate-400" data-mobile-empty="true">
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
                    {canManageMembershipLevels ? <form action={assignPatientMembershipLevelAction} className="flex min-w-52 items-center gap-2"><input type="hidden" name="patient_id" value={p.id} /><select className="input py-1.5 text-xs" name="level_id" defaultValue={p.membership_level_id ?? ""}><option value="">一般顧客</option>{levelRows.filter((level) => level.active).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select><SubmitButton className="btn btn-secondary px-2 py-1.5 text-xs">儲存</SubmitButton></form> : <span className="text-slate-500">{p.membership_level_id ? levelName.get(p.membership_level_id) ?? "會員" : "一般顧客"}</span>}
                  </td>
                  <td data-label="操作">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/patients/${p.id}`}
                        className="admin-inline-action text-brand-700"
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
    </div>
  );
}
