import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDateTime } from "@/lib/slots";
import { TreatmentRecordForm, type BeautyAppointmentOption } from "./TreatmentRecordForm";
import { createInventoryItemAction, createTreatmentRecordAction, recordInventoryMovementAction, saveCommissionRuleAction } from "./actions";

export const dynamic = "force-dynamic";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
interface AppointmentRow { id: string; patient_id: string; doctor_id: string | null; service_id: string | null; start_at: string; status: string; patients: Relation<{ name: string }>; doctors: Relation<{ name: string }>; services: Relation<{ name: string }>; }
interface RecordRow { id: string; treatment_name: string | null; assessment: string | null; content: string; aftercare: string | null; private_photo_paths: string[]; photo_consent: boolean; created_at: string; patients: Relation<{ name: string }>; appointments: Relation<{ start_at: string }>; }
interface InventoryRow { id: string; sku: string | null; name: string; unit: string; stock_on_hand: number; reorder_level: number; retail_price: number; active: boolean; }
interface MovementRow { id: string; kind: string; quantity: number; stock_after: number; note: string | null; created_at: string; inventory_items: Relation<{ name: string; unit: string }>; }
interface DoctorRow { id: string; name: string; }
interface ServiceRow { id: string; name: string; }
interface RuleRow { id: string; doctor_id: string; service_id: string | null; amount_per_service: number; doctors: Relation<{ name: string }>; services: Relation<{ name: string }>; }

const MOVEMENT_LABEL: Record<string, string> = { stock_in: "進貨", use: "療程使用", sale: "零售售出", waste: "報廢" };
const twd = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });

export default async function BeautyOperationsPage() {
  const member = await requireOperator();
  const { clinicId } = member;
  if (!(await isAdminModuleEnabled(member.supabase, clinicId, "beauty"))) return <ModuleDisabled title="美業營運尚未啟用" />;
  const service = createServiceClient();
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const [appointmentsResult, recordsResult, inventoryResult, movementsResult, doctorsResult, servicesResult, rulesResult, completedResult] = await Promise.all([
    service.from("appointments").select("id, patient_id, doctor_id, service_id, start_at, status, patients(name), doctors(name), services(name)").eq("clinic_id", clinicId).order("start_at", { ascending: false }).limit(100),
    service.from("patient_records").select("id, treatment_name, assessment, content, aftercare, private_photo_paths, photo_consent, created_at, patients(name), appointments(start_at)").eq("clinic_id", clinicId).eq("record_type", "beauty_treatment").order("created_at", { ascending: false }).limit(30),
    service.from("inventory_items").select("id, sku, name, unit, stock_on_hand, reorder_level, retail_price, active").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("inventory_movements").select("id, kind, quantity, stock_after, note, created_at, inventory_items(name, unit)").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(30),
    service.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("services").select("id, name").eq("clinic_id", clinicId).eq("active", true).order("name"),
    service.from("beauty_commission_rules").select("id, doctor_id, service_id, amount_per_service, doctors(name), services(name)").eq("clinic_id", clinicId).eq("active", true),
    service.from("appointments").select("id, doctor_id, service_id").eq("clinic_id", clinicId).eq("status", "done").gte("start_at", startOfMonth.toISOString()),
  ]);
  const firstError = [appointmentsResult, recordsResult, inventoryResult, movementsResult, doctorsResult, servicesResult, rulesResult, completedResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  const appointments = (appointmentsResult.data ?? []) as unknown as AppointmentRow[];
  const records = (recordsResult.data ?? []) as unknown as RecordRow[];
  const inventory = (inventoryResult.data ?? []) as InventoryRow[];
  const movements = (movementsResult.data ?? []) as unknown as MovementRow[];
  const doctors = (doctorsResult.data ?? []) as DoctorRow[];
  const services = (servicesResult.data ?? []) as ServiceRow[];
  const rules = (rulesResult.data ?? []) as unknown as RuleRow[];
  const completed = (completedResult.data ?? []) as Array<{ id: string; doctor_id: string | null; service_id: string | null }>;
  const allPaths = [...new Set(records.flatMap((record) => record.private_photo_paths ?? []))];
  const signedResult = allPaths.length > 0 ? await service.storage.from("customer-media").createSignedUrls(allPaths, 3600) : { data: [], error: null };
  const signed = new Map((signedResult.data ?? []).map((item) => [item.path, item.signedUrl]));
  const appointmentOptions: BeautyAppointmentOption[] = appointments.filter((appointment) => appointment.status !== "cancelled").map((appointment) => ({ id: appointment.id, label: `${formatDateTime(appointment.start_at)}｜${one(appointment.patients)?.name ?? "顧客"}｜${one(appointment.services)?.name ?? "服務"}` }));
  const commissionRows = doctors.map((doctor) => {
    const doctorCompleted = completed.filter((appointment) => appointment.doctor_id === doctor.id);
    const amount = doctorCompleted.reduce((sum, appointment) => {
      const specific = rules.find((rule) => rule.doctor_id === doctor.id && rule.service_id === appointment.service_id);
      const general = rules.find((rule) => rule.doctor_id === doctor.id && rule.service_id === null);
      return sum + Number(specific?.amount_per_service ?? general?.amount_per_service ?? 0);
    }, 0);
    return { doctor, count: doctorCompleted.length, amount };
  });

  return <div className="space-y-8">
    <header><div className="eyebrow">可選產業模組</div><h1 className="text-2xl font-bold text-slate-900">美業營運</h1><p className="mt-1 text-sm leading-6 text-slate-500">療程紀錄、私密照片、耗材庫存與服務獎金試算集中管理。這裡不包含會計、發票或完整 POS 結帳。</p></header>
    <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
      <TreatmentRecordForm appointments={appointmentOptions} action={createTreatmentRecordAction} />
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-900">近期療程紀錄</h2></div>
        {records.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">尚未建立療程紀錄。</p> : <div className="divide-y divide-slate-100">{records.map((record) => (
          <article key={record.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{record.treatment_name ?? "療程紀錄"}</h3><p className="mt-1 text-sm text-slate-500">{one(record.patients)?.name ?? "顧客"} · {formatDateTime(one(record.appointments)?.start_at ?? record.created_at)}</p></div><span className="badge bg-slate-100 text-slate-600">私密紀錄</span></div>
            {record.assessment && <p className="text-sm leading-6 text-slate-600"><strong className="text-slate-800">服務前：</strong>{record.assessment}</p>}
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.content}</p>
            {record.aftercare && <p className="rounded-xl bg-brand-50 p-3 text-sm leading-6 text-brand-800"><strong>居家照護：</strong>{record.aftercare}</p>}
            {record.private_photo_paths.length > 0 && <div className="flex flex-wrap gap-2">{record.private_photo_paths.map((path) => { const url = signed.get(path); return typeof url === "string" ? <a key={path} href={url} target="_blank" rel="noreferrer"><img src={url} alt="私密療程照片" className="h-20 w-20 rounded-lg object-cover" /></a> : null; })}</div>}
          </article>
        ))}</div>}
      </div>
    </section>

    <section className="space-y-5"><div><h2 className="text-xl font-bold text-slate-900">耗材與商品庫存</h2><p className="mt-1 text-sm text-slate-500">每次異動會保留進貨、使用、售出或報廢紀錄；低於安全量會標示提醒。</p></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]"><div className="card overflow-hidden"><div className="divide-y divide-slate-100">{inventory.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">尚未建立庫存品項。</p> : inventory.map((item) => <article key={item.id} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{item.name}</h3>{item.stock_on_hand <= item.reorder_level && <span className="badge bg-amber-50 text-amber-700">需要補貨</span>}</div><p className="mt-1 text-sm text-slate-500">{item.sku || "未設編號"} · 售價 {twd.format(item.retail_price)}</p><p className="mt-2 text-2xl font-bold text-slate-900">{item.stock_on_hand} <span className="text-sm font-normal text-slate-500">{item.unit}</span></p></div><form action={recordInventoryMovementAction} className="grid gap-2 sm:grid-cols-2"><input type="hidden" name="item_id" value={item.id} /><select name="kind" className="input"><option value="stock_in">進貨</option><option value="use">療程使用</option><option value="sale">零售售出</option><option value="waste">報廢</option></select><input type="number" name="quantity" min="0.01" step="0.01" required className="input" placeholder="數量" /><input name="note" className="input sm:col-span-2" maxLength={300} placeholder="備註（選填）" /><SubmitButton className="btn btn-primary sm:col-span-2">記錄異動</SubmitButton></form></article>)}</div></div><form action={createInventoryItemAction} className="card h-fit space-y-4 p-5"><h3 className="font-semibold text-slate-900">新增庫存品項</h3><label><span className="label">品項名稱</span><input name="name" className="input" required /></label><div className="grid grid-cols-2 gap-3"><label><span className="label">品項編號</span><input name="sku" className="input uppercase" /></label><label><span className="label">單位</span><input name="unit" defaultValue="件" className="input" /></label></div><div className="grid grid-cols-2 gap-3"><label><span className="label">目前數量</span><input type="number" step="0.01" min="0" name="stock_on_hand" defaultValue="0" className="input" /></label><label><span className="label">補貨提醒量</span><input type="number" step="0.01" min="0" name="reorder_level" defaultValue="3" className="input" /></label></div><label><span className="label">建議售價</span><input type="number" min="0" name="retail_price" defaultValue="0" className="input" /></label><SubmitButton className="btn btn-primary w-full">建立品項</SubmitButton></form></div>{movements.length > 0 && <div className="card overflow-hidden"><div className="border-b border-slate-100 p-5 font-semibold text-slate-900">最近庫存異動</div><div className="divide-y divide-slate-100">{movements.slice(0, 12).map((movement) => { const item = one(movement.inventory_items); return <div key={movement.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><span><strong className="text-slate-800">{item?.name ?? "品項"}</strong> · {MOVEMENT_LABEL[movement.kind] ?? movement.kind} {movement.quantity} {item?.unit ?? ""}</span><span className="text-slate-500">結餘 {movement.stock_after} · {formatDateTime(movement.created_at)}</span></div>; })}</div></div>}</section>

    <section className="space-y-5"><div><h2 className="text-xl font-bold text-slate-900">服務獎金試算</h2><p className="mt-1 text-sm leading-6 text-slate-500">以本月「已完成」預約乘上固定單次獎金。這是內部營運試算，不是薪資、稅務或會計結算。</p></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]"><div className="grid gap-3 sm:grid-cols-2">{commissionRows.map(({ doctor, count, amount }) => <article key={doctor.id} className="card p-5"><p className="text-sm text-slate-500">{doctor.name}</p><p className="mt-2 text-2xl font-bold text-slate-900">{twd.format(amount)}</p><p className="mt-1 text-sm text-slate-500">本月完成 {count} 次服務</p></article>)}</div><form action={saveCommissionRuleAction} className="card h-fit space-y-4 p-5"><h3 className="font-semibold text-slate-900">設定固定單次獎金</h3><label><span className="label">服務人員</span><select name="doctor_id" className="input" required defaultValue=""><option value="" disabled>請選擇</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label><label><span className="label">指定服務（留空代表通用）</span><select name="service_id" className="input" defaultValue=""><option value="">所有服務</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="label">每次完成獎金（元）</span><input type="number" min="0" name="amount_per_service" className="input" required /></label><SubmitButton className="btn btn-primary w-full">儲存試算規則</SubmitButton>{rules.length > 0 && <div className="space-y-2 border-t border-slate-100 pt-4 text-sm">{rules.map((rule) => <p key={rule.id} className="flex justify-between gap-3"><span>{one(rule.doctors)?.name} · {one(rule.services)?.name ?? "所有服務"}</span><strong>{twd.format(rule.amount_per_service)}</strong></p>)}</div>}</form></div></section>
  </div>;
}
