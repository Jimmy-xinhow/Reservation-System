-- ============================================================================
-- 病患建檔/行銷欄位:讓櫃檯能在「病患查詢」記錄資訊。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

alter table patients add column if not exists note text;             -- 備註 / 病況記錄
alter table patients add column if not exists tags text;             -- 標籤(逗號分隔)
alter table patients add column if not exists birthday date;
alter table patients add column if not exists gender text;
alter table patients add column if not exists email text;
alter table patients add column if not exists marketing_opt_in boolean not null default false;

select id, name, phone, note, tags, birthday, gender, email, marketing_opt_in
from patients
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
limit 5;
