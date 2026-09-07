import Link from "next/link";
import { requireNonProvider } from "@/lib/admin";
import { AdminModal } from "@/components/AdminModal";
import CreateSalesOrderForm, { type CheckoutSourceOption } from "./CreateSalesOrderForm";

interface AppointmentOption { id: string; start_at: string; patients: { name: string } | { name: string }[] | null; services: { name: string; price: number } | { name: string; price: number }[] | null; }
interface RegistrationOption { id: string; registration_no: string; name: string; amount: number; events: { title: string } | { title: string }[] | null; }
interface PatientOption { id: string; name: string; phone: string; }

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function dateTime(value: string): string { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

export default async function SalesOrderEditor({ appointmentId, registrationId, variant = "page" }: { appointmentId?: string; registrationId?: string; variant?: "page" | "modal" }) {
  const member = await requireNonProvider();
  const supabase = member.supabase;
  const [appointmentsResult, registrationsResult, patientsResult] = await Promise.all([
    supabase.from("appointments").select("id, start_at, patients(name), services(name, price)").eq("clinic_id", member.clinicId).in("status", ["booked", "confirmed", "done"]).order("start_at", { ascending: false }).limit(250),
    supabase.from("registrations").select("id, registration_no, name, amount, events(title)").eq("clinic_id", member.clinicId).in("status", ["pending", "confirmed", "attended"]).order("created_at", { ascending: false }).limit(250),
    supabase.from("patients").select("id, name, phone").eq("clinic_id", member.clinicId).eq("active", true).order("name").limit(500),
  ]);
  const firstError = [appointmentsResult.error, registrationsResult.error, patientsResult.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);
  const appointments = [...((appointmentsResult.data ?? []) as unknown as AppointmentOption[])];
  const registrations = [...((registrationsResult.data ?? []) as unknown as RegistrationOption[])];
  const patients = (patientsResult.data ?? []) as PatientOption[];
  if (appointmentId && !appointments.some((row) => row.id === appointmentId)) {
    const { data, error } = await supabase.from("appointments").select("id, start_at, patients(name), services(name, price)").eq("clinic_id", member.clinicId).eq("id", appointmentId).in("status", ["booked", "confirmed", "done"]).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) appointments.unshift(data as unknown as AppointmentOption);
  }
  if (registrationId && !registrations.some((row) => row.id === registrationId)) {
    const { data, error } = await supabase.from("registrations").select("id, registration_no, name, amount, events(title)").eq("clinic_id", member.clinicId).eq("id", registrationId).in("status", ["pending", "confirmed", "attended"]).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) registrations.unshift(data as unknown as RegistrationOption);
  }
  const options: CheckoutSourceOption[] = [
    ...appointments.map((appointment) => { const patient = one(appointment.patients); const service = one(appointment.services); return { value: `appointment:${appointment.id}`, kind: "appointment" as const, label: `${dateTime(appointment.start_at)} · ${patient?.name ?? "顧客"} · ${service?.name ?? "一般服務"}`, amount: Number(service?.price ?? 0) }; }),
    ...registrations.map((registration) => ({ value: `registration:${registration.id}`, kind: "registration" as const, label: `${registration.registration_no} · ${registration.name} · ${one(registration.events)?.title ?? "活動"}`, amount: Number(registration.amount) })),
    ...patients.map((patient) => ({ value: `patient:${patient.id}`, kind: "patient" as const, label: `${patient.name} · ${patient.phone}`, amount: null })),
  ];
  const requestedSource = appointmentId ? `appointment:${appointmentId}` : registrationId ? `registration:${registrationId}` : "";
  const defaultSource = options.some((option) => option.value === requestedSource) ? requestedSource : "";
  const form = <CreateSalesOrderForm options={options} defaultSource={defaultSource} closeHref="/admin/checkout" embedded={variant === "modal"} />;
  if (variant === "modal") return <AdminModal title="建立銷售單" description="先選結帳來源與實際成交金額，建立後即可加入服務、商品或套票。" closeHref="/admin/checkout" size="wide">{form}</AdminModal>;
  return <div className="admin-page checkout-create-page"><div className="admin-page-header"><div><p className="eyebrow">結帳中心</p><h1 className="admin-page-title">建立銷售單</h1><p className="admin-page-description">單獨完成來源、成交金額與折扣設定，再進入品項與收款。</p></div><Link href="/admin/checkout" className="btn btn-secondary">← 返回結帳中心</Link></div>{form}</div>;
}
