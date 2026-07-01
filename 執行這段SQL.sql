-- ============================================================================
-- 叫號分「線上」與「現場(線下)」兩條序列。在 Supabase → SQL Editor 跑一次。
-- ============================================================================

-- 約診標記來源:線上預約 online / 現場(後台建立)offline
alter table appointments add column if not exists source text not null default 'online';

-- 叫號狀態:兩條序列 + 自動穿插設定
alter table serving_numbers add column if not exists online_current int not null default 0;
alter table serving_numbers add column if not exists offline_current int not null default 0;
alter table serving_numbers add column if not exists auto_every int not null default 0;
alter table serving_numbers add column if not exists online_run int not null default 0;
alter table serving_numbers add column if not exists last_kind text;

select 'queue split ready' as status;
