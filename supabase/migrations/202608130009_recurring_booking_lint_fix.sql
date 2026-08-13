-- Remove the redundant declaration shadowed by the integer FOR-loop variable.
begin;

create or replace function public.book_recurring_appointments(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_template_id uuid, p_date date,
  p_visit_type text, p_is_self_pay boolean, p_membership_code text,
  p_booking_answers jsonb, p_booking_form_snapshot jsonb, p_addon_ids uuid[],
  p_occurrence_count integer, p_interval_weeks integer default 1
)
returns table (appointment_id uuid, occurrence_number integer, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings record;
  v_series_id uuid;
  v_id uuid;
  v_queue integer;
  v_row record;
begin
  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found or not coalesce(v_settings.recurring_booking_enabled, false) then raise exception 'recurring booking is disabled'; end if;
  if coalesce(v_settings.deposit_enabled, false) then raise exception 'recurring booking is unavailable while deposit is enabled'; end if;
  if p_occurrence_count < 2 or p_occurrence_count > least(12, coalesce(v_settings.max_recurring_occurrences, 8)) then raise exception 'invalid recurring occurrence count'; end if;
  if p_interval_weeks < 1 or p_interval_weeks > 4 then raise exception 'invalid recurring interval'; end if;
  insert into public.appointment_series (clinic_id, patient_id, service_id, occurrence_count, interval_weeks)
  values (p_clinic_id, p_patient_id, p_service_id, p_occurrence_count, p_interval_weeks)
  returning id into v_series_id;
  for v_index in 1..p_occurrence_count loop
    v_queue := null;
    if v_settings.booking_mode = 'time' then
      if p_start_at is null then raise exception 'recurring time booking requires start time'; end if;
      v_id := public.book_time_slot_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_start_at + ((v_index - 1) * p_interval_weeks || ' weeks')::interval, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids);
    else
      if p_template_id is null or p_date is null then raise exception 'recurring session booking requires template and date'; end if;
      select row.appointment_id, row.queue_number into v_row from public.book_number_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_template_id, p_date + ((v_index - 1) * p_interval_weeks * 7), p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids) row;
      v_id := v_row.appointment_id; v_queue := v_row.queue_number;
    end if;
    update public.appointments set series_id = v_series_id, series_sequence = v_index where id = v_id and clinic_id = p_clinic_id;
    appointment_id := v_id; occurrence_number := v_index; queue_number := v_queue;
    return next;
  end loop;
end;
$$;

revoke all on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) to service_role;

commit;
