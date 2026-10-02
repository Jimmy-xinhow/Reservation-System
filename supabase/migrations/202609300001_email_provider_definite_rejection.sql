-- Keep confirmed Resend 422 rejections visible without retrying the same payload.
-- Ambiguous transport/server responses remain reserved for investigation.
begin;

create or replace function claim_crm_delivery(
  p_clinic_id uuid, p_automation_id uuid, p_patient_id uuid,
  p_trigger_key text, p_channel text, p_appointment_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from crm_automations where id = p_automation_id and clinic_id = p_clinic_id and active and archived_at is null
  ) or not exists (
    select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'CRM 資料不屬於指定租戶';
  end if;
  insert into crm_delivery_logs(
    clinic_id, automation_id, patient_id, appointment_id, trigger_key, channel
  ) values (
    p_clinic_id, p_automation_id, p_patient_id, p_appointment_id, p_trigger_key, p_channel
  ) on conflict (automation_id, patient_id, trigger_key, channel) do update
    set status = 'pending', error = null, attempt_count = crm_delivery_logs.attempt_count + 1,
        attempted_at = now()
    where crm_delivery_logs.status = 'failed'
      and crm_delivery_logs.error is distinct from 'delivery_error:provider_rejected'
      and crm_delivery_logs.attempted_at < now() - interval '10 minutes'
  returning id into v_id;
  return v_id;
end; $$;

create or replace function claim_reminder(
  p_appointment_id uuid, p_channel text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing public.reminder_logs;
  claimed_id uuid;
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.appointments where id = p_appointment_id;
  if not found then raise exception '找不到預約'; end if;
  perform pg_advisory_xact_lock(hashtext('reminder:' || p_appointment_id::text || ':' || p_channel));
  select * into existing from public.reminder_logs
   where appointment_id=p_appointment_id and channel=p_channel;
  if found then
    if existing.result = 'sent' or (existing.result = 'failed' and existing.error = 'delivery_error:provider_rejected') then return null; end if;
    if existing.result = 'sending' then raise exception 'notification_delivery_unconfirmed'; end if;
    update public.reminder_logs set result='sending', error=null, sent_at=now() where id=existing.id returning id into claimed_id;
    return claimed_id;
  end if;
  insert into public.reminder_logs(clinic_id, appointment_id, channel, result, sent_at)
    values (v_clinic_id, p_appointment_id, p_channel, 'sending', now())
    returning id into claimed_id;
  return claimed_id;
end; $$;

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
       and notification.error is distinct from 'delivery_error:provider_rejected'

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

create or replace function public.claim_appointment_waitlist_notifications_for_scope(p_clinic_id uuid,p_waitlist_ids uuid[],p_limit integer default 50)
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
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
  if p_clinic_id is null or p_waitlist_ids is null or cardinality(p_waitlist_ids) not between 1 and 100 or array_position(p_waitlist_ids,null) is not null or (select count(distinct x) from unnest(p_waitlist_ids)x)<>cardinality(p_waitlist_ids) then raise exception 'invalid record selection'; end if;
  if not exists(select 1 from public.clinics where id=p_clinic_id and active) then return; end if;
  if p_limit not between 1 and 200 then raise exception 'invalid claim limit'; end if;
  return query
  with candidates as (
    select notification.id
      from public.appointment_waitlist_notification_logs notification
     where notification.clinic_id=p_clinic_id and notification.waitlist_id=any(p_waitlist_ids) and ((
       notification.status in ('pending', 'failed') and notification.attempt_count < 5
       and notification.error is distinct from 'delivery_error:provider_rejected'

     )
     ) order by notification.created_at, notification.id
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

revoke all on function public.claim_crm_delivery(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_crm_delivery(uuid,uuid,uuid,text,text,uuid) to service_role;
revoke all on function public.claim_reminder(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_reminder(uuid,text) to service_role;
revoke all on function public.claim_appointment_waitlist_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_appointment_waitlist_notifications(integer) to service_role;
revoke all on function public.claim_appointment_waitlist_notifications_for_scope(uuid,uuid[],integer) from public,anon,authenticated;
grant execute on function public.claim_appointment_waitlist_notifications_for_scope(uuid,uuid[],integer) to service_role;
commit;
