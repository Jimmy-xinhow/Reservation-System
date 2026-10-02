begin;

-- A record must refer only to its own tenant's patient and source patient.
-- Refuse to install constraints over historical rows that need reconciliation.
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.patient_records record
  left join public.patients patient on patient.id = record.patient_id
  left join public.appointments appointment on appointment.id = record.appointment_id
  left join public.registrations registration on registration.id = record.registration_id
  where patient.id is null or patient.clinic_id <> record.clinic_id
    or (record.appointment_id is not null and
        (appointment.id is null or appointment.clinic_id <> record.clinic_id or appointment.patient_id <> record.patient_id))
    or (record.registration_id is not null and
        (registration.id is null or registration.clinic_id <> record.clinic_id or registration.patient_id is distinct from record.patient_id));
  if mismatches <> 0 then
    raise exception 'patient record tenant or source mismatches: %', mismatches;
  end if;
end;
$$;

create unique index if not exists patients_clinic_id_id_uidx
  on public.patients (clinic_id, id);
create unique index if not exists appointments_clinic_id_id_patient_id_uidx
  on public.appointments (clinic_id, id, patient_id);
create unique index if not exists registrations_clinic_id_id_patient_id_uidx
  on public.registrations (clinic_id, id, patient_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.patient_records'::regclass and conname = 'patient_records_clinic_patient_fkey') then
    alter table public.patient_records add constraint patient_records_clinic_patient_fkey
      foreign key (clinic_id, patient_id) references public.patients (clinic_id, id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.patient_records'::regclass and conname = 'patient_records_clinic_appointment_patient_fkey') then
    alter table public.patient_records add constraint patient_records_clinic_appointment_patient_fkey
      foreign key (clinic_id, appointment_id, patient_id) references public.appointments (clinic_id, id, patient_id)
      on delete no action deferrable initially deferred not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.patient_records'::regclass and conname = 'patient_records_clinic_registration_patient_fkey') then
    alter table public.patient_records add constraint patient_records_clinic_registration_patient_fkey
      foreign key (clinic_id, registration_id, patient_id) references public.registrations (clinic_id, id, patient_id)
      on delete no action deferrable initially deferred not valid;
  end if;
end;
$$;

alter table public.patient_records validate constraint patient_records_clinic_patient_fkey;
alter table public.patient_records validate constraint patient_records_clinic_appointment_patient_fkey;
alter table public.patient_records validate constraint patient_records_clinic_registration_patient_fkey;
notify pgrst, 'reload schema';
commit;
