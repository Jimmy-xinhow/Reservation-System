-- Preserve a waiting entry when the target is still full. The applied 006
-- migration contained a mojibake replacement for the Chinese capacity marker.
begin;

create or replace function public.offer_next_appointment_waitlist(
  p_clinic_id uuid,
  p_target_key text,
  p_offer_minutes integer default 15
) returns table (waitlist_id uuid, appointment_id uuid, patient_id uuid, offer_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  candidate record;
  booking record;
  v_appointment_id uuid;
  v_offer_expires timestamptz;
  v_error text;
begin
  if p_offer_minutes not between 5 and 1440 then raise exception 'invalid waitlist offer duration'; end if;
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || p_target_key));
  for candidate in
    select * from public.appointment_waitlist_entries
     where clinic_id = p_clinic_id and target_key = p_target_key and status = 'waiting'
     order by position, created_at
     for update skip locked
  loop
    v_appointment_id := null;
    v_error := null;
    begin
      if candidate.booking_mode = 'time' then
        if candidate.doctor_id is null then
          v_appointment_id := public.book_service_slot(
            candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
          );
        elsif candidate.service_id is null then
          v_appointment_id := public.book_time_slot(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, null
          );
        else
          v_appointment_id := public.book_time_slot_for_service(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.service_id
          );
        end if;
      elsif candidate.doctor_id is null then
        select * into booking from public.book_service_session(
          candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
        );
        v_appointment_id := booking.appointment_id;
      elsif candidate.service_id is null then
        select * into booking from public.book_number(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, null
        );
        v_appointment_id := booking.appointment_id;
      else
        select * into booking from public.book_number_for_service(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.service_id
        );
        v_appointment_id := booking.appointment_id;
      end if;
    exception when others then
      v_error := sqlerrm;
    end;

    if v_appointment_id is null then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (candidate.clinic_id, candidate.id, candidate.target_key, 'promotion_failed', candidate.status, candidate.status, v_error);
      if v_error like '%額滿%'
         or v_error like '%capacity%'
         or v_error like '%slot is full%'
         or v_error like '%session is full%'
         or v_error like '%resource is unavailable%' then
        return;
      end if;
      update public.appointment_waitlist_entries
         set status = 'expired'
       where id = candidate.id and clinic_id = candidate.clinic_id;
      continue;
    end if;

    v_offer_expires := now() + (p_offer_minutes || ' minutes')::interval;
    update public.appointments
       set waitlist_entry_id = candidate.id,
           booking_answers = candidate.booking_answers,
           note = concat_ws(E'\n', nullif(note, ''), 'waitlist offer')
     where id = v_appointment_id and clinic_id = candidate.clinic_id;
    update public.appointment_waitlist_entries
       set status = 'offered', appointment_id = v_appointment_id,
           offered_at = now(), offer_expires_at = v_offer_expires
     where id = candidate.id and clinic_id = candidate.clinic_id;
    return query select candidate.id, v_appointment_id, candidate.patient_id, v_offer_expires;
    return;
  end loop;
end;
$$;

revoke all on function public.offer_next_appointment_waitlist(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.offer_next_appointment_waitlist(uuid, text, integer) to service_role;

commit;
