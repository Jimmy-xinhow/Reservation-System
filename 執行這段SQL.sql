-- ============================================================================
-- 新增「看診服務」資料表 + 約診的 service_id 欄位 + RLS。
-- 在 Supabase → SQL Editor 跑一次即可。之後在後台「看診服務」管理項目。
-- ============================================================================

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  description text,
  active boolean default true,
  created_at timestamptz default now()
);

alter table appointments add column if not exists service_id uuid references services(id);

alter table services enable row level security;
drop policy if exists services_member on services;
create policy services_member on services for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

-- (選用)先帶幾個常見服務,之後可在後台改/停用
insert into services (clinic_id, name)
select '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'::uuid, v.name
from (values ('一般看診'), ('針灸'), ('推拿'), ('把脈調理')) as v(name)
where not exists (
  select 1 from services where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733'
);

select id, name, active from services
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733';
