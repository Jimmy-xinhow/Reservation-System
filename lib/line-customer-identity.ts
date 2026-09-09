import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLineUserProfile } from "@/lib/line";

export interface LineCustomerIdentity {
  patientId: string | null;
  displayName: string | null;
  profileCompleted: boolean;
}

export async function getLineCustomerIdentity(
  service: SupabaseClient,
  clinicId: string,
  lineUserId: string,
): Promise<LineCustomerIdentity | null> {
  const { data, error } = await service
    .from("line_customer_identities")
    .select("patient_id, display_name, profile_completed")
    .eq("clinic_id", clinicId)
    .eq("line_user_id", lineUserId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    patientId: data.patient_id ? String(data.patient_id) : null,
    displayName: typeof data.display_name === "string" ? data.display_name : null,
    profileCompleted: data.profile_completed === true,
  };
}

export async function saveLineCustomerIdentity(
  service: SupabaseClient,
  input: {
    clinicId: string;
    lineUserId: string;
    patientId?: string | null;
    displayName?: string | null;
    pictureUrl?: string | null;
    profileCompleted?: boolean;
  },
): Promise<LineCustomerIdentity> {
  const lineUserId = input.lineUserId.trim();
  if (!lineUserId || lineUserId.length > 160) throw new Error("LINE 身分格式不正確");
  const payload = {
    clinic_id: input.clinicId,
    line_user_id: lineUserId,
    patient_id: input.patientId ?? null,
    display_name: input.displayName?.trim().slice(0, 100) || null,
    picture_url: input.pictureUrl?.trim().slice(0, 2048) || null,
    profile_completed: input.profileCompleted === true,
    active: true,
    last_seen_at: new Date().toISOString(),
  };
  const { data, error } = await service
    .from("line_customer_identities")
    .upsert(payload, { onConflict: "clinic_id,line_user_id" })
    .select("patient_id, display_name, profile_completed")
    .single();
  if (error) throw new Error(error.message);
  return {
    patientId: data.patient_id ? String(data.patient_id) : null,
    displayName: typeof data.display_name === "string" ? data.display_name : null,
    profileCompleted: data.profile_completed === true,
  };
}

export async function ensureLineCustomerIdentity(
  service: SupabaseClient,
  input: { clinicId: string; lineUserId: string; lineAccessToken: string },
): Promise<LineCustomerIdentity> {
  const [{ data: patient, error: patientError }, profile, existingIdentity] = await Promise.all([
    service
      .from("patients")
      .select("id, name")
      .eq("clinic_id", input.clinicId)
      .eq("line_user_id", input.lineUserId)
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    getLineUserProfile(input.lineUserId, input.lineAccessToken).catch(() => null),
    getLineCustomerIdentity(service, input.clinicId, input.lineUserId),
  ]);
  if (patientError) throw new Error(patientError.message);
  return saveLineCustomerIdentity(service, {
    clinicId: input.clinicId,
    lineUserId: input.lineUserId,
    patientId: patient?.id ? String(patient.id) : existingIdentity?.patientId ?? null,
    displayName: profile?.displayName ?? (typeof patient?.name === "string" ? patient.name : existingIdentity?.displayName ?? null),
    pictureUrl: profile?.pictureUrl ?? null,
    profileCompleted: Boolean(patient?.id) || existingIdentity?.profileCompleted === true,
  });
}
