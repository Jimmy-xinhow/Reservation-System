-- ============================================================================
-- 為 clinics 加上「公開診所資訊」欄位,並帶入你的 LINE 基本 ID。
-- 在 Supabase → SQL Editor 跑一次即可。之後這些都能在後台「診所設定」修改。
-- ============================================================================

alter table clinics add column if not exists line_basic_id text;
alter table clinics add column if not exists phone text;
alter table clinics add column if not exists address text;
alter table clinics add column if not exists intro text;

-- 帶入目前的 LINE 官方帳號基本 ID(之後可在後台改)
update clinics
set line_basic_id = '@738xusfj'
where id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
  and (line_basic_id is null or line_basic_id = '');

select id, name, line_basic_id, phone, address from clinics
where id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733';
