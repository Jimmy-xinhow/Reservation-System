import { readCronSelections } from "@/lib/cron-scope";
import { fail } from "@/lib/http";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { processRegistrationNotificationQueue } from "@/lib/registration-notifications";
import { processAppointmentNotificationQueue } from "@/lib/appointment-notifications";
import { processAppointmentWaitlistNotificationQueue } from "@/lib/appointment-waitlist-notifications";

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
    const { data: expiredWaitlistOffers, error: waitlistExpiryError } = await svc.rpc("expire_appointment_waitlist_offers");
    if (waitlistExpiryError) throw new Error(waitlistExpiryError.message);
    const notifications = await processRegistrationNotificationQueue(svc);
    const appointmentNotifications = await processAppointmentNotificationQueue(svc);
    const appointmentWaitlistNotifications = await processAppointmentWaitlistNotificationQueue(svc);
    return Response.json({ ok: notifications.failed === 0 && appointmentNotifications.failed === 0 && appointmentWaitlistNotifications.failed === 0, expired: Number(data ?? 0), expired_appointments: Number(expiredAppointments ?? 0), expired_membership_payments: Number(expiredMembershipPayments ?? 0), expired_waitlist_offers: Number(expiredWaitlistOffers ?? 0), released_benefits: Number(releasedBenefits ?? 0), notifications, appointment_notifications: appointmentNotifications, appointment_waitlist_notifications: appointmentWaitlistNotifications });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "報名付款逾時處理失敗", 500);
  }
}

interface ScopedResult {
  expired: number; expired_appointments: number; expired_membership_payments: number;
  expired_waitlist_offers: number; released_benefits: number;
  registration_ids: string[]; appointment_ids: string[]; waitlist_ids: string[];
}
export async function POST(req: NextRequest) {
  const scope = await readCronSelections(req, ["registration_ids", "appointment_ids", "membership_payment_ids", "waitlist_ids"], true);
  if (scope instanceof Response) return scope;
  try {
    const svc = createServiceClient();
    const { data, error } = await svc.rpc("process_registration_cron_scope", {
      p_clinic_id: scope.clinicId,
      p_registration_ids: scope.selections.registration_ids,
      p_appointment_ids: scope.selections.appointment_ids,
      p_membership_payment_ids: scope.selections.membership_payment_ids,
      p_waitlist_ids: scope.selections.waitlist_ids,
    });
    if (error) {
      if (error.code === "P0001" && error.message === "cron scope excludes affected waitlist") {
        return Response.json({ ok: false, error: "指定範圍未包含連動候補，期限處理已全部回滾" }, { status: 409 });
      }
      throw new Error(error.message);
    }
    const result = data as ScopedResult;
    if (!result || !Array.isArray(result.registration_ids) || !Array.isArray(result.appointment_ids) || !Array.isArray(result.waitlist_ids)) throw new Error("invalid scoped cron result");
    const notifications = await processRegistrationNotificationQueue(svc, { clinicId: scope.clinicId, recordIds: result.registration_ids });
    const appointmentNotifications = await processAppointmentNotificationQueue(svc, { clinicId: scope.clinicId, recordIds: result.appointment_ids });
    const appointmentWaitlistNotifications = await processAppointmentWaitlistNotificationQueue(svc, 200, { clinicId: scope.clinicId, recordIds: result.waitlist_ids });
    return Response.json({ ok: notifications.failed === 0 && appointmentNotifications.failed === 0 && appointmentWaitlistNotifications.failed === 0,
      expired: result.expired, expired_appointments: result.expired_appointments, expired_membership_payments: result.expired_membership_payments,
      expired_waitlist_offers: result.expired_waitlist_offers, released_benefits: result.released_benefits,
      notifications, appointment_notifications: appointmentNotifications, appointment_waitlist_notifications: appointmentWaitlistNotifications });
  } catch (error) { return fail(error instanceof Error ? error.message : "指定期限與通知處理失敗", 500); }
}
