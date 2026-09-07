-- Multi-tenant staff attendance for click, rotating QR and verified LINE keywords.
begin;

create table if not exists public.attendance_settings (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  click_enabled boolean not null default true,
  qr_enabled boolean not null default false,
  line_enabled boolean not null default false,
  qr_refresh_seconds integer not null default 60 check (qr_refresh_seconds in (30, 60, 300, 600, 1800)),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_staff (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  display_name text,
  line_user_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, user_id),
  check (display_name is null or length(btrim(display_name)) between 1 and 80),
  check (line_user_id is null or length(btrim(line_user_id)) between 10 and 80)
);
create unique index if not exists attendance_staff_line_unique_idx on public.attendance_staff (clinic_id, line_user_id) where line_user_id is not null;

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  method text not null check (method in ('button', 'qr', 'line')),
  occurred_at timestamptz not null default now(),
  line_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_events_clinic_time_idx on public.attendance_events (clinic_id, occurred_at desc);
create index if not exists attendance_events_user_time_idx on public.attendance_events (clinic_id, user_id, occurred_at);
create unique index if not exists attendance_events_line_event_unique_idx on public.attendance_events (clinic_id, line_event_id) where line_event_id is not null;

create table if not exists public.attendance_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  token_hash text not null,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, token_hash)
);
create index if not exists attendance_qr_tokens_expiry_idx on public.attendance_qr_tokens (clinic_id, expires_at desc);

create or replace function public.seed_attendance_settings_for_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.attendance_settings (clinic_id) values (new.id) on conflict (clinic_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_clinics_seed_attendance_settings on public.clinics;
create trigger trg_clinics_seed_attendance_settings after insert on public.clinics for each row execute function public.seed_attendance_settings_for_clinic();

drop trigger if exists trg_attendance_settings_touch on public.attendance_settings;
create trigger trg_attendance_settings_touch before update on public.attendance_settings for each row execute function public.touch_updated_at();
drop trigger if exists trg_attendance_staff_touch on public.attendance_staff;
create trigger trg_attendance_staff_touch before update on public.attendance_staff for each row execute function public.touch_updated_at();

alter table public.attendance_settings enable row level security;
alter table public.attendance_staff enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_qr_tokens enable row level security;
revoke all on table public.attendance_settings, public.attendance_staff, public.attendance_events, public.attendance_qr_tokens from public, anon, authenticated;
grant select on table public.attendance_settings to authenticated;
grant select on table public.attendance_events to authenticated;
grant all on table public.attendance_settings, public.attendance_staff, public.attendance_events, public.attendance_qr_tokens to service_role;
revoke all on function public.seed_attendance_settings_for_clinic() from public, anon, authenticated;

drop policy if exists attendance_settings_member_read on public.attendance_settings;
create policy attendance_settings_member_read on public.attendance_settings for select to authenticated using (
  exists (select 1 from public.clinic_members member where member.clinic_id = attendance_settings.clinic_id and member.user_id = auth.uid())
);
drop policy if exists attendance_events_member_read on public.attendance_events;
create policy attendance_events_member_read on public.attendance_events for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.clinic_members member where member.clinic_id = attendance_events.clinic_id and member.user_id = auth.uid()
      and (member.access_type = 'brand_admin' or (member.access_type is null and member.role in ('owner', 'admin')))
  )
);

insert into public.attendance_settings (clinic_id)
select id from public.clinics
on conflict (clinic_id) do nothing;

commit;
