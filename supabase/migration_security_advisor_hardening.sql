-- v3 security advisor hardening; safe to re-run on an existing database.
-- Trigger and internal SECURITY DEFINER functions are never called by API roles.

alter function public.sync_patient_birthday_mmdd() set search_path = '';
alter function public.touch_updated_at() set search_path = '';

revoke all on function public.get_available_sessions(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.seed_clinic_settings() from public, anon, authenticated;
revoke all on function public.sync_patient_birthday_mmdd() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_provider_appointment_writes() from public, anon, authenticated;
revoke all on function public.record_appointment_status_event() from public, anon, authenticated;
revoke all on function public.record_registration_status_event() from public, anon, authenticated;

grant execute on function public.get_available_sessions(uuid, uuid, date) to service_role;
grant execute on function public.seed_clinic_settings() to service_role;
grant execute on function public.sync_patient_birthday_mmdd() to service_role;
grant execute on function public.touch_updated_at() to service_role;
grant execute on function public.prevent_provider_appointment_writes() to service_role;
grant execute on function public.record_appointment_status_event() to service_role;
grant execute on function public.record_registration_status_event() to service_role;
