begin;

-- Health alerts are platform operations records. No browser role may read them.
create table if not exists public.cron_alert_states (
  mode text not null check (mode in ('global', 'scoped')),
  job text not null check (job in (
    'reminders', 'marketing', 'membership', 'followups', 'registration',
    'richmenu', 'subscription-freezes'
  )),
  state text not null check (state in ('healthy', 'failed', 'stale', 'missing', 'invalid_time')),
  incident_id uuid,
  observed_at timestamptz not null default now(),
  primary key (mode, job),
  check ((state = 'healthy') = (incident_id is null))
);

create table if not exists public.cron_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null,
  mode text not null check (mode in ('global', 'scoped')),
  job text not null check (job in (
    'reminders', 'marketing', 'membership', 'followups', 'registration',
    'richmenu', 'subscription-freezes'
  )),
  transition text not null check (transition in ('incident', 'recovery')),
  observed_state text not null check (observed_state in ('healthy', 'failed', 'stale', 'missing', 'invalid_time')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain')),
  attempts integer not null default 0 check (attempts >= 0),
  first_claimed_at timestamptz,
  claimed_at timestamptz,
  lease_until timestamptz,
  sent_at timestamptz,
  last_error_code text check (last_error_code in ('provider_rejected', 'network_uncertain')),
  created_at timestamptz not null default now(),
  unique (incident_id, transition),
  check ((transition = 'recovery') = (observed_state = 'healthy'))
);

create index if not exists cron_alert_deliveries_queue_idx
  on public.cron_alert_deliveries (created_at)
  where status in ('pending', 'sending');

alter table public.cron_alert_states enable row level security;
alter table public.cron_alert_deliveries enable row level security;
revoke all on table public.cron_alert_states, public.cron_alert_deliveries
  from public, anon, authenticated, service_role;
grant select on table public.cron_alert_states, public.cron_alert_deliveries to service_role;

create or replace function public.record_cron_alert_observation(
  p_mode text, p_job text, p_state text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.cron_alert_states%rowtype;
  v_inserted integer;
  v_incident_id uuid;
begin
  if p_mode not in ('global', 'scoped') or p_job not in (
    'reminders', 'marketing', 'membership', 'followups', 'registration',
    'richmenu', 'subscription-freezes'
  ) or p_state not in ('healthy', 'failed', 'stale', 'missing', 'invalid_time') then
    raise exception 'invalid cron alert observation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_mode || ':' || p_job, 0));
  v_incident_id := case when p_state = 'healthy' then null else gen_random_uuid() end;
  insert into public.cron_alert_states (mode, job, state, incident_id)
  values (p_mode, p_job, p_state, v_incident_id)
  on conflict (mode, job) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    if p_state <> 'healthy' then
      insert into public.cron_alert_deliveries (incident_id, mode, job, transition, observed_state)
      values (v_incident_id, p_mode, p_job, 'incident', p_state);
    end if;
    return;
  end if;

  select * into strict v_old from public.cron_alert_states
    where mode = p_mode and job = p_job for update;
  if v_old.state = 'healthy' and p_state <> 'healthy' then
    v_incident_id := gen_random_uuid();
    insert into public.cron_alert_deliveries (incident_id, mode, job, transition, observed_state)
    values (v_incident_id, p_mode, p_job, 'incident', p_state);
  elsif v_old.state <> 'healthy' and p_state = 'healthy' then
    v_incident_id := null;
    insert into public.cron_alert_deliveries (incident_id, mode, job, transition, observed_state)
    values (v_old.incident_id, p_mode, p_job, 'recovery', 'healthy');
  else
    v_incident_id := v_old.incident_id;
  end if;
  update public.cron_alert_states set state = p_state,
    incident_id = v_incident_id, observed_at = now()
    where mode = p_mode and job = p_job;
end;
$$;

create or replace function public.claim_cron_alert_delivery()
returns table (
  id uuid, incident_id uuid, mode text, job text, transition text,
  observed_state text, attempts integer
) language plpgsql security definer set search_path = '' as $$
begin
  -- An unknown result must not be resent after Resend's 24-hour idempotency window.
  update public.cron_alert_deliveries d set status = 'uncertain', lease_until = null,
    last_error_code = 'network_uncertain'
  where d.status = 'sending' and d.lease_until < now()
    and d.first_claimed_at < now() - interval '24 hours';

  return query
  with next_delivery as (
    select d.id from public.cron_alert_deliveries d
    where d.status = 'pending' or (
      d.status = 'sending' and d.lease_until < now()
      and d.first_claimed_at >= now() - interval '24 hours'
    )
    order by d.created_at, d.id
    for update skip locked limit 1
  )
  update public.cron_alert_deliveries d
    set status = 'sending', attempts = d.attempts + 1,
      first_claimed_at = coalesce(d.first_claimed_at, now()),
      claimed_at = now(), lease_until = now() + interval '2 minutes'
    from next_delivery n where d.id = n.id
    returning d.id, d.incident_id, d.mode, d.job, d.transition,
      d.observed_state, d.attempts;
end;
$$;

create or replace function public.finish_cron_alert_delivery(
  p_id uuid, p_attempts integer, p_sent boolean, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if (p_sent and p_error_code is not null) or
     (not p_sent and p_error_code is distinct from 'provider_rejected') then
    raise exception 'invalid cron alert delivery result' using errcode = '22023';
  end if;
  update public.cron_alert_deliveries
    set status = case when p_sent then 'sent' else 'failed' end,
      sent_at = case when p_sent then now() else null end,
      lease_until = null,
      last_error_code = p_error_code
    where id = p_id and attempts = p_attempts and status = 'sending';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.record_cron_alert_observation(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_cron_alert_delivery() from public, anon, authenticated;
revoke all on function public.finish_cron_alert_delivery(uuid, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.record_cron_alert_observation(text, text, text) to service_role;
grant execute on function public.claim_cron_alert_delivery() to service_role;
grant execute on function public.finish_cron_alert_delivery(uuid, integer, boolean, text) to service_role;

notify pgrst, 'reload schema';
commit;
