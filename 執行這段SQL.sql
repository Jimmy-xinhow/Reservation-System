-- ============================================================================
-- 叫號功能:每個門診段目前看診到第幾號。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

create table if not exists serving_numbers (
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  date date not null,
  session_key text not null,
  current_number int not null default 0,
  updated_at timestamptz default now(),
  primary key (clinic_id, doctor_id, date, session_key)
);

alter table serving_numbers enable row level security;
drop policy if exists serving_member on serving_numbers;
create policy serving_member on serving_numbers for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

select 'serving_numbers ready' as status;
