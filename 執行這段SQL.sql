-- ============================================================================
-- LINE 主選單卡片自訂 + 圖文選單(Rich Menu)設定。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

-- 主選單卡片自訂欄位
alter table clinic_settings add column if not exists line_menu_title text;
alter table clinic_settings add column if not exists line_menu_btn_booking boolean not null default true;
alter table clinic_settings add column if not exists line_menu_btn_query boolean not null default true;
alter table clinic_settings add column if not exists line_menu_btn_progress boolean not null default true;
alter table clinic_settings add column if not exists line_menu_btn_info boolean not null default true;
alter table clinic_settings add column if not exists line_menu_link_label text;
alter table clinic_settings add column if not exists line_menu_link_url text;

-- 圖文選單設定
create table if not exists line_richmenu (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  layout text not null default 'full-3',
  chat_bar_text text not null default '選單',
  slots jsonb not null default '[]',
  published_id text,
  updated_at timestamptz default now()
);

alter table line_richmenu enable row level security;
drop policy if exists line_richmenu_member on line_richmenu;
create policy line_richmenu_member on line_richmenu for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

select 'line menu + richmenu ready' as status;
