-- v3 硬化：報名稽核、租戶金流設定與候補遞補
-- 可重跑；本檔需在 migration_registration_payments.sql 之後執行。
alter table clinic_domains add column if not exists verification_token text;
alter table clinics add column if not exists line_destination text;
alter table appointments add column if not exists deposit_expires_at timestamptz;
create index if not exists appointments_deposit_expiry_idx
  on appointments (clinic_id, deposit_status, deposit_expires_at)
  where deposit_status = 'pending';
create unique index if not exists clinics_line_destination_unique_idx
  on clinics (line_destination) where line_destination is not null;

-- Keep time availability aligned with first-visit duration and closed intervals.
drop function if exists get_available_slots(uuid, uuid, date);
create or replace function get_available_slots(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_visit_type text default 'return'
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql security definer set search_path = '' as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead int := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id=p_clinic_id),30);
  v_first_visit_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id=p_clinic_id), false);
  v_first_visit_minutes int := (select first_visit_minutes from public.clinic_settings where clinic_id=p_clinic_id);
  v_slot_length int;
  rec record;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  for rec in
    select t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id=p_clinic_id and t.doctor_id=p_doctor_id
       and t.weekday=v_weekday and t.active
       and not exists (select 1 from public.schedule_exceptions e
              where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id
                and e.date=p_date and e.is_closed and e.start_time is null)
    union all
    select e.start_time, e.end_time, coalesce(e.slot_minutes,15), coalesce(e.capacity,1)
      from public.schedule_exceptions e
     where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id
       and e.date=p_date and not e.is_closed
  loop
    v_slot_length := case when p_visit_type='first' and v_first_visit_extends
      then coalesce(v_first_visit_minutes, rec.slot_minutes) else rec.slot_minutes end;
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n||' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n+v_slot_length)||' minutes')::interval) at time zone 'Asia/Taipei') as e
      from generate_series(0, (extract(epoch from (rec.end_time-rec.start_time))/60)::int - v_slot_length, rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::int
      from candidate c
      left join public.appointments a
        on a.clinic_id=p_clinic_id and a.doctor_id=p_doctor_id
       and a.status in ('booked','confirmed','done')
       and a.start_at < c.e and a.end_at > c.s
     where c.s > now() + (v_lead||' minutes')::interval
       and not exists (
         select 1 from public.schedule_exceptions ec
          where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=p_date
            and ec.is_closed and ec.start_time is not null
            and (c.s at time zone 'Asia/Taipei')::time < ec.end_time
            and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
       )
     group by c.s, c.e, rec.capacity
     having rec.capacity - count(a.id) > 0
     order by c.s;
  end loop;
end; $$;
revoke execute on function get_available_slots(uuid,uuid,date,text) from public, anon, authenticated;
grant execute on function get_available_slots(uuid,uuid,date,text) to service_role;

-- Provider assignments keep staff access limited to explicitly assigned doctors.
create table if not exists doctor_assignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, doctor_id, user_id)
);
create index if not exists doctor_assignments_user_idx
  on doctor_assignments (clinic_id, user_id, active);
create index if not exists doctor_assignments_doctor_idx
  on doctor_assignments (clinic_id, doctor_id, active);
alter table doctor_assignments enable row level security;
drop policy if exists doctor_assignments_self on doctor_assignments;
create policy doctor_assignments_self on doctor_assignments for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from clinic_members cm
       where cm.clinic_id = doctor_assignments.clinic_id
         and cm.user_id = auth.uid()
         and cm.role in ('owner', 'admin')
    )
  );
drop policy if exists doctor_assignments_admin on doctor_assignments;
create policy doctor_assignments_admin on doctor_assignments for all to authenticated
  using (exists (
    select 1 from clinic_members cm
     where cm.clinic_id = doctor_assignments.clinic_id
       and cm.user_id = auth.uid()
       and cm.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from clinic_members cm
     where cm.clinic_id = doctor_assignments.clinic_id
       and cm.user_id = auth.uid()
       and cm.role in ('owner', 'admin')
  ));
drop trigger if exists trg_doctor_assignments_touch on doctor_assignments;
create trigger trg_doctor_assignments_touch before update on doctor_assignments
  for each row execute function touch_updated_at();

create table if not exists appointment_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete restrict,
  from_status text,
  to_status text not null,
  source text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  notification_processed_at timestamptz
);
alter table appointment_status_events add column if not exists notification_processed_at timestamptz;
create index if not exists appointment_status_events_lookup_idx
  on appointment_status_events (clinic_id, appointment_id, created_at desc);
create index if not exists appointment_status_events_notification_queue_idx
  on appointment_status_events (created_at, id)
  where notification_processed_at is null;

create table if not exists appointment_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete restrict,
  kind text not null check (kind in ('pending','confirmed','cancelled','rescheduled')),
  channel text not null check (channel in ('line','email')),
  status text not null default 'sending' check (status in ('sending','sent','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, kind, channel)
);
create index if not exists appointment_notification_logs_queue_idx
  on appointment_notification_logs (clinic_id, status, updated_at);

create or replace function record_appointment_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'system' else 'admin' end;
begin
  if tg_op = 'INSERT' then
    insert into appointment_status_events (clinic_id, appointment_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, null, new.status, v_source, v_actor);
  elsif new.status is distinct from old.status then
    insert into appointment_status_events (clinic_id, appointment_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, old.status, new.status, v_source, v_actor);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointment_status_event on appointments;
create trigger trg_appointment_status_event
after insert or update of status on appointments
for each row execute function record_appointment_status_event();

create table if not exists clinic_payment_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  provider text not null check (provider in ('ecpay','newebpay')),
  merchant_id text not null,
  environment text not null default 'test' check (environment in ('test','production')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clinic_payment_provider_merchant_idx
  on clinic_payment_settings (provider, merchant_id);

-- legacy secrets are no longer used; configure server environment before applying this migration.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_settings' and column_name = 'resend_api_key') then
    execute 'update public.clinic_settings set resend_api_key = null where resend_api_key is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_settings' and column_name = 'email_from') then
    execute 'update public.clinic_settings set email_from = null where email_from is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_payment_settings' and column_name = 'hash_key') then
    execute 'update public.clinic_payment_settings set hash_key = null where hash_key is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_payment_settings' and column_name = 'hash_iv') then
    execute 'update public.clinic_payment_settings set hash_iv = null where hash_iv is not null';
  end if;
end $$;
alter table clinic_settings drop column if exists resend_api_key;
alter table clinic_settings drop column if exists email_from;
alter table clinic_payment_settings drop column if exists hash_key;
alter table clinic_payment_settings drop column if exists hash_iv;

alter table reminder_logs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table reminder_logs add column if not exists error text;
update reminder_logs rl
   set clinic_id = a.clinic_id
  from appointments a
 where a.id = rl.appointment_id and rl.clinic_id is null;
alter table reminder_logs alter column clinic_id set not null;
drop policy if exists reminder_logs_member on reminder_logs;
create policy reminder_logs_member on reminder_logs for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

create table if not exists registration_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete restrict,
  from_status text,
  to_status text not null,
  source text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  notification_processed_at timestamptz
);
alter table registration_status_events add column if not exists notification_processed_at timestamptz;
create index if not exists registration_status_events_lookup_idx
  on registration_status_events (clinic_id, registration_id, created_at desc);
create index if not exists registration_status_events_notification_queue_idx
  on registration_status_events (created_at, id)
  where notification_processed_at is null;

create table if not exists registration_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete restrict,
  kind text not null check (kind in ('pending','confirmed','waitlisted','cancelled')),
  channel text not null check (channel in ('line','email')),
  status text not null default 'sending' check (status in ('sending','sent','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, kind, channel)
);
alter table registration_notification_logs drop constraint if exists registration_notification_logs_status_check;
alter table registration_notification_logs add constraint registration_notification_logs_status_check
  check (status in ('sending','sent','failed','skipped'));
create index if not exists registration_notification_logs_queue_idx
  on registration_notification_logs (clinic_id, status, updated_at);

create table if not exists payment_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  payment_order_id uuid not null references payment_orders(id) on delete restrict,
  from_status text,
  to_status text not null,
  source text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  provider_event_key text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payment_status_events_lookup_idx
  on payment_status_events (clinic_id, payment_order_id, created_at desc);

create or replace function record_registration_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'system' else 'admin' end;
begin
  if tg_op = 'INSERT' then
    insert into registration_status_events (clinic_id, registration_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, null, new.status, v_source, v_actor);
  elsif new.status is distinct from old.status then
    insert into registration_status_events (clinic_id, registration_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, old.status, new.status, v_source, v_actor);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registration_status_event on registrations;
create trigger trg_registration_status_event
after insert or update of status on registrations
for each row execute function record_registration_status_event();

drop trigger if exists trg_clinic_payment_settings_touch on clinic_payment_settings;
create trigger trg_clinic_payment_settings_touch before update on clinic_payment_settings
for each row execute function touch_updated_at();

drop trigger if exists trg_registration_notification_logs_touch on registration_notification_logs;
create trigger trg_registration_notification_logs_touch before update on registration_notification_logs
for each row execute function touch_updated_at();

drop trigger if exists trg_appointment_notification_logs_touch on appointment_notification_logs;
create trigger trg_appointment_notification_logs_touch before update on appointment_notification_logs
for each row execute function touch_updated_at();

create or replace function promote_waitlist_for_session(p_clinic_id uuid, p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s record;
  r record;
  v_taken integer;
  v_ticket_taken integer;
  v_promoted integer := 0;
begin
  select * into s from event_sessions
   where id = p_session_id and clinic_id = p_clinic_id and active
   for update;
  if not found then raise exception '找不到場次'; end if;

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || s.event_id::text));

  select count(*)::int into v_taken from registrations
   where clinic_id = p_clinic_id and session_id = p_session_id
     and status in ('pending','confirmed','attended')
     and (status <> 'pending' or expires_at is null or expires_at > now());

  for r in
    select w.id as waitlist_id, w.registration_id, reg.ticket_type_id, tt.capacity as ticket_capacity, reg.amount
      from waitlist_entries w
      join registrations reg on reg.id = w.registration_id
      left join event_ticket_types tt
        on tt.id = reg.ticket_type_id and tt.event_id = s.event_id and tt.clinic_id = p_clinic_id
     where w.clinic_id = p_clinic_id and w.session_id = p_session_id
       and w.status = 'waiting' and reg.status = 'waitlisted'
     order by w.position, w.created_at
     for update of w, reg
  loop
    exit when v_taken >= s.capacity;
    if r.ticket_capacity is not null then
      select count(*)::int into v_ticket_taken
        from registrations active_reg
       where active_reg.clinic_id = p_clinic_id
         and active_reg.ticket_type_id = r.ticket_type_id
         and active_reg.status in ('pending', 'confirmed', 'attended')
         and (active_reg.status <> 'pending' or active_reg.expires_at is null or active_reg.expires_at > now());
      if v_ticket_taken >= r.ticket_capacity then
        continue;
      end if;
    end if;
    if r.amount > 0 then
      update registrations
         set status = 'pending', payment_status = 'pending', expires_at = now() + interval '15 minutes'
       where id = r.registration_id;
    else
      update registrations
         set status = 'confirmed', payment_status = 'not_required', expires_at = null
       where id = r.registration_id;
    end if;
    update waitlist_entries set status = 'promoted' where id = r.waitlist_id;
    v_taken := v_taken + 1;
    v_promoted := v_promoted + 1;
  end loop;
  return v_promoted;
end;
$$;

create or replace function expire_registration_payments()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n integer;
  session_row record;
begin
  with expired_orders as (
    update payment_orders po
       set status = 'expired', updated_at = now()
      from registrations r
     where po.registration_id = r.id
       and po.status = 'pending'
       and r.status = 'pending'
       and r.payment_status = 'pending'
       and r.expires_at is not null
       and r.expires_at <= now()
    returning po.id, po.clinic_id, po.status
  )
  insert into payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
    select clinic_id, id, 'pending', 'expired', 'registration_expiry'
      from expired_orders;
  update registrations
     set status = 'cancelled', payment_status = 'expired', expires_at = null
  where status = 'pending' and payment_status = 'pending'
     and expires_at is not null and expires_at <= now();
  get diagnostics n = row_count;
  for session_row in
    select distinct clinic_id, session_id from registrations
     where status = 'cancelled' and payment_status = 'expired'
       and updated_at >= now() - interval '2 minutes'
  loop
    perform promote_waitlist_for_session(session_row.clinic_id, session_row.session_id);
  end loop;
  return n;
end;
$$;

create or replace function expire_pending_appointment_deposits()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a record;
  order_row record;
  n integer := 0;
begin
  for a in
    select id, clinic_id
      from appointments
     where deposit_status = 'pending'
       and deposit_expires_at is not null
       and deposit_expires_at <= now()
       and status in ('booked', 'confirmed')
     for update skip locked
  loop
    update appointments
       set status = 'cancelled', deposit_status = 'failed', deposit_expires_at = null, updated_at = now()
     where id = a.id and clinic_id = a.clinic_id and status in ('booked', 'confirmed') and deposit_status = 'pending';
    for order_row in
      update payment_orders
         set status = 'expired', updated_at = now()
       where appointment_id = a.id and clinic_id = a.clinic_id and status = 'pending'
       returning id
    loop
      insert into payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
        values (a.clinic_id, order_row.id, 'pending', 'expired', 'appointment_deposit_expiry');
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function cancel_registration(p_clinic_id uuid, p_token text)
returns table (registration_id uuid, registration_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  r record;
begin
  if nullif(trim(p_token), '') is null then raise exception '缺少取消憑證'; end if;
  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  select * into r from registrations
   where clinic_id = p_clinic_id and checkin_token_hash = v_hash
   for update;
  if not found then raise exception '取消憑證無效'; end if;
  if r.status in ('attended','cancelled') then
    return query select r.id, r.status;
    return;
  end if;
  update registrations
     set status = 'cancelled',
         payment_status = case when r.payment_status = 'paid' then 'paid' else r.payment_status end,
         expires_at = null
   where id = r.id;
  perform promote_waitlist_for_session(p_clinic_id, r.session_id);
  return query select r.id, 'cancelled'::text;
end;
$$;

revoke all on function promote_waitlist_for_session(uuid,uuid) from public, anon, authenticated;
grant execute on function promote_waitlist_for_session(uuid,uuid) to service_role;
revoke all on function expire_registration_payments() from public, anon, authenticated;
grant execute on function expire_registration_payments() to service_role;
revoke all on function expire_pending_appointment_deposits() from public, anon, authenticated;
grant execute on function expire_pending_appointment_deposits() to service_role;
revoke all on function cancel_registration(uuid,text) from public, anon, authenticated;
grant execute on function cancel_registration(uuid,text) to service_role;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['clinic_payment_settings','appointment_status_events','appointment_notification_logs','registration_status_events','registration_notification_logs','payment_status_events'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
    $policy$, tbl || '_member', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;

-- Existing installations receive the same number-mode safeguards as a fresh schema.
drop function if exists book_number(uuid, uuid, uuid, uuid, date, text, boolean);
create or replace function book_number(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_patient_id uuid,
  p_template_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_service_id uuid default null
) returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  st record;
  v_cap integer;
  v_start time;
  v_end time;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_used integer;
  v_no integer;
  v_id uuid;
  v_dep boolean;
begin
  if p_visit_type not in ('first', 'return') then
    raise exception 'invalid visit type';
  end if;

  select * into st from clinic_settings where clinic_id = p_clinic_id;
  if not exists (select 1 from doctors where id = p_doctor_id and clinic_id = p_clinic_id and active) then
    raise exception 'doctor not found or inactive';
  end if;
  if not exists (select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id and active) then
    raise exception 'patient not found or inactive';
  end if;
  if p_service_id is not null and not exists (select 1 from services where id = p_service_id and clinic_id = p_clinic_id and active) then
    raise exception 'service not found or inactive';
  end if;
  if not exists (
    select 1 from schedule_templates
     where id = p_template_id and clinic_id = p_clinic_id and doctor_id = p_doctor_id
       and active and weekday = extract(dow from p_date)
  ) and not exists (
    select 1 from schedule_exceptions
     where id = p_template_id and clinic_id = p_clinic_id and doctor_id = p_doctor_id
       and date = p_date and not is_closed
  ) then
    raise exception 'schedule segment does not match the date';
  end if;

  select capacity, start_time, end_time into v_cap, v_start, v_end from (
    select id, capacity, start_time, end_time from schedule_templates
     where clinic_id = p_clinic_id and doctor_id = p_doctor_id and active
    union all
    select id, coalesce(capacity, 40), start_time, end_time from schedule_exceptions
     where clinic_id = p_clinic_id and doctor_id = p_doctor_id and date = p_date and not is_closed
  ) q where id = p_template_id;
  if not found then
    raise exception 'schedule segment not found';
  end if;

  v_start_at := (p_date + v_start) at time zone 'Asia/Taipei';
  v_end_at := (p_date + v_end) at time zone 'Asia/Taipei';
  if v_start_at < now() + (coalesce(st.min_lead_minutes, 30) || ' minutes')::interval then
    raise exception 'booking lead time has not been reached';
  end if;
  if p_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days, 30)) then
    raise exception 'booking date exceeds the advance window';
  end if;
  if v_end_at <= now() then
    raise exception 'session has ended';
  end if;
  if exists (
    select 1 from schedule_exceptions ec
     where ec.clinic_id = p_clinic_id and ec.doctor_id = p_doctor_id and ec.date = p_date
       and ec.is_closed and (ec.start_time is null or (
         ec.start_time < v_end
         and coalesce(ec.end_time, '23:59:59.999999'::time) > v_start
       ))
  ) then
    raise exception 'session is closed';
  end if;

  perform pg_advisory_xact_lock(hashtext('number:' || p_clinic_id::text || p_template_id::text || p_date::text));
  perform pg_advisory_xact_lock(hashtext('patient:' || p_clinic_id::text || p_patient_id::text || p_date::text));
  if exists (
    select 1 from appointments
     where clinic_id = p_clinic_id and patient_id = p_patient_id
       and status in ('booked', 'confirmed', 'done')
       and (start_at at time zone 'Asia/Taipei')::date = p_date
  ) then
    raise exception 'patient already has an appointment on this date';
  end if;

  select count(*) filter (where a.status in ('booked', 'confirmed', 'done')),
         coalesce(max(a.queue_number), 0)
    into v_used, v_no
    from appointments a
   where a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
     and a.template_id = p_template_id and a.start_at = v_start_at;
  if v_used >= v_cap then
    raise exception 'session is full';
  end if;

  v_no := v_no + 1;
  v_dep := coalesce(st.deposit_enabled, false)
           and (st.deposit_scope = 'all' or (st.deposit_scope = 'self_pay' and p_is_self_pay));
  insert into appointments (
    clinic_id, doctor_id, patient_id, template_id, start_at, end_at, service_id,
    visit_type, queue_number, is_self_pay, deposit_status, deposit_amount, deposit_expires_at
  ) values (
    p_clinic_id, p_doctor_id, p_patient_id, p_template_id, v_start_at, v_end_at, p_service_id,
    p_visit_type, v_no, p_is_self_pay,
    case when v_dep then 'pending' else 'none' end,
    case when v_dep then coalesce(st.deposit_amount, 0) else 0 end,
    case when v_dep then now() + interval '15 minutes' else null end
  ) returning id into v_id;
  return query select v_id, v_no;
end;
$$;

revoke all on function book_number(uuid, uuid, uuid, uuid, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function book_number(uuid, uuid, uuid, uuid, date, text, boolean, uuid) to service_role;

-- Provider row-level hardening; keeps incremental deployments aligned with schema.sql.
drop policy if exists doctors_member on doctors;
drop policy if exists doctors_provider_read on doctors;
drop policy if exists doctors_nonprovider_manage on doctors;
create policy doctors_provider_read on doctors for select to authenticated
  using (
    doctors.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = doctors.clinic_id and da.doctor_id = doctors.id and da.user_id = auth.uid() and da.active))
  );
create policy doctors_nonprovider_manage on doctors for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists schedule_templates_member on schedule_templates;
drop policy if exists schedule_templates_provider_read on schedule_templates;
drop policy if exists schedule_templates_nonprovider_manage on schedule_templates;
create policy schedule_templates_provider_read on schedule_templates for select to authenticated
  using (
    schedule_templates.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_templates.clinic_id and da.doctor_id = schedule_templates.doctor_id and da.user_id = auth.uid() and da.active))
  );
create policy schedule_templates_nonprovider_manage on schedule_templates for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists schedule_exceptions_member on schedule_exceptions;
drop policy if exists schedule_exceptions_provider_read on schedule_exceptions;
drop policy if exists schedule_exceptions_nonprovider_manage on schedule_exceptions;
create policy schedule_exceptions_provider_read on schedule_exceptions for select to authenticated
  using (
    schedule_exceptions.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_exceptions.clinic_id and da.doctor_id = schedule_exceptions.doctor_id and da.user_id = auth.uid() and da.active))
  );
create policy schedule_exceptions_nonprovider_manage on schedule_exceptions for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists patients_member on patients;
drop policy if exists patients_provider_read on patients;
drop policy if exists patients_nonprovider_manage on patients;
create policy patients_provider_read on patients for select to authenticated
  using (
    patients.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patients.clinic_id and a.patient_id = patients.id and da.user_id = auth.uid() and da.active
      ))
  );
create policy patients_nonprovider_manage on patients for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists appointments_member on appointments;
drop policy if exists appointments_provider_read on appointments;
drop policy if exists appointments_nonprovider_manage on appointments;
drop policy if exists appointments_provider_status_update on appointments;
create policy appointments_provider_read on appointments for select to authenticated
  using (
    appointments.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active))
  );
create policy appointments_nonprovider_manage on appointments for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));
create policy appointments_provider_status_update on appointments for update to authenticated
  using (exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active))
  with check (appointments.status in ('done', 'no_show') and exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active));

create or replace function prevent_provider_appointment_writes()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from clinic_members cm where cm.clinic_id = old.clinic_id and cm.user_id = auth.uid() and cm.role = 'provider') then
    if not exists (select 1 from doctor_assignments da where da.clinic_id = old.clinic_id and da.doctor_id = old.doctor_id and da.user_id = auth.uid() and da.active)
      or new.clinic_id is distinct from old.clinic_id or new.doctor_id is distinct from old.doctor_id
      or new.patient_id is distinct from old.patient_id or new.template_id is distinct from old.template_id
      or new.service_id is distinct from old.service_id or new.start_at is distinct from old.start_at
      or new.end_at is distinct from old.end_at or new.visit_type is distinct from old.visit_type
      or new.source is distinct from old.source or new.queue_number is distinct from old.queue_number
      or new.is_self_pay is distinct from old.is_self_pay or new.deposit_status is distinct from old.deposit_status
      or new.deposit_amount is distinct from old.deposit_amount or new.deposit_expires_at is distinct from old.deposit_expires_at
      or new.note is distinct from old.note or new.status not in ('done', 'no_show') or old.status not in ('booked', 'confirmed') then
      raise exception '服務提供者只能將已指派預約標記為完成或未到';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_provider_appointment_writes on appointments;
create trigger trg_prevent_provider_appointment_writes before update on appointments for each row execute function prevent_provider_appointment_writes();

drop policy if exists serving_member on serving_numbers;
drop policy if exists serving_numbers_provider_read on serving_numbers;
drop policy if exists serving_numbers_nonprovider_manage on serving_numbers;
create policy serving_numbers_provider_read on serving_numbers for select to authenticated
  using (
    serving_numbers.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = serving_numbers.clinic_id and da.doctor_id = serving_numbers.doctor_id and da.user_id = auth.uid() and da.active))
  );
create policy serving_numbers_nonprovider_manage on serving_numbers for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists patient_records_member on patient_records;
drop policy if exists patient_records_provider_read on patient_records;
drop policy if exists patient_records_nonprovider_manage on patient_records;
create policy patient_records_provider_read on patient_records for select to authenticated
  using (
    patient_records.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patient_records.clinic_id and a.patient_id = patient_records.patient_id and da.user_id = auth.uid() and da.active
      ))
  );
create policy patient_records_nonprovider_manage on patient_records for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

do $$
declare tbl text;
begin
  foreach tbl in array array['clinic_domains','events','event_sessions','event_ticket_types','registration_forms','registration_form_fields','registrations','registration_answers','waitlist_entries','checkins','payment_orders','payment_transactions','payment_webhook_events','clinic_payment_settings','appointment_status_events','appointment_notification_logs','registration_status_events','registration_notification_logs','payment_status_events','chat_messages','chat_blocks','crm_segments','crm_segment_members','crm_interactions','crm_automations','crm_delivery_logs','reminder_logs','line_messages','line_auto_replies','line_richmenu'] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$ create policy %I on public.%I for all to authenticated
      using (%I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid()) and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
      with check (%I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid()) and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
    $policy$, tbl || '_member', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;

-- 公開預約／瀏覽器備援共用的顧客建立流程：以品牌＋電話序列化，避免同電話上限被併發請求突破。
create or replace function create_or_get_public_patient(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_birthday date default null,
  p_line_user_id text default null
) returns table (patient_id uuid, reused boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings_row record;
  matched record;
  v_patient_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_line_user_id text := nullif(btrim(coalesce(p_line_user_id, '')), '');
  active_count integer;
begin
  if v_name = '' or v_phone = '' then raise exception 'name and phone are required'; end if;
  if length(v_name) > 100 or length(v_phone) > 40 or length(coalesce(v_line_user_id, '')) > 128 then
    raise exception 'patient identity is too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('public-patient:' || p_clinic_id::text || ':' || v_phone));
  select * into settings_row from clinic_settings where clinic_id = p_clinic_id;
  if not found then raise exception 'clinic settings not found'; end if;

  select * into matched
    from patients
   where clinic_id = p_clinic_id
     and phone = v_phone
     and name = v_name
     and (p_birthday is null or birthday is not distinct from p_birthday)
     and (
       (v_line_user_id is not null and (line_user_id is null or line_user_id = v_line_user_id))
       or (v_line_user_id is null and line_user_id is null)
     )
   order by active desc, created_at
   limit 1
   for update;

  if found then
    update patients
       set active = true,
           line_user_id = coalesce(v_line_user_id, line_user_id)
     where id = matched.id;
    return query select matched.id, true;
    return;
  end if;

  if v_line_user_id is not null and exists (
    select 1 from patients
     where clinic_id = p_clinic_id and phone = v_phone and name = v_name
       and (p_birthday is null or birthday is not distinct from p_birthday)
       and active and line_user_id is not null and line_user_id <> v_line_user_id
  ) then
    raise exception 'patient is bound to another LINE account';
  end if;

  select count(*)::integer into active_count
    from patients
   where clinic_id = p_clinic_id and phone = v_phone and active;
  if not settings_row.allow_multi_patient_per_phone and active_count >= 1 then
    raise exception 'phone already has a patient';
  end if;
  if settings_row.allow_multi_patient_per_phone and active_count >= greatest(1, settings_row.max_patients_per_phone) then
    raise exception 'phone patient limit reached';
  end if;

  insert into patients (clinic_id, name, phone, birthday, line_user_id, active)
  values (p_clinic_id, v_name, v_phone, p_birthday, v_line_user_id, true)
  returning id into v_patient_id;
  return query select v_patient_id, false;
end;
$$;

revoke all on function create_or_get_public_patient(uuid, text, text, date, text) from public, anon, authenticated;
grant execute on function create_or_get_public_patient(uuid, text, text, date, text) to service_role;

-- 既有資料庫也必須依初診設定計算時長，並拒絕跨出門診段的預約。
drop function if exists book_time_slot(uuid, uuid, uuid, timestamptz, text, boolean);
create or replace function book_time_slot(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_service_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (p_start_at at time zone 'Asia/Taipei')::date;
  v_tod time := (p_start_at at time zone 'Asia/Taipei')::time;
  v_weekday smallint := extract(dow from v_date);
  st record; s record; v_len int; v_end timestamptz; v_used int; v_id uuid;
  v_dep boolean; v_match_count int;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id=p_clinic_id;
  if not exists (select 1 from public.doctors where id=p_doctor_id and clinic_id=p_clinic_id and active)
    then raise exception '醫師不存在或已停用'; end if;
  if not exists (select 1 from public.patients where id=p_patient_id and clinic_id=p_clinic_id and active)
    then raise exception '病患不存在或已停用'; end if;
  if p_service_id is not null and not exists (select 1 from public.services where id=p_service_id and clinic_id=p_clinic_id and active)
    then raise exception '服務不存在或已停用'; end if;

  select count(*) into v_match_count from (
    select start_time,end_time,slot_minutes,capacity from public.schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and weekday=v_weekday and active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=v_date and e.is_closed and e.start_time is null)
    union all
    select start_time,end_time,coalesce(slot_minutes,15),coalesce(capacity,1)
      from public.schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=v_date and not is_closed
  ) q where v_tod >= start_time and v_tod < end_time;
  if v_match_count = 0 then raise exception '未找到可用門診時段'; end if;
  if v_match_count > 1 then raise exception '門診時段設定重疊,請先調整門診設定'; end if;

  select start_time,end_time,slot_minutes,capacity into s from (
    select start_time,end_time,slot_minutes,capacity from public.schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and weekday=v_weekday and active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=v_date and e.is_closed and e.start_time is null)
    union all
    select start_time,end_time,coalesce(slot_minutes,15),coalesce(capacity,1)
      from public.schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=v_date and not is_closed
  ) q where v_tod >= start_time and v_tod < end_time;
  if not found then raise exception '此時段非門診時間'; end if;

  if p_visit_type='first' and coalesce(st.first_visit_extends,false)
     then v_len := coalesce(st.first_visit_minutes, s.slot_minutes);
     else v_len := s.slot_minutes; end if;
  v_end := p_start_at + (v_len||' minutes')::interval;
  if v_end > ((v_date + s.end_time) at time zone 'Asia/Taipei')
    then raise exception '初診時長超出門診時段'; end if;

  if exists (select 1 from public.schedule_exceptions ec
             where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=v_date
               and ec.is_closed and ec.start_time is not null
               and (p_start_at at time zone 'Asia/Taipei')::time < coalesce(ec.end_time, '23:59:59.999999'::time)
               and (v_end at time zone 'Asia/Taipei')::time > ec.start_time)
    then raise exception '此時段已休診'; end if;

  if p_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '已超過可預約時間'; end if;
  if v_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days,30))
    then raise exception '超過最長可預約區間'; end if;

  perform pg_advisory_xact_lock(hashtext('time:' || p_clinic_id::text || p_doctor_id::text || v_date::text));
  perform pg_advisory_xact_lock(hashtext('patient:' || p_clinic_id::text || p_patient_id::text || v_date::text));
  if exists (
    select 1 from public.appointments
    where clinic_id=p_clinic_id and patient_id=p_patient_id
      and status in ('booked','confirmed','done')
      and (start_at at time zone 'Asia/Taipei')::date = v_date
  ) then raise exception '同一病患當日已有預約'; end if;
  select count(*) into v_used from public.appointments
   where clinic_id=p_clinic_id and doctor_id=p_doctor_id
     and status in ('booked','confirmed','done')
     and start_at < v_end and end_at > p_start_at;
  if v_used >= s.capacity then raise exception '時段已額滿'; end if;

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into public.appointments(clinic_id,doctor_id,patient_id,start_at,end_at,service_id,visit_type,is_self_pay,
                           deposit_status,deposit_amount,deposit_expires_at)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_start_at,v_end,p_service_id,p_visit_type,p_is_self_pay,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end,
          case when v_dep then now() + interval '15 minutes' else null end)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function book_time_slot(uuid, uuid, uuid, timestamptz, text, boolean, uuid) from public, anon, authenticated;
grant execute on function book_time_slot(uuid, uuid, uuid, timestamptz, text, boolean, uuid) to service_role;

-- 既有資料庫也必須只回傳未來且未滿的號次診次，與 consolidated schema 保持一致。
create or replace function get_available_sessions(
  p_clinic_id uuid, p_doctor_id uuid, p_date date
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz,
               total int, taken int, remaining int)
language plpgsql security definer set search_path = '' as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead int := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id=p_clinic_id),30);
begin
  return query
  with sess as (
    select t.id, t.start_time, t.end_time, t.capacity from public.schedule_templates t
      where t.clinic_id=p_clinic_id and t.doctor_id=p_doctor_id and t.weekday=v_weekday and t.active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=p_date and e.is_closed
              and (e.start_time is null or (
                e.start_time < t.end_time
                and coalesce(e.end_time, '23:59:59.999999'::time) > t.start_time
              )))
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity,40) from public.schedule_exceptions e
      where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id and e.date=p_date and not e.is_closed
        and not exists (
          select 1 from public.schedule_exceptions closed
           where closed.clinic_id=p_clinic_id and closed.doctor_id=p_doctor_id
             and closed.date=p_date and closed.is_closed
             and (closed.start_time is null or (
               e.start_time < coalesce(closed.end_time, '23:59:59.999999'::time)
               and coalesce(e.end_time, '23:59:59.999999'::time) > closed.start_time
             ))
        )
  )
  select x.id,
         ((p_date + x.start_time) at time zone 'Asia/Taipei'),
         ((p_date + x.end_time) at time zone 'Asia/Taipei'),
         x.capacity, count(a.id)::int, greatest(0, x.capacity - count(a.id))::int
  from sess x
  left join public.appointments a
    on a.template_id=x.id
   and a.start_at = ((p_date + x.start_time) at time zone 'Asia/Taipei')
   and a.status in ('booked','confirmed','done')
  where ((p_date + x.start_time) at time zone 'Asia/Taipei') > now() + (v_lead||' minutes')::interval
  group by x.id, x.start_time, x.end_time, x.capacity
  having count(a.id) < x.capacity;
end; $$;

alter table registrations add column if not exists form_id uuid references registration_forms(id) on delete set null;
alter table registrations add column if not exists form_version integer;
create index if not exists registrations_form_idx on registrations (clinic_id, form_id, form_version);

create or replace function create_brand_with_owner(
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
    select 1 from clinic_members cm
     where cm.clinic_id = p_source_clinic_id
       and cm.user_id = p_actor_user_id
       and cm.role in ('owner', 'admin')
  ) then
    raise exception '無權限建立品牌';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception '品牌名稱格式錯誤'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then
    raise exception '品牌短網址格式錯誤';
  end if;

  insert into clinics (name, slug, phone, address)
    values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
    returning id into v_id;
  insert into clinic_settings (clinic_id) values (v_id)
    on conflict (clinic_id) do nothing;
  insert into clinic_members (clinic_id, user_id, role)
    values (v_id, p_actor_user_id, 'owner');
  return query select v_id, v_name, v_slug;
exception
  when unique_violation then
    raise exception '品牌短網址已存在' using errcode = '23505';
end;
$$;

revoke all on function create_brand_with_owner(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function create_brand_with_owner(uuid, uuid, text, text, text, text) to service_role;

-- 品牌採 soft-delete；所有 clinic_id 外鍵禁止刪除品牌時連帶刪除歷史業務資料。
do $$
declare
  fk record;
begin
  for fk in
    select ns.nspname as table_schema, child.relname as table_name, con.conname as constraint_name
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    where con.contype = 'f'
      and ns.nspname = 'public'
      and con.confrelid = 'public.clinics'::regclass
      and array_length(con.conkey, 1) = 1
      and con.conkey[1] = (
        select att.attnum from pg_attribute att
         where att.attrelid = con.conrelid and att.attname = 'clinic_id' and not att.attisdropped
      )
  loop
    execute format('alter table %I.%I drop constraint if exists %I', fk.table_schema, fk.table_name, fk.constraint_name);
    execute format('alter table %I.%I add constraint %I foreign key (clinic_id) references public.clinics(id) on delete restrict', fk.table_schema, fk.table_name, fk.constraint_name);
  end loop;
end $$;
