begin;

-- Both source tables are also written by server-side service-role flows.
-- A single-column patient FK permits a source from one brand to embed another
-- brand's customer, so refuse this migration until historical rows are clean.
do $$
declare appointment_mismatches bigint;
declare registration_mismatches bigint;
begin
  select count(*) into appointment_mismatches
  from public.appointments source
  left join public.patients patient on patient.id = source.patient_id
  where patient.id is null or patient.clinic_id <> source.clinic_id;

  select count(*) into registration_mismatches
  from public.registrations source
  left join public.patients patient on patient.id = source.patient_id
  where source.patient_id is not null
    and (patient.id is null or patient.clinic_id <> source.clinic_id);

  if appointment_mismatches <> 0 or registration_mismatches <> 0 then
    raise exception 'source patient tenant mismatches: appointments %, registrations %',
      appointment_mismatches, registration_mismatches;
  end if;
end;
$$;

create unique index if not exists patients_clinic_id_id_uidx
  on public.patients (clinic_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_clinic_patient_fkey'
  ) then
    alter table public.appointments add constraint appointments_clinic_patient_fkey
      foreign key (clinic_id, patient_id) references public.patients (clinic_id, id)
      on delete no action not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.registrations'::regclass
      and conname = 'registrations_clinic_patient_fkey'
  ) then
    alter table public.registrations add constraint registrations_clinic_patient_fkey
      foreign key (clinic_id, patient_id) references public.patients (clinic_id, id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.appointments validate constraint appointments_clinic_patient_fkey;
alter table public.registrations validate constraint registrations_clinic_patient_fkey;

-- Keep one PostgREST relationship per source/patient pair; otherwise generic
-- patients(...) embeds become ambiguous and existing admin pages fail.
alter table public.appointments drop constraint if exists appointments_patient_id_fkey;
alter table public.registrations drop constraint if exists registrations_patient_id_fkey;

notify pgrst, 'reload schema';
commit;
