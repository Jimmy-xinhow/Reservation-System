begin;

-- Service-role membership reminders embed patient contact data. Refuse to
-- install a tenant-scoped FK until historical links have been reconciled.
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.patient_memberships membership
  left join public.patients patient on patient.id = membership.patient_id
  where patient.id is null or patient.clinic_id <> membership.clinic_id;

  if mismatches <> 0 then
    raise exception 'membership patient tenant mismatches: %', mismatches;
  end if;
end;
$$;

create unique index if not exists patients_clinic_id_id_uidx
  on public.patients (clinic_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.patient_memberships'::regclass
      and conname = 'patient_memberships_clinic_patient_fkey'
  ) then
    alter table public.patient_memberships
      add constraint patient_memberships_clinic_patient_fkey
      foreign key (clinic_id, patient_id)
      references public.patients (clinic_id, id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.patient_memberships
  validate constraint patient_memberships_clinic_patient_fkey;

-- Keep the patients(...) embed unambiguous for existing admin and cron pages.
alter table public.patient_memberships
  drop constraint if exists patient_memberships_patient_id_fkey;

notify pgrst, 'reload schema';
commit;
