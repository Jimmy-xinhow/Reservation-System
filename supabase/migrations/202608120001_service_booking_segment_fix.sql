-- Fix time-mode service bookings: book_time_slot does not persist template_id,
-- so the service wrapper must resolve the already-validated schedule segment
-- from the appointment's Taipei date and time.
begin;

create or replace function public.book_time_slot_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_appointment record;
  v_settings record;
  v_segment record;
  v_end_at timestamptz;
  v_minutes integer;
  v_date date;
  v_time time;
begin
  v_id := public.book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is null then return v_id; end if;

  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  select * into v_appointment from public.appointments where id = v_id and clinic_id = p_clinic_id for update;
  v_minutes := public.service_booking_minutes(
    p_clinic_id,
    p_service_id,
    greatest(1, extract(epoch from (v_appointment.end_at - v_appointment.start_at))::integer / 60),
    p_visit_type,
    coalesce(v_settings.first_visit_extends, false),
    v_settings.first_visit_minutes
  );
  v_end_at := v_appointment.start_at + (v_minutes || ' minutes')::interval;
  v_date := (v_appointment.start_at at time zone 'Asia/Taipei')::date;
  v_time := (v_appointment.start_at at time zone 'Asia/Taipei')::time;

  select segment.start_time, segment.end_time
    into v_segment
    from (
      select template.start_time, template.end_time
        from public.schedule_templates template
       where template.clinic_id = p_clinic_id
         and template.doctor_id = p_doctor_id
         and template.weekday = extract(dow from v_date)
         and template.active
         and v_time >= template.start_time
         and v_time < template.end_time
         and not exists (
           select 1
             from public.schedule_exceptions exception
            where exception.clinic_id = p_clinic_id
              and exception.doctor_id = p_doctor_id
              and exception.date = v_date
              and exception.is_closed
              and exception.start_time is null
         )
      union all
      select exception.start_time, exception.end_time
        from public.schedule_exceptions exception
       where exception.clinic_id = p_clinic_id
         and exception.doctor_id = p_doctor_id
         and exception.date = v_date
         and not exception.is_closed
         and v_time >= exception.start_time
         and v_time < exception.end_time
    ) segment
   limit 1;

  if v_segment.end_time is null
     or v_end_at > ((v_date + v_segment.end_time) at time zone 'Asia/Taipei') then
    raise exception 'service duration exceeds schedule segment';
  end if;
  if exists (
    select 1
      from public.appointments appointment
     where appointment.id <> v_id
       and appointment.clinic_id = p_clinic_id
       and appointment.doctor_id = p_doctor_id
       and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < v_end_at
       and appointment.end_at > v_appointment.start_at
  ) then
    raise exception 'service duration slot is full';
  end if;
  if not public.service_resources_available(
    p_clinic_id,
    p_service_id,
    v_appointment.start_at,
    v_end_at,
    v_id
  ) then
    raise exception 'service resource is unavailable';
  end if;

  update public.appointments
     set end_at = v_end_at
   where id = v_id
     and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid)
  to service_role;

commit;
