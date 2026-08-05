export const REGISTRATION_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "waitlisted",
  "attended",
  "no_show",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const EVENT_STATUSES = ["draft", "published", "archived"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface PublicEventSession {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  venue: string | null;
  capacity: number;
  waitlist_enabled: boolean;
}

export interface PublicTicketType {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
}

export interface PublicRegistrationField {
  id: string;
  field_key: string;
  label: string;
  field_type: "text" | "textarea" | "date" | "select" | "checkbox";
  required: boolean;
  options: string[];
  sort_order: number;
}

export interface PublicEvent {
  id: string;
  clinic_id: string;
  clinic_name: string;
  slug: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  registration_open_at: string | null;
  registration_close_at: string | null;
  sessions: PublicEventSession[];
  ticket_types: PublicTicketType[];
  form: { id: string; version: number } | null;
  fields: PublicRegistrationField[];
}

export function toSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || `event-${Date.now()}`;
}

export function formatEventDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatAmount(amount: number): string {
  return amount === 0 ? "免費" : `NT$${amount.toLocaleString("zh-TW")}`;
}
