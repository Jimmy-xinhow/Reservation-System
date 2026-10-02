export interface PaymentResultStatus {
  status: string;
  target: "registration" | "appointment" | "membership";
  registration_status: string | null;
  registration_payment_status: string | null;
  appointment_status: string | null;
  membership_id: string | null;
}

export function paymentResultState(data: PaymentResultStatus | null): "processing" | "completed" | "incomplete" | "refunded" | "needs_review" {
  if (!data) return "processing";
  if (data.status === "refunded") return "refunded";
  if (["failed", "expired", "cancelled"].includes(data.status)) return "incomplete";
  if (data.status !== "paid") return "processing";
  if (data.target === "appointment") {
    if (["confirmed", "done", "no_show"].includes(data.appointment_status ?? "")) return "completed";
    if (data.appointment_status === "cancelled") return "needs_review";
  } else if (data.target === "membership") {
    if (data.membership_id) return "completed";
  } else {
    if (data.registration_status === "cancelled") return "needs_review";
    if (data.registration_payment_status === "paid" && ["confirmed", "attended", "no_show"].includes(data.registration_status ?? "")) return "completed";
  }
  return "processing";
}
