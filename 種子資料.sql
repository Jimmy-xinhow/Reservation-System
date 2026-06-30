-- ============================================================================
-- 慈愛中醫診所 示範資料(時間制)。在 Supabase → SQL Editor 跑「一次」即可。
-- 已有醫師/門診段時不會重複插入(防誤跑)。跑完後台「今日約診/門診表」就有資料,
-- 病患端 /book 也會有可選醫師與時段。
-- ============================================================================

-- 1) 兩位示範醫師(若此診所已有醫師則略過)
insert into doctors (clinic_id, name, specialty)
select v.clinic_id, v.name, v.specialty
from (values
  ('087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'::uuid, '王志明', '中醫內科'),
  ('087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'::uuid, '林淑芬', '針灸科')
) as v(clinic_id, name, specialty)
where not exists (
  select 1 from doctors where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
);

-- 2) 為每位醫師建立週一~週五門診(上午 09–12,週一三五加下午 14–17)
--    slot_minutes=15、capacity=1(時間制:每 15 分鐘一格、每格 1 人)
insert into schedule_templates (clinic_id, doctor_id, weekday, start_time, end_time, slot_minutes, capacity)
select d.clinic_id, d.id, s.weekday, s.start_time::time, s.end_time::time, 15, 1
from doctors d
cross join (values
  (1, '09:00', '12:00'), (2, '09:00', '12:00'), (3, '09:00', '12:00'),
  (4, '09:00', '12:00'), (5, '09:00', '12:00'),
  (1, '14:00', '17:00'), (3, '14:00', '17:00'), (5, '14:00', '17:00')
) as s(weekday, start_time, end_time)
where d.clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
  and not exists (
    select 1 from schedule_templates t
    where t.clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
  );

-- 3) 確認結果
select '醫師' as kind, count(*) as n from doctors
  where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
union all
select '門診段', count(*) from schedule_templates
  where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733';
