-- Product restructure M2: expose full-but-valid appointment targets and
-- claim waitlist notifications atomically without changing normal availability.
begin;

create or replace function public.get_appointment_waitlist_targets(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_service_id uuid,
  p_date date,
  p_visit_type text default 'return'
)
returns table (
  booking_mode text,
  template_id uuid,
  target_start timestamptz,
  target_end timestamptz,
  total integer,
  taken integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings record;
  schedule record;
  candidate record;
  v_length integer;
  v_taken integer;
  v_start timestamptz;
  v_end timestamptz;
  v_resources_available boolean;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  if p_doctor_id is null and p_service_id is null then raise exception 'service or provider is required'; end if;
  select * into settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found then raise exception 'brand settings not found'; end if;
  if p_date < (now() at time zone 'Asia/Taipei')::date
     or p_date > (now() at time zone 'Asia/Taipei')::date + settings.max_advance_days then
    return;
  end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'provider is unavailable'; end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and clinic_id = p_clinic_id and active
  ) then raise exception 'service is unavailable'; end if;

  if settings.booking_mode = 'time' then
    for schedule in
      select t.id, t.start_time, t.end_time, t.slot_minutes, t.capacity
        from public.schedule_templates t
       where t.clinic_id = p_clinic_id and t.weekday = extract(dow from p_date) and t.active
         and (
           (p_doctor_id is not null and t.doctor_id = p_doctor_id and (p_service_id is null or t.service_id is null or t.service_id = p_service_id))
           or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id)
         )
         and not exists (
           select 1 from public.schedule_exceptions closed
            where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed and closed.start_time is null
              and (
                (p_doctor_id is not null and closed.doctor_id = p_doctor_id and (p_service_id is null or closed.service_id is null or closed.service_id = p_service_id))
                or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)
              )
         )
      union all
      select e.id, e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
        from public.schedule_exceptions e
       where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
         and (
           (p_doctor_id is not null and e.doctor_id = p_doctor_id and (p_service_id is null or e.service_id is null or e.service_id = p_service_id))
           or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
         )
    loop
      v_length := case
        when p_service_id is not null then public.service_booking_minutes(
          p_clinic_id, p_service_id, schedule.slot_minutes, p_visit_type,
          coalesce(settings.first_visit_extends, false), settings.first_visit_minutes
        )
        when p_visit_type = 'first' and coalesce(settings.first_visit_extends, false)
          then coalesce(settings.first_visit_minutes, schedule.slot_minutes)
        else schedule.slot_minutes
      end;
      for candidate in
        select
          ((p_date + schedule.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as starts_at,
          ((p_date + schedule.start_time + ((n + v_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as ends_at
          from generate_series(
            0,
            (extract(epoch from (schedule.end_time - schedule.start_time)) / 60)::integer - v_length,
            schedule.slot_minutes
          ) n
      loop
        if candidate.starts_at <= now() + (coalesce(settings.min_lead_minutes, 30) || ' minutes')::interval then continue; end if;
        if exists (
          select 1 from public.schedule_exceptions closed
           where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed and closed.start_time is not null
             and (
               (p_doctor_id is not null and closed.doctor_id = p_doctor_id and (p_service_id is null or closed.service_id is null or closed.service_id = p_service_id))
               or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)
             )
             and (candidate.starts_at at time zone 'Asia/Taipei')::time < coalesce(closed.end_time, '23:59:59.999999'::time)
             and (candidate.ends_at at time zone 'Asia/Taipei')::time > closed.start_time
        ) then continue; end if;

        select count(*)::integer into v_taken
          from public.appointments appointment
         where appointment.clinic_id = p_clinic_id
           and appointment.status in ('booked', 'confirmed', 'done')
           and appointment.start_at < candidate.ends_at and appointment.end_at > candidate.starts_at
           and (
             (p_doctor_id is not null and appointment.doctor_id = p_doctor_id)
             or (p_doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id)
           );
        v_resources_available := p_service_id is null or public.service_resources_available(
          p_clinic_id, p_service_id, candidate.starts_at, candidate.ends_at, null
        );
        if v_taken >= schedule.capacity or not v_resources_available then
          return query select 'time'::text, null::uuid, candidate.starts_at, candidate.ends_at,
            schedule.capacity::integer, greatest(v_taken, schedule.capacity)::integer;
        end if;
      end loop;
    end loop;
  elsif settings.booking_mode = 'number' then
    for schedule in
      select t.id, t.start_time, t.end_time, t.capacity
        from public.schedule_templates t
       where t.clinic_id = p_clinic_id and t.weekday = extract(dow from p_date) and t.active
         and (
           (p_doctor_id is not null and t.doctor_id = p_doctor_id and (p_service_id is null or t.service_id is null or t.service_id = p_service_id))
           or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id)
         )
         and not exists (
           select 1 from public.schedule_exceptions closed
            where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed
              and (
                (p_doctor_id is not null and closed.doctor_id = p_doctor_id and (p_service_id is null or closed.service_id is null or closed.service_id = p_service_id))
                or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)
              )
              and (closed.start_time is null or (closed.start_time < t.end_time and coalesce(closed.end_time, '23:59:59.999999'::time) > t.start_time))
         )
      union all
      select e.id, e.start_time, e.end_time, coalesce(e.capacity, 40)
        from public.schedule_exceptions e
       where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
         and (
           (p_doctor_id is not null and e.doctor_id = p_doctor_id and (p_service_id is null or e.service_id is null or e.service_id = p_service_id))
           or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
         )
    loop
      v_start := (p_date + schedule.start_time) at time zone 'Asia/Taipei';
      v_end := (p_date + schedule.end_time) at time zone 'Asia/Taipei';
      if v_start <= now() + (coalesce(settings.min_lead_minutes, 30) || ' minutes')::interval then continue; end if;
      select count(*)::integer into v_taken
        from public.appointments appointment
       where appointment.clinic_id = p_clinic_id and appointment.template_id = schedule.id
         and appointment.start_at = v_start and appointment.status in ('booked', 'confirmed', 'done')
         and (
           (p_doctor_id is not null and appointment.doctor_id = p_doctor_id)
           or (p_doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id)
         );
      v_resources_available := p_service_id is null or public.service_resources_available(
        p_clinic_id, p_service_id, v_start, v_end, null
      );
      if v_taken >= schedule.capacity or not v_resources_available then
        return query select 'number'::text, schedule.id, v_start, v_end,
          schedule.capacity::integer, greatest(v_taken, schedule.capacity)::integer;
      end if;
    end loop;
  else
    raise exception 'invalid booking mode';
  end if;
end;
$$;

create or replace function public.claim_appointment_waitlist_notifications(p_limit integer default 50)
returns table (
  log_id uuid,
  clinic_id uuid,
  waitlist_id uuid,
  kind text,
  channel text,
  patient_name text,
  line_user_id text,
  email text,
  booking_mode text,
  requested_date date,
  target_start_at timestamptz,
  "position" integer,
  offer_expires_at timestamptz,
  appointment_id uuid,
  doctor_name text,
  service_name text,
  clinic_name text,
  line_destination text,
  email_enabled boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit not between 1 and 200 then raise exception 'invalid claim limit'; end if;
  return query
  with candidates as (
    select notification.id
      from public.appointment_waitlist_notification_logs notification
     where (
       notification.status in ('pending', 'failed') and notification.attempt_count < 5
     ) or (
       notification.status = 'claimed' and notification.updated_at < now() - interval '10 minutes' and notification.attempt_count < 5
     )
     order by notification.created_at, notification.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.appointment_waitlist_notification_logs notification
       set status = 'claimed', attempt_count = notification.attempt_count + 1, error = null
      from candidates
     where notification.id = candidates.id
    returning notification.*
  )
  select claimed.id, claimed.clinic_id, claimed.waitlist_id, claimed.kind, claimed.channel,
         patient.name, patient.line_user_id, patient.email,
         entry.booking_mode, entry.requested_date,
         coalesce(
           entry.requested_start_at,
           ((entry.requested_date + coalesce(template.start_time, schedule_exception.start_time)) at time zone 'Asia/Taipei')
         ),
         entry.position, entry.offer_expires_at, entry.appointment_id,
         doctor.name, service.name, clinic.name, clinic.line_destination,
         coalesce(settings.email_enabled, false)
    from claimed
    join public.appointment_waitlist_entries entry on entry.id = claimed.waitlist_id and entry.clinic_id = claimed.clinic_id
    join public.patients patient on patient.id = claimed.patient_id and patient.clinic_id = claimed.clinic_id
    join public.clinics clinic on clinic.id = claimed.clinic_id
    join public.clinic_settings settings on settings.clinic_id = claimed.clinic_id
    left join public.doctors doctor on doctor.id = entry.doctor_id and doctor.clinic_id = entry.clinic_id
    left join public.services service on service.id = entry.service_id and service.clinic_id = entry.clinic_id
    left join public.schedule_templates template on template.id = entry.template_id and template.clinic_id = entry.clinic_id
    left join public.schedule_exceptions schedule_exception on schedule_exception.id = entry.template_id and schedule_exception.clinic_id = entry.clinic_id
   order by claimed.created_at, claimed.id;
end;
$$;

create or replace function public.finish_appointment_waitlist_notification(
  p_log_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  changed integer;
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'invalid notification result'; end if;
  update public.appointment_waitlist_notification_logs
     set status = p_status,
         error = left(nullif(p_error, ''), 1000),
         sent_at = case when p_status = 'sent' then now() else null end
   where id = p_log_id and status = 'claimed';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.get_appointment_waitlist_targets(uuid, uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public.claim_appointment_waitlist_notifications(integer) from public, anon, authenticated;
revoke all on function public.finish_appointment_waitlist_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_appointment_waitlist_targets(uuid, uuid, uuid, date, text) to service_role;
grant execute on function public.claim_appointment_waitlist_notifications(integer) to service_role;
grant execute on function public.finish_appointment_waitlist_notification(uuid, text, text) to service_role;

commit;
