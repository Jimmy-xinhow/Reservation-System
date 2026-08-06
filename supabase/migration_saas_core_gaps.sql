-- Core booking and registration gaps: service timing, customer change rules,
-- ticket sale windows, and immutable terms consent snapshots.

alter table public.clinic_settings add column if not exists cancel_lead_minutes integer not null default 120;
alter table public.clinic_settings add column if not exists reschedule_lead_minutes integer not null default 120;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_settings_cancel_lead_check') then alter table public.clinic_settings add constraint clinic_settings_cancel_lead_check check (cancel_lead_minutes >= 0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_settings_reschedule_lead_check') then alter table public.clinic_settings add constraint clinic_settings_reschedule_lead_check check (reschedule_lead_minutes >= 0) not valid; end if;
end $$;

-- 會員套票公開購買：付款訂單只在 service role 建立，付款成功後冪等發放套票。
alter table public.payment_orders add column if not exists membership_plan_id uuid;
alter table public.payment_orders add column if not exists patient_id uuid;
alter table public.payment_orders drop constraint if exists payment_orders_check;
alter table public.payment_orders drop constraint if exists payment_orders_subject_check;
alter table public.payment_orders
  add constraint payment_orders_subject_check check (
    (appointment_id is not null and registration_id is null and membership_plan_id is null and patient_id is null)
    or (registration_id is not null and appointment_id is null and membership_plan_id is null and patient_id is null)
    or (membership_plan_id is not null and patient_id is not null and appointment_id is null and registration_id is null)
  );
create unique index if not exists payment_orders_membership_pending_idx
  on public.payment_orders (membership_plan_id, patient_id)
  where membership_plan_id is not null and patient_id is not null and status = 'pending';
alter table public.patient_memberships add column if not exists payment_order_id uuid;
create unique index if not exists patient_memberships_payment_order_idx
  on public.patient_memberships (payment_order_id)
  where payment_order_id is not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_orders'::regclass
      and conname = 'payment_orders_membership_plan_fk'
  ) then
    alter table public.payment_orders
      add constraint payment_orders_membership_plan_fk
      foreign key (membership_plan_id) references public.membership_plans(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_orders'::regclass
      and conname = 'payment_orders_patient_fk'
  ) then
    alter table public.payment_orders
      add constraint payment_orders_patient_fk
      foreign key (patient_id) references public.patients(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.patient_memberships'::regclass
      and conname = 'patient_memberships_payment_order_fk'
  ) then
    alter table public.patient_memberships
      add constraint patient_memberships_payment_order_fk
      foreign key (payment_order_id) references public.payment_orders(id) on delete restrict;
  end if;
end $$;

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
  o record;
  plan_row record;
  existing record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  select po.id, po.status, po.clinic_id, po.patient_id, po.membership_plan_id
    into o
    from public.payment_orders po
   where po.id = p_payment_order_id and po.clinic_id = p_clinic_id
   for update;
  if not found or o.membership_plan_id is null or o.patient_id is null then
    raise exception 'membership payment order not found';
  end if;
  if o.status <> 'paid' then raise exception 'membership payment is not paid'; end if;

  select pm.id, pm.membership_code, pm.expires_at, pm.credits_remaining
    into existing
    from public.patient_memberships pm
   where pm.payment_order_id = p_payment_order_id;
  if found then
    return query select existing.id, existing.membership_code, existing.expires_at, existing.credits_remaining;
    return;
  end if;

  select * into plan_row from public.membership_plans
   where id = o.membership_plan_id and clinic_id = p_clinic_id;
  if not found then raise exception 'membership plan not found'; end if;
  if not exists (select 1 from public.patients where id = o.patient_id and clinic_id = p_clinic_id and active) then
    raise exception 'patient not found';
  end if;
  if plan_row.valid_days is not null then v_expires := now() + (plan_row.valid_days || ' days')::interval; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (select 1 from public.patient_memberships where clinic_id = p_clinic_id and membership_code = v_code);
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, payment_order_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
    values (p_clinic_id, o.patient_id, o.membership_plan_id, p_payment_order_id, v_code, plan_row.credits_total, plan_row.credits_total, now(), v_expires, 'purchase', 'membership payment purchase')
    returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, note)
    values (p_clinic_id, v_id, o.patient_id, 'grant', plan_row.credits_total, 'payment_order', p_payment_order_id, 'membership payment purchase');
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;
revoke all on function public.grant_paid_membership_from_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_paid_membership_from_order(uuid, uuid) to service_role;

create or replace function public.expire_pending_membership_payments()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n integer;
begin
  with expired_orders as (
    update public.payment_orders
       set status = 'expired', updated_at = now()
     where membership_plan_id is not null
       and patient_id is not null
       and status = 'pending'
       and expires_at is not null
       and expires_at <= now()
    returning id, clinic_id
  )
  insert into public.payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
    select clinic_id, id, 'pending', 'expired', 'membership_expiry'
      from expired_orders;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.expire_pending_membership_payments() from public, anon, authenticated;
grant execute on function public.expire_pending_membership_payments() to service_role;

alter table public.services add column if not exists category text;
alter table public.services add column if not exists duration_minutes integer;
alter table public.services add column if not exists buffer_minutes integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'services_duration_check') then alter table public.services add constraint services_duration_check check (duration_minutes is null or duration_minutes > 0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'services_buffer_check') then alter table public.services add constraint services_buffer_check check (buffer_minutes >= 0) not valid; end if;
end $$;

create table if not exists public.service_resources (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null,
  kind text not null default 'room' check (kind in ('room', 'equipment', 'staff', 'other')),
  capacity integer not null default 1 check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.service_resource_assignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  resource_id uuid not null references public.service_resources(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (service_id, resource_id)
);
create index if not exists service_resources_clinic_idx on public.service_resources (clinic_id, active, name);
create index if not exists service_resource_assignments_service_idx on public.service_resource_assignments (clinic_id, service_id);
drop trigger if exists trg_service_resources_touch on public.service_resources;
create trigger trg_service_resources_touch before update on public.service_resources for each row execute function public.touch_updated_at();
alter table public.service_resources enable row level security;
alter table public.service_resource_assignments enable row level security;
revoke all on table public.service_resources from public, anon;
revoke all on table public.service_resource_assignments from public, anon;

create table if not exists public.membership_levels (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, code)
);
create table if not exists public.membership_plan_level_prices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  plan_id uuid not null references public.membership_plans(id) on delete restrict,
  level_id uuid not null references public.membership_levels(id) on delete restrict,
  price integer not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, level_id)
);
alter table public.patients add column if not exists membership_level_id uuid references public.membership_levels(id) on delete set null;
create index if not exists patients_membership_level_idx on public.patients (clinic_id, membership_level_id);
create index if not exists membership_levels_clinic_idx on public.membership_levels (clinic_id, active, sort_order);
create index if not exists membership_plan_level_prices_clinic_idx on public.membership_plan_level_prices (clinic_id, plan_id);
drop trigger if exists trg_membership_levels_touch on public.membership_levels;
create trigger trg_membership_levels_touch before update on public.membership_levels for each row execute function public.touch_updated_at();
drop trigger if exists trg_membership_plan_level_prices_touch on public.membership_plan_level_prices;
create trigger trg_membership_plan_level_prices_touch before update on public.membership_plan_level_prices for each row execute function public.touch_updated_at();
alter table public.membership_levels enable row level security;
alter table public.membership_plan_level_prices enable row level security;
revoke all on table public.membership_levels from public, anon;
revoke all on table public.membership_plan_level_prices from public, anon;

create or replace function public.get_membership_plan_price(p_clinic_id uuid, p_plan_id uuid, p_patient_id uuid default null)
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select price from public.membership_plan_level_prices price_rule
      join public.patients patient on patient.membership_level_id = price_rule.level_id and patient.id = p_patient_id and patient.clinic_id = p_clinic_id
     where price_rule.clinic_id = p_clinic_id and price_rule.plan_id = p_plan_id),
    (select price from public.membership_plans plan where plan.id = p_plan_id and plan.clinic_id = p_clinic_id)
  );
$$;

create or replace function public.service_resources_available(
  p_clinic_id uuid, p_service_id uuid, p_start_at timestamptz, p_end_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select not exists (
    select 1
      from public.service_resource_assignments required
      join public.service_resources resource on resource.id = required.resource_id and resource.clinic_id = required.clinic_id
     where required.clinic_id = p_clinic_id and required.service_id = p_service_id
       and (not resource.active or (
         select coalesce(sum(used.quantity), 0)
           from public.appointments appointment
           join public.service_resource_assignments used
             on used.clinic_id = appointment.clinic_id and used.service_id = appointment.service_id
            and used.resource_id = required.resource_id
          where appointment.clinic_id = p_clinic_id
            and appointment.status in ('booked', 'confirmed', 'done')
            and appointment.start_at < p_end_at and appointment.end_at > p_start_at
            and appointment.id is distinct from p_exclude_appointment_id
       ) + required.quantity > resource.capacity));
$$;

create or replace function public.get_available_sessions_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_service_id uuid
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz, total integer, taken integer, remaining integer)
language sql
security definer
set search_path = public, extensions
as $$
  select session.template_id, session.session_start, session.session_end, session.total, session.taken, session.remaining
    from public.get_available_sessions(p_clinic_id, p_doctor_id, p_date) session
   where public.service_resources_available(p_clinic_id, p_service_id, session.session_start, session.session_end, null);
$$;
revoke all on function public.get_available_sessions_for_service(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.get_available_sessions_for_service(uuid, uuid, date, uuid) to service_role;

alter table public.event_ticket_types add column if not exists sale_start_at timestamptz;
alter table public.event_ticket_types add column if not exists sale_end_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'event_ticket_sale_window_check') then alter table public.event_ticket_types add constraint event_ticket_sale_window_check check (sale_end_at is null or sale_start_at is null or sale_end_at > sale_start_at) not valid; end if;
end $$;
alter table public.events add column if not exists terms_version integer not null default 1;
alter table public.events add column if not exists terms_text text;
alter table public.registrations add column if not exists terms_version integer;
alter table public.registrations add column if not exists terms_accepted_at timestamptz;

create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null,
  p_terms_version integer default null, p_terms_accepted_at timestamptz default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  select * into r from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations
     set terms_version = p_terms_version, terms_accepted_at = p_terms_accepted_at
   where id = r.registration_id and clinic_id = p_clinic_id;
  return query select r.registration_id, r.registration_no, r.registration_status, r.payment_status, r.amount, r.discount_amount, r.membership_applied, r.checkin_token;
end;
$$;

create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null,
  p_terms_version integer default null, p_terms_accepted_at timestamptz default null, p_patient_id uuid default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  if p_patient_id is not null and not exists (
    select 1 from public.patients
     where id = p_patient_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'patient is not valid for this brand';
  end if;
  select * into r from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations
     set terms_version = p_terms_version,
         terms_accepted_at = p_terms_accepted_at,
         patient_id = p_patient_id
   where id = r.registration_id and clinic_id = p_clinic_id;
  update public.discount_redemptions
     set patient_id = p_patient_id
   where clinic_id = p_clinic_id and registration_id = r.registration_id;
  return query select r.registration_id, r.registration_no, r.registration_status, r.payment_status, r.amount, r.discount_amount, r.membership_applied, r.checkin_token;
end;
$$;

create or replace function public.service_booking_minutes(
  p_clinic_id uuid,
  p_service_id uuid,
  p_base_minutes integer,
  p_visit_type text,
  p_first_visit_extends boolean,
  p_first_visit_minutes integer
)
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select greatest(
    coalesce((select s.duration_minutes + s.buffer_minutes from public.services s where s.id = p_service_id and s.clinic_id = p_clinic_id and s.active), p_base_minutes),
    case when p_visit_type = 'first' and p_first_visit_extends then coalesce(p_first_visit_minutes, p_base_minutes) else p_base_minutes end,
    1
  );
$$;

create or replace function public.get_available_slots_for_service(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_service_id uuid default null
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead integer := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30);
  v_first_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id = p_clinic_id), false);
  v_first_minutes integer := (select first_visit_minutes from public.clinic_settings where clinic_id = p_clinic_id);
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  for rec in
    select t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.doctor_id = p_doctor_id and t.weekday = v_weekday and t.active
       and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and e.date = p_date and e.is_closed and e.start_time is null)
    union all
    select e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and e.date = p_date and not e.is_closed
  loop
    v_slot_length := public.service_booking_minutes(p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes);
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as e
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::integer
      from candidate c
      left join public.appointments a on a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
        and a.status in ('booked', 'confirmed', 'done') and a.start_at < c.e and a.end_at > c.s
     where c.s > now() + (v_lead || ' minutes')::interval
       and public.service_resources_available(p_clinic_id, p_service_id, c.s, c.e, null)
       and not exists (
         select 1 from public.schedule_exceptions ec
          where ec.clinic_id = p_clinic_id and ec.doctor_id = p_doctor_id and ec.date = p_date and ec.is_closed and ec.start_time is not null
            and (c.s at time zone 'Asia/Taipei')::time < ec.end_time and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
       )
     group by c.s, c.e, rec.capacity
     having rec.capacity - count(a.id) > 0
     order by c.s;
  end loop;
end;
$$;

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
begin
  v_id := public.book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is null then return v_id; end if;

  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  select * into v_appointment from public.appointments where id = v_id and clinic_id = p_clinic_id for update;
  v_minutes := public.service_booking_minutes(p_clinic_id, p_service_id,
    greatest(1, extract(epoch from (v_appointment.end_at - v_appointment.start_at))::integer / 60),
    p_visit_type, coalesce(v_settings.first_visit_extends, false), v_settings.first_visit_minutes);
  v_end_at := v_appointment.start_at + (v_minutes || ' minutes')::interval;

  select x.start_time, x.end_time into v_segment from (
    select t.start_time, t.end_time from public.schedule_templates t
     where t.id = v_appointment.template_id and t.clinic_id = p_clinic_id and t.doctor_id = p_doctor_id and t.active
    union all
    select e.start_time, e.end_time from public.schedule_exceptions e
     where e.id = v_appointment.template_id and e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and not e.is_closed
  ) x limit 1;
  if v_segment.end_time is null or v_end_at > ((v_appointment.start_at at time zone 'Asia/Taipei')::date + v_segment.end_time) at time zone 'Asia/Taipei' then
    raise exception 'service duration exceeds schedule segment';
  end if;
  if exists (
    select 1 from public.appointments a where a.id <> v_id and a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
      and a.status in ('booked', 'confirmed', 'done') and a.start_at < v_end_at and a.end_at > v_appointment.start_at
  ) then raise exception 'service duration slot is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, v_appointment.start_at, v_end_at, v_id) then
    raise exception 'service resource is unavailable';
  end if;
  update public.appointments set end_at = v_end_at where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_time_slot_with_membership_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_membership_code text default null, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_membership_id uuid;
begin
  v_id := public.book_time_slot_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if nullif(trim(p_membership_code), '') is null then return v_id; end if;
  select id into v_membership_id from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code)) for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', v_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.service_booking_minutes(uuid, uuid, integer, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.get_available_slots_for_service(uuid, uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.book_time_slot_with_membership_for_service(uuid, uuid, uuid, timestamptz, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.service_booking_minutes(uuid, uuid, integer, text, boolean, integer) to service_role;
grant execute on function public.get_available_slots_for_service(uuid, uuid, date, text, uuid) to service_role;
grant execute on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid) to service_role;
grant execute on function public.book_time_slot_with_membership_for_service(uuid, uuid, uuid, timestamptz, text, boolean, text, uuid) to service_role;
revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz) to service_role;
revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) to service_role;

create or replace function public.book_number_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b record;
begin
  select * into b from public.book_number(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is not null and not public.service_resources_available(p_clinic_id, p_service_id, (select start_at from public.appointments where id = b.appointment_id), (select end_at from public.appointments where id = b.appointment_id), b.appointment_id) then
    raise exception 'service resource is unavailable';
  end if;
  return query select b.appointment_id, b.queue_number;
end;
$$;

create or replace function public.book_number_with_membership_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_membership_code text default null, p_service_id uuid default null
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b record;
  v_membership_id uuid;
begin
  select * into b from public.book_number_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id);
  if nullif(trim(p_membership_code), '') is null then return query select b.appointment_id, b.queue_number; return; end if;
  select id into v_membership_id from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code)) for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', b.appointment_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = b.appointment_id and clinic_id = p_clinic_id;
  return query select b.appointment_id, b.queue_number;
end;
$$;

revoke all on function public.service_resources_available(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.book_number_for_service(uuid, uuid, uuid, uuid, date, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.book_number_with_membership_for_service(uuid, uuid, uuid, uuid, date, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.service_resources_available(uuid, uuid, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.book_number_for_service(uuid, uuid, uuid, uuid, date, text, boolean, uuid) to service_role;
grant execute on function public.book_number_with_membership_for_service(uuid, uuid, uuid, uuid, date, text, boolean, text, uuid) to service_role;

drop policy if exists service_resource_assignments_tenant on public.service_resource_assignments;
create policy service_resource_assignments_tenant on public.service_resource_assignments for all to authenticated
  using (exists (select 1 from public.clinic_members member where member.clinic_id = service_resource_assignments.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')))
  with check (
    exists (select 1 from public.clinic_members member where member.clinic_id = service_resource_assignments.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin'))
    and exists (select 1 from public.services service where service.id = service_resource_assignments.service_id and service.clinic_id = service_resource_assignments.clinic_id)
    and exists (select 1 from public.service_resources resource where resource.id = service_resource_assignments.resource_id and resource.clinic_id = service_resource_assignments.clinic_id)
  );

-- Membership reminders are service-role only. The unique window prevents a
-- repeated cron run from sending the same low-balance or expiry notice twice.
create table if not exists public.membership_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_membership_id uuid not null references public.patient_memberships(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('low_balance', 'expiry')),
  channel text not null check (channel in ('line', 'email')),
  window_key text not null,
  status text not null check (status in ('claimed', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (patient_membership_id, kind, channel, window_key)
);
create index if not exists membership_notification_logs_clinic_idx
  on public.membership_notification_logs (clinic_id, created_at desc);
alter table public.membership_notification_logs enable row level security;
revoke all on table public.membership_notification_logs from public, anon, authenticated;

-- 優惠碼與禮券共用核銷流程；禮券固定為單次使用，並可記錄發放對象。
alter table public.discount_codes add column if not exists benefit_type text not null default 'coupon';
alter table public.discount_codes add column if not exists recipient_name text;
alter table public.discount_codes add column if not exists recipient_phone text;
alter table public.discount_codes add column if not exists issued_at timestamptz not null default now();
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discount_codes'::regclass
      and conname = 'discount_codes_benefit_type_check'
  ) then
    alter table public.discount_codes
      add constraint discount_codes_benefit_type_check
      check (benefit_type in ('coupon', 'voucher'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discount_codes'::regclass
      and conname = 'discount_codes_voucher_single_use_check'
  ) then
    alter table public.discount_codes
      add constraint discount_codes_voucher_single_use_check
      check (benefit_type <> 'voucher' or max_uses = 1);
  end if;
end $$;
