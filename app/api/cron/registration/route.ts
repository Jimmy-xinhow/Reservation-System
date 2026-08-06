import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { processRegistrationNotificationQueue } from "@/lib/registration-notifications";
import { processAppointmentNotificationQueue } from "@/lib/appointment-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  try {
    const svc = createServiceClient();
    const { data, error } = await svc.rpc("expire_registration_payments");
    if (error) throw new Error(error.message);
    const { data: releasedBenefits, error: benefitError } = await svc.rpc("release_expired_registration_benefits");
    if (benefitError) throw new Error(benefitError.message);
    const { data: expiredAppointments, error: appointmentExpiryError } = await svc.rpc("expire_pending_appointment_deposits");
    if (appointmentExpiryError) throw new Error(appointmentExpiryError.message);
    const { data: expiredMembershipPayments, error: membershipExpiryError } = await svc.rpc("expire_pending_membership_payments");
    if (membershipExpiryError) throw new Error(membershipExpiryError.message);
    const notifications = await processRegistrationNotificationQueue(svc);
    const appointmentNotifications = await processAppointmentNotificationQueue(svc);
    return Response.json({ ok: true, expired: Number(data ?? 0), expired_appointments: Number(expiredAppointments ?? 0), expired_membership_payments: Number(expiredMembershipPayments ?? 0), released_benefits: Number(releasedBenefits ?? 0), notifications, appointment_notifications: appointmentNotifications });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "報名付款逾時處理失敗" }, { status: 500 });
  }
}
