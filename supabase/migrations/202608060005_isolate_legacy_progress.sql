-- Keep the legacy queue/progress surface available only when a brand explicitly opts in.
begin;

alter table public.clinic_settings
  add column if not exists legacy_progress_enabled boolean not null default false;

commit;
