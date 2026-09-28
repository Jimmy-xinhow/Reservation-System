/** Remove joined labels that do not belong to the public request's brand. */
export function publicClinicRelation(relation: unknown, clinicId: string): Record<string, unknown> | null {
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) return null;
  const { clinic_id, ...fields } = relation as Record<string, unknown>;
  return clinic_id === clinicId ? fields : null;
}

export function publicBookingRelations<T extends Record<string, unknown>>(row: T, clinicId: string): Record<string, unknown> {
  const doctors = publicClinicRelation(row.doctors, clinicId);
  const services = publicClinicRelation(row.services, clinicId);
  const scoped: Record<string, unknown> = { ...row };
  if ("doctors" in row) scoped.doctors = doctors;
  if ("services" in row) scoped.services = services;
  if ("doctor_id" in row) scoped.doctor_id = doctors ? row.doctor_id : null;
  if ("service_id" in row) scoped.service_id = services ? row.service_id : null;
  if ("patients" in row) scoped.patients = publicClinicRelation(row.patients, clinicId);
  return scoped;
}
