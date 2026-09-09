-- LINE-first customer journeys: webhook idempotency, short-lived conversation state,
-- and official LINE account-link nonces. Server/service-role only.
begin;

create extension if not exists pgcrypto;

alter table public.chat_messages add column if not exists delivery_status text;
alter table public.chat_messages add column if not exists delivery_error text;
alter table public.chat_messages drop constraint if exists chat_messages_delivery_status_check;
alter table public.chat_messages add constraint chat_messages_delivery_status_check
  check (delivery_status is null or delivery_status in ('sending', 'sent', 'failed'));

create table if not exists public.line_webhook_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  event_id text not null,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint line_webhook_events_event_length check (length(event_id) between 1 and 160),
  constraint line_webhook_events_type_length check (length(event_type) between 1 and 40),
  constraint line_webhook_events_clinic_event_unique unique (clinic_id, event_id)
);

create index if not exists line_webhook_events_cleanup_idx
  on public.line_webhook_events (received_at, status);

drop trigger if exists trg_line_webhook_events_touch on public.line_webhook_events;
create trigger trg_line_webhook_events_touch
before update on public.line_webhook_events
for each row execute function public.touch_updated_at();

create table if not exists public.line_customer_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  line_user_id text not null,
  intent text not null check (intent in ('booking', 'support', 'events', 'membership')),
  step text not null,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_customer_sessions_user_length check (length(line_user_id) between 1 and 160),
  constraint line_customer_sessions_step_length check (length(step) between 1 and 80),
  constraint line_customer_sessions_clinic_user_unique unique (clinic_id, line_user_id)
);

create index if not exists line_customer_sessions_expiry_idx
  on public.line_customer_sessions (expires_at);

drop trigger if exists trg_line_customer_sessions_touch on public.line_customer_sessions;
create trigger trg_line_customer_sessions_touch
before update on public.line_customer_sessions
for each row execute function public.touch_updated_at();

create table if not exists public.line_account_link_nonces (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  nonce_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint line_account_link_nonces_hash_length check (length(nonce_hash) = 64),
  constraint line_account_link_nonces_clinic_hash_unique unique (clinic_id, nonce_hash)
);

create index if not exists line_account_link_nonces_expiry_idx
  on public.line_account_link_nonces (expires_at, used_at);

alter table public.line_webhook_events enable row level security;
alter table public.line_customer_sessions enable row level security;
alter table public.line_account_link_nonces enable row level security;

revoke all on table public.line_webhook_events from public, anon, authenticated;
revoke all on table public.line_customer_sessions from public, anon, authenticated;
revoke all on table public.line_account_link_nonces from public, anon, authenticated;
grant select, insert, update, delete on table public.line_webhook_events to service_role;
grant select, insert, update, delete on table public.line_customer_sessions to service_role;
grant select, insert, update, delete on table public.line_account_link_nonces to service_role;

create or replace function public.claim_line_webhook_event(
  p_clinic_id uuid,
  p_event_id text,
  p_event_type text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_clinic_id is null or nullif(btrim(p_event_id), '') is null then
    return false;
  end if;

  insert into public.line_webhook_events (clinic_id, event_id, event_type)
  values (p_clinic_id, btrim(p_event_id), left(coalesce(nullif(btrim(p_event_type), ''), 'unknown'), 40))
  on conflict (clinic_id, event_id) do nothing;
  if found then return true; end if;

  update public.line_webhook_events
     set status = 'processing',
         attempt_count = attempt_count + 1,
         error = null,
         processed_at = null
   where clinic_id = p_clinic_id
     and event_id = btrim(p_event_id)
     and (
       status = 'failed'
       or (status = 'processing' and updated_at < now() - interval '5 minutes')
     );
  return found;
end;
$$;

create or replace function public.complete_line_account_link(
  p_clinic_id uuid,
  p_nonce text,
  p_line_user_id text
) returns table (patient_id uuid, patient_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nonce_hash text;
  v_link public.line_account_link_nonces%rowtype;
  v_line_user_id text := nullif(btrim(coalesce(p_line_user_id, '')), '');
  v_patient public.patients%rowtype;
begin
  if p_clinic_id is null or nullif(btrim(coalesce(p_nonce, '')), '') is null or v_line_user_id is null then
    raise exception 'invalid account link request';
  end if;
  if length(p_nonce) > 256 or length(v_line_user_id) > 160 then
    raise exception 'account link value is too long';
  end if;

  v_nonce_hash := encode(digest(p_nonce, 'sha256'), 'hex');
  select * into v_link
    from public.line_account_link_nonces
   where clinic_id = p_clinic_id
     and nonce_hash = v_nonce_hash
     and used_at is null
     and expires_at > now()
   for update;
  if not found then raise exception 'account link nonce is invalid or expired'; end if;

  select * into v_patient
    from public.patients
   where id = v_link.patient_id and clinic_id = p_clinic_id and active
   for update;
  if not found then raise exception 'account link patient is unavailable'; end if;
  if v_patient.line_user_id is not null and v_patient.line_user_id <> v_line_user_id then
    raise exception 'patient is already linked to another LINE account';
  end if;

  update public.patients
     set line_user_id = v_line_user_id
   where id = v_patient.id and clinic_id = p_clinic_id;
  update public.line_account_link_nonces
     set used_at = now()
   where id = v_link.id;

  return query select v_patient.id, v_patient.name;
end;
$$;

revoke all on function public.claim_line_webhook_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_line_webhook_event(uuid, text, text) to service_role;
revoke all on function public.complete_line_account_link(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_line_account_link(uuid, text, text) to service_role;

commit;
