import { requireOperator } from "@/lib/admin";
import { formatDateTime } from "@/lib/slots";
import { createServiceClient } from "@/lib/supabase";
import { createTreatmentRecordAction } from "../../beauty/actions";
import { TreatmentRecordForm, type OperationFocus, type ServiceRecordSourceOption } from "../../beauty/TreatmentRecordForm";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

interface AppointmentRow { id: string; start_at: string; status: string; patients: Relation<{ name: string }>; services: Relation<{ name: string }>; }
interface RegistrationRow { id: string; created_at: string; status: string; patients: Relation<{ name: string }>; events: Relation<{ title: string }>; event_sessions: Relation<{ name: string; start_at: string }>; }
interface RecordRow {
  id: string;
  treatment_name: string | null;
  assessment: string | null;
  content: string;
  aftercare: string | null;
  private_photo_paths: string[];
  created_at: string;
  patients: Relation<{ name: string }>;
  appointments: Relation<{ start_at: string; services: Relation<{ name: string }> }>;
  registrations: Relation<{ created_at: string; events: Relation<{ title: string }>; event_sessions: Relation<{ name: string; start_at: string }> }>;
}

export default async function ServiceRecordsPage() {
  const member = await requireOperator();
  const service = createServiceClient();
  const [appointmentsResult, registrationsResult, recordsResult, settingsResult] = await Promise.all([
    service.from("appointments").select("id, start_at, status, patients(name), services(name)").eq("clinic_id", member.clinicId).order("start_at", { ascending: false }).limit(150),
    service.from("registrations").select("id, created_at, status, patients(name), events(title), event_sessions(name,start_at)").eq("clinic_id", member.clinicId).not("patient_id", "is", null).order("created_at", { ascending: false }).limit(150),
    service.from("patient_records").select("id, treatment_name, assessment, content, aftercare, private_photo_paths, created_at, patients(name), appointments(start_at,services(name)), registrations(created_at,events(title),event_sessions(name,start_at))").eq("clinic_id", member.clinicId).in("record_type", ["beauty_treatment", "service_record"]).order("created_at", { ascending: false }).limit(60),
    service.from("clinic_settings").select("dashboard_focus").eq("clinic_id", member.clinicId).maybeSingle(),
  ]);
  const firstError = [appointmentsResult, registrationsResult, recordsResult, settingsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const appointments = (appointmentsResult.data ?? []) as unknown as AppointmentRow[];
  const registrations = (registrationsResult.data ?? []) as unknown as RegistrationRow[];
  const records = (recordsResult.data ?? []) as unknown as RecordRow[];
  const focus = (["booking", "registration", "mixed"].includes(String(settingsResult.data?.dashboard_focus)) ? settingsResult.data?.dashboard_focus : "mixed") as OperationFocus;
  const sources: ServiceRecordSourceOption[] = [
    ...appointments.filter((item) => item.status !== "cancelled").map((item) => ({ id: item.id, kind: "appointment" as const, label: `${formatDateTime(item.start_at)}｜${one(item.patients)?.name ?? "顧客"}｜${one(item.services)?.name ?? "服務"}` })),
    ...registrations.filter((item) => !["cancelled", "waitlisted"].includes(item.status)).map((item) => { const session = one(item.event_sessions); return { id: item.id, kind: "registration" as const, label: `${formatDateTime(session?.start_at ?? item.created_at)}｜${one(item.patients)?.name ?? "學員"}｜${one(item.events)?.title ?? session?.name ?? "課程／活動"}` }; }),
  ];
  const allPaths = [...new Set(records.flatMap((record) => record.private_photo_paths ?? []))];
  const signedResult = allPaths.length > 0 ? await service.storage.from("customer-media").createSignedUrls(allPaths, 3600) : { data: [], error: null };
  const signed = new Map((signedResult.data ?? []).map((item) => [item.path, item.signedUrl]));

  return <div className="admin-page">
    <header className="admin-page-header"><div><p className="eyebrow">營運中心</p><h1 className="admin-page-title">服務過程紀錄</h1><p className="admin-page-description">同時支援預約服務、課程與活動報名；欄位會依品牌主軸及所選來源調整，不再限定美業或預約流程。</p></div></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(340px,.72fr)_minmax(0,1.28fr)]">
      <TreatmentRecordForm sources={sources} focus={focus} action={createTreatmentRecordAction} />
      <section className="admin-section overflow-hidden"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">近期紀錄</h2><p className="mt-0.5 text-xs text-slate-500">最近 {records.length} 筆服務／課程紀錄</p></div></div>
        {records.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">尚未建立服務過程紀錄。</p> : <div className="divide-y divide-slate-200">{records.map((record) => { const appointment = one(record.appointments); const registration = one(record.registrations); const session = one(registration?.event_sessions ?? null); const isCourse = Boolean(registration); const sourceName = isCourse ? one(registration?.events ?? null)?.title ?? session?.name ?? "課程／活動" : one(appointment?.services ?? null)?.name ?? "預約服務"; const sourceTime = session?.start_at ?? appointment?.start_at ?? registration?.created_at ?? record.created_at; return <article key={record.id} className="space-y-3 px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{record.treatment_name ?? "服務過程紀錄"}</h3><p className="mt-1 text-sm text-slate-500">{one(record.patients)?.name ?? (isCourse ? "學員" : "顧客")} · {sourceName} · {formatDateTime(sourceTime)}</p></div><span className="badge bg-slate-100 text-slate-600">{isCourse ? "課程／活動" : "預約服務"}</span></div>{record.assessment && <p className="text-sm leading-6 text-slate-600"><strong className="text-slate-800">{isCourse ? "課前狀況：" : "服務前："}</strong>{record.assessment}</p>}<p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.content}</p>{record.aftercare && <p className="border-l-2 border-brand-500 bg-brand-50 px-3 py-2 text-sm leading-6 text-brand-800"><strong>{isCourse ? "練習與下次建議：" : "後續建議："}</strong>{record.aftercare}</p>}{record.private_photo_paths.length > 0 && <div className="flex flex-wrap gap-2">{record.private_photo_paths.map((path) => { const url = signed.get(path); return typeof url === "string" ? <a key={path} href={url} target="_blank" rel="noreferrer"><img src={url} alt="私密過程圖片" className="h-20 w-20 rounded object-cover" /></a> : null; })}</div>}</article>; })}</div>}
      </section>
    </div>
  </div>;
}
