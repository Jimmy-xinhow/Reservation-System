-- Brand owners may ask the platform to configure their store without changing live settings.
-- Requests are accessed only through permission-checked server actions.
begin;

create table if not exists public.brand_setup_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references public.clinics(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 8192),
  status text not null default 'submitted'
    check (status in ('submitted', 'in_progress', 'ready_for_review', 'completed')),
  handled_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  handled_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists brand_setup_requests_status_idx
  on public.brand_setup_requests (status, updated_at desc);
drop trigger if exists trg_brand_setup_requests_touch on public.brand_setup_requests;
create trigger trg_brand_setup_requests_touch before update on public.brand_setup_requests
  for each row execute function public.touch_updated_at();
alter table public.brand_setup_requests enable row level security;
revoke all on public.brand_setup_requests from public, anon, authenticated;
grant select, insert, update on public.brand_setup_requests to service_role;

notify pgrst, 'reload schema';
commit;
