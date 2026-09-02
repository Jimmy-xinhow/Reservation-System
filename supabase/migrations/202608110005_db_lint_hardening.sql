-- Resolve PL/pgSQL output-column ambiguity reported by `supabase db lint`
-- without changing business behavior or grants.
begin;

create or replace function public.create_brand_with_owner(
  p_actor_user_id uuid,
  p_source_clinic_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
) returns table (clinic_id uuid, clinic_name text, clinic_slug text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_source_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then
    raise exception '無權限建立品牌';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception '品牌名稱格式錯誤'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then
    raise exception '品牌短網址格式錯誤';
  end if;

  insert into public.clinics (name, slug, phone, address)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
  returning id into v_id;

  insert into public.clinic_settings (clinic_id) values (v_id)
  on conflict on constraint clinic_settings_pkey do nothing;
  insert into public.clinic_members (clinic_id, user_id, role)
  values (v_id, p_actor_user_id, 'owner');

  return query select v_id, v_name, v_slug;
exception
  when unique_violation then
    raise exception '品牌短網址已存在' using errcode = '23505';
end;
$$;

create or replace function public.create_brand_with_platform_admin(
  p_actor_user_id uuid,
  p_owner_user_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
)
returns table (clinic_id uuid, owner_user_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.platform_admins platform_admin
     where platform_admin.user_id = p_actor_user_id and platform_admin.active
  ) then
    raise exception 'platform admin access required';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'invalid brand name'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception 'invalid brand slug'; end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = p_owner_user_id) then
    raise exception 'owner user not found';
  end if;

  insert into public.clinics (name, slug, phone, address, active)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''), true)
  returning id into v_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role)
  values (v_clinic_id, p_owner_user_id, 'owner')
  on conflict on constraint clinic_members_pkey do update set role = 'owner';

  return query select v_clinic_id, p_owner_user_id;
exception
  when unique_violation then
    raise exception 'brand slug already exists' using errcode = '23505';
end;
$$;

create or replace function public.grant_patient_membership(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_plan_id uuid,
  p_actor_user_id uuid,
  p_source text default 'manual',
  p_note text default null
) returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  plan_row record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  if p_source not in ('manual', 'purchase', 'migration') then raise exception 'invalid membership source'; end if;
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role <> 'provider'
  ) then raise exception 'membership actor is not allowed'; end if;
  if not exists (
    select 1 from public.patients patient
     where patient.id = p_patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then raise exception 'patient not found'; end if;
  select plan.* into plan_row
    from public.membership_plans plan
   where plan.id = p_plan_id and plan.clinic_id = p_clinic_id and plan.active;
  if not found then raise exception 'membership plan not found'; end if;
  if plan_row.valid_days is not null then
    v_expires := now() + (plan_row.valid_days || ' days')::interval;
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (
      select 1 from public.patient_memberships membership
       where membership.clinic_id = p_clinic_id and membership.membership_code = v_code
    );
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
  values
    (p_clinic_id, p_patient_id, p_plan_id, v_code, plan_row.credits_total, plan_row.credits_total, now(), v_expires, p_source, nullif(btrim(p_note), ''))
  returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, actor_id, note)
  values
    (p_clinic_id, v_id, p_patient_id, 'grant', plan_row.credits_total, 'manual', p_actor_user_id, p_note);
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;

create or replace function public.grant_paid_membership_from_order(
  p_clinic_id uuid,
  p_payment_order_id uuid
)
returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_row record;
  plan_row record;
  existing record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  select payment_order.id, payment_order.status, payment_order.clinic_id, payment_order.patient_id, payment_order.membership_plan_id
    into order_row
    from public.payment_orders payment_order
   where payment_order.id = p_payment_order_id and payment_order.clinic_id = p_clinic_id
   for update;
  if not found or order_row.membership_plan_id is null or order_row.patient_id is null then
    raise exception 'membership payment order not found';
  end if;
  if order_row.status <> 'paid' then raise exception 'membership payment is not paid'; end if;
  select membership.id, membership.membership_code, membership.expires_at, membership.credits_remaining
    into existing
    from public.patient_memberships membership
   where membership.payment_order_id = p_payment_order_id;
  if found then
    return query select existing.id, existing.membership_code, existing.expires_at, existing.credits_remaining;
    return;
  end if;
  select plan.* into plan_row
    from public.membership_plans plan
   where plan.id = order_row.membership_plan_id and plan.clinic_id = p_clinic_id;
  if not found then raise exception 'membership plan not found'; end if;
  if not exists (
    select 1 from public.patients patient
     where patient.id = order_row.patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then raise exception 'patient not found'; end if;
  if plan_row.valid_days is not null then
    v_expires := now() + (plan_row.valid_days || ' days')::interval;
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (
      select 1 from public.patient_memberships membership
       where membership.clinic_id = p_clinic_id and membership.membership_code = v_code
    );
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, payment_order_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
  values
    (p_clinic_id, order_row.patient_id, order_row.membership_plan_id, p_payment_order_id, v_code, plan_row.credits_total, plan_row.credits_total, now(), v_expires, 'purchase', 'membership payment purchase')
  returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, note)
  values
    (p_clinic_id, v_id, order_row.patient_id, 'grant', plan_row.credits_total, 'payment_order', p_payment_order_id, 'membership payment purchase');
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;

create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_ticket_type_id uuid,
  p_name text,
  p_phone text,
  p_email text default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb,
  p_access_token text default null,
  p_discount_code text default null,
  p_membership_code text default null,
  p_form_id uuid default null,
  p_form_version integer default null,
  p_terms_version integer default null,
  p_terms_accepted_at timestamptz default null,
  p_patient_id uuid default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  registration_result record;
begin
  if p_patient_id is not null and not exists (
    select 1 from public.patients patient
     where patient.id = p_patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then
    raise exception 'patient is not valid for this brand';
  end if;

  select * into registration_result from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations registration
     set terms_version = p_terms_version,
         terms_accepted_at = p_terms_accepted_at,
         patient_id = p_patient_id
   where registration.id = registration_result.registration_id
     and registration.clinic_id = p_clinic_id;
  update public.discount_redemptions redemption
     set patient_id = p_patient_id
   where redemption.clinic_id = p_clinic_id
     and redemption.registration_id = registration_result.registration_id;
  return query select
    registration_result.registration_id,
    registration_result.registration_no,
    registration_result.registration_status,
    registration_result.payment_status,
    registration_result.amount,
    registration_result.discount_amount,
    registration_result.membership_applied,
    registration_result.checkin_token;
end;
$$;

create or replace function public.reschedule_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null,
  p_service_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_appt record;
  new_appointment_id uuid;
  v_service_id uuid;
begin
  select appointment.patient_id, appointment.visit_type, appointment.is_self_pay,
         appointment.membership_id, appointment.service_id, appointment.status
    into old_appt
    from public.appointments appointment
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;
  v_service_id := coalesce(p_service_id, old_appt.service_id);

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    new_appointment_id := public.book_time_slot(
      p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
      old_appt.visit_type, old_appt.is_self_pay, v_service_id
    );
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    select booking.appointment_id into new_appointment_id
      from public.book_number(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      ) booking;
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
    update public.appointments appointment
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments appointment
       set service_id = v_service_id
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  end if;

  update public.appointments appointment
     set status = 'cancelled'
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id;
  update public.appointment_status_events status_event
     set note = 'rescheduled appointment'
   where status_event.id = (
     select latest_status.id from public.appointment_status_events latest_status
      where latest_status.appointment_id = p_old_appointment_id
        and latest_status.clinic_id = p_clinic_id
        and latest_status.to_status = 'cancelled'
      order by latest_status.created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

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
  v_service_id uuid;
  v_answers jsonb;
begin
  select appointment.patient_id, appointment.visit_type, appointment.is_self_pay,
         appointment.membership_id, appointment.service_id, appointment.booking_answers, appointment.status
    into old_appt
    from public.appointments appointment
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;

  v_service_id := coalesce(p_service_id, old_appt.service_id);
  v_answers := coalesce(old_appt.booking_answers, '{}'::jsonb);

  update public.appointments appointment
     set status = 'cancelled'
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id;
  if p_doctor_id is null and v_service_id is null then raise exception 'service or provider is required'; end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors doctor
     where doctor.id = p_doctor_id and doctor.clinic_id = p_clinic_id and doctor.active
  ) then raise exception 'doctor is unavailable'; end if;
  if v_service_id is not null and not exists (
    select 1 from public.services service
     where service.id = v_service_id and service.clinic_id = p_clinic_id and service.active
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
      select booking.appointment_id into new_appointment_id
        from public.book_service_session(
          p_clinic_id, v_service_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_answers
        ) booking;
    else
      select booking.appointment_id into new_appointment_id
        from public.book_number(
          p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_service_id
        ) booking;
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
    update public.appointments appointment
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id,
           booking_answers = v_answers
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments appointment
       set service_id = v_service_id, booking_answers = v_answers
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  end if;

  update public.appointments appointment
     set status = 'cancelled'
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id;
  update public.appointment_status_events status_event
     set note = 'rescheduled appointment'
   where status_event.id = (
     select latest_status.id from public.appointment_status_events latest_status
      where latest_status.appointment_id = p_old_appointment_id
        and latest_status.clinic_id = p_clinic_id
        and latest_status.to_status = 'cancelled'
      order by latest_status.created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.grant_patient_membership(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.grant_paid_membership_from_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, uuid, text, uuid, timestamptz, uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) from public, anon, authenticated;

grant execute on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.grant_patient_membership(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.grant_paid_membership_from_order(uuid, uuid) to service_role;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) to service_role;
grant execute on function public.reschedule_appointment(uuid, uuid, text, uuid, timestamptz, uuid, date, uuid) to service_role;
grant execute on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) to service_role;

commit;
