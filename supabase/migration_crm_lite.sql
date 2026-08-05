-- CRM Lite：顧客分眾、互動時間軸與規則式行銷自動化。
-- 所有資料以 clinic_id 隔離；病患端不直接讀取這些表。

create table if not exists crm_segments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  description text,
  rule_type text not null check (rule_type in (
    'tag_contains', 'no_booking_days', 'completed_visits_gte', 'no_show_gte', 'birthday_month'
  )),
  rule_value text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_segments_clinic_idx on crm_segments (clinic_id, active, created_at desc);

create table if not exists crm_segment_members (
  segment_id uuid not null references crm_segments(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  matched_at timestamptz not null default now(),
  primary key (segment_id, patient_id)
);
create index if not exists crm_segment_members_clinic_idx on crm_segment_members (clinic_id, segment_id);
create index if not exists crm_segment_members_patient_idx on crm_segment_members (clinic_id, patient_id);

create table if not exists crm_interactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('note', 'booking', 'message', 'campaign')),
  channel text check (channel in ('line', 'email', 'staff', 'system')),
  title text,
  body text not null,
  appointment_id uuid references appointments(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crm_interactions_patient_idx on crm_interactions (clinic_id, patient_id, created_at desc);

create table if not exists crm_automations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('appointment_done', 'birthday', 'inactive')),
  segment_id uuid references crm_segments(id) on delete set null,
  channel text not null check (channel in ('line', 'email')),
  delay_minutes integer not null default 0 check (delay_minutes >= 0),
  trigger_days integer not null default 30 check (trigger_days >= 1),
  cooldown_days integer not null default 30 check (cooldown_days >= 1),
  subject text,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_automations_clinic_idx on crm_automations (clinic_id, active, created_at desc);

create table if not exists crm_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  automation_id uuid not null references crm_automations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  trigger_key text not null,
  channel text not null check (channel in ('line', 'email')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error text,
  attempt_count integer not null default 1,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (automation_id, patient_id, trigger_key, channel)
);
create index if not exists crm_delivery_logs_lookup_idx
  on crm_delivery_logs (clinic_id, automation_id, patient_id, attempted_at desc);

drop trigger if exists trg_crm_segments_touch on crm_segments;
create trigger trg_crm_segments_touch before update on crm_segments
  for each row execute function touch_updated_at();
drop trigger if exists trg_crm_automations_touch on crm_automations;
create trigger trg_crm_automations_touch before update on crm_automations
  for each row execute function touch_updated_at();

create or replace function refresh_crm_segment(p_clinic_id uuid, p_segment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  inserted_count integer := 0;
begin
  select * into s from crm_segments where id = p_segment_id and clinic_id = p_clinic_id and active;
  if not found then raise exception '找不到有效的 CRM 分眾'; end if;

  delete from crm_segment_members where clinic_id = p_clinic_id and segment_id = p_segment_id;

  if s.rule_type = 'tag_contains' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id
      from patients p
     where p.clinic_id = s.clinic_id and p.active
       and position(lower(s.rule_value) in lower(coalesce(p.tags, ''))) > 0;
  elsif s.rule_type = 'no_booking_days' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id
      from patients p
     where p.clinic_id = s.clinic_id and p.active
       and not exists (
         select 1 from appointments a
          where a.clinic_id = s.clinic_id and a.patient_id = p.id
            and a.status in ('booked', 'confirmed') and a.start_at >= now()
       )
       and not exists (
         select 1 from appointments a
          where a.clinic_id = s.clinic_id and a.patient_id = p.id
            and a.status = 'done'
            and a.start_at >= now() - (s.rule_value::int || ' days')::interval
       );
  elsif s.rule_type = 'completed_visits_gte' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id
      from patients p
     where p.clinic_id = s.clinic_id and p.active
       and (select count(*) from appointments a
             where a.clinic_id = s.clinic_id and a.patient_id = p.id and a.status = 'done') >= s.rule_value::int;
  elsif s.rule_type = 'no_show_gte' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id
      from patients p
     where p.clinic_id = s.clinic_id and p.active
       and (select count(*) from appointments a
             where a.clinic_id = s.clinic_id and a.patient_id = p.id and a.status = 'no_show') >= s.rule_value::int;
  elsif s.rule_type = 'birthday_month' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id
      from patients p
     where p.clinic_id = s.clinic_id and p.active
       and extract(month from p.birthday)::int = s.rule_value::int;
  else
    raise exception '不支援的 CRM 分眾規則';
  end if;

  get diagnostics inserted_count = row_count;
  update crm_segments set updated_at = now() where id = p_segment_id and clinic_id = p_clinic_id;
  return inserted_count;
end; $$;

create or replace function claim_crm_delivery(
  p_clinic_id uuid,
  p_automation_id uuid,
  p_patient_id uuid,
  p_trigger_key text,
  p_channel text,
  p_appointment_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from crm_automations where id = p_automation_id and clinic_id = p_clinic_id
  ) or not exists (
    select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'CRM 資料不屬於指定租戶';
  end if;
  insert into crm_delivery_logs(
    clinic_id, automation_id, patient_id, appointment_id, trigger_key, channel
  ) values (
    p_clinic_id, p_automation_id, p_patient_id, p_appointment_id, p_trigger_key, p_channel
  )
  on conflict (automation_id, patient_id, trigger_key, channel) do update
    set status = 'pending', error = null, attempt_count = crm_delivery_logs.attempt_count + 1,
        attempted_at = now()
    where crm_delivery_logs.status = 'failed'
      and crm_delivery_logs.attempted_at < now() - interval '10 minutes'
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function refresh_crm_segment(uuid, uuid) from public, anon, authenticated;
grant execute on function refresh_crm_segment(uuid, uuid) to service_role;
revoke all on function claim_crm_delivery(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function claim_crm_delivery(uuid, uuid, uuid, text, text, uuid) to service_role;

alter table crm_segments enable row level security;
alter table crm_segment_members enable row level security;
alter table crm_interactions enable row level security;
alter table crm_automations enable row level security;
alter table crm_delivery_logs enable row level security;

drop policy if exists crm_segments_member on crm_segments;
create policy crm_segments_member on crm_segments for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
drop policy if exists crm_segment_members_member on crm_segment_members;
create policy crm_segment_members_member on crm_segment_members for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
drop policy if exists crm_interactions_member on crm_interactions;
create policy crm_interactions_member on crm_interactions for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
drop policy if exists crm_automations_member on crm_automations;
create policy crm_automations_member on crm_automations for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
drop policy if exists crm_delivery_logs_member on crm_delivery_logs;
create policy crm_delivery_logs_member on crm_delivery_logs for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
