-- Privacy-safe marketing funnel events. No customer PII is stored.
begin;

create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  event_name text not null check (event_name in (
    'portal_view', 'booking_view', 'booking_start', 'booking_success',
    'registration_view', 'registration_start', 'registration_success',
    'membership_view', 'membership_lookup', 'membership_purchase_start'
  )),
  anonymous_id text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists funnel_events_clinic_time_idx on public.funnel_events (clinic_id, created_at desc);
create index if not exists funnel_events_clinic_name_idx on public.funnel_events (clinic_id, event_name, created_at desc);
alter table public.funnel_events enable row level security;
revoke all on table public.funnel_events from public, anon, authenticated;

commit;
