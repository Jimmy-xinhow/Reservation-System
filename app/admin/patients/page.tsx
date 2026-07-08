import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";
import { DeletePatientButton } from "./DeletePatientButton";

export const dynamic = "force-dynamic";

interface Patient {
  id: string;
  name: string;
  phone: string;
  tags: string | null;
  blocked_until: string | null;
  created_at: string;
}

const PAGE_SIZE = 30;
const SELECT = "id, name, phone, tags, blocked_until, created_at";

function isBlocked(p: Patient): boolean {
  return !!p.blocked_until && new Date(p.blocked_until) > new Date();
}

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
      .limit(100);
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

  // 各病患的約診/未到統計
  const counts = new Map<string, { all: number; noShow: number }>();
  if (patients.length > 0) {
    const { data: appts } = await supabase
      .from("appointments")
      .select("patient_id, status")
      .eq("clinic_id", CLINIC_ID)
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
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">病患查詢</h1>

      <form className="flex gap-2">
        <input name="q" defaultValue={keyword} placeholder="輸入姓名或電話" className="input max-w-xs" />
        <SubmitButton className="btn btn-primary">搜尋</SubmitButton>
        {keyword && (
          <Link href="/admin/patients" className="btn btn-ghost">
            清除
          </Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>姓名</th>
              <th>電話</th>
              <th>標籤</th>
              <th>約診</th>
              <th>未到</th>
              <th>狀態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patients.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  {keyword ? "查無符合的病患" : "尚無病患"}
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
                  <td className="font-medium text-slate-800">{p.name}</td>
                  <td className="text-slate-500">{p.phone}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {tags.slice(0, 3).map((t) => (
                        <span key={t} className="badge bg-brand-50 text-brand-700">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-slate-500">{c.all}</td>
                  <td className={c.noShow >= 3 ? "font-semibold text-red-600" : "text-slate-500"}>
                    {c.noShow}
                  </td>
                  <td>
                    {blocked ? (
                      <span className="badge bg-red-50 text-red-600">停權中</span>
                    ) : (
                      <span className="badge bg-accent-500/10 text-accent-600">正常</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/patients/${p.id}`}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        詳情
                      </Link>
                      {c.all === 0 && <DeletePatientButton id={p.id} name={p.name} />}
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
