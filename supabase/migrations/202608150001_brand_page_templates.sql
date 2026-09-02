-- 設定驅動的公開品牌形象頁。既有品牌預設關閉，避免未確認就改變公開入口。

alter table public.clinic_settings
  add column if not exists brand_page_enabled boolean not null default false;

alter table public.clinic_settings
  add column if not exists brand_page_template text not null default 'beauty';

alter table public.clinic_settings
  add column if not exists brand_page_content jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clinic_settings_brand_page_template_check'
  ) then
    alter table public.clinic_settings
      add constraint clinic_settings_brand_page_template_check
      check (brand_page_template in ('beauty', 'wellness', 'fitness', 'education', 'consulting', 'pet-care', 'venue', 'event'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clinic_settings_brand_page_content_check'
  ) then
    alter table public.clinic_settings
      add constraint clinic_settings_brand_page_content_check
      check (jsonb_typeof(brand_page_content) = 'object');
  end if;
end $$;
