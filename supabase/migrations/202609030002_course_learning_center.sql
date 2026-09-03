-- Online-course learning center: admin-managed units and per-registration progress.
-- Customer access remains server-only through the signed browser token API.

create table if not exists public.course_units (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  title text not null,
  summary text,
  unit_type text not null default 'link' check (unit_type in ('video','link','download','text')),
  content_url text,
  body text,
  access_rule text not null default 'registered' check (access_rule in ('registered','paid','attended')),
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content_url is not null or body is not null)
);
create index if not exists course_units_event_idx on public.course_units (clinic_id, event_id, active, sort_order);

create table if not exists public.course_unit_progress (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  unit_id uuid not null references public.course_units(id) on delete restrict,
  registration_id uuid not null references public.registrations(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, unit_id)
);
create index if not exists course_unit_progress_patient_idx on public.course_unit_progress (clinic_id, patient_id, event_id);

drop trigger if exists trg_course_units_touch on public.course_units;
create trigger trg_course_units_touch before update on public.course_units for each row execute function public.touch_updated_at();
drop trigger if exists trg_course_unit_progress_touch on public.course_unit_progress;
create trigger trg_course_unit_progress_touch before update on public.course_unit_progress for each row execute function public.touch_updated_at();

alter table public.course_units enable row level security;
alter table public.course_unit_progress enable row level security;
revoke all on table public.course_units from public, anon;
revoke all on table public.course_unit_progress from public, anon;

drop policy if exists course_units_member on public.course_units;
create policy course_units_member on public.course_units for all to authenticated
  using (
    clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid())
    and exists (select 1 from public.clinic_members cm where cm.clinic_id = course_units.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
  )
  with check (
    clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid())
    and exists (select 1 from public.clinic_members cm where cm.clinic_id = course_units.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
    and exists (select 1 from public.events e where e.id = course_units.event_id and e.clinic_id = course_units.clinic_id)
  );

drop policy if exists course_unit_progress_member on public.course_unit_progress;
create policy course_unit_progress_member on public.course_unit_progress for all to authenticated
  using (
    clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid())
    and exists (select 1 from public.clinic_members cm where cm.clinic_id = course_unit_progress.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
  )
  with check (
    clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid())
    and exists (select 1 from public.clinic_members cm where cm.clinic_id = course_unit_progress.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
  );
