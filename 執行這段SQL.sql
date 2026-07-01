-- ============================================================================
-- 病況紀錄(逐筆)。在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

create table if not exists patient_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists patient_records_patient_idx on patient_records (patient_id, created_at desc);

alter table patient_records enable row level security;
drop policy if exists patient_records_member on patient_records;
create policy patient_records_member on patient_records for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

select 'patient_records ready' as status;
