begin;
-- A transaction-local scope follows cancellation triggers into waitlist promotion.
-- Normal application/global cron calls leave this setting empty.
create or replace function public.promote_waitlist_after_appointment_cancel()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare target record; scope jsonb; allowed uuid[];
begin
 if old.status in ('booked','confirmed','done') and new.status='cancelled' then
  scope:=nullif(current_setting('app.registration_cron_scope',true),'')::jsonb;
  if scope is not null then
   if scope->>'clinic_id'<>old.clinic_id::text then raise exception 'cron scope excludes affected waitlist'; end if;
   allowed:=array(select value::uuid from jsonb_array_elements_text(scope->'waitlist_ids'));
  end if;
  for target in select target_key,min(created_at) as first_joined
   from public.appointment_waitlist_entries
   where clinic_id=old.clinic_id and requested_date=(old.start_at at time zone 'Asia/Taipei')::date and status='waiting'
   group by target_key order by first_joined,target_key
  loop
   if scope is not null then
    -- join and promotion use this same lock; recheck after acquiring it.
    perform pg_advisory_xact_lock(hashtext('appointment-waitlist:'||old.clinic_id::text||':'||target.target_key));
    if exists(select 1 from public.appointment_waitlist_entries where clinic_id=old.clinic_id
      and target_key=target.target_key and status='waiting' and not(id=any(allowed)))
    then raise exception 'cron scope excludes affected waitlist'; end if;
   end if;
   begin
    perform public.offer_next_appointment_waitlist(old.clinic_id,target.target_key,15);
   exception when others then
    insert into public.appointment_waitlist_events(clinic_id,target_key,kind,from_status,to_status,appointment_id,error)
    values(old.clinic_id,target.target_key,'promotion_failed',old.status,new.status,old.id,sqlerrm);
   end;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.promote_waitlist_after_appointment_cancel() from public,anon,authenticated;

create or replace function public.process_registration_cron_scope(
 p_clinic_id uuid,p_registration_ids uuid[],p_appointment_ids uuid[],p_membership_payment_ids uuid[],p_waitlist_ids uuid[]
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 ids uuid[]; r record; a record; w record; s record;
 regs uuid[]:='{}'::uuid[]; appts uuid[]:='{}'::uuid[]; waits uuid[]:='{}'::uuid[];
 expired integer:=0; expired_appts integer:=0; expired_memberships integer:=0; expired_offers integer:=0; benefits integer:=0;
 previous_scope text:=current_setting('app.registration_cron_scope',true);
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
 if p_clinic_id is null then raise exception 'clinic is required'; end if;
 -- Validate separately: arrays may differ in length and must not be assembled as a matrix.
 for ids in select x from (values(p_registration_ids),(p_appointment_ids),(p_membership_payment_ids),(p_waitlist_ids)) v(x) loop
  if ids is null or cardinality(ids)>100 or array_position(ids,null) is not null
   or (select count(distinct x) from unnest(ids)x)<>cardinality(ids) then raise exception 'invalid record selection'; end if;
 end loop;
 if cardinality(p_registration_ids)+cardinality(p_appointment_ids)+cardinality(p_membership_payment_ids)+cardinality(p_waitlist_ids)=0 then raise exception 'empty record selection'; end if;
 if exists(select 1 from public.clinics where id=p_clinic_id and active) then
  select coalesce(array_agg(id),'{}'::uuid[]) into regs from public.registrations where clinic_id=p_clinic_id and id=any(p_registration_ids);
  select coalesce(array_agg(id),'{}'::uuid[]) into waits from public.appointment_waitlist_entries where clinic_id=p_clinic_id and id=any(p_waitlist_ids);
  select coalesce(array_agg(id),'{}'::uuid[]) into appts from public.appointments where clinic_id=p_clinic_id and
   (id=any(p_appointment_ids) or id in(select appointment_id from public.appointment_waitlist_entries where clinic_id=p_clinic_id and id=any(waits)));
  perform set_config('app.registration_cron_scope',jsonb_build_object('clinic_id',p_clinic_id,'waitlist_ids',waits)::text,true);
  -- Existing registration creation/promotion serializes on session + event locks.
  for s in select es.id,es.event_id from public.event_sessions es where es.clinic_id=p_clinic_id and es.id in(
   select session_id from public.registrations where clinic_id=p_clinic_id and id=any(regs) and status='pending' and payment_status='pending' and expires_at<=now()) order by es.id for update
  loop
   perform pg_advisory_xact_lock(hashtext('registration-event:'||p_clinic_id::text||':'||s.event_id::text));
   if exists(select 1 from public.waitlist_entries we join public.registrations reg on reg.id=we.registration_id and reg.clinic_id=we.clinic_id
    where we.clinic_id=p_clinic_id and we.session_id=s.id and we.status='waiting' and reg.status='waitlisted' and not(reg.id=any(regs)))
   then raise exception 'cron scope excludes affected waitlist'; end if;
   for r in select * from public.registrations where clinic_id=p_clinic_id and id=any(regs) and session_id=s.id
    and status='pending' and payment_status='pending' and expires_at<=now() order by id for update
   loop
    with changed as(update public.payment_orders set status='expired',updated_at=now() where clinic_id=p_clinic_id and registration_id=r.id and status='pending' returning id)
     insert into public.payment_status_events(clinic_id,payment_order_id,from_status,to_status,source) select p_clinic_id,id,'pending','expired','registration_expiry' from changed;
    update public.registrations set status='cancelled',payment_status='expired',expires_at=null where clinic_id=p_clinic_id and id=r.id;
    expired:=expired+1;
   end loop;
   perform public.promote_waitlist_for_session(p_clinic_id,s.id);
  end loop;
  for r in select reg.id from public.registrations reg where reg.clinic_id=p_clinic_id and reg.id=any(regs) and reg.status='cancelled' and reg.payment_status in('failed','expired')
   and exists(select 1 from public.discount_redemptions d where d.clinic_id=p_clinic_id and d.registration_id=reg.id and d.status='reserved')
  loop benefits:=benefits+public.release_registration_benefits(p_clinic_id,r.id); end loop;
  for a in select * from public.appointments where clinic_id=p_clinic_id and id=any(appts) and deposit_status='pending' and deposit_expires_at<=now() and status in('booked','confirmed') order by id for update
  loop
   perform public.fail_appointment_payment(p_clinic_id,a.id,'appointment deposit expired');
   with changed as(update public.payment_orders set status='expired',updated_at=now() where clinic_id=p_clinic_id and appointment_id=a.id and status='pending' returning id)
    insert into public.payment_status_events(clinic_id,payment_order_id,from_status,to_status,source) select p_clinic_id,id,'pending','expired','appointment_deposit_expiry' from changed;
   expired_appts:=expired_appts+1;
  end loop;
  with changed as(update public.payment_orders set status='expired',updated_at=now() where clinic_id=p_clinic_id and id=any(p_membership_payment_ids)
   and membership_plan_id is not null and patient_id is not null and status='pending' and expires_at<=now() returning id)
   insert into public.payment_status_events(clinic_id,payment_order_id,from_status,to_status,source) select p_clinic_id,id,'pending','expired','membership_expiry' from changed;
  get diagnostics expired_memberships=row_count;
  for w in select * from public.appointment_waitlist_entries where clinic_id=p_clinic_id and id=any(waits) and status='offered' and offer_expires_at<=now() order by id for update
  loop
   update public.appointment_waitlist_entries set status='expired' where clinic_id=p_clinic_id and id=w.id;
   if exists(select 1 from public.appointments where clinic_id=p_clinic_id and id=w.appointment_id and status in('booked','confirmed')) then
    perform public.cancel_appointment(p_clinic_id,w.appointment_id,'waitlist offer expired');
   end if;
   expired_offers:=expired_offers+1;
  end loop;
  -- Newly created reservations belong to the explicitly selected waitlist entries.
  select coalesce(array_agg(distinct id),'{}'::uuid[]) into appts from public.appointments where clinic_id=p_clinic_id and
   (id=any(appts) or id in(select appointment_id from public.appointment_waitlist_entries where clinic_id=p_clinic_id and id=any(waits)));
  perform set_config('app.registration_cron_scope',coalesce(previous_scope,''),true);
 end if;
 return jsonb_build_object('expired',expired,'expired_appointments',expired_appts,'expired_membership_payments',expired_memberships,
  'expired_waitlist_offers',expired_offers,'released_benefits',benefits,'registration_ids',regs,'appointment_ids',appts,'waitlist_ids',waits);
end $$;
revoke all on function public.process_registration_cron_scope(uuid,uuid[],uuid[],uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.process_registration_cron_scope(uuid,uuid[],uuid[],uuid[],uuid[]) to service_role;

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
     ) or (
       notification.status = 'claimed' and notification.updated_at < now() - interval '10 minutes' and notification.attempt_count < 5
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
revoke all on function public.claim_appointment_waitlist_notifications_for_scope(uuid,uuid[],integer) from public,anon,authenticated;
grant execute on function public.claim_appointment_waitlist_notifications_for_scope(uuid,uuid[],integer) to service_role;
commit;
