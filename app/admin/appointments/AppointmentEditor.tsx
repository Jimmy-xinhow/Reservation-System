import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import { formatTime } from "@/lib/slots";
import BookingForm from "../_components/BookingForm";
import { createAppointmentAction, rescheduleAppointmentAction } from "../appointment-actions";
import { AdminModal } from "@/components/AdminModal";

interface BookingField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
}

interface AppointmentRow {
  id: string;
  doctor_id: string | null;
  service_id: string | null;
  start_at: string;
  status: string;
  patients: { name: string } | { name: string }[] | null;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function validDate(value?: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function safeReturn(value?: string): string {
  return value?.startsWith("/admin") && !value.startsWith("//") ? value : "/admin";
}

export default async function AppointmentEditor({
  appointmentId,
  date,
  returnTo,
  variant = "page",
}: {
  appointmentId?: string;
  date?: string;
  returnTo?: string;
  variant?: "page" | "modal";
}) {
  const member = await requireOperator();
  const supabase = member.supabase;
  const service = createServiceClient();
  const [settingsResult, doctorsResult, servicesResult, clinicResult, appointmentResult] = await Promise.all([
    supabase.from("clinic_settings").select("booking_mode").eq("clinic_id", member.clinicId).maybeSingle(),
    supabase.from("doctors").select("id, name").eq("clinic_id", member.clinicId).eq("active", true).order("name"),
    supabase.from("services").select("id, name, booking_target, booking_fields").eq("clinic_id", member.clinicId).eq("active", true).order("created_at"),
    service.from("clinics").select("slug").eq("id", member.clinicId).maybeSingle(),
    appointmentId
      ? supabase
          .from("appointments")
          .select("id, doctor_id, service_id, start_at, status, patients(name)")
          .eq("id", appointmentId)
          .eq("clinic_id", member.clinicId)
          .in("status", ["booked", "confirmed"])
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const firstError = [settingsResult.error, doctorsResult.error, servicesResult.error, clinicResult.error, appointmentResult.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);
  if (appointmentId && !appointmentResult.data) notFound();

  const mode = settingsResult.data?.booking_mode === "number" ? "number" : "time";
  const current = appointmentResult.data as unknown as AppointmentRow | null;
  const customer = current ? one(current.patients)?.name ?? "顧客" : "";
  const defaultDate = validDate(date) ?? (current ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(current.start_at)) : undefined);
  const appointments = current
    ? [{ id: current.id, doctor_id: current.doctor_id, service_id: current.service_id, label: `${customer} ${formatTime(current.start_at)}` }]
    : [];

  const form = (doctorsResult.data ?? []).length === 0 && (servicesResult.data ?? []).length === 0 ? (
    <section className="admin-section p-5 text-sm text-slate-600">尚未建立服務、人員或排程，請先完成服務排程設定。</section>
  ) : (
    <BookingForm
      mode={mode}
      doctors={doctorsResult.data ?? []}
      services={(servicesResult.data ?? []) as unknown as Array<{ id: string; name: string; booking_target?: "provider_required" | "provider_optional" | "resource_only"; booking_fields?: BookingField[] }>}
      appointments={appointments}
      clinicSlug={clinicResult.data?.slug}
      defaultDate={defaultDate}
      initialTargetId={current?.id}
      returnTo={safeReturn(returnTo)}
      createAction={createAppointmentAction}
      rescheduleAction={rescheduleAppointmentAction}
      embedded={variant === "modal"}
    />
  );

  if (variant === "modal") {
    return (
      <AdminModal
        title={current ? `改期 · ${customer}` : "新增預約"}
        description={current ? "選擇新的日期與時段，原預約會保留為取消紀錄。" : "輸入顧客、服務與時段後直接儲存。"}
        closeHref={safeReturn(returnTo)}
        size="wide"
      >
        {form}
      </AdminModal>
    );
  }

  return (
    <div className="admin-page appointment-editor-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">預約營運</p>
          <h1 className="admin-page-title">{current ? `改期 · ${customer}` : "新增預約"}</h1>
          <p className="admin-page-description">在單一畫面完成資料輸入與時段確認，儲存後回到原工作頁。</p>
        </div>
        <Link href={safeReturn(returnTo)} className="btn btn-secondary">← 返回</Link>
      </div>

      {form}
    </div>
  );
}
