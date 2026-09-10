alter table public.clinic_settings
  add column if not exists line_flex_designs jsonb not null default '{}'::jsonb;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_line_flex_designs_object_check;

alter table public.clinic_settings
  add constraint clinic_settings_line_flex_designs_object_check
  check (jsonb_typeof(line_flex_designs) = 'object');

comment on column public.clinic_settings.line_flex_designs is
  'Per-brand LINE Flex draft and published designs, keyed by supported customer-journey template.';
