-- ============================================================================
-- LINE 自動回覆規則(後台可編輯)+ 歡迎詞/預設回覆。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

create table if not exists line_auto_replies (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  keywords text not null,
  action text not null default 'text' check (action in ('text','booking','query','progress')),
  reply_text text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);

alter table clinic_settings add column if not exists line_welcome_text text;
alter table clinic_settings add column if not exists line_fallback_text text;

alter table line_auto_replies enable row level security;
drop policy if exists line_replies_member on line_auto_replies;
create policy line_replies_member on line_auto_replies for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

-- 預設幾條常用規則(已有規則則略過)
insert into line_auto_replies (clinic_id, keywords, action, sort)
select '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733', v.k, v.a, v.s
from (values
  ('進度,叫號,看診號', 'progress', 1),
  ('查詢,查預約,我的預約,取消', 'query', 2),
  ('預約,掛號', 'booking', 3)
) as v(k, a, s)
where not exists (
  select 1 from line_auto_replies where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
);

select id, keywords, action, active from line_auto_replies
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733' order by sort;
