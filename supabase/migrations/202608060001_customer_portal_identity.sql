-- Unified browser customer portal: link event registrations to the existing patient identity.
-- Additive migration. Existing registration lookup by registration_no + phone remains supported.
begin;

alter table public.registrations
  add column if not exists patient_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.registrations'::regclass
       and conname = 'registrations_patient_id_fkey'
  ) then
    alter table public.registrations
      add constraint registrations_patient_id_fkey
      foreign key (patient_id) references public.patients(id) on delete restrict;
  end if;
end;
$$;

create index if not exists registrations_patient_idx
  on public.registrations (clinic_id, patient_id, created_at desc);

-- Only backfill unique brand/name/phone matches. Ambiguous identities remain
-- null and continue to use the existing registration number + phone lookup.
update public.registrations as r
   set patient_id = (
     select p.id
       from public.patients as p
      where p.clinic_id = r.clinic_id
        and p.name = r.name
        and p.phone = r.phone
        and p.active
   )
 where r.patient_id is null
   and (
     select count(*)
       from public.patients as p
      where p.clinic_id = r.clinic_id
        and p.name = r.name
        and p.phone = r.phone
        and p.active
   ) = 1;

commit;
