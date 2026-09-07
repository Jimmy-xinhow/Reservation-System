import Link from "next/link";
import { requireOperator } from "@/lib/admin";
import { formatDateTime } from "@/lib/slots";
import { createServiceClient } from "@/lib/supabase";
import { createTreatmentRecordAction } from "../../beauty/actions";
import { TreatmentRecordForm, type BeautyAppointmentOption } from "../../beauty/TreatmentRecordForm";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

interface AppointmentRow {
  id: string;
  start_at: string;
  status: string;
  patients: Relation<{ name: string }>;
  services: Relation<{ name: string }>;
}
interface RecordRow {
  id: string;
  treatment_name: string | null;
  assessment: string | null;
  content: string;
  aftercare: string | null;
  private_photo_paths: string[];
  created_at: string;
  patients: Relation<{ name: string }>;
  appointments: Relation<{ start_at: string }>;
}

export default async function ServiceRecordsPage() {
  const member = await requireOperator();
  const service = createServiceClient();
  const [{ data: appointments, error: appointmentsError }, { data: records, error: recordsError }] = await Promise.all([
    service.from("appointments").select("id, start_at, status, patients(name), services(name)").eq("clinic_id", member.clinicId).order("start_at", { ascending: false }).limit(150),
    service.from("patient_records").select("id, treatment_name, assessment, content, aftercare, private_photo_paths, created_at, patients(name), appointments(start_at)").eq("clinic_id", member.clinicId).eq("record_type", "beauty_treatment").order("created_at", { ascending: false }).limit(60),
  ]);
  if (appointmentsError || recordsError) throw new Error(appointmentsError?.message ?? recordsError?.message ?? "讀取服務過程紀錄失敗");

  const appointmentRows = (appointments ?? []) as unknown as AppointmentRow[];
  const recordRows = (records ?? []) as unknown as RecordRow[];
  const allPaths = [...new Set(recordRows.flatMap((record) => record.private_photo_paths ?? []))];
  const signedResult = allPaths.length > 0 ? await service.storage.from("customer-media").createSignedUrls(allPaths, 3600) : { data: [], error: null };
  const signed = new Map((signedResult.data ?? []).map((item) => [item.path, item.signedUrl]));
  const appointmentOptions: BeautyAppointmentOption[] = appointmentRows
    .filter((appointment) => appointment.status !== "cancelled")
    .map((appointment) => ({
      id: appointment.id,
      label: `${formatDateTime(appointment.start_at)}｜${one(appointment.patients)?.name ?? "顧客"}｜${one(appointment.services)?.name ?? "服務"}`,
    }));

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div><p className="eyebrow">營運中心</p><h1 className="admin-page-title">服務過程紀錄</h1><p className="admin-page-description">獨立保存每次服務的觀察、執行內容、後續建議與私密照片，適用各種預約型產業。</p></div>
        <Link href="/admin/beauty" className="btn btn-secondary">返回營運總覽</Link>
      </header>
      <div className="grid gap-5 xl:grid-cols-[minmax(340px,.72fr)_minmax(0,1.28fr)]">
        <TreatmentRecordForm appointments={appointmentOptions} action={createTreatmentRecordAction} />
        <section className="admin-section overflow-hidden">
          <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">近期紀錄</h2><p className="mt-0.5 text-xs text-slate-500">最近 {recordRows.length} 筆服務紀錄</p></div></div>
          {recordRows.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">尚未建立服務過程紀錄。</p> : <div className="divide-y divide-slate-200">{recordRows.map((record) => (
            <article key={record.id} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{record.treatment_name ?? "服務過程紀錄"}</h3><p className="mt-1 text-sm text-slate-500">{one(record.patients)?.name ?? "顧客"} · {formatDateTime(one(record.appointments)?.start_at ?? record.created_at)}</p></div><span className="badge bg-slate-100 text-slate-600">私密紀錄</span></div>
              {record.assessment && <p className="text-sm leading-6 text-slate-600"><strong className="text-slate-800">服務前：</strong>{record.assessment}</p>}
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.content}</p>
              {record.aftercare && <p className="border-l-2 border-brand-500 bg-brand-50 px-3 py-2 text-sm leading-6 text-brand-800"><strong>後續建議：</strong>{record.aftercare}</p>}
              {record.private_photo_paths.length > 0 && <div className="flex flex-wrap gap-2">{record.private_photo_paths.map((path) => { const url = signed.get(path); return typeof url === "string" ? <a key={path} href={url} target="_blank" rel="noreferrer"><img src={url} alt="私密服務照片" className="h-20 w-20 rounded object-cover" /></a> : null; })}</div>}
            </article>
          ))}</div>}
        </section>
      </div>
    </div>
  );
}
