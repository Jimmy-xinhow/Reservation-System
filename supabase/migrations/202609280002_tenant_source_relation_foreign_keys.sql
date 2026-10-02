begin;

-- Server-side service-role flows can bypass RLS. A single-column FK accepts
-- another brand's related row and PostgREST may then embed its private title.
-- Abort before changing constraints if existing data needs reconciliation.
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.appointments a left join public.doctors d on d.id = a.doctor_id
  where a.doctor_id is not null and (d.id is null or d.clinic_id <> a.clinic_id);
  if mismatches <> 0 then raise exception 'appointment doctor tenant mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.appointments a left join public.services s on s.id = a.service_id
  where a.service_id is not null and (s.id is null or s.clinic_id <> a.clinic_id);
  if mismatches <> 0 then raise exception 'appointment service tenant mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.event_sessions s left join public.events e on e.id = s.event_id
  where e.id is null or e.clinic_id <> s.clinic_id;
  if mismatches <> 0 then raise exception 'session event tenant mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.event_ticket_types t left join public.events e on e.id = t.event_id
  where e.id is null or e.clinic_id <> t.clinic_id;
  if mismatches <> 0 then raise exception 'ticket event tenant mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.registrations r left join public.events e on e.id = r.event_id
  where e.id is null or e.clinic_id <> r.clinic_id;
  if mismatches <> 0 then raise exception 'registration event tenant mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.registrations r left join public.event_sessions s on s.id = r.session_id
  where s.id is null or s.clinic_id <> r.clinic_id or s.event_id <> r.event_id;
  if mismatches <> 0 then raise exception 'registration session tenant/event mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.registrations r left join public.event_ticket_types t on t.id = r.ticket_type_id
  where r.ticket_type_id is not null and (t.id is null or t.clinic_id <> r.clinic_id or t.event_id <> r.event_id);
  if mismatches <> 0 then raise exception 'registration ticket tenant/event mismatches: %', mismatches; end if;

  select count(*) into mismatches
  from public.course_units u left join public.events e on e.id = u.event_id
  where e.id is null or e.clinic_id <> u.clinic_id;
  if mismatches <> 0 then raise exception 'course unit event tenant mismatches: %', mismatches; end if;
end;
$$;

create unique index if not exists doctors_clinic_id_id_uidx on public.doctors (clinic_id, id);
create unique index if not exists services_clinic_id_id_uidx on public.services (clinic_id, id);
create unique index if not exists events_clinic_id_id_uidx on public.events (clinic_id, id);
create unique index if not exists event_sessions_clinic_event_id_id_uidx on public.event_sessions (clinic_id, event_id, id);
create unique index if not exists event_ticket_types_clinic_event_id_id_uidx on public.event_ticket_types (clinic_id, event_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointments'::regclass and conname = 'appointments_clinic_doctor_fkey') then
    alter table public.appointments add constraint appointments_clinic_doctor_fkey
      foreign key (clinic_id, doctor_id) references public.doctors (clinic_id, id) on delete no action not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointments'::regclass and conname = 'appointments_clinic_service_fkey') then
    alter table public.appointments add constraint appointments_clinic_service_fkey
      foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete no action not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.event_sessions'::regclass and conname = 'event_sessions_clinic_event_fkey') then
    alter table public.event_sessions add constraint event_sessions_clinic_event_fkey
      foreign key (clinic_id, event_id) references public.events (clinic_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.event_ticket_types'::regclass and conname = 'event_ticket_types_clinic_event_fkey') then
    alter table public.event_ticket_types add constraint event_ticket_types_clinic_event_fkey
      foreign key (clinic_id, event_id) references public.events (clinic_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.registrations'::regclass and conname = 'registrations_clinic_event_fkey') then
    alter table public.registrations add constraint registrations_clinic_event_fkey
      foreign key (clinic_id, event_id) references public.events (clinic_id, id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.registrations'::regclass and conname = 'registrations_clinic_event_session_fkey') then
    alter table public.registrations add constraint registrations_clinic_event_session_fkey
      foreign key (clinic_id, event_id, session_id) references public.event_sessions (clinic_id, event_id, id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.registrations'::regclass and conname = 'registrations_clinic_event_ticket_fkey') then
    alter table public.registrations add constraint registrations_clinic_event_ticket_fkey
      foreign key (clinic_id, event_id, ticket_type_id) references public.event_ticket_types (clinic_id, event_id, id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.course_units'::regclass and conname = 'course_units_clinic_event_fkey') then
    alter table public.course_units add constraint course_units_clinic_event_fkey
      foreign key (clinic_id, event_id) references public.events (clinic_id, id) on delete restrict not valid;
  end if;
end;
$$;

alter table public.appointments validate constraint appointments_clinic_doctor_fkey;
alter table public.appointments validate constraint appointments_clinic_service_fkey;
alter table public.event_sessions validate constraint event_sessions_clinic_event_fkey;
alter table public.event_ticket_types validate constraint event_ticket_types_clinic_event_fkey;
alter table public.registrations validate constraint registrations_clinic_event_fkey;
alter table public.registrations validate constraint registrations_clinic_event_session_fkey;
alter table public.registrations validate constraint registrations_clinic_event_ticket_fkey;
alter table public.course_units validate constraint course_units_clinic_event_fkey;

-- Preserve one PostgREST relationship per pair for generic embeds.
alter table public.appointments drop constraint if exists appointments_doctor_id_fkey;
alter table public.appointments drop constraint if exists appointments_service_id_fkey;
alter table public.event_sessions drop constraint if exists event_sessions_event_id_fkey;
alter table public.event_ticket_types drop constraint if exists event_ticket_types_event_id_fkey;
alter table public.registrations drop constraint if exists registrations_event_id_fkey;
alter table public.registrations drop constraint if exists registrations_session_id_fkey;
alter table public.registrations drop constraint if exists registrations_ticket_type_id_fkey;
alter table public.course_units drop constraint if exists course_units_event_id_fkey;

notify pgrst, 'reload schema';
commit;
