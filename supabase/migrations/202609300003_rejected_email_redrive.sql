-- An operator may re-send only an email that the provider definitively rejected.
-- The claim and recipient correction are one transaction; ambiguous/sent attempts
-- never become retryable. Each manual claim retains its actor and outcome.
begin;

create table if not exists public.email_redrive_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  source text not null check (source in ('appointment', 'reminder')),
  notification_kind text not null,
  notification_log_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  status text not null default 'claimed' check (status in ('claimed', 'delivering', 'sent', 'rejected', 'aborted', 'uncertain')),
  error_code text check (error_code in ('provider_rejected', 'preflight_failed', 'delivery_uncertain')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists email_redrive_events_clinic_time_idx
  on public.email_redrive_events (clinic_id, created_at desc);
alter table public.email_redrive_events enable row level security;
revoke all on public.email_redrive_events from public, anon, authenticated;
grant all on public.email_redrive_events to service_role;

create or replace function public.claim_rejected_email_redrive(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_source text,
  p_kind text,
  p_actor_user_id uuid,
  p_email text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_appointment public.appointments%rowtype;
  v_patient public.patients%rowtype;
  v_log_id uuid;
  v_redrive_id uuid;
  v_email text := lower(btrim(p_email));
begin
  if not exists (
    select 1 from public.clinic_members m
    where m.clinic_id = p_clinic_id and m.user_id = p_actor_user_id
      and (m.access_type = 'brand_admin' or 'operations.manage' = any(m.permissions)
        or m.role in ('owner', 'admin', 'frontdesk'))
  ) then raise exception 'email redrive actor is not allowed'; end if;
  if v_email is null or length(v_email) > 200 or
     v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid recipient email';
  end if;
  if p_source is null or p_kind is null or p_source not in ('appointment', 'reminder') or
     (p_source = 'reminder' and p_kind <> 'reminder') or
     (p_source = 'appointment' and p_kind not in ('pending', 'confirmed', 'cancelled', 'rescheduled')) then
    raise exception 'invalid redrive source';
  end if;
  select * into v_appointment from public.appointments
    where id = p_appointment_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'appointment not found'; end if;
  if p_source = 'reminder' and
     (v_appointment.status not in ('booked', 'confirmed') or v_appointment.start_at <= now()) then
    raise exception 'reminder is no longer applicable';
  end if;
  if p_source = 'appointment' and v_appointment.start_at <= now() then
    raise exception 'notification is no longer applicable';
  end if;
  if p_source = 'appointment' and (
     (p_kind = 'pending' and (v_appointment.status <> 'booked' or v_appointment.deposit_status <> 'pending')) or
     (p_kind = 'confirmed' and (v_appointment.status not in ('booked', 'confirmed') or v_appointment.deposit_status = 'pending')) or
     (p_kind = 'cancelled' and v_appointment.status <> 'cancelled') or
     (p_kind = 'rescheduled' and v_appointment.status not in ('booked', 'confirmed'))
  ) then raise exception 'notification is no longer applicable'; end if;
  select * into v_patient from public.patients
    where id = v_appointment.patient_id and clinic_id = p_clinic_id and active = true for update;
  if not found then raise exception 'patient not found'; end if;

  if p_source = 'appointment' then
    select id into v_log_id from public.appointment_notification_logs
      where clinic_id = p_clinic_id and appointment_id = p_appointment_id
        and kind = p_kind and channel = 'email' and status = 'failed'
        and error = 'delivery_error:provider_rejected' for update;
    if not found then raise exception 'email is not definitively rejected'; end if;
    update public.appointment_notification_logs
      set status = 'sending', error = null, attempt_count = attempt_count + 1,
          sent_at = null, updated_at = now()
      where id = v_log_id;
  else
    select id into v_log_id from public.reminder_logs
      where clinic_id = p_clinic_id and appointment_id = p_appointment_id
        and channel = 'email' and result = 'failed'
        and error = 'delivery_error:provider_rejected' for update;
    if not found then raise exception 'email is not definitively rejected'; end if;
    update public.reminder_logs
      set result = 'sending', error = null, sent_at = now()
      where id = v_log_id;
  end if;

  if v_patient.email is distinct from v_email then
    update public.patients set email = v_email where id = v_patient.id and clinic_id = p_clinic_id;
  end if;
  insert into public.email_redrive_events
    (clinic_id, appointment_id, source, notification_kind, notification_log_id, actor_id)
    values (p_clinic_id, p_appointment_id, p_source, p_kind, v_log_id, p_actor_user_id)
    returning id into v_redrive_id;
  return v_redrive_id;
end;
$$;
revoke all on function public.claim_rejected_email_redrive(uuid,uuid,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_rejected_email_redrive(uuid,uuid,text,text,uuid,text)
  to service_role;

notify pgrst, 'reload schema';
commit;
