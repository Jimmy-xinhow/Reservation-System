-- ============================================================================
-- 設為單一醫師「張勝雄院長」。在 Supabase → SQL Editor 跑一次即可。
-- 規則:保留最早建立的一位醫師改名為張勝雄院長並啟用,其餘停用(不硬刪,保留約診)。
--      若完全沒有醫師則新增一位。
-- ============================================================================

-- 1) 已有醫師:最早一位改名並啟用
with keep as (
  select id from doctors
  where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
  order by created_at
  limit 1
)
update doctors
set name = '張勝雄院長', specialty = null, active = true
where id in (select id from keep);

-- 2) 其餘醫師停用(soft-delete,保留其歷史約診)
update doctors
set active = false
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
  and id not in (
    select id from doctors
    where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
    order by created_at
    limit 1
  );

-- 3) 完全沒有醫師才新增
insert into doctors (clinic_id, name)
select '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733', '張勝雄院長'
where not exists (
  select 1 from doctors where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
);

select id, name, active from doctors
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
order by created_at;
