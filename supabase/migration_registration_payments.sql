-- 預約與報名 SaaS v3：活動報名、標準付款、品牌入口
-- 可重跑；所有業務資料都帶 clinic_id，顧客端只能透過 Next.js API 使用 service role。

create extension if not exists pgcrypto;

alter table clinics add column if not exists slug text;
create unique index if not exists clinics_slug_unique_idx
  on clinics (slug) where slug is not null;

alter table clinic_settings add column if not exists timezone text not null default 'Asia/Taipei';
alter table clinic_settings add column if not exists brand_logo_url text;
alter table clinic_settings add column if not exists brand_primary_color text not null default '#1B6FC4';
alter table clinic_settings add column if not exists brand_accent_color text not null default '#B8862B';
alter table clinic_settings add column if not exists public_booking_enabled boolean not null default true;
alter table clinic_settings add column if not exists public_registration_enabled boolean not null default true;

create table if not exists clinic_domains (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  hostname text not null,
  kind text not null default 'custom' check (kind in ('shared','custom')),
  verification_token text,
  verified_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (hostname)
);
create index if not exists clinic_domains_clinic_idx on clinic_domains (clinic_id, active);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  cover_url text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  access_mode text not null default 'public' check (access_mode in ('public','private')),
  access_token_hash text,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, slug)
);
create index if not exists events_public_idx on events (clinic_id, status, registration_open_at, registration_close_at);
alter table events add column if not exists access_mode text not null default 'public';
alter table events add column if not exists access_token_hash text;
do $$ begin
  alter table events add constraint events_access_mode_check check (access_mode in ('public','private'));
exception when duplicate_object then null; end $$;

create table if not exists event_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  venue text,
  capacity integer not null check (capacity > 0),
  waitlist_enabled boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists event_sessions_event_idx on event_sessions (clinic_id, event_id, start_at);

create table if not exists event_ticket_types (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  price integer not null default 0 check (price >= 0),
  capacity integer check (capacity is null or capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_ticket_types_event_idx on event_ticket_types (clinic_id, event_id, active);

create table if not exists registration_forms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  unique (event_id, version)
);

create table if not exists registration_form_fields (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  form_id uuid not null references registration_forms(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text','textarea','date','select','checkbox')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  unique (form_id, field_key)
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete restrict,
  session_id uuid not null references event_sessions(id) on delete restrict,
  ticket_type_id uuid references event_ticket_types(id) on delete restrict,
  registration_no text not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','cancelled','waitlisted','attended','no_show')),
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required','pending','paid','failed','expired','refunded')),
  amount integer not null default 0 check (amount >= 0),
  name text not null,
  phone text not null,
  email text,
  line_user_id text,
  marketing_opt_in boolean not null default false,
  answers jsonb not null default '{}'::jsonb,
  checkin_token_hash text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, registration_no)
);
create index if not exists registrations_event_idx on registrations (clinic_id, event_id, session_id, status);
create index if not exists registrations_contact_idx on registrations (clinic_id, phone, created_at desc);

alter table crm_interactions add column if not exists registration_id uuid references registrations(id) on delete set null;
alter table crm_interactions drop constraint if exists crm_interactions_kind_check;
alter table crm_interactions add constraint crm_interactions_kind_check
  check (kind in ('note', 'booking', 'registration', 'message', 'campaign'));
create index if not exists crm_interactions_registration_idx on crm_interactions (clinic_id, registration_id, created_at desc);

create table if not exists registration_answers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null unique references registrations(id) on delete restrict,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists registration_answers_clinic_idx on registration_answers (clinic_id, created_at desc);

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null unique references registrations(id) on delete cascade,
  session_id uuid not null references event_sessions(id) on delete cascade,
  position integer not null check (position > 0),
  status text not null default 'waiting' check (status in ('waiting','offered','promoted','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists waitlist_session_idx on waitlist_entries (clinic_id, session_id, status, position);

create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete restrict,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id) on delete set null,
  result text not null default 'accepted' check (result in ('accepted','duplicate','rejected')),
  unique (registration_id)
);

create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete restrict,
  registration_id uuid references registrations(id) on delete restrict,
  provider text not null check (provider in ('ecpay','newebpay')),
  merchant_order_no text not null,
  amount integer not null check (amount > 0),
  currency text not null default 'TWD' check (currency = 'TWD'),
  expires_at timestamptz,
  return_path text not null default '/',
  status text not null default 'pending'
    check (status in ('pending','paid','failed','expired','refunded')),
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((appointment_id is null) <> (registration_id is null)),
  unique (provider, merchant_order_no)
);
alter table payment_orders add column if not exists currency text not null default 'TWD';
alter table payment_orders add column if not exists expires_at timestamptz;
alter table payment_orders add column if not exists return_path text not null default '/';
create index if not exists payment_orders_clinic_idx on payment_orders (clinic_id, status, created_at desc);
create unique index if not exists payment_orders_registration_pending_idx
  on payment_orders (registration_id) where registration_id is not null and status = 'pending';
create unique index if not exists payment_orders_appointment_pending_idx
  on payment_orders (appointment_id) where appointment_id is not null and status = 'pending';

create table if not exists payment_transactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  payment_order_id uuid not null references payment_orders(id) on delete cascade,
  provider_transaction_no text,
  currency text not null default 'TWD' check (currency = 'TWD'),
  event_key text not null,
  status text not null check (status in ('received','accepted','rejected')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (payment_order_id, event_key)
);
alter table payment_transactions add column if not exists currency text not null default 'TWD';

create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id) on delete set null,
  provider text not null check (provider in ('ecpay','newebpay')),
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, event_key)
);

drop trigger if exists trg_events_touch on events;
create trigger trg_events_touch before update on events for each row execute function touch_updated_at();
drop trigger if exists trg_event_sessions_touch on event_sessions;
create trigger trg_event_sessions_touch before update on event_sessions for each row execute function touch_updated_at();
drop trigger if exists trg_event_ticket_types_touch on event_ticket_types;
create trigger trg_event_ticket_types_touch before update on event_ticket_types for each row execute function touch_updated_at();
drop trigger if exists trg_registrations_touch on registrations;
create trigger trg_registrations_touch before update on registrations for each row execute function touch_updated_at();
drop trigger if exists trg_waitlist_entries_touch on waitlist_entries;
create trigger trg_waitlist_entries_touch before update on waitlist_entries for each row execute function touch_updated_at();
drop trigger if exists trg_payment_orders_touch on payment_orders;
create trigger trg_payment_orders_touch before update on payment_orders for each row execute function touch_updated_at();

drop function if exists register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb);
create or replace function register_for_event(
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
  p_access_token text default null
) returns table (
  registration_id uuid,
  registration_no text,
  registration_status text,
  payment_status text,
  amount integer,
  checkin_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e record;
  s record;
  v_taken integer;
  v_ticket_taken integer;
  v_ticket_capacity integer;
  v_status text;
  v_payment_status text;
  v_amount integer := 0;
  v_no integer;
  v_registration_no text;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid;
  v_position integer;
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception '請填寫姓名與電話';
  end if;

  select * into e from events
   where id = p_event_id and clinic_id = p_clinic_id and status = 'published';
  if not found then raise exception '找不到可報名的活動'; end if;
  if e.access_mode = 'private' and (
    nullif(trim(p_access_token), '') is null or
    encode(digest(trim(p_access_token), 'sha256'), 'hex') is distinct from e.access_token_hash
  ) then
    raise exception '此活動需要私密報名連結';
  end if;
  if e.registration_open_at is not null and now() < e.registration_open_at then
    raise exception '報名尚未開始';
  end if;
  if e.registration_close_at is not null and now() > e.registration_close_at then
    raise exception '報名已截止';
  end if;

  select * into s from event_sessions
   where id = p_session_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
  if not found then raise exception '找不到可報名的場次'; end if;

  if p_ticket_type_id is not null then
    select price, capacity into v_amount, v_ticket_capacity from event_ticket_types
     where id = p_ticket_type_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
    if not found then raise exception '找不到可選的票種'; end if;
  else
    v_ticket_capacity := null;
  end if;

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text));

  select count(*)::int into v_taken from registrations r
   where r.clinic_id = p_clinic_id and r.session_id = p_session_id
     and r.status in ('pending','confirmed','attended')
     and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());

  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from registrations r
     where r.clinic_id = p_clinic_id and r.ticket_type_id = p_ticket_type_id
       and r.status in ('pending','confirmed','attended')
       and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());
  else
    v_ticket_taken := 0;
  end if;

  if v_taken >= s.capacity or (v_ticket_capacity is not null and v_ticket_taken >= v_ticket_capacity) then
    if not s.waitlist_enabled then raise exception '此場次已額滿'; end if;
    v_status := 'waitlisted';
    v_payment_status := 'not_required';
  elsif v_amount = 0 then
    v_status := 'confirmed';
    v_payment_status := 'not_required';
  else
    v_status := 'pending';
    v_payment_status := 'pending';
  end if;

  select coalesce(max(nullif(regexp_replace(registration_no, '[^0-9]', '', 'g'), '')::int), 0) + 1
    into v_no from registrations where event_id = p_event_id;
  v_registration_no := 'REG-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_no::text, 4, '0');

  insert into registrations (
    clinic_id, event_id, session_id, ticket_type_id, registration_no, status,
    payment_status, amount, name, phone, email, line_user_id, marketing_opt_in,
    answers, checkin_token_hash, expires_at
  ) values (
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, v_registration_no, v_status,
    v_payment_status, v_amount, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    nullif(trim(p_line_user_id), ''), coalesce(p_marketing_opt_in, false), coalesce(p_answers, '{}'::jsonb),
    encode(digest(v_token, 'sha256'), 'hex'),
    case when v_status = 'pending' then now() + interval '15 minutes' else null end
  ) returning id into v_id;

  insert into registration_answers (clinic_id, registration_id, answers)
    values (p_clinic_id, v_id, p_answers);

  if v_status = 'waitlisted' then
    select coalesce(max(position), 0) + 1 into v_position
      from waitlist_entries where session_id = p_session_id and status in ('waiting','offered');
    insert into waitlist_entries (clinic_id, registration_id, session_id, position)
      values (p_clinic_id, v_id, p_session_id, v_position);
  end if;

  return query select v_id, v_registration_no, v_status, v_payment_status, v_amount, v_token;
end; $$;

create or replace function checkin_registration(p_clinic_id uuid, p_token text, p_user_id uuid default null)
returns table (registration_id uuid, registration_status text, checked_in_at timestamptz, result text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_hash text;
  v_now timestamptz := now();
begin
  if nullif(trim(p_token), '') is null then raise exception '缺少報到憑證'; end if;
  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  select * into r from registrations where clinic_id = p_clinic_id and checkin_token_hash = v_hash for update;
  if not found then raise exception '報到憑證無效'; end if;
  if r.status in ('cancelled','waitlisted','pending') then raise exception '此報名目前不可報到'; end if;
  if exists (select 1 from checkins where registration_id = r.id and result = 'accepted') then
    return query select r.id, r.status, (select c.checked_in_at from checkins c where c.registration_id = r.id and c.result = 'accepted'), 'duplicate';
    return;
  end if;
  insert into checkins (clinic_id, registration_id, checked_in_by, result)
    values (p_clinic_id, r.id, p_user_id, 'accepted');
  update registrations set status = 'attended', updated_at = v_now where id = r.id;
  return query select r.id, 'attended'::text, v_now, 'accepted'::text;
end; $$;

revoke all on function register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text) from public, anon, authenticated;
grant execute on function register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text) to service_role;
revoke all on function checkin_registration(uuid,text,uuid) from public, anon, authenticated;
grant execute on function checkin_registration(uuid,text,uuid) to service_role;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['clinic_domains','events','event_sessions','event_ticket_types','registration_forms','registration_form_fields','registrations','registration_answers','waitlist_entries','checkins','payment_orders','payment_transactions','payment_webhook_events'] loop
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
