-- Cross-industry booking foundation.
-- Existing doctor/provider booking remains compatible; service-only schedules may omit doctor_id.
begin;

alter table public.services
  add column if not exists booking_target text not null default 'provider_required';
alter table public.services
  add column if not exists booking_fields jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_booking_target_check') then
    alter table public.services add constraint services_booking_target_check
      check (booking_target in ('provider_required', 'provider_optional', 'resource_only')) not valid;
  end if;
end;
$$;

alter table public.schedule_templates alter column doctor_id drop not null;
alter table public.schedule_templates add column if not exists service_id uuid references public.services(id) on delete restrict;
alter table public.schedule_exceptions alter column doctor_id drop not null;
alter table public.schedule_exceptions add column if not exists service_id uuid references public.services(id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedule_templates_target_check') then
    alter table public.schedule_templates add constraint schedule_templates_target_check
      check (doctor_id is not null or service_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedule_exceptions_target_check') then
    alter table public.schedule_exceptions add constraint schedule_exceptions_target_check
      check (doctor_id is not null or service_id is not null) not valid;
  end if;
end;
$$;
drop index if exists public.uniq_sched_exc;
create unique index if not exists uniq_sched_exc
  on public.schedule_exceptions (
    clinic_id,
    coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    date,
    coalesce(start_time, '00:00'::time)
  );
create index if not exists schedule_templates_service_idx
  on public.schedule_templates (clinic_id, service_id, weekday, active, start_time);
create index if not exists schedule_exceptions_service_idx
  on public.schedule_exceptions (clinic_id, service_id, date, is_closed, start_time);

alter table public.appointments alter column doctor_id drop not null;
alter table public.appointments add column if not exists booking_answers jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_target_check') then
    alter table public.appointments add constraint appointments_target_check
      check (doctor_id is not null or service_id is not null) not valid;
  end if;
end;
$$;
create index if not exists appointments_service_start_idx
  on public.appointments (clinic_id, service_id, start_at);

create or replace function public.get_available_service_slots(
  p_clinic_id uuid,
  p_service_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_doctor_id uuid default null
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead integer := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30);
  v_first_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id = p_clinic_id), false);
  v_first_minutes integer := (select first_visit_minutes from public.clinic_settings where clinic_id = p_clinic_id);
  v_target text;
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select booking_target into v_target
    from public.services
   where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if v_target = 'provider_required' and p_doctor_id is null then raise exception 'provider is required for this service'; end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'provider not found'; end if;

  for rec in
    select t.id as template_id, t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.weekday = v_weekday and t.active
       and (t.service_id is null or t.service_id = p_service_id)
       and (
         (p_doctor_id is not null and t.doctor_id = p_doctor_id)
         or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id)
       )
       and not exists (
         select 1 from public.schedule_exceptions e
          where e.clinic_id = p_clinic_id and e.date = p_date and e.is_closed and e.start_time is null
            and (
              (p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id))
              or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
            )
       )
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
       and (
         (p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id))
         or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
       )
  loop
    v_slot_length := public.service_booking_minutes(
      p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes
    );
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as e
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::integer
      from candidate c
      left join public.appointments a
        on a.clinic_id = p_clinic_id
       and a.status in ('booked', 'confirmed', 'done')
       and a.start_at < c.e and a.end_at > c.s
       and (
         (p_doctor_id is not null and a.doctor_id = p_doctor_id)
         or (p_doctor_id is null and a.doctor_id is null and a.service_id = p_service_id)
       )
     where c.s > now() + (v_lead || ' minutes')::interval
       and public.service_resources_available(p_clinic_id, p_service_id, c.s, c.e, null)
       and not exists (
         select 1 from public.schedule_exceptions ec
          where ec.clinic_id = p_clinic_id and ec.date = p_date and ec.is_closed and ec.start_time is not null
            and (
              (p_doctor_id is not null and ec.doctor_id = p_doctor_id and (ec.service_id is null or ec.service_id = p_service_id))
              or (p_doctor_id is null and ec.doctor_id is null and ec.service_id = p_service_id)
            )
            and (c.s at time zone 'Asia/Taipei')::time < ec.end_time
            and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
       )
     group by c.s, c.e, rec.capacity
    having rec.capacity - count(a.id) > 0
     order by c.s;
  end loop;
end;
$$;

create or replace function public.get_available_service_sessions(
  p_clinic_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz, total integer, taken integer, remaining integer)
language sql
security definer
set search_path = public, extensions
as $$
  with sess as (
    select t.id, t.start_time, t.end_time, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.service_id = p_service_id and t.doctor_id is null
       and t.weekday = extract(dow from p_date) and t.active
       and not exists (
         select 1 from public.schedule_exceptions e
          where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null
            and e.date = p_date and e.is_closed
            and (e.start_time is null or (e.start_time < t.end_time and coalesce(e.end_time, '23:59:59.999999'::time) > t.start_time))
       )
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity, 40)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null
       and e.date = p_date and not e.is_closed
       and not exists (
         select 1 from public.schedule_exceptions closed
          where closed.clinic_id = p_clinic_id and closed.service_id = p_service_id and closed.doctor_id is null
            and closed.date = p_date and closed.is_closed
            and (closed.start_time is null or (e.start_time < coalesce(closed.end_time, '23:59:59.999999'::time) and coalesce(e.end_time, '23:59:59.999999'::time) > closed.start_time))
       )
  )
  select x.id,
         ((p_date + x.start_time) at time zone 'Asia/Taipei'),
         ((p_date + x.end_time) at time zone 'Asia/Taipei'),
         x.capacity,
         count(a.id)::integer,
         greatest(0, x.capacity - count(a.id))::integer
    from sess x
    left join public.appointments a
      on a.clinic_id = p_clinic_id and a.template_id = x.id
     and a.doctor_id is null and a.service_id = p_service_id
     and a.start_at = ((p_date + x.start_time) at time zone 'Asia/Taipei')
     and a.status in ('booked', 'confirmed', 'done')
   where ((p_date + x.start_time) at time zone 'Asia/Taipei') > now() + (
     coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30) || ' minutes'
   )::interval
     and public.service_resources_available(
       p_clinic_id, p_service_id,
       ((p_date + x.start_time) at time zone 'Asia/Taipei'),
       ((p_date + x.end_time) at time zone 'Asia/Taipei'), null
     )
   group by x.id, x.start_time, x.end_time, x.capacity
  having count(a.id) < x.capacity;
$$;

create or replace function public.book_service_slot(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_start_at timestamptz,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_booking_answers jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  st record;
  service_row record;
  segment record;
  v_date date := (p_start_at at time zone 'Asia/Taipei')::date;
  v_tod time := (p_start_at at time zone 'Asia/Taipei')::time;
  v_weekday smallint := extract(dow from p_start_at at time zone 'Asia/Taipei');
  v_len integer;
  v_end timestamptz;
  v_used integer;
  v_id uuid;
  v_dep boolean;
  v_match_count integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id = p_clinic_id;
  select * into service_row from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if service_row.booking_target = 'provider_required' then raise exception 'provider is required for this service'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and clinic_id = p_clinic_id and active) then raise exception 'customer not found'; end if;

  select count(*) into v_match_count
    from (
      select start_time, end_time, slot_minutes, capacity
        from public.schedule_templates
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and weekday = v_weekday and active
         and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = v_date and e.is_closed and e.start_time is null)
      union all
      select start_time, end_time, coalesce(slot_minutes, 15), coalesce(capacity, 1)
        from public.schedule_exceptions
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and date = v_date and not is_closed
    ) q
   where v_tod >= start_time and v_tod < end_time;
  if v_match_count = 0 then raise exception 'no available service schedule'; end if;
  if v_match_count > 1 then raise exception 'service schedules overlap'; end if;

  select * into segment
    from (
      select id as template_id, start_time, end_time, slot_minutes, capacity
        from public.schedule_templates
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and weekday = v_weekday and active
         and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = v_date and e.is_closed and e.start_time is null)
      union all
      select id, start_time, end_time, coalesce(slot_minutes, 15), coalesce(capacity, 1)
        from public.schedule_exceptions
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and date = v_date and not is_closed
    ) q
   where v_tod >= start_time and v_tod < end_time;
  v_len := public.service_booking_minutes(p_clinic_id, p_service_id, segment.slot_minutes, p_visit_type, coalesce(st.first_visit_extends, false), st.first_visit_minutes);
  v_end := p_start_at + (v_len || ' minutes')::interval;
  if v_end > ((v_date + segment.end_time) at time zone 'Asia/Taipei') then raise exception 'service duration exceeds schedule'; end if;
  if p_start_at < now() + (coalesce(st.min_lead_minutes, 30) || ' minutes')::interval then raise exception 'booking lead time exceeded'; end if;
  if v_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days, 30)) then raise exception 'booking window exceeded'; end if;
  if exists (
    select 1 from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = v_date and e.is_closed and e.start_time is not null
       and v_tod < coalesce(e.end_time, '23:59:59.999999'::time) and (v_end at time zone 'Asia/Taipei')::time > e.start_time
  ) then raise exception 'service schedule is closed'; end if;

  perform pg_advisory_xact_lock(hashtext('service-time:' || p_clinic_id::text || p_service_id::text || v_date::text));
  perform pg_advisory_xact_lock(hashtext('customer:' || p_clinic_id::text || p_patient_id::text || v_date::text));
  if exists (
    select 1 from public.appointments
     where clinic_id = p_clinic_id and patient_id = p_patient_id and status in ('booked', 'confirmed', 'done')
       and (start_at at time zone 'Asia/Taipei')::date = v_date
  ) then raise exception 'customer already has a booking on this date'; end if;
  select count(*) into v_used
    from public.appointments
   where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null
     and status in ('booked', 'confirmed', 'done') and start_at < v_end and end_at > p_start_at;
  if v_used >= segment.capacity then raise exception 'service slot is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, p_start_at, v_end, null) then raise exception 'service resource is unavailable'; end if;
  v_dep := coalesce(st.deposit_enabled, false) and (st.deposit_scope = 'all' or (st.deposit_scope = 'self_pay' and p_is_self_pay));
  insert into public.appointments (
    clinic_id, doctor_id, patient_id, template_id, service_id, start_at, end_at, visit_type, is_self_pay, booking_answers,
    deposit_status, deposit_amount, deposit_expires_at
  ) values (
    p_clinic_id, null, p_patient_id, segment.template_id, p_service_id, p_start_at, v_end, p_visit_type, p_is_self_pay, coalesce(p_booking_answers, '{}'::jsonb),
    case when v_dep then 'pending' else 'none' end,
    case when v_dep then coalesce(st.deposit_amount, 0) else 0 end,
    case when v_dep then now() + interval '15 minutes' else null end
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.book_service_slot_with_membership(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_start_at timestamptz,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_membership_id uuid;
begin
  v_id := public.book_service_slot(p_clinic_id, p_service_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_booking_answers);
  if nullif(trim(p_membership_code), '') is null then return v_id; end if;
  select id into v_membership_id
    from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code))
   for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', v_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_service_session(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_template_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_booking_answers jsonb default '{}'::jsonb
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  st record;
  service_row record;
  session record;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_used integer;
  v_no integer;
  v_id uuid;
  v_dep boolean;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id = p_clinic_id;
  select * into service_row from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if service_row.booking_target = 'provider_required' then raise exception 'provider is required for this service'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and clinic_id = p_clinic_id and active) then raise exception 'customer not found'; end if;
  select * into session from (
    select id as template_id, start_time, end_time, capacity
      from public.schedule_templates
     where id = p_template_id and clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and weekday = extract(dow from p_date) and active
    union all
    select id, start_time, end_time, coalesce(capacity, 40)
      from public.schedule_exceptions
     where id = p_template_id and clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and date = p_date and not is_closed
  ) q limit 1;
  if not found then raise exception 'service session does not match date'; end if;
  v_start_at := (p_date + session.start_time) at time zone 'Asia/Taipei';
  v_end_at := (p_date + session.end_time) at time zone 'Asia/Taipei';
  if v_start_at < now() + (coalesce(st.min_lead_minutes, 30) || ' minutes')::interval then raise exception 'booking lead time exceeded'; end if;
  if p_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days, 30)) then raise exception 'booking window exceeded'; end if;
  if exists (
    select 1 from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = p_date and e.is_closed
       and (e.start_time is null or (e.start_time < session.end_time and coalesce(e.end_time, '23:59:59.999999'::time) > session.start_time))
  ) then raise exception 'service session is closed'; end if;
  perform pg_advisory_xact_lock(hashtext('service-session:' || p_clinic_id::text || p_template_id::text || p_date::text));
  perform pg_advisory_xact_lock(hashtext('customer:' || p_clinic_id::text || p_patient_id::text || p_date::text));
  if exists (
    select 1 from public.appointments
     where clinic_id = p_clinic_id and patient_id = p_patient_id and status in ('booked', 'confirmed', 'done')
       and (start_at at time zone 'Asia/Taipei')::date = p_date
  ) then raise exception 'customer already has a booking on this date'; end if;
  select count(*) filter (where a.status in ('booked', 'confirmed', 'done')), coalesce(max(a.queue_number), 0)
    into v_used, v_no
    from public.appointments a
   where a.clinic_id = p_clinic_id and a.template_id = p_template_id and a.doctor_id is null and a.service_id = p_service_id and a.start_at = v_start_at;
  if v_used >= session.capacity then raise exception 'service session is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, v_start_at, v_end_at, null) then raise exception 'service resource is unavailable'; end if;
  v_no := v_no + 1;
  v_dep := coalesce(st.deposit_enabled, false) and (st.deposit_scope = 'all' or (st.deposit_scope = 'self_pay' and p_is_self_pay));
  insert into public.appointments (
    clinic_id, doctor_id, patient_id, template_id, service_id, start_at, end_at, visit_type, queue_number, is_self_pay, booking_answers,
    deposit_status, deposit_amount, deposit_expires_at
  ) values (
    p_clinic_id, null, p_patient_id, p_template_id, p_service_id, v_start_at, v_end_at, p_visit_type, v_no, p_is_self_pay, coalesce(p_booking_answers, '{}'::jsonb),
    case when v_dep then 'pending' else 'none' end,
    case when v_dep then coalesce(st.deposit_amount, 0) else 0 end,
    case when v_dep then now() + interval '15 minutes' else null end
  ) returning id into v_id;
  return query select v_id, v_no;
end;
$$;

create or replace function public.book_service_session_with_membership(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_template_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_row record;
  v_membership_id uuid;
begin
  select * into base_row from public.book_service_session(p_clinic_id, p_service_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_booking_answers);
  if nullif(trim(p_membership_code), '') is null then return query select base_row.appointment_id, base_row.queue_number; return; end if;
  select id into v_membership_id
    from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code))
   for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', base_row.appointment_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = base_row.appointment_id and clinic_id = p_clinic_id;
  return query select base_row.appointment_id, base_row.queue_number;
end;
$$;

create or replace function public.cancel_registration_for_customer(
  p_clinic_id uuid,
  p_registration_id uuid,
  p_patient_id uuid
)
returns table (registration_id uuid, registration_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_patient_id is null or not exists (
    select 1 from public.registrations
     where id = p_registration_id and clinic_id = p_clinic_id and patient_id = p_patient_id
  ) then raise exception 'registration customer does not match'; end if;
  return query select * from public.cancel_registration_by_id(p_clinic_id, p_registration_id, null);
end;
$$;

revoke all on function public.get_available_service_slots(uuid, uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.get_available_service_sessions(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.book_service_slot(uuid, uuid, uuid, timestamptz, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.book_service_slot_with_membership(uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.book_service_session(uuid, uuid, uuid, uuid, date, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.book_service_session_with_membership(uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_registration_for_customer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_available_service_slots(uuid, uuid, date, text, uuid) to service_role;
grant execute on function public.get_available_service_sessions(uuid, uuid, date) to service_role;
grant execute on function public.book_service_slot(uuid, uuid, uuid, timestamptz, text, boolean, jsonb) to service_role;
grant execute on function public.book_service_slot_with_membership(uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb) to service_role;
grant execute on function public.book_service_session(uuid, uuid, uuid, uuid, date, text, boolean, jsonb) to service_role;
grant execute on function public.book_service_session_with_membership(uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb) to service_role;
grant execute on function public.cancel_registration_for_customer(uuid, uuid, uuid) to service_role;

commit;
