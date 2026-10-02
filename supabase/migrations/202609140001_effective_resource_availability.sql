-- G1-03: report effective resource capacity and scope provider slots to the selected service.
begin;

create or replace function public.service_resource_remaining(
 p_clinic_id uuid, p_service_id uuid, p_start_at timestamptz, p_end_at timestamptz
)
returns integer
language sql stable security definer
set search_path = public, extensions
as $$
 -- NULL means no assigned resource limit. LEAST(schedule_remaining, NULL)
 -- retains the schedule limit. Match the existing booking resource guard.
 select min(case when not resource.active then 0 else
   greatest(0, floor((resource.capacity - (
     select coalesce(sum(used.quantity), 0)
     from public.appointments appointment
     join public.service_resource_assignments used
       on used.clinic_id = appointment.clinic_id and used.service_id = appointment.service_id
      and used.resource_id = required.resource_id
     where appointment.clinic_id = p_clinic_id
       and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < p_end_at and appointment.end_at > p_start_at
   ))::numeric / required.quantity))::integer end)
 from public.service_resource_assignments required
 join public.service_resources resource on resource.id = required.resource_id and resource.clinic_id = required.clinic_id
 where required.clinic_id = p_clinic_id and required.service_id = p_service_id;
$$;
revoke all on function public.service_resource_remaining(uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.service_resource_remaining(uuid,uuid,timestamptz,timestamptz) to service_role;

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
    select c.s, c.e, least((rec.capacity - count(a.id))::integer, public.service_resource_remaining(p_clinic_id, p_service_id, c.s, c.e))
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

create or replace function public.get_available_service_slots_with_options(
  p_clinic_id uuid,
  p_service_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_doctor_id uuid default null,
  p_addon_ids uuid[] default '{}'::uuid[]
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
  v_ids uuid[] := array(select distinct id from unnest(coalesce(p_addon_ids, '{}'::uuid[])) as id order by id);
  v_addon_count integer;
  v_addon_minutes integer;
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select booking_target into v_target from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if v_target = 'provider_required' and p_doctor_id is null then raise exception 'provider is required for this service'; end if;
  if p_doctor_id is not null and not exists (select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active) then raise exception 'provider not found'; end if;
  select count(*), coalesce(sum(duration_minutes), 0) into v_addon_count, v_addon_minutes
    from public.service_addons where clinic_id = p_clinic_id and service_id = p_service_id and active and id = any(v_ids);
  if v_addon_count <> cardinality(v_ids) then raise exception 'one or more add-ons are invalid'; end if;

  for rec in
    select t.id as template_id, t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.weekday = v_weekday and t.active
       and (t.service_id is null or t.service_id = p_service_id)
       and ((p_doctor_id is not null and t.doctor_id = p_doctor_id) or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id))
       and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.date = p_date and e.is_closed and e.start_time is null and ((p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id)) or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)))
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
       and ((p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id)) or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id))
  loop
    v_slot_length := public.service_booking_minutes(p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes) + v_addon_minutes;
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as starts_at,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as ends_at
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select candidate.starts_at, candidate.ends_at, least((rec.capacity - count(appointment.id))::integer, public.service_resource_remaining(p_clinic_id, p_service_id, candidate.starts_at, candidate.ends_at))
      from candidate
      left join public.appointments appointment
        on appointment.clinic_id = p_clinic_id and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < candidate.ends_at and appointment.end_at > candidate.starts_at
       and ((p_doctor_id is not null and appointment.doctor_id = p_doctor_id) or (p_doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id))
     where candidate.starts_at > now() + (v_lead || ' minutes')::interval
       and public.service_resources_available(p_clinic_id, p_service_id, candidate.starts_at, candidate.ends_at, null)
       and not exists (
         select 1 from public.schedule_exceptions closed
          where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed and closed.start_time is not null
            and ((p_doctor_id is not null and closed.doctor_id = p_doctor_id and (closed.service_id is null or closed.service_id = p_service_id)) or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id))
            and (candidate.starts_at at time zone 'Asia/Taipei')::time < closed.end_time
            and (candidate.ends_at at time zone 'Asia/Taipei')::time > closed.start_time
       )
     group by candidate.starts_at, candidate.ends_at, rec.capacity
    having rec.capacity - count(appointment.id) > 0
     order by candidate.starts_at;
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
         least(greatest(0, x.capacity - count(a.id))::integer, public.service_resource_remaining(p_clinic_id, p_service_id,
           ((p_date + x.start_time) at time zone 'Asia/Taipei'), ((p_date + x.end_time) at time zone 'Asia/Taipei')))
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

create or replace function public.get_available_sessions_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_service_id uuid
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz, total integer, taken integer, remaining integer)
language sql
security definer
set search_path = public, extensions
as $$
  select session.template_id, session.session_start, session.session_end, session.total, session.taken, least(session.remaining, public.service_resource_remaining(p_clinic_id, p_service_id, session.session_start, session.session_end))
    from public.get_available_sessions(p_clinic_id, p_doctor_id, p_date) session
   where (p_service_id is null or exists (
     select 1 from public.schedule_templates t where t.clinic_id = p_clinic_id and t.id = session.template_id and (t.service_id is null or t.service_id = p_service_id)
     union all
     select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.id = session.template_id and (e.service_id is null or e.service_id = p_service_id)
   )) and public.service_resources_available(p_clinic_id, p_service_id, session.session_start, session.session_end, null);
$$;

create or replace function public.get_available_slots_for_service(
 p_clinic_id uuid, p_doctor_id uuid, p_date date,
 p_visit_type text default 'return', p_service_id uuid default null
)
returns table(slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql security definer
set search_path = public, extensions
as $$
begin
 if p_service_id is null then
   return query select * from public.get_available_slots(p_clinic_id,p_doctor_id,p_date,p_visit_type);
 else
   return query select * from public.get_available_service_slots(p_clinic_id,p_service_id,p_date,p_visit_type,p_doctor_id);
 end if;
end;
$$;

commit;
