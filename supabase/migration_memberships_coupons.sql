-- v3 standard customer benefits: membership packages, credits, and coupons.
-- Apply after migration_v3_hardening.sql.

create extension if not exists pgcrypto;

create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  name text not null,
  description text,
  price integer not null default 0 check (price >= 0),
  credits_total integer not null check (credits_total > 0),
  valid_days integer check (valid_days is null or valid_days > 0),
  usage_scope text not null default 'both' check (usage_scope in ('appointment','registration','both')),
  service_id uuid references services(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists membership_plans_clinic_idx on membership_plans (clinic_id, active, created_at desc);

create table if not exists patient_memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  patient_id uuid not null references patients(id) on delete restrict,
  plan_id uuid not null references membership_plans(id) on delete restrict,
  membership_code text not null,
  status text not null default 'active' check (status in ('active','exhausted','expired','cancelled')),
  credits_total integer not null check (credits_total > 0),
  credits_remaining integer not null check (credits_remaining >= 0 and credits_remaining <= credits_total),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  source text not null default 'manual' check (source in ('manual','purchase','migration')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);
create unique index if not exists patient_memberships_code_idx on patient_memberships (clinic_id, membership_code);
create index if not exists patient_memberships_patient_idx on patient_memberships (clinic_id, patient_id, status, expires_at);

create table if not exists membership_ledger (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  membership_id uuid not null references patient_memberships(id) on delete restrict,
  patient_id uuid not null references patients(id) on delete restrict,
  kind text not null check (kind in ('grant','consume','restore','adjust','expire')),
  credits_delta integer not null check (credits_delta <> 0),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists membership_ledger_idempotency_idx
  on membership_ledger (membership_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists membership_ledger_lookup_idx on membership_ledger (clinic_id, patient_id, created_at desc);

create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  code text not null,
  kind text not null check (kind in ('percent','fixed')),
  value integer not null check (value > 0),
  min_amount integer not null default 0 check (min_amount >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists discount_codes_code_idx on discount_codes (clinic_id, lower(code));
create index if not exists discount_codes_active_idx on discount_codes (clinic_id, active, starts_at, ends_at);

create table if not exists discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  discount_code_id uuid not null references discount_codes(id) on delete restrict,
  patient_id uuid references patients(id) on delete restrict,
  registration_id uuid references registrations(id) on delete restrict,
  appointment_id uuid references appointments(id) on delete restrict,
  original_amount integer not null check (original_amount >= 0),
  discount_amount integer not null check (discount_amount >= 0),
  final_amount integer not null check (final_amount >= 0),
  status text not null default 'reserved' check (status in ('reserved','applied','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((registration_id is null) <> (appointment_id is null))
);
create unique index if not exists discount_redemptions_registration_idx
  on discount_redemptions (registration_id) where registration_id is not null;
create unique index if not exists discount_redemptions_appointment_idx
  on discount_redemptions (appointment_id) where appointment_id is not null;
create index if not exists discount_redemptions_code_idx on discount_redemptions (clinic_id, discount_code_id, status);

alter table event_ticket_types add column if not exists membership_plan_id uuid references membership_plans(id) on delete restrict;
alter table registrations add column if not exists discount_code_id uuid references discount_codes(id) on delete restrict;
alter table registrations add column if not exists discount_amount integer not null default 0 check (discount_amount >= 0);
alter table registrations add column if not exists membership_id uuid references patient_memberships(id) on delete restrict;
alter table appointments add column if not exists membership_id uuid references patient_memberships(id) on delete restrict;
alter table appointments add column if not exists discount_code_id uuid references discount_codes(id) on delete restrict;
alter table appointments add column if not exists discount_amount integer not null default 0 check (discount_amount >= 0);
create index if not exists registrations_benefit_idx on registrations (clinic_id, discount_code_id, membership_id);
create index if not exists appointments_benefit_idx on appointments (clinic_id, discount_code_id, membership_id);

drop trigger if exists trg_membership_plans_touch on membership_plans;
create trigger trg_membership_plans_touch before update on membership_plans for each row execute function touch_updated_at();
drop trigger if exists trg_patient_memberships_touch on patient_memberships;
create trigger trg_patient_memberships_touch before update on patient_memberships for each row execute function touch_updated_at();
drop trigger if exists trg_discount_codes_touch on discount_codes;
create trigger trg_discount_codes_touch before update on discount_codes for each row execute function touch_updated_at();
drop trigger if exists trg_discount_redemptions_touch on discount_redemptions;
create trigger trg_discount_redemptions_touch before update on discount_redemptions for each row execute function touch_updated_at();

create or replace function grant_patient_membership(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_plan_id uuid,
  p_actor_user_id uuid,
  p_source text default 'manual',
  p_note text default null
) returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  plan_row record;
  patient_row record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  if p_source not in ('manual','purchase','migration') then raise exception 'invalid membership source'; end if;
  if not exists (
    select 1 from clinic_members cm
     where cm.clinic_id = p_clinic_id and cm.user_id = p_actor_user_id and cm.role <> 'provider'
  ) then raise exception 'membership actor is not allowed'; end if;
  select id, name, phone into patient_row from patients
   where id = p_patient_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'patient not found'; end if;
  select * into plan_row from membership_plans
   where id = p_plan_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'membership plan not found'; end if;
  if plan_row.valid_days is not null then
    v_expires := now() + (plan_row.valid_days || ' days')::interval;
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (select 1 from patient_memberships where clinic_id = p_clinic_id and membership_code = v_code);
  end loop;
  insert into patient_memberships (
    clinic_id, patient_id, plan_id, membership_code, credits_total, credits_remaining,
    starts_at, expires_at, source, note
  ) values (
    p_clinic_id, patient_row.id, plan_row.id, v_code, plan_row.credits_total, plan_row.credits_total,
    now(), v_expires, p_source, nullif(btrim(p_note), '')
  ) returning id into v_id;
  insert into membership_ledger (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, actor_id, note)
    values (p_clinic_id, v_id, patient_row.id, 'grant', plan_row.credits_total, 'manual', p_actor_user_id, p_note);
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;

create or replace function consume_membership_credit(
  p_clinic_id uuid,
  p_membership_id uuid,
  p_usage_scope text,
  p_reference_type text,
  p_reference_id uuid,
  p_service_id uuid default null,
  p_actor_user_id uuid default null,
  p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare
  membership_row record;
  v_key text := coalesce(p_reference_type, 'manual') || ':' || coalesce(p_reference_id::text, 'none');
  v_remaining integer;
begin
  if p_usage_scope not in ('appointment','registration') then raise exception 'invalid membership usage scope'; end if;
  select pm.*, mp.usage_scope, mp.service_id as plan_service_id
    into membership_row
    from patient_memberships pm
    join membership_plans mp on mp.id = pm.plan_id and mp.clinic_id = pm.clinic_id
   where pm.id = p_membership_id and pm.clinic_id = p_clinic_id
   for update of pm;
  if not found then raise exception 'membership not found'; end if;
  if membership_row.status <> 'active' or membership_row.credits_remaining <= 0 then raise exception 'membership has no available credit'; end if;
  if membership_row.expires_at is not null and membership_row.expires_at <= now() then
    update patient_memberships set status = 'expired', updated_at = now() where id = p_membership_id;
    raise exception 'membership expired';
  end if;
  if membership_row.usage_scope not in (p_usage_scope, 'both') then raise exception 'membership scope does not match'; end if;
  if membership_row.plan_service_id is not null and membership_row.plan_service_id is distinct from p_service_id then
    raise exception 'membership is not valid for this service';
  end if;
  if p_reference_id is not null and exists (
    select 1 from membership_ledger where membership_id = p_membership_id and kind = 'consume' and idempotency_key = v_key
  ) then
    return membership_row.credits_remaining;
  end if;
  v_remaining := membership_row.credits_remaining - 1;
  update patient_memberships
     set credits_remaining = v_remaining,
         status = case when v_remaining = 0 then 'exhausted' else 'active' end,
         updated_at = now()
   where id = p_membership_id;
  insert into membership_ledger (
    clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, idempotency_key, actor_id, note
  ) values (
    p_clinic_id, p_membership_id, membership_row.patient_id, 'consume', -1, p_reference_type, p_reference_id, v_key, p_actor_user_id, p_note
  );
  return v_remaining;
end;
$$;

create or replace function restore_membership_credit(
  p_clinic_id uuid,
  p_membership_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare
  membership_row record;
  v_key text := 'restore:' || coalesce(p_reference_type, 'manual') || ':' || coalesce(p_reference_id::text, 'none');
  v_remaining integer;
begin
  if exists (select 1 from membership_ledger where membership_id = p_membership_id and kind = 'restore' and idempotency_key = v_key) then
    select credits_remaining into v_remaining from patient_memberships where id = p_membership_id and clinic_id = p_clinic_id;
    return coalesce(v_remaining, 0);
  end if;
  select * into membership_row from patient_memberships where id = p_membership_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'membership not found'; end if;
  v_remaining := least(membership_row.credits_total, membership_row.credits_remaining + 1);
  update patient_memberships
     set credits_remaining = v_remaining,
         status = case when expires_at is not null and expires_at <= now() then 'expired' when v_remaining = credits_total then 'active' else 'active' end,
         updated_at = now()
   where id = p_membership_id;
  insert into membership_ledger (
    clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, idempotency_key, note
  ) values (
    p_clinic_id, p_membership_id, membership_row.patient_id, 'restore', 1, p_reference_type, p_reference_id, v_key, p_note
  );
  return v_remaining;
end;
$$;

create or replace function cancel_appointment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_note text default 'cancelled appointment'
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  appt record;
begin
  select id, status, membership_id into appt
    from appointments
   where id = p_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be cancelled'; end if;
  if appt.membership_id is not null then
    perform restore_membership_credit(p_clinic_id, appt.membership_id, 'appointment', appt.id, p_note);
  end if;
  update appointments set status = 'cancelled' where id = appt.id and clinic_id = p_clinic_id;
  return appt.id;
end;
$$;

revoke all on function cancel_appointment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function cancel_appointment(uuid, uuid, text) to service_role;

drop function if exists register_for_event_with_benefits(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text);

create or replace function register_for_event_with_benefits(
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
  p_form_version integer default null
) returns table (
  registration_id uuid,
  registration_no text,
  registration_status text,
  payment_status text,
  amount integer,
  discount_amount integer,
  membership_applied boolean,
  checkin_token text
)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  e record;
  s record;
  ticket record;
  membership_row record;
  discount_row record;
  v_taken integer;
  v_ticket_taken integer;
  v_status text;
  v_payment_status text;
  v_original_amount integer := 0;
  v_amount integer := 0;
  v_discount_amount integer := 0;
  v_no integer;
  v_registration_no text;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid;
  v_position integer;
  v_membership_applied boolean := false;
  v_code text := lower(nullif(trim(p_discount_code), ''));
  v_membership_code text := upper(nullif(trim(p_membership_code), ''));
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then raise exception 'name and phone are required'; end if;
  if v_code is not null and v_membership_code is not null then raise exception 'membership and discount cannot be combined'; end if;
  select * into e from events where id = p_event_id and clinic_id = p_clinic_id and status = 'published';
  if not found then raise exception 'event not found'; end if;
  if e.access_mode = 'private' and (nullif(trim(p_access_token), '') is null or encode(digest(trim(p_access_token), 'sha256'), 'hex') is distinct from e.access_token_hash) then raise exception 'private event token is invalid'; end if;
  if e.registration_open_at is not null and now() < e.registration_open_at then raise exception 'registration is not open'; end if;
  if e.registration_close_at is not null and now() > e.registration_close_at then raise exception 'registration is closed'; end if;
  select * into s from event_sessions where id = p_session_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'session not found'; end if;
  if p_form_id is not null and not exists (
    select 1 from registration_forms
     where id = p_form_id and event_id = p_event_id and clinic_id = p_clinic_id
       and status = 'published' and version = p_form_version
  ) then
    raise exception 'registration form is invalid';
  end if;
  if p_ticket_type_id is not null then
    select price, capacity, membership_plan_id into ticket from event_ticket_types where id = p_ticket_type_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
    if not found then raise exception 'ticket type not found'; end if;
    v_original_amount := ticket.price;
    v_ticket_taken := 0;
  else
    v_ticket_taken := 0;
  end if;
  if v_code is not null and v_original_amount = 0 then raise exception 'discount code requires a paid ticket'; end if;

  perform pg_advisory_xact_lock(hashtext('registration-benefit:' || p_clinic_id::text || ':' || p_event_id::text));
  select count(*)::int into v_taken from registrations r
   where r.clinic_id = p_clinic_id and r.session_id = p_session_id and r.status in ('pending','confirmed','attended')
     and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());
  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from registrations r
     where r.clinic_id = p_clinic_id and r.ticket_type_id = p_ticket_type_id and r.status in ('pending','confirmed','attended')
       and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());
  end if;
  if v_taken >= s.capacity or (p_ticket_type_id is not null and ticket.capacity is not null and v_ticket_taken >= ticket.capacity) then
    if not s.waitlist_enabled then raise exception 'session is full'; end if;
    if v_code is not null or v_membership_code is not null then raise exception 'benefits cannot be used while waitlisted'; end if;
    v_status := 'waitlisted';
    v_payment_status := 'not_required';
  else
    if v_membership_code is not null then
      select pm.*, mp.usage_scope, mp.service_id as plan_service_id
        into membership_row
        from patient_memberships pm
        join membership_plans mp on mp.id = pm.plan_id and mp.clinic_id = pm.clinic_id
        join patients p on p.id = pm.patient_id and p.clinic_id = pm.clinic_id
       where pm.clinic_id = p_clinic_id and pm.membership_code = v_membership_code and p.phone = trim(p_phone) and p.active
       for update of pm;
      if not found then raise exception 'membership code is invalid'; end if;
      if membership_row.status <> 'active' or membership_row.credits_remaining <= 0 then raise exception 'membership has no available credit'; end if;
      if membership_row.expires_at is not null and membership_row.expires_at <= now() then raise exception 'membership expired'; end if;
      if membership_row.usage_scope not in ('registration','both') then raise exception 'membership cannot be used for registration'; end if;
      if p_ticket_type_id is not null and ticket.membership_plan_id is not null and ticket.membership_plan_id is distinct from membership_row.plan_id then raise exception 'membership does not match ticket'; end if;
      v_amount := 0;
      v_membership_applied := true;
    else
      v_amount := v_original_amount;
      if v_code is not null and v_amount > 0 then
        select * into discount_row from discount_codes where clinic_id = p_clinic_id and lower(code) = v_code for update;
        if not found or not discount_row.active then raise exception 'discount code is invalid'; end if;
        if discount_row.starts_at is not null and now() < discount_row.starts_at then raise exception 'discount code is not active'; end if;
        if discount_row.ends_at is not null and now() >= discount_row.ends_at then raise exception 'discount code is expired'; end if;
        if v_amount < discount_row.min_amount then raise exception 'order does not meet discount minimum'; end if;
        if discount_row.max_uses is not null and discount_row.used_count >= discount_row.max_uses then raise exception 'discount code usage limit reached'; end if;
        v_discount_amount := case when discount_row.kind = 'percent' then floor(v_amount * discount_row.value / 100.0)::int else least(v_amount, discount_row.value) end;
        v_amount := greatest(0, v_amount - v_discount_amount);
      end if;
    end if;
    v_status := case when v_amount = 0 then 'confirmed' else 'pending' end;
    v_payment_status := case when v_amount = 0 then 'not_required' else 'pending' end;
  end if;

  select coalesce(max(nullif(regexp_replace(registration_no, '[^0-9]', '', 'g'), '')::int), 0) + 1 into v_no from registrations where clinic_id = p_clinic_id and event_id = p_event_id;
  v_registration_no := 'REG-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_no::text, 4, '0');
  insert into registrations (
    clinic_id, event_id, session_id, ticket_type_id, registration_no, status, payment_status, amount, discount_code_id, discount_amount, membership_id,
    name, phone, email, line_user_id, marketing_opt_in, answers, checkin_token_hash, expires_at, form_id, form_version
  ) values (
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, v_registration_no, v_status, v_payment_status, v_amount,
    case when v_code is null then null else discount_row.id end, v_discount_amount,
    case when v_membership_applied then membership_row.id else null end,
    trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_line_user_id), ''), coalesce(p_marketing_opt_in, false), coalesce(p_answers, '{}'::jsonb), encode(digest(v_token, 'sha256'), 'hex'),
    case when v_status = 'pending' then now() + interval '15 minutes' else null end,
    p_form_id, p_form_version
  ) returning id into v_id;
  insert into registration_answers (clinic_id, registration_id, answers) values (p_clinic_id, v_id, p_answers);
  if v_membership_applied then
    perform consume_membership_credit(p_clinic_id, membership_row.id, 'registration', 'registration', v_id, null, null, 'registration membership redemption');
  elsif v_code is not null then
    update discount_codes set used_count = used_count + 1, updated_at = now() where id = discount_row.id;
    insert into discount_redemptions (clinic_id, discount_code_id, patient_id, registration_id, original_amount, discount_amount, final_amount, status)
      values (p_clinic_id, discount_row.id, (select id from patients where clinic_id = p_clinic_id and phone = trim(p_phone) and active order by created_at limit 1), v_id, v_original_amount, v_discount_amount, v_amount,
        case when v_status = 'confirmed' then 'applied' else 'reserved' end);
  end if;
  if v_status = 'waitlisted' then
    select coalesce(max(position), 0) + 1 into v_position from waitlist_entries where session_id = p_session_id and status in ('waiting','offered');
    insert into waitlist_entries (clinic_id, registration_id, session_id, position) values (p_clinic_id, v_id, p_session_id, v_position);
  end if;
  return query select v_id, v_registration_no, v_status, v_payment_status, v_amount, v_discount_amount, v_membership_applied, v_token;
end;
$$;

create or replace function apply_registration_benefits(p_clinic_id uuid, p_registration_id uuid)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare n integer;
begin
  update discount_redemptions set status = 'applied', updated_at = now()
   where clinic_id = p_clinic_id and registration_id = p_registration_id and status = 'reserved';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function release_registration_benefits(p_clinic_id uuid, p_registration_id uuid)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare
  reg record;
  redemption record;
  released integer := 0;
begin
  select * into reg from registrations where id = p_registration_id and clinic_id = p_clinic_id for update;
  if not found then return 0; end if;
  for redemption in select * from discount_redemptions where clinic_id = p_clinic_id and registration_id = p_registration_id and status = 'reserved' for update loop
    update discount_redemptions set status = 'released', updated_at = now() where id = redemption.id;
    update discount_codes set used_count = greatest(0, used_count - 1), updated_at = now() where id = redemption.discount_code_id;
    released := released + 1;
  end loop;
  if reg.membership_id is not null and exists (
    select 1 from membership_ledger where membership_id = reg.membership_id and kind = 'consume' and reference_type = 'registration' and reference_id = reg.id
  ) then
    perform restore_membership_credit(p_clinic_id, reg.membership_id, 'registration', reg.id, 'cancelled registration');
    released := released + 1;
  end if;
  return released;
end;
$$;

create or replace function release_expired_registration_benefits()
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare
  reg record;
  released integer := 0;
begin
  for reg in
    select r.clinic_id, r.id
      from registrations r
      join discount_redemptions dr on dr.registration_id = r.id and dr.status = 'reserved'
     where r.status = 'cancelled' and r.payment_status in ('failed','expired')
  loop
    released := released + release_registration_benefits(reg.clinic_id, reg.id);
  end loop;
  return released;
end;
$$;

create or replace function cancel_registration_by_id(
  p_clinic_id uuid,
  p_registration_id uuid,
  p_actor_user_id uuid default null
)
returns table (registration_id uuid, registration_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  if p_actor_user_id is not null and not exists (
    select 1 from clinic_members cm
     where cm.clinic_id = p_clinic_id
       and cm.user_id = p_actor_user_id
       and cm.role <> 'provider'
  ) then
    raise exception 'operator is not authorized';
  end if;

  select * into r from registrations
   where id = p_registration_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'registration not found'; end if;
  if r.status in ('attended', 'cancelled') then
    return query select r.id, r.status;
    return;
  end if;

  update registrations
     set status = 'cancelled',
         payment_status = case when r.payment_status = 'paid' then 'paid' else r.payment_status end,
         expires_at = null
   where id = r.id and clinic_id = p_clinic_id;
  perform release_registration_benefits(p_clinic_id, r.id);
  perform promote_waitlist_for_session(p_clinic_id, r.session_id);
  return query select r.id, 'cancelled'::text;
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
  v_registration_id uuid;
begin
  if nullif(trim(p_token), '') is null then raise exception '缺少取消憑證'; end if;
  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  select id into v_registration_id from registrations
   where clinic_id = p_clinic_id and checkin_token_hash = v_hash
   for update;
  if not found then raise exception '取消憑證無效'; end if;
  return query select * from cancel_registration_by_id(p_clinic_id, v_registration_id, null);
end;
$$;

create or replace function book_time_slot_with_membership(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_membership_code text default null,
  p_service_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
  membership_row record;
begin
  if nullif(trim(p_membership_code), '') is null then
    return book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  end if;
  v_id := book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  select pm.id into membership_row
    from patient_memberships pm
    join patients p on p.id = pm.patient_id and p.clinic_id = pm.clinic_id
   where pm.clinic_id = p_clinic_id and pm.membership_code = upper(trim(p_membership_code)) and pm.patient_id = p_patient_id and p.phone is not null;
  if not found then raise exception 'membership code is invalid'; end if;
  perform consume_membership_credit(p_clinic_id, membership_row.id, 'appointment', 'appointment', v_id, p_service_id, null, 'appointment membership redemption');
  update appointments set membership_id = membership_row.id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function book_number_with_membership(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_membership_code text default null,
  p_service_id uuid default null
) returns table (appointment_id uuid, queue_number integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  base_row record;
  membership_row record;
begin
  if nullif(trim(p_membership_code), '') is null then
    return query select * from book_number(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id);
    return;
  end if;
  select * into base_row from book_number(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id);
  select pm.id into membership_row
    from patient_memberships pm
   where pm.clinic_id = p_clinic_id and pm.membership_code = upper(trim(p_membership_code)) and pm.patient_id = p_patient_id;
  if not found then raise exception 'membership code is invalid'; end if;
  perform consume_membership_credit(p_clinic_id, membership_row.id, 'appointment', 'appointment', base_row.appointment_id, p_service_id, null, 'appointment membership redemption');
  update appointments set membership_id = membership_row.id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = base_row.appointment_id and clinic_id = p_clinic_id;
  return query select base_row.appointment_id, base_row.queue_number;
end;
$$;

create or replace function reschedule_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null,
  p_service_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  old_appt record;
  new_appointment_id uuid;
  new_queue_number integer;
  v_service_id uuid;
begin
  select patient_id, visit_type, is_self_pay, membership_id, service_id, status
    into old_appt
    from appointments
   where id = p_old_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;
  v_service_id := coalesce(p_service_id, old_appt.service_id);

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    new_appointment_id := book_time_slot(
      p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
      old_appt.visit_type, old_appt.is_self_pay, v_service_id
    );
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    select appointment_id, queue_number into new_appointment_id, new_queue_number
      from book_number(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      );
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update appointments
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id
     where id = new_appointment_id and clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update appointments set service_id = v_service_id where id = new_appointment_id and clinic_id = p_clinic_id;
  end if;

  update appointments set status = 'cancelled' where id = p_old_appointment_id and clinic_id = p_clinic_id;
  update appointment_status_events
     set note = 'rescheduled appointment'
   where id = (
     select id from appointment_status_events
      where appointment_id = p_old_appointment_id
        and clinic_id = p_clinic_id
        and to_status = 'cancelled'
      order by created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function reschedule_appointment(uuid,uuid,text,uuid,timestamptz,uuid,date,uuid) from public,anon,authenticated;
grant execute on function reschedule_appointment(uuid,uuid,text,uuid,timestamptz,uuid,date,uuid) to service_role;

revoke all on function grant_patient_membership(uuid,uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function grant_patient_membership(uuid,uuid,uuid,uuid,text,text) to service_role;
revoke all on function consume_membership_credit(uuid,uuid,text,text,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function consume_membership_credit(uuid,uuid,text,text,uuid,uuid,uuid,text) to service_role;
revoke all on function restore_membership_credit(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function restore_membership_credit(uuid,uuid,text,uuid,text) to service_role;
revoke all on function register_for_event_with_benefits(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text,text,text,uuid,integer) from public, anon, authenticated;
grant execute on function register_for_event_with_benefits(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text,text,text,uuid,integer) to service_role;
revoke all on function apply_registration_benefits(uuid,uuid) from public, anon, authenticated;
grant execute on function apply_registration_benefits(uuid,uuid) to service_role;
revoke all on function release_registration_benefits(uuid,uuid) from public, anon, authenticated;
grant execute on function release_registration_benefits(uuid,uuid) to service_role;
revoke all on function release_expired_registration_benefits() from public, anon, authenticated;
grant execute on function release_expired_registration_benefits() to service_role;
revoke all on function cancel_registration(uuid, text) from public, anon, authenticated;
grant execute on function cancel_registration(uuid, text) to service_role;
revoke all on function cancel_registration_by_id(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function cancel_registration_by_id(uuid, uuid, uuid) to service_role;
revoke all on function book_time_slot_with_membership(uuid,uuid,uuid,timestamptz,text,boolean,text,uuid) from public, anon, authenticated;
grant execute on function book_time_slot_with_membership(uuid,uuid,uuid,timestamptz,text,boolean,text,uuid) to service_role;
revoke all on function book_number_with_membership(uuid,uuid,uuid,uuid,date,text,boolean,text,uuid) from public, anon, authenticated;
grant execute on function book_number_with_membership(uuid,uuid,uuid,uuid,date,text,boolean,text,uuid) to service_role;

do $$
declare tbl text;
begin
  foreach tbl in array array['membership_plans','patient_memberships','membership_ledger','discount_codes','discount_redemptions'] loop
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
