-- Allow a service/resource booking to be rescheduled without inventing a provider.
begin;

create or replace function public.reschedule_service_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid default null,
  p_service_id uuid default null,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_appt record;
  new_appointment_id uuid;
  new_queue_number integer;
  v_service_id uuid;
  v_answers jsonb;
begin
  select patient_id, visit_type, is_self_pay, membership_id, service_id, booking_answers, status
    into old_appt
    from public.appointments
   where id = p_old_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;

  v_service_id := coalesce(p_service_id, old_appt.service_id);
  v_answers := coalesce(old_appt.booking_answers, '{}'::jsonb);
  if p_doctor_id is null and v_service_id is null then
    raise exception 'service or provider is required';
  end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'doctor is unavailable'; end if;
  if v_service_id is not null and not exists (
    select 1 from public.services where id = v_service_id and clinic_id = p_clinic_id and active
  ) then raise exception 'service is unavailable'; end if;

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    if p_doctor_id is null then
      new_appointment_id := public.book_service_slot(
        p_clinic_id, v_service_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_answers
      );
    else
      new_appointment_id := public.book_time_slot(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      );
    end if;
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    if p_doctor_id is null then
      select appointment_id, queue_number into new_appointment_id, new_queue_number
        from public.book_service_session(
          p_clinic_id, v_service_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_answers
        );
    else
      select appointment_id, queue_number into new_appointment_id, new_queue_number
        from public.book_number(
          p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_service_id
        );
    end if;
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform public.restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform public.consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update public.appointments
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id,
           booking_answers = v_answers
     where id = new_appointment_id and clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments
       set service_id = v_service_id, booking_answers = v_answers
     where id = new_appointment_id and clinic_id = p_clinic_id;
  end if;

  update public.appointments set status = 'cancelled' where id = p_old_appointment_id and clinic_id = p_clinic_id;
  update public.appointment_status_events
     set note = 'rescheduled appointment'
   where id = (
     select id from public.appointment_status_events
      where appointment_id = p_old_appointment_id
        and clinic_id = p_clinic_id
        and to_status = 'cancelled'
      order by created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) from public, anon, authenticated;
grant execute on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) to service_role;

commit;
