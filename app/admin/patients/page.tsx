import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { formatDateTime } from "@/lib/slots";
import { updatePatientAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  cancelled: "已取消",
  done: "完成",
  no_show: "未到",
};

interface Patient {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  tags: string | null;
  birthday: string | null;
  gender: string | null;
  email: string | null;
  marketing_opt_in: boolean;
  created_at: string;
}
interface Appt {
  id: string;
  patient_id: string;
  start_at: string;
  status: string;
  queue_number: number | null;
  doctors: { name: string } | null;
  services: { name: string } | null;
}

const PAGE_SIZE = 20;
const SELECT = "id, name, phone, note, tags, birthday, gender, email, marketing_opt_in, created_at";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageStr } = await searchParams;
  const keyword = (q ?? "").trim().replace(/[,%()*]/g, "");
  const page = Math.max(1, Number(pageStr) || 1);

  const supabase = await createSupabaseServer();

  let patients: Patient[] = [];
  let total = 0;
  if (keyword) {
    const { data } = await supabase
      .from("patients")
      .select(SELECT)
      .eq("clinic_id", CLINIC_ID)
      .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`)
      .order("created_at", { ascending: false })
      .limit(50);
    patients = (data ?? []) as Patient[];
  } else {
    const { data, count } = await supabase
      .from("patients")
      .select(SELECT, { count: "exact" })
      .eq("clinic_id", CLINIC_ID)
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    patients = (data ?? []) as Patient[];
    total = count ?? 0;
  }

  let appts: Appt[] = [];
  if (patients.length > 0) {
    const { data } = await supabase
      .from("appointments")
      .select("id, patient_id, start_at, status, queue_number, doctors(name), services(name)")
      .eq("clinic_id", CLINIC_ID)
      .in(
        "patient_id",
        patients.map((p) => p.id),
      )
      .order("start_at", { ascending: false });
    appts = (data ?? []) as unknown as Appt[];
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">病患查詢</h1>

      <form className="flex gap-2">
        <input name="q" defaultValue={keyword} placeholder="輸入姓名或電話" className="input max-w-xs" />
        <button className="btn btn-primary">搜尋</button>
        {keyword && (
          <Link href="/admin/patients" className="btn btn-ghost">
            清除
          </Link>
        )}
      </form>

      {patients.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-slate-400">
          {keyword ? "查無符合的病患。" : "尚無病患。"}
        </p>
      )}

      <div className="space-y-4">
        {patients.map((p) => {
          const history = appts.filter((a) => a.patient_id === p.id);
          const tags = (p.tags ?? "")
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean);
          return (
            <div key={p.id} className="card p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-slate-900">{p.name}</span>
                <span className="text-sm text-slate-500">{p.phone}</span>
                {p.marketing_opt_in && (
                  <span className="badge bg-accent-500/10 text-accent-600">同意行銷</span>
                )}
                {tags.map((t) => (
                  <span key={t} className="badge bg-brand-50 text-brand-700">
                    {t}
                  </span>
                ))}
              </div>

              {/* 建檔記錄(可編輯) */}
              <details className="mb-3 rounded-xl border border-slate-200">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-600">
                  建檔記錄 / 行銷資訊
                </summary>
                <form action={updatePatientAction} className="space-y-3 border-t border-slate-100 p-3">
                  <input type="hidden" name="id" value={p.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-slate-600">生日</span>
                      <input type="date" name="birthday" defaultValue={p.birthday ?? ""} className="input" />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-slate-600">性別</span>
                      <select name="gender" defaultValue={p.gender ?? ""} className="input">
                        <option value="">未填</option>
                        <option value="男">男</option>
                        <option value="女">女</option>
                        <option value="其他">其他</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-slate-600">Email</span>
                      <input type="email" name="email" defaultValue={p.email ?? ""} className="input" />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-slate-600">標籤(逗號分隔)</span>
                      <input name="tags" defaultValue={p.tags ?? ""} placeholder="VIP, 慢性, 初診優惠" className="input" />
                    </label>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-600">備註 / 病況記錄</span>
                    <textarea name="note" rows={2} defaultValue={p.note ?? ""} className="input" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="marketing_opt_in"
                      defaultChecked={p.marketing_opt_in}
                      className="h-4 w-4 accent-brand-600"
                    />
                    同意接收行銷訊息
                  </label>
                  <button className="btn btn-primary">儲存建檔</button>
                </form>
              </details>

              {/* 約診歷史 */}
              {history.length === 0 ? (
                <p className="text-sm text-slate-400">無約診紀錄</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {history.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-slate-700">
                      <span className="font-medium">{formatDateTime(a.start_at)}</span>
                      <span className="text-slate-500">{a.doctors?.name}</span>
                      {a.services?.name && (
                        <span className="badge bg-slate-100 text-slate-600">{a.services.name}</span>
                      )}
                      {a.queue_number != null && (
                        <span className="text-slate-500">第 {a.queue_number} 號</span>
                      )}
                      <span className="badge ml-auto bg-slate-100 text-slate-600">
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* 分頁(僅瀏覽全部時) */}
      {!keyword && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/admin/patients?page=${page - 1}`} className="btn btn-secondary px-3 py-1.5">
              上一頁
            </Link>
          ) : (
            <span className="text-slate-300">上一頁</span>
          )}
          <span className="text-slate-500">
            {page} / {totalPages}(共 {total} 位)
          </span>
          {page < totalPages ? (
            <Link href={`/admin/patients?page=${page + 1}`} className="btn btn-secondary px-3 py-1.5">
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
