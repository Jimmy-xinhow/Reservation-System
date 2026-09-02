import type { BookingField, ServiceAddon } from "./BookingFlowUi";
import type { CustomerEntryAvailability } from "@/lib/customer-entry";

export interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  booking_target: "provider_required" | "provider_optional" | "resource_only";
  booking_fields: BookingField[];
  service_addons: ServiceAddon[];
}

export interface Config {
  clinic_name: string | null;
  liff_id: string | null;
  booking_mode: "time" | "number";
  deposit_enabled: boolean;
  max_advance_days: number;
  recurring_booking_enabled: boolean;
  max_recurring_occurrences: number;
  allow_multi_patient_per_phone: boolean;
  max_patients_per_phone: number;
  doctors: Doctor[];
  services: Service[];
}

export interface EntryConfig {
  clinic_name: string | null;
  clinic_slug: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
  line_basic_id: string | null;
  liff_id: string | null;
  booking_mode: "time" | "number";
  brand_page_enabled: boolean;
  availability: CustomerEntryAvailability;
}

export interface BoundPatient {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  blocked_until: string | null;
}

export interface Slot {
  slot_start: string;
  slot_end: string;
  remaining: number;
}

export interface Session {
  template_id: string;
  session_start: string;
  session_end: string;
  total: number;
  taken: number;
  remaining: number;
}

export interface ReserveResult {
  appointment_id: string;
  queue_number: number | null;
  deposit_status: string;
  deposit_amount: number;
  start_at: string | null;
  end_at: string | null;
  doctor_name: string | null;
  service_name: string | null;
  addons_amount: number;
  series_count: number;
  appointment_ids: string[];
}

export interface WaitlistResult {
  waitlist_id: string;
  position: number;
}
