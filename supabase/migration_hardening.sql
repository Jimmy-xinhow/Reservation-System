-- 既有環境的 P0/P2 hardening migration。
-- 新環境請直接執行 schema.sql；既有環境請先執行本檔，再重新執行 schema.sql 中的 booking RPC 定義。

alter table patients add column if not exists birthday_mmdd char(4);
update patients
set birthday_mmdd = to_char(birthday, 'MMDD')
where birthday is not null and birthday_mmdd is distinct from to_char(birthday, 'MMDD');

create or replace function sync_patient_birthday_mmdd()
returns trigger
language plpgsql as $$
begin
  new.birthday_mmdd := case when new.birthday is null then null else to_char(new.birthday, 'MMDD') end;
  return new;
end; $$;

drop trigger if exists trg_patient_birthday_mmdd on patients;
create trigger trg_patient_birthday_mmdd before insert or update of birthday on patients
  for each row execute function sync_patient_birthday_mmdd();

create index if not exists patients_clinic_birthday_mmdd_idx
  on patients (clinic_id, birthday_mmdd)
  where active = true;

insert into clinic_settings (clinic_id)
select id from clinics
on conflict (clinic_id) do nothing;

create or replace function seed_clinic_settings()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.clinic_settings (clinic_id) values (new.id)
  on conflict (clinic_id) do nothing;
  return new;
end; $$;

drop trigger if exists trg_clinic_seed_settings on clinics;
create trigger trg_clinic_seed_settings after insert on clinics
  for each row execute function seed_clinic_settings();

create or replace function claim_reminder(
  p_appointment_id uuid, p_channel text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing public.reminder_logs;
  claimed_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('reminder:' || p_appointment_id::text || ':' || p_channel));
  select * into existing from public.reminder_logs
   where appointment_id=p_appointment_id and channel=p_channel;
  if found then
    if existing.result = 'sent' then return null; end if;
    if existing.result = 'sending' and existing.sent_at > now() - interval '15 minutes' then return null; end if;
    update public.reminder_logs set result='sending', sent_at=now() where id=existing.id returning id into claimed_id;
    return claimed_id;
  end if;
  insert into public.reminder_logs(appointment_id, channel, result, sent_at)
    values (p_appointment_id, p_channel, 'sending', now())
    returning id into claimed_id;
  return claimed_id;
end; $$;

revoke all on function claim_reminder(uuid, text) from public, anon, authenticated;
grant execute on function claim_reminder(uuid, text) to service_role;

-- 預約 RPC 的完整定義與權限請以 schema.sql 同步部署，避免既有環境遺漏原子鎖修復。
