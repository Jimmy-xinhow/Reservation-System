-- ============================================================================
-- 黑名單欄位:停權至某時間(三次未到自動停權一個月,或櫃檯手動設定)。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

alter table patients add column if not exists blocked_until timestamptz;

select id, name, phone, blocked_until
from patients
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
limit 5;
