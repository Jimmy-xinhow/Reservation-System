-- Availability must include selected add-on duration, not only the base service.
begin;

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
    select candidate.starts_at, candidate.ends_at, (rec.capacity - count(appointment.id))::integer
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

revoke all on function public.get_available_service_slots_with_options(uuid, uuid, date, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_available_service_slots_with_options(uuid, uuid, date, text, uuid, uuid[]) to service_role;

commit;
