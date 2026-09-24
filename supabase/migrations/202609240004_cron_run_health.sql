-- Count-free, identity-free worker heartbeat. Only the server may insert/read it.
create table if not exists public.cron_job_runs (
  run_id uuid not null,
  job text not null check (job in (
    'reminders', 'marketing', 'membership', 'followups', 'registration',
    'richmenu', 'subscription-freezes'
  )),
  mode text not null check (mode in ('global', 'scoped')),
  status text not null check (status in ('success', 'failed')),
  result_code text not null check (result_code in (
    'success', 'http_failed', 'invalid_or_failed_result', 'partial_failure',
    'timeout', 'request_failed'
  )),
  http_status integer check (http_status between 100 and 599),
  completed_at timestamptz not null default now(),
  primary key (run_id, job),
  check ((status = 'success') = (result_code = 'success')),
  check (status <> 'success' or http_status = 200)
);

create index if not exists cron_job_runs_latest_idx
  on public.cron_job_runs (mode, job, completed_at desc);

alter table public.cron_job_runs enable row level security;
revoke all on table public.cron_job_runs from public, anon, authenticated, service_role;
grant select, insert on table public.cron_job_runs to service_role;
