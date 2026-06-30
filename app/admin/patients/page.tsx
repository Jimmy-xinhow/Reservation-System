import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { formatDateTime } from "@/lib/slots";

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
}
interface Appt {
  id: string;
  patient_id: string;
  start_at: string;
  status: string;
  queue_number: number | null;
  doctors: { name: string } | null;
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const keyword = (q ?? "").trim().replace(/[,%()*]/g, "");

  const supabase = await createSupabaseServer();
  let patients: Patient[] = [];
  let appts: Appt[] = [];

  if (keyword) {
    const { data: pData } = await supabase
      .from("patients")
      .select("id, name, phone")
      .eq("clinic_id", CLINIC_ID)
      .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`)
      .limit(50);
    patients = (pData ?? []) as Patient[];

    if (patients.length > 0) {
      const { data: aData } = await supabase
        .from("appointments")
        .select("id, patient_id, start_at, status, queue_number, doctors(name)")
        .eq("clinic_id", CLINIC_ID)
        .in(
          "patient_id",
          patients.map((p) => p.id),
        )
        .order("start_at", { ascending: false });
      appts = (aData ?? []) as unknown as Appt[];
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">病患查詢</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={keyword}
          placeholder="輸入姓名或電話"
          className="w-64 rounded border p-2 text-sm"
        />
        <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white">搜尋</button>
      </form>

      {keyword && patients.length === 0 && <p className="text-gray-400">查無符合的病患。</p>}

      <div className="space-y-4">
        {patients.map((p) => {
          const history = appts.filter((a) => a.patient_id === p.id);
          return (
            <div key={p.id} className="rounded-xl border bg-white p-4">
              <div className="mb-2 flex items-baseline gap-3">
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-gray-500">{p.phone}</span>
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-gray-400">無約診紀錄</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {history.map((a) => (
                    <li key={a.id} className="flex gap-3 text-gray-700">
                      <span>{formatDateTime(a.start_at)}</span>
                      <span>{a.doctors?.name}</span>
                      {a.queue_number != null && <span>第 {a.queue_number} 號</span>}
                      <span className="text-gray-500">{STATUS_LABEL[a.status] ?? a.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
