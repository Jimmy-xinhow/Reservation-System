-- ============================================================================
-- 通用品牌示範資料（時間制）。此檔僅供開發測試，不會替任何品牌預設資料。
-- 使用前請先在同一個 SQL session 設定目標品牌：
-- select set_config('app.seed_clinic_id', '<品牌 UUID>', false);
-- ============================================================================

do $$
declare
  v_clinic_id uuid := nullif(current_setting('app.seed_clinic_id', true), '')::uuid;
begin
  if v_clinic_id is null then
    raise exception '請先設定 app.seed_clinic_id，再執行示範資料腳本';
  end if;

  if not exists (select 1 from clinics where id = v_clinic_id and active) then
    raise exception '找不到啟用中的目標品牌：%', v_clinic_id;
  end if;

  -- 1) 兩位示範服務提供者（若此品牌已有服務提供者則略過）
  insert into doctors (clinic_id, name, specialty)
  select v_clinic_id, v.name, v.specialty
  from (values
    ('服務提供者 A', '一般服務'),
    ('服務提供者 B', '專業服務')
  ) as v(name, specialty)
  where not exists (
    select 1 from doctors where clinic_id = v_clinic_id
  );

  -- 2) 為每位服務提供者建立週一至週五時段。
  --    slot_minutes=15、capacity=1（時間制每 15 分鐘一格，每格 1 人）
  insert into schedule_templates (clinic_id, doctor_id, weekday, start_time, end_time, slot_minutes, capacity)
  select d.clinic_id, d.id, s.weekday, s.start_time::time, s.end_time::time, 15, 1
  from doctors d
  cross join (values
    (1, '09:00', '12:00'), (2, '09:00', '12:00'), (3, '09:00', '12:00'),
    (4, '09:00', '12:00'), (5, '09:00', '12:00'),
    (1, '14:00', '17:00'), (3, '14:00', '17:00'), (5, '14:00', '17:00')
  ) as s(weekday, start_time, end_time)
  where d.clinic_id = v_clinic_id
    and not exists (
      select 1 from schedule_templates t
      where t.clinic_id = v_clinic_id
    );
end $$;

-- 3) 確認結果
select '服務提供者' as kind, count(*) as n
from doctors
where clinic_id = nullif(current_setting('app.seed_clinic_id', true), '')::uuid
union all
select '可預約時段模板', count(*)
from schedule_templates
where clinic_id = nullif(current_setting('app.seed_clinic_id', true), '')::uuid;
