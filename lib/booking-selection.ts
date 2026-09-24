export function bookingPatientSelection(
  patients: ReadonlyArray<{ id: string }>,
  current: string,
  requested: string | null,
): string {
  if (requested !== null) return patients.some((patient) => patient.id === requested) ? requested : "";
  if (current === "__new__" || patients.some((patient) => patient.id === current)) return current;
  // A removed selection must be chosen again, never silently replaced by another person.
  if (current) return "";
  return patients[0]?.id ?? "__new__";
}

export function bookingDoctorSelection(
  target: "provider_required" | "provider_optional" | "resource_only",
  requested: string,
  doctors: ReadonlyArray<{ id: string }>,
): string {
  if (target === "resource_only") return "";
  if (doctors.some((doctor) => doctor.id === requested)) return requested;
  return target === "provider_required" && doctors.length === 1 ? doctors[0].id : "";
}
