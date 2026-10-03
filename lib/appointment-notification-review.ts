export interface ReviewablePendingNotification {
  clinic_id: string;
  appointment_id: string;
  kind: string;
  status: string;
  sent_at: string | null;
  provider_message_id: string | null;
  reviewed_at: string | null;
}

export interface ReviewableAppointment {
  id: string;
  clinic_id: string;
  status: string;
  start_at: string;
}

/** A review closes an obsolete task; it never changes the delivery result. */
export function canReviewObsoletePendingNotification(
  notice: ReviewablePendingNotification,
  appointment: ReviewableAppointment | null,
  now = new Date(),
): boolean {
  if (!appointment || notice.clinic_id !== appointment.clinic_id || notice.appointment_id !== appointment.id) return false;
  if (notice.kind !== "pending" || notice.status !== "failed" || notice.reviewed_at) return false;
  if (notice.sent_at || notice.provider_message_id) return false;
  const startAt = new Date(appointment.start_at).getTime();
  return appointment.status === "cancelled" && Number.isFinite(startAt) && startAt < now.getTime();
}
