import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "";
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase staging environment variables");
if (environmentName.toLowerCase() !== "staging") throw new Error(`Refusing to run outside staging: ${environmentName || "unknown"}`);

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const clinic = await must(
  "find role fixture clinic",
  service.from("clinics").select("id, slug").like("slug", "qa-role-%").order("created_at", { ascending: false }).limit(1).single(),
);
const target = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const bookingDate = target.toISOString().slice(0, 10);
const weekday = target.getUTCDay();

await must("enable growth booking settings", service.from("clinic_settings").update({
  booking_mode: "time",
  public_booking_enabled: true,
  deposit_enabled: false,
  recurring_booking_enabled: true,
  max_recurring_occurrences: 4,
  min_lead_minutes: 0,
  max_advance_days: 60,
}).eq("clinic_id", clinic.id));

await must("remove old fixture schedules", service.from("schedule_templates").delete().eq("clinic_id", clinic.id));
await must("remove old fixture addons", service.from("service_addons").delete().eq("clinic_id", clinic.id));
await must("remove old fixture services", service.from("services").delete().eq("clinic_id", clinic.id));

const bookingFields = [
  { key: "service_need", label: "本次服務需求", type: "textarea", required: false, options: [] },
  { key: "experience", label: "偏好體驗", type: "select", required: true, options: ["舒緩", "深層"] },
  { key: "cancel_policy", label: "我已閱讀並同意取消政策", type: "consent", required: true, options: [] },
];
const createdService = await must("create fixture service", service.from("services").insert({
  clinic_id: clinic.id,
  name: "舒壓照護體驗",
  category: "QA 成長流程",
  description: "用於 staging 驗收自訂表單、多服務加購與重複預約。",
  duration_minutes: 30,
  buffer_minutes: 0,
  booking_target: "resource_only",
  booking_fields: bookingFields,
  active: true,
}).select("id, name").single());

await must("create fixture addons", service.from("service_addons").insert([
  {
    clinic_id: clinic.id,
    service_id: createdService.id,
    name: "延長深層照護",
    description: "增加 20 分鐘，系統會一併檢查時段容量。",
    duration_minutes: 20,
    price: 600,
    sort_order: 10,
    active: true,
  },
  {
    clinic_id: clinic.id,
    service_id: createdService.id,
    name: "舒緩精油升級",
    description: "不增加服務時間，預約時保存加購價格快照。",
    duration_minutes: 0,
    price: 300,
    sort_order: 20,
    active: true,
  },
]));

await must("create fixture schedule", service.from("schedule_templates").insert({
  clinic_id: clinic.id,
  doctor_id: null,
  service_id: createdService.id,
  weekday,
  start_time: "09:00",
  end_time: "12:00",
  slot_minutes: 15,
  capacity: 2,
  active: true,
}));

console.log(JSON.stringify({ clinic, service: createdService, bookingDate, weekday }));
