-- Configure each brand's operating focus and allow service records to originate
-- from either an appointment or a course/event registration.
begin;

alter table public.clinic_settings
  add column if not exists dashboard_focus text not null default 'mixed';

alter table public.clinic_settings
  drop constraint if exists clinic_settings_dashboard_focus_check;
alter table public.clinic_settings
  add constraint clinic_settings_dashboard_focus_check
  check (dashboard_focus in ('booking', 'registration', 'mixed'));

alter table public.patient_records
  add column if not exists registration_id uuid references public.registrations(id) on delete restrict;

alter table public.patient_records drop constraint if exists patient_records_record_type_check;
alter table public.patient_records
  add constraint patient_records_record_type_check
  check (record_type in ('general', 'beauty_treatment', 'service_record'));

alter table public.patient_records drop constraint if exists patient_records_service_source_check;
alter table public.patient_records
  add constraint patient_records_service_source_check
  check (
    record_type not in ('beauty_treatment', 'service_record')
    or ((appointment_id is not null)::integer + (registration_id is not null)::integer = 1)
  );

create index if not exists patient_records_registration_idx
  on public.patient_records (clinic_id, registration_id, created_at desc);

commit;
