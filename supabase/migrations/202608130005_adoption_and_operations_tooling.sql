-- Adoption metrics and first-stage operational tooling.
-- All tenant-scoped data is keyed by clinic_id. Anonymous access is denied.
begin;

create table if not exists public.clinic_activation_metrics (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  measurement_started_at timestamptz not null default now(),
  first_bookable_at timestamptz,
  first_booking_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.trial_brand_observations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'active' and ended_at is null) or (status = 'completed' and ended_at is not null))
);
create unique index if not exists trial_brand_observations_one_active_idx
  on public.trial_brand_observations (clinic_id) where status = 'active';

create table if not exists public.admin_product_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  event_name text not null check (event_name in (
    'settings_view', 'settings_exit', 'settings_submit',
    'permission_denied', 'permission_help_requested'
  )),
  session_id text not null,
  actor_scope text not null default 'brand_employee' check (actor_scope in ('brand_admin', 'brand_employee', 'system_admin', 'system_employee')),
  pathname text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(session_id) between 8 and 128),
  check (pathname is null or length(pathname) <= 240),
  check (pg_column_size(metadata) <= 4096)
);
create index if not exists admin_product_events_clinic_time_idx
  on public.admin_product_events (clinic_id, created_at desc);
create index if not exists admin_product_events_clinic_name_idx
  on public.admin_product_events (clinic_id, event_name, created_at desc);

create table if not exists public.data_import_jobs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  entity text not null check (entity in ('patients', 'services', 'memberships')),
  idempotency_key text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0 and total_rows <= 500),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  error_summary jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (clinic_id, idempotency_key),
  check (length(idempotency_key) between 8 and 128),
  check (pg_column_size(error_summary) <= 16384)
);
create index if not exists data_import_jobs_clinic_time_idx
  on public.data_import_jobs (clinic_id, created_at desc);

create table if not exists public.channel_test_runs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  channel text not null check (channel in ('line', 'liff', 'email', 'payment', 'domain')),
  status text not null check (status in ('passed', 'warning', 'failed')),
  checks jsonb not null default '[]'::jsonb,
  ran_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (pg_column_size(checks) <= 16384)
);
create index if not exists channel_test_runs_clinic_time_idx
  on public.channel_test_runs (clinic_id, channel, created_at desc);

create table if not exists public.handoff_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null,
  category text not null default 'other' check (category in ('appointment', 'payment', 'customer', 'channel', 'other')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  related_appointment_id uuid references public.appointments(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(title) between 1 and 160),
  check (note is null or length(note) <= 1000)
);
create index if not exists handoff_tasks_clinic_filter_idx
  on public.handoff_tasks (clinic_id, status, priority, due_at, created_at desc);

create table if not exists public.feature_interest_signals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'calendar_sync', 'refund_reconciliation', 'pos_inventory', 'commission',
    'multilingual', 'white_label'
  )),
  interest text not null check (interest in ('unknown', 'interested', 'not_interested', 'quoted', 'won')),
  willingness_monthly integer check (willingness_monthly is null or willingness_monthly >= 0),
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, feature_key),
  check (note is null or length(note) <= 1000)
);

alter table public.clinic_activation_metrics enable row level security;
alter table public.trial_brand_observations enable row level security;
alter table public.admin_product_events enable row level security;
alter table public.data_import_jobs enable row level security;
alter table public.channel_test_runs enable row level security;
alter table public.handoff_tasks enable row level security;
alter table public.feature_interest_signals enable row level security;

revoke all on table public.clinic_activation_metrics from public, anon, authenticated;
revoke all on table public.trial_brand_observations from public, anon, authenticated;
revoke all on table public.admin_product_events from public, anon, authenticated;
revoke all on table public.data_import_jobs from public, anon, authenticated;
revoke all on table public.channel_test_runs from public, anon, authenticated;
revoke all on table public.feature_interest_signals from public, anon, authenticated;
revoke all on table public.handoff_tasks from public, anon;

drop policy if exists handoff_tasks_member on public.handoff_tasks;
create policy handoff_tasks_member on public.handoff_tasks for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
    where member.clinic_id = handoff_tasks.clinic_id
      and member.user_id = auth.uid()
      and (
        member.access_type = 'brand_admin'
        or 'operations.manage' = any(member.permissions)
        or 'brand.manage' = any(member.permissions)
      )
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
    where member.clinic_id = handoff_tasks.clinic_id
      and member.user_id = auth.uid()
      and (
        member.access_type = 'brand_admin'
        or 'operations.manage' = any(member.permissions)
        or 'brand.manage' = any(member.permissions)
      )
  )
);

drop trigger if exists trg_clinic_activation_metrics_touch on public.clinic_activation_metrics;
create trigger trg_clinic_activation_metrics_touch before update on public.clinic_activation_metrics
for each row execute function public.touch_updated_at();
drop trigger if exists trg_trial_brand_observations_touch on public.trial_brand_observations;
create trigger trg_trial_brand_observations_touch before update on public.trial_brand_observations
for each row execute function public.touch_updated_at();
drop trigger if exists trg_handoff_tasks_touch on public.handoff_tasks;
create trigger trg_handoff_tasks_touch before update on public.handoff_tasks
for each row execute function public.touch_updated_at();
drop trigger if exists trg_feature_interest_signals_touch on public.feature_interest_signals;
create trigger trg_feature_interest_signals_touch before update on public.feature_interest_signals
for each row execute function public.touch_updated_at();

create or replace function public.refresh_clinic_activation_metric(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_is_bookable boolean;
begin
  insert into public.clinic_activation_metrics (clinic_id)
  values (p_clinic_id)
  on conflict (clinic_id) do nothing;

  select
    coalesce(settings.public_booking_enabled, false)
    and exists (
      select 1 from public.services service
      where service.clinic_id = p_clinic_id and service.active
    )
    and exists (
      select 1 from public.schedule_templates template
      where template.clinic_id = p_clinic_id and template.active
    )
  into v_is_bookable
  from public.clinic_settings settings
  where settings.clinic_id = p_clinic_id;

  if coalesce(v_is_bookable, false) then
    update public.clinic_activation_metrics
       set first_bookable_at = coalesce(first_bookable_at, now())
     where clinic_id = p_clinic_id;
  end if;
end;
$$;

create or replace function public.refresh_clinic_activation_from_row()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic_id uuid;
begin
  v_clinic_id := coalesce(new.clinic_id, old.clinic_id);
  perform public.refresh_clinic_activation_metric(v_clinic_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.seed_clinic_activation_metric()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.clinic_activation_metrics (clinic_id) values (new.id)
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;

create or replace function public.record_first_clinic_booking()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status <> 'cancelled' then
    insert into public.clinic_activation_metrics (clinic_id, first_booking_at)
    values (new.clinic_id, coalesce(new.created_at, now()))
    on conflict (clinic_id) do update
      set first_booking_at = coalesce(public.clinic_activation_metrics.first_booking_at, excluded.first_booking_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinic_seed_activation_metric on public.clinics;
create trigger trg_clinic_seed_activation_metric after insert on public.clinics
for each row execute function public.seed_clinic_activation_metric();
drop trigger if exists trg_clinic_settings_activation on public.clinic_settings;
create trigger trg_clinic_settings_activation after insert or update of public_booking_enabled on public.clinic_settings
for each row execute function public.refresh_clinic_activation_from_row();
drop trigger if exists trg_services_activation on public.services;
create trigger trg_services_activation after insert or update of active or delete on public.services
for each row execute function public.refresh_clinic_activation_from_row();
drop trigger if exists trg_schedule_templates_activation on public.schedule_templates;
create trigger trg_schedule_templates_activation after insert or update of active or delete on public.schedule_templates
for each row execute function public.refresh_clinic_activation_from_row();
drop trigger if exists trg_appointments_first_booking on public.appointments;
create trigger trg_appointments_first_booking after insert on public.appointments
for each row execute function public.record_first_clinic_booking();

insert into public.clinic_activation_metrics (clinic_id)
select id from public.clinics
on conflict (clinic_id) do nothing;
select public.refresh_clinic_activation_metric(id) from public.clinics;
update public.clinic_activation_metrics metric
set first_booking_at = first_row.first_booking_at
from (
  select clinic_id, min(created_at) as first_booking_at
  from public.appointments
  where status <> 'cancelled'
  group by clinic_id
) first_row
where metric.clinic_id = first_row.clinic_id
  and metric.first_booking_at is null;

create or replace function public.execute_data_import(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_entity text,
  p_idempotency_key text,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job_id uuid;
  v_row jsonb;
  v_index integer := 0;
  v_imported integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_patient_id uuid;
  v_plan_id uuid;
  v_membership_id uuid;
  v_name text;
  v_phone text;
  v_credits integer;
  v_code text;
  v_allowed boolean;
  v_max integer;
  v_existing integer;
begin
  if p_entity not in ('patients', 'services', 'memberships') then raise exception 'unsupported import entity'; end if;
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'invalid idempotency key'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'import rows must contain 1 to 500 items';
  end if;
  if not exists (
    select 1 from public.clinic_members member
    where member.clinic_id = p_clinic_id
      and member.user_id = p_actor_user_id
      and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  ) then raise exception 'brand management permission required'; end if;

  insert into public.data_import_jobs (clinic_id, entity, idempotency_key, total_rows, created_by)
  values (p_clinic_id, p_entity, p_idempotency_key, jsonb_array_length(p_rows), p_actor_user_id)
  on conflict (clinic_id, idempotency_key) do nothing
  returning id into v_job_id;
  if v_job_id is null then
    select id into v_job_id from public.data_import_jobs
    where clinic_id = p_clinic_id and idempotency_key = p_idempotency_key;
    return v_job_id;
  end if;

  select allow_multi_patient_per_phone, max_patients_per_phone
  into v_allowed, v_max
  from public.clinic_settings where clinic_id = p_clinic_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    begin
      if jsonb_typeof(v_row) <> 'object' then raise exception 'row must be an object'; end if;
      if p_entity = 'patients' then
        v_name := btrim(coalesce(v_row->>'name', ''));
        v_phone := regexp_replace(coalesce(v_row->>'phone', ''), '[^0-9+]', '', 'g');
        if v_name = '' or length(v_name) > 120 then raise exception 'invalid name'; end if;
        if length(v_phone) < 8 or length(v_phone) > 20 then raise exception 'invalid phone'; end if;
        select id into v_patient_id from public.patients
        where clinic_id = p_clinic_id and phone = v_phone and lower(name) = lower(v_name) and active
        order by created_at limit 1;
        if v_patient_id is null then
          select count(*) into v_existing from public.patients where clinic_id = p_clinic_id and phone = v_phone and active;
          if (not coalesce(v_allowed, false) and v_existing > 0) or (coalesce(v_allowed, false) and v_existing >= greatest(1, coalesce(v_max, 1))) then
            raise exception 'phone patient limit reached';
          end if;
          insert into public.patients (clinic_id, name, phone, birthday, email, marketing_opt_in)
          values (
            p_clinic_id, v_name, v_phone,
            case when coalesce(v_row->>'birthday', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row->>'birthday')::date else null end,
            nullif(btrim(v_row->>'email'), ''), coalesce((v_row->>'marketing_opt_in')::boolean, false)
          ) returning id into v_patient_id;
        end if;
      elsif p_entity = 'services' then
        v_name := btrim(coalesce(v_row->>'name', ''));
        if v_name = '' or length(v_name) > 120 then raise exception 'invalid service name'; end if;
        if exists (select 1 from public.services where clinic_id = p_clinic_id and lower(name) = lower(v_name) and active) then
          raise exception 'service already exists';
        end if;
        insert into public.services (clinic_id, name, category, description, duration_minutes, buffer_minutes, booking_target, active)
        values (
          p_clinic_id, v_name, nullif(btrim(v_row->>'category'), ''), nullif(btrim(v_row->>'description'), ''),
          case when coalesce(v_row->>'duration_minutes', '') ~ '^\d+$' then greatest(1, (v_row->>'duration_minutes')::integer) else null end,
          case when coalesce(v_row->>'buffer_minutes', '') ~ '^\d+$' then greatest(0, (v_row->>'buffer_minutes')::integer) else 0 end,
          case when v_row->>'booking_target' in ('provider_required', 'provider_optional', 'resource_only') then v_row->>'booking_target' else 'provider_required' end,
          true
        );
      else
        v_name := btrim(coalesce(v_row->>'patient_name', ''));
        v_phone := regexp_replace(coalesce(v_row->>'patient_phone', ''), '[^0-9+]', '', 'g');
        select id into v_patient_id from public.patients
        where clinic_id = p_clinic_id and phone = v_phone and lower(name) = lower(v_name) and active
        order by created_at limit 1;
        if v_patient_id is null then raise exception 'patient not found'; end if;
        select id into v_plan_id from public.membership_plans
        where clinic_id = p_clinic_id and lower(name) = lower(btrim(coalesce(v_row->>'plan_name', ''))) and active
        order by created_at limit 1;
        if v_plan_id is null then raise exception 'membership plan not found'; end if;
        v_credits := case when coalesce(v_row->>'credits_remaining', '') ~ '^\d+$' then (v_row->>'credits_remaining')::integer else 0 end;
        if v_credits <= 0 then raise exception 'credits must be positive'; end if;
        v_code := 'MIG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
        insert into public.patient_memberships (
          clinic_id, patient_id, plan_id, membership_code, credits_total, credits_remaining,
          expires_at, source, note
        ) values (
          p_clinic_id, v_patient_id, v_plan_id, v_code, v_credits, v_credits,
          case when coalesce(v_row->>'expires_at', '') ~ '^\d{4}-\d{2}-\d{2}$' then ((v_row->>'expires_at') || 'T23:59:59+08:00')::timestamptz else null end,
          'migration', 'CSV 匯入'
        ) returning id into v_membership_id;
        insert into public.membership_ledger (
          clinic_id, membership_id, patient_id, kind, credits_delta, reference_type,
          idempotency_key, actor_id, note
        ) values (
          p_clinic_id, v_membership_id, v_patient_id, 'grant', v_credits, 'migration',
          p_idempotency_key || ':' || v_index::text, p_actor_user_id, 'CSV 匯入初始堂數'
        );
      end if;
      v_imported := v_imported + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'reason', left(sqlerrm, 240)));
    end;
  end loop;

  update public.data_import_jobs
     set status = 'completed', imported_rows = v_imported, failed_rows = v_failed,
         error_summary = v_errors, completed_at = now()
   where id = v_job_id;
  return v_job_id;
exception when others then
  if v_job_id is not null then
    update public.data_import_jobs
       set status = 'failed', failed_rows = greatest(1, failed_rows),
           error_summary = jsonb_build_array(jsonb_build_object('row', 0, 'reason', left(sqlerrm, 240))),
           completed_at = now()
     where id = v_job_id;
  end if;
  raise;
end;
$$;

revoke all on function public.refresh_clinic_activation_metric(uuid) from public, anon, authenticated;
revoke all on function public.refresh_clinic_activation_from_row() from public, anon, authenticated;
revoke all on function public.seed_clinic_activation_metric() from public, anon, authenticated;
revoke all on function public.record_first_clinic_booking() from public, anon, authenticated;
revoke all on function public.execute_data_import(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_clinic_activation_metric(uuid) to service_role;
grant execute on function public.refresh_clinic_activation_from_row() to service_role;
grant execute on function public.seed_clinic_activation_metric() to service_role;
grant execute on function public.record_first_clinic_booking() to service_role;
grant execute on function public.execute_data_import(uuid, uuid, text, text, jsonb) to service_role;

commit;
