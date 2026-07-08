-- ============================================================================
-- 病患軟刪除:有約診紀錄的病患從後台列表移除時,改標記 active=false 保留歷史。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

alter table patients add column if not exists active boolean not null default true;

select 'patients.active ready' as status;
