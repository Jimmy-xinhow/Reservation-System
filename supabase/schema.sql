-- ============================================================================
-- 診所預約系統 schema  (spec v2 §2/§3/§4/§6)
-- 在 Supabase SQL Editor 整份貼上執行。
-- 時區基準一律 Asia/Taipei;時間欄位全 timestamptz。
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- §2 資料表
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean default true,
  -- 公開診所資訊(顯示於公開資訊頁;非機密)
  line_basic_id text,   -- LINE 官方帳號基本 ID,例 @738xusfj
  phone text,
  address text,
  intro text,
  created_at timestamptz default now(),
  updated_at timestamptz not null default now()
);
-- 既有資料庫補欄位(idempotent)
alter table clinics add column if not exists line_basic_id text;
alter table clinics add column if not exists phone text;
alter table clinics add column if not exists address text;
alter table clinics add column if not exists intro text;
alter table clinics add column if not exists updated_at timestamptz not null default now();

create table if not exists clinic_settings (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  booking_mode text not null default 'time' check (booking_mode in ('time','number')),
  first_visit_extends boolean not null default false,
  first_visit_minutes smallint,                       -- null 沿用模板 slot_minutes
  allow_multi_patient_per_phone boolean not null default false,
  max_patients_per_phone smallint not null default 1, -- >=1
  deposit_enabled boolean not null default false,
  deposit_amount integer not null default 0,          -- TWD
  deposit_scope text not null default 'self_pay' check (deposit_scope in ('all','self_pay','none')),
  min_lead_minutes smallint not null default 30,
  max_advance_days smallint not null default 30,
  -- Email 提醒(寄件人與 provider 僅由 server environment 管理)
  email_enabled boolean not null default false,
  updated_at timestamptz default now()
);
alter table clinic_settings add column if not exists email_enabled boolean not null default false;
alter table clinic_settings add column if not exists beauty_operations_enabled boolean not null default false;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_settings' and column_name = 'resend_api_key') then
    execute 'update public.clinic_settings set resend_api_key = null where resend_api_key is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_settings' and column_name = 'email_from') then
    execute 'update public.clinic_settings set email_from = null where email_from is not null';
  end if;
end $$;

alter table clinic_settings drop column if exists resend_api_key;
alter table clinic_settings drop column if exists email_from;

-- 新建診所時自動建立可用的預設設定
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

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  specialty text,
  active boolean default true,                         -- soft-delete,不硬刪
  created_at timestamptz default now()
);

-- 門診段。同 (doctor_id, weekday) 可多筆 = 一天多診(上午/下午/晚診)
-- Provider assignments keep staff access limited to explicitly assigned doctors.
create table if not exists doctor_assignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, doctor_id, user_id)
);
create index if not exists doctor_assignments_user_idx
  on doctor_assignments (clinic_id, user_id, active);
create index if not exists doctor_assignments_doctor_idx
  on doctor_assignments (clinic_id, doctor_id, active);

create table if not exists schedule_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  weekday smallint not null,                           -- 0=日..6=六 (Postgres dow)
  start_time time not null,
  end_time time not null,
  slot_minutes smallint not null default 15,           -- 時間制每格時長
  capacity smallint not null default 1,                -- 時間制=每格人數 / 號次制=整診總號數
  active boolean default true
);

-- 休診(整天)或加診(臨時門診段)
create table if not exists schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  date date not null,
  is_closed boolean default true,                      -- true=當天整天休診
  start_time time, end_time time,
  slot_minutes smallint, capacity smallint             -- is_closed=false(加診)時使用
);
-- 表層級 unique 不可用 coalesce 運算式,改用 unique index:
-- 同診所同醫師同一天同一開始時間只能一筆;start_time 為 null(整天休診)視為同一筆。
create unique index if not exists uniq_sched_exc
  on schedule_exceptions (clinic_id, doctor_id, date, coalesce(start_time, '00:00'::time));

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  phone text not null,                                 -- 不設 unique;多病患共用電話由設定控管
  line_user_id text,
  -- 櫃檯記錄 / 建檔 / 行銷用(非病患自填)
  note text,                                           -- 備註 / 病況記錄
  tags text,                                           -- 標籤(逗號分隔,如 VIP、慢性)
  birthday date,
  gender text,
  email text,
  marketing_opt_in boolean not null default false,     -- 同意行銷
  blocked_until timestamptz,                            -- 黑名單:停權至此時間(null=正常)
  active boolean not null default true,                 -- 軟刪除:false=已從後台列表移除(保留歷史)
  created_at timestamptz default now()
);
create index if not exists patients_clinic_phone_idx on patients (clinic_id, phone);
-- 既有資料庫補欄位(idempotent)
alter table patients add column if not exists note text;
alter table patients add column if not exists tags text;
alter table patients add column if not exists birthday date;
alter table patients add column if not exists gender text;
alter table patients add column if not exists email text;
alter table patients add column if not exists marketing_opt_in boolean not null default false;
alter table patients add column if not exists blocked_until timestamptz;
alter table patients add column if not exists active boolean not null default true;
alter table patients add column if not exists birthday_mmdd char(4);
update patients
set birthday_mmdd = to_char(birthday, 'MMDD')
where birthday is not null and birthday_mmdd is distinct from to_char(birthday, 'MMDD');

create or replace function sync_patient_birthday_mmdd()
returns trigger
language plpgsql set search_path = '' as $$
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

-- 公開預約／瀏覽器備援共用的顧客建立流程：以品牌＋電話序列化，避免同電話上限被併發請求突破。
create or replace function create_or_get_public_patient(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_birthday date default null,
  p_line_user_id text default null
) returns table (patient_id uuid, reused boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings_row record;
  matched record;
  v_patient_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_line_user_id text := nullif(btrim(coalesce(p_line_user_id, '')), '');
  active_count integer;
begin
  if v_name = '' or v_phone = '' then raise exception 'name and phone are required'; end if;
  if length(v_name) > 100 or length(v_phone) > 40 or length(coalesce(v_line_user_id, '')) > 128 then
    raise exception 'patient identity is too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('public-patient:' || p_clinic_id::text || ':' || v_phone));
  select * into settings_row from clinic_settings where clinic_id = p_clinic_id;
  if not found then raise exception 'clinic settings not found'; end if;

  -- LINE 流程只能沿用同 LINE 或尚未綁定的資料；瀏覽器流程不會取得已綁定其他 LINE 的顧客。
  select * into matched
    from patients
   where clinic_id = p_clinic_id
     and phone = v_phone
     and name = v_name
     and (p_birthday is null or birthday is not distinct from p_birthday)
     and (
       (v_line_user_id is not null and (line_user_id is null or line_user_id = v_line_user_id))
       or (v_line_user_id is null and line_user_id is null)
     )
   order by active desc, created_at
   limit 1
   for update;

  if found then
    update patients
       set active = true,
           line_user_id = coalesce(v_line_user_id, line_user_id)
     where id = matched.id;
    return query select matched.id, true;
    return;
  end if;

  if v_line_user_id is not null and exists (
    select 1 from patients
     where clinic_id = p_clinic_id and phone = v_phone and name = v_name
       and (p_birthday is null or birthday is not distinct from p_birthday)
       and active and line_user_id is not null and line_user_id <> v_line_user_id
  ) then
    raise exception 'patient is bound to another LINE account';
  end if;

  select count(*)::integer into active_count
    from patients
   where clinic_id = p_clinic_id and phone = v_phone and active;
  if not settings_row.allow_multi_patient_per_phone and active_count >= 1 then
    raise exception 'phone already has a patient';
  end if;
  if settings_row.allow_multi_patient_per_phone and active_count >= greatest(1, settings_row.max_patients_per_phone) then
    raise exception 'phone patient limit reached';
  end if;

  insert into patients (clinic_id, name, phone, birthday, line_user_id, active)
  values (p_clinic_id, v_name, v_phone, p_birthday, v_line_user_id, true)
  returning id into v_patient_id;
  return query select v_patient_id, false;
end;
$$;

revoke all on function create_or_get_public_patient(uuid, text, text, date, text) from public, anon, authenticated;
grant execute on function create_or_get_public_patient(uuid, text, text, date, text) to service_role;

-- 報名同意行銷時，在同一 transaction 內同步 CRM 顧客的 opt-in。
-- false 不會覆蓋顧客既有同意，避免無勾選的後續流程意外退訂。
create or replace function create_or_get_public_patient_with_marketing_opt_in(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_birthday date default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false
) returns table (patient_id uuid, reused boolean)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  matched record;
begin
  select * into matched
    from public.create_or_get_public_patient(p_clinic_id, p_name, p_phone, p_birthday, p_line_user_id);
  if coalesce(p_marketing_opt_in, false) and matched.patient_id is not null then
    update public.patients
       set marketing_opt_in = true
     where id = matched.patient_id
       and clinic_id = p_clinic_id;
  end if;
  return query select matched.patient_id, matched.reused;
end;
$$;

revoke all on function create_or_get_public_patient_with_marketing_opt_in(uuid, text, text, date, text, boolean) from public, anon, authenticated;
grant execute on function create_or_get_public_patient_with_marketing_opt_in(uuid, text, text, date, text, boolean) to service_role;

-- 病況紀錄(逐筆,櫃檯/醫師記錄)
create table if not exists patient_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists patient_records_patient_idx on patient_records (patient_id, created_at desc);

-- 看診服務項目(例:針灸、推拿、把脈調理)。病患預約時可選,記錄於約診。
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  description text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists service_resources (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  name text not null,
  kind text not null default 'room' check (kind in ('room', 'equipment', 'staff', 'other')),
  capacity integer not null default 1 check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists service_resource_assignments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  service_id uuid not null references services(id) on delete restrict,
  resource_id uuid not null references service_resources(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (service_id, resource_id)
);
create index if not exists service_resources_clinic_idx on service_resources (clinic_id, active, name);
create index if not exists service_resource_assignments_service_idx on service_resource_assignments (clinic_id, service_id);

-- updated_at 自動更新；必須先於任何引用它的 trigger 建立。
create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_clinics_touch on public.clinics;
create trigger trg_clinics_touch before update on public.clinics
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_service_resources_touch on service_resources;
create trigger trg_service_resources_touch before update on service_resources for each row execute function touch_updated_at();
alter table service_resources enable row level security;
alter table service_resource_assignments enable row level security;
revoke all on table service_resources from public, anon;
revoke all on table service_resource_assignments from public, anon;

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id),
  patient_id uuid not null references patients(id),
  template_id uuid references schedule_templates(id), -- 所屬門診段(號次制必填)
  service_id uuid references services(id),            -- 看診服務(選填)
  start_at timestamptz not null,
  end_at timestamptz not null,
  visit_type text not null default 'return' check (visit_type in ('first','return')),
  source text not null default 'online' check (source in ('online','offline')), -- 線上預約 / 現場(後台建立)
  queue_number int,                                    -- 號次制專用
  status text not null default 'booked'
    check (status in ('booked','confirmed','cancelled','done','no_show')),
  is_self_pay boolean not null default false,
  deposit_status text not null default 'none'
    check (deposit_status in ('none','pending','paid','failed','waived','refunded')),
  deposit_amount integer not null default 0,
  deposit_expires_at timestamptz,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists appt_clinic_doctor_start_idx on appointments (clinic_id, doctor_id, start_at);
create index if not exists appt_start_idx on appointments (start_at);
create index if not exists appt_template_start_idx on appointments (template_id, start_at);
-- 既有資料庫補欄位(idempotent)
alter table appointments add column if not exists service_id uuid references services(id);
alter table appointments add column if not exists source text not null default 'online';
alter table appointments add column if not exists deposit_expires_at timestamptz;
create index if not exists appointments_deposit_expiry_idx
  on appointments (clinic_id, deposit_status, deposit_expires_at)
  where deposit_status = 'pending';
-- 號次制的例外診次也使用 template_id 作為 session key；來源由 booking RPC 嚴格驗證。
alter table appointments drop constraint if exists appointments_template_id_fkey;

-- LINE 自動回覆規則(後台可編輯)。keywords 命中(包含)→ 依 action 回覆。
-- action:text=自訂文字 / booking=開啟預約 / query=查詢預約 / progress=看診進度
-- line_messages must exist before line_auto_replies because message_id references it
create table if not exists line_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  kind text not null default 'text' check (kind in ('text','card','carousel')),
  data jsonb not null default '{}',
  created_at timestamptz default now()
);

create table if not exists line_auto_replies (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  keywords text not null,              -- 以逗號分隔,任一命中即觸發
  action text not null default 'text' check (action in ('text','booking','query','progress','message')),
  reply_text text,                     -- action=text 時回覆的內容
  message_id uuid references line_messages(id) on delete set null, -- action=message 時對應的訊息素材
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table line_auto_replies add column if not exists message_id uuid references line_messages(id) on delete set null;

-- 歡迎詞與找不到指令時的預設回覆(存 clinic_settings)
alter table clinic_settings add column if not exists line_welcome_text text;
alter table clinic_settings add column if not exists line_fallback_text text;
-- 主選單卡片自訂
alter table clinic_settings add column if not exists line_menu_title text;
alter table clinic_settings add column if not exists line_menu_btn_booking boolean not null default true;
alter table clinic_settings add column if not exists line_menu_btn_query boolean not null default true;
alter table clinic_settings add column if not exists line_menu_btn_progress boolean not null default true;
alter table clinic_settings add column if not exists line_menu_btn_info boolean not null default true;
alter table clinic_settings add column if not exists line_menu_link_label text;
alter table clinic_settings add column if not exists line_menu_link_url text;

-- LINE 訊息素材(可綁關鍵字回覆):文字 / 圖文卡 / 多頁(carousel)
create table if not exists line_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  kind text not null default 'text' check (kind in ('text','card','carousel')),
  data jsonb not null default '{}',      -- 內容(文字/圖片URL/標題/內文/按鈕)
  created_at timestamptz default now()
);

-- LINE 圖文選單(Rich Menu)設定(每診所一筆)
create table if not exists line_richmenu (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  layout text not null default 'full-3',      -- full-3 / full-6 / compact-2 / compact-3
  chat_bar_text text not null default '選單',
  slots jsonb not null default '[]',           -- [{label, action, value}]
  published_id text,                           -- 已發布的 LINE richMenuId
  updated_at timestamptz default now()
);

-- 叫號:每個門診段(doctor+date+session_key)目前看診到第幾號
-- session_key:號次制=template_id;時間制=該約診所屬門診段的 template/exception id
create table if not exists serving_numbers (
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  date date not null,
  session_key text not null,
  current_number int not null default 0,          -- 保留(舊)
  online_current int not null default 0,          -- 線上目前叫到第幾號
  offline_current int not null default 0,         -- 現場目前叫到第幾號
  auto_every int not null default 0,              -- 自動穿插:每 N 個線上插 1 個現場(0=手動)
  online_run int not null default 0,              -- 自動模式:距上次插現場已叫幾個線上
  last_kind text,                                 -- 最後叫的是 online / offline
  updated_at timestamptz default now(),
  primary key (clinic_id, doctor_id, date, session_key)
);
alter table serving_numbers add column if not exists online_current int not null default 0;
alter table serving_numbers add column if not exists offline_current int not null default 0;
alter table serving_numbers add column if not exists auto_every int not null default 0;
alter table serving_numbers add column if not exists online_run int not null default 0;
alter table serving_numbers add column if not exists last_kind text;

create table if not exists reminder_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  channel text not null default 'line',
  sent_at timestamptz default now(),
  result text,
  error text,
  unique (appointment_id, channel)
);

create or replace function claim_reminder(
  p_appointment_id uuid, p_channel text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing public.reminder_logs;
  claimed_id uuid;
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.appointments where id = p_appointment_id;
  if not found then raise exception '找不到預約'; end if;
  perform pg_advisory_xact_lock(hashtext('reminder:' || p_appointment_id::text || ':' || p_channel));
  select * into existing from public.reminder_logs
   where appointment_id=p_appointment_id and channel=p_channel;
  if found then
    if existing.result = 'sent' then return null; end if;
    if existing.result = 'sending' and existing.sent_at > now() - interval '15 minutes' then return null; end if;
    update public.reminder_logs set result='sending', error=null, sent_at=now() where id=existing.id returning id into claimed_id;
    return claimed_id;
  end if;
  insert into public.reminder_logs(clinic_id, appointment_id, channel, result, sent_at)
    values (v_clinic_id, p_appointment_id, p_channel, 'sending', now())
    returning id into claimed_id;
  return claimed_id;
end; $$;

revoke all on function claim_reminder(uuid, text) from public, anon, authenticated;
grant execute on function claim_reminder(uuid, text) to service_role;

drop trigger if exists trg_appt_touch on appointments;
create trigger trg_appt_touch before update on appointments
  for each row execute function touch_updated_at();

drop trigger if exists trg_settings_touch on clinic_settings;
create trigger trg_settings_touch before update on clinic_settings
  for each row execute function touch_updated_at();

drop trigger if exists trg_doctor_assignments_touch on doctor_assignments;
create trigger trg_doctor_assignments_touch before update on doctor_assignments
  for each row execute function touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- §3 時間制 (booking_mode='time')
-- ──────────────────────────────────────────────────────────────────────────

drop function if exists get_available_slots(uuid, uuid, date);
drop function if exists book_time_slot(uuid, uuid, uuid, timestamptz, text, boolean);
drop function if exists book_number(uuid, uuid, uuid, uuid, date, text, boolean);
create or replace function get_available_slots(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_visit_type text default 'return'
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql security definer set search_path = '' as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead int := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id=p_clinic_id),30);
  v_first_visit_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id=p_clinic_id), false);
  v_first_visit_minutes int := (select first_visit_minutes from public.clinic_settings where clinic_id=p_clinic_id);
  v_slot_length int;
  rec record;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  for rec in
    select t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id=p_clinic_id and t.doctor_id=p_doctor_id
       and t.weekday=v_weekday and t.active
       and not exists (select 1 from public.schedule_exceptions e
              where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id
                and e.date=p_date and e.is_closed and e.start_time is null)  -- 整天休診
    union all
    select e.start_time, e.end_time, coalesce(e.slot_minutes,15), coalesce(e.capacity,1)
      from public.schedule_exceptions e
     where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id
       and e.date=p_date and not e.is_closed                                  -- 加診
   loop
     v_slot_length := case when p_visit_type='first' and v_first_visit_extends
       then coalesce(v_first_visit_minutes, rec.slot_minutes) else rec.slot_minutes end;
     return query
    with candidate as (
      select ((p_date + rec.start_time + (n||' minutes')::interval) at time zone 'Asia/Taipei') as s,
              ((p_date + rec.start_time + ((n+v_slot_length)||' minutes')::interval) at time zone 'Asia/Taipei') as e
      from generate_series(0,
         (extract(epoch from (rec.end_time-rec.start_time))/60)::int - v_slot_length,
        rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::int
    from candidate c
    left join public.appointments a
      on a.clinic_id=p_clinic_id and a.doctor_id=p_doctor_id
     and a.status in ('booked','confirmed','done')
     and a.start_at < c.e and a.end_at > c.s              -- 區間重疊
    where c.s > now() + (v_lead||' minutes')::interval
      and not exists (                                    -- 排除「只休某診」的時段
        select 1 from public.schedule_exceptions ec
        where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=p_date
          and ec.is_closed and ec.start_time is not null
           and (c.s at time zone 'Asia/Taipei')::time < ec.end_time
           and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
      )
    group by c.s, c.e, rec.capacity
    having rec.capacity - count(a.id) > 0
    order by c.s;
  end loop;
end; $$;

create or replace function book_time_slot(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_service_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (p_start_at at time zone 'Asia/Taipei')::date;
  v_tod time := (p_start_at at time zone 'Asia/Taipei')::time;
  v_weekday smallint := extract(dow from v_date);
  st record; s record; v_len int; v_end timestamptz; v_used int; v_id uuid;
  v_dep boolean; v_match_count int;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id=p_clinic_id;
  if not exists (select 1 from public.doctors where id=p_doctor_id and clinic_id=p_clinic_id and active)
    then raise exception '醫師不存在或已停用'; end if;
  if not exists (select 1 from public.patients where id=p_patient_id and clinic_id=p_clinic_id and active)
    then raise exception '病患不存在或已停用'; end if;
  if p_service_id is not null and not exists (select 1 from public.services where id=p_service_id and clinic_id=p_clinic_id and active)
    then raise exception '服務不存在或已停用'; end if;

  select count(*) into v_match_count from (
    select start_time,end_time,slot_minutes,capacity from public.schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and weekday=v_weekday and active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=v_date and e.is_closed and e.start_time is null)
    union all
    select start_time,end_time,coalesce(slot_minutes,15),coalesce(capacity,1)
      from public.schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=v_date and not is_closed
  ) q where v_tod >= start_time and v_tod < end_time;
  if v_match_count = 0 then raise exception '未找到可用門診時段'; end if;
  if v_match_count > 1 then raise exception '門診時段設定重疊,請先調整門診設定'; end if;

  select start_time,end_time,slot_minutes,capacity into s from (
    select start_time,end_time,slot_minutes,capacity from public.schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and weekday=v_weekday and active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=v_date and e.is_closed and e.start_time is null)
    union all
    select start_time,end_time,coalesce(slot_minutes,15),coalesce(capacity,1)
      from public.schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=v_date and not is_closed
  ) q where v_tod >= start_time and v_tod < end_time;
  if not found then raise exception '此時段非門診時間'; end if;

  if p_visit_type='first' and coalesce(st.first_visit_extends,false)
     then v_len := coalesce(st.first_visit_minutes, s.slot_minutes);
     else v_len := s.slot_minutes; end if;
  v_end := p_start_at + (v_len||' minutes')::interval;
  if v_end > ((v_date + s.end_time) at time zone 'Asia/Taipei')
    then raise exception '初診時長超出門診時段'; end if;

  if exists (select 1 from public.schedule_exceptions ec
             where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=v_date
               and ec.is_closed and ec.start_time is not null
               and (p_start_at at time zone 'Asia/Taipei')::time < coalesce(ec.end_time, '23:59:59.999999'::time)
               and (v_end at time zone 'Asia/Taipei')::time > ec.start_time)
    then raise exception '此時段已休診'; end if;

  if p_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '已超過可預約時間'; end if;

  if v_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days,30))
    then raise exception '超過最長可預約區間'; end if;

  perform pg_advisory_xact_lock(hashtext('time:' || p_clinic_id::text || p_doctor_id::text || v_date::text));
  perform pg_advisory_xact_lock(hashtext('patient:' || p_clinic_id::text || p_patient_id::text || v_date::text));
  if exists (
    select 1 from public.appointments
    where clinic_id=p_clinic_id and patient_id=p_patient_id
      and status in ('booked','confirmed','done')
      and (start_at at time zone 'Asia/Taipei')::date = v_date
  ) then raise exception '同一病患當日已有預約'; end if;
  select count(*) into v_used from public.appointments
   where clinic_id=p_clinic_id and doctor_id=p_doctor_id
     and status in ('booked','confirmed','done')
     and start_at < v_end and end_at > p_start_at;
  if v_used >= s.capacity then raise exception '時段已額滿'; end if;

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into public.appointments(clinic_id,doctor_id,patient_id,start_at,end_at,visit_type,is_self_pay,service_id,
                           deposit_status,deposit_amount,deposit_expires_at)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_start_at,v_end,p_visit_type,p_is_self_pay,p_service_id,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end,
          case when v_dep then now() + interval '15 minutes' else null end)
  returning id into v_id;
  return v_id;
end; $$;

-- ──────────────────────────────────────────────────────────────────────────
-- §4 號次制 (booking_mode='number')
-- ──────────────────────────────────────────────────────────────────────────

create or replace function get_available_sessions(
  p_clinic_id uuid, p_doctor_id uuid, p_date date
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz,
               total int, taken int, remaining int)
language plpgsql security definer set search_path = '' as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead int := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id=p_clinic_id),30);
begin
  return query
  with sess as (
    select t.id, t.start_time, t.end_time, t.capacity from public.schedule_templates t
      where t.clinic_id=p_clinic_id and t.doctor_id=p_doctor_id and t.weekday=v_weekday and t.active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=p_date and e.is_closed
              and (e.start_time is null or (
                e.start_time < t.end_time
                and coalesce(e.end_time, '23:59:59.999999'::time) > t.start_time
              )))  -- 整天休診或與此診次有重疊
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity,40) from public.schedule_exceptions e
      where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id and e.date=p_date and not e.is_closed
        and not exists (
          select 1 from public.schedule_exceptions closed
           where closed.clinic_id=p_clinic_id and closed.doctor_id=p_doctor_id
             and closed.date=p_date and closed.is_closed
             and (closed.start_time is null or (
               e.start_time < coalesce(closed.end_time, '23:59:59.999999'::time)
               and coalesce(e.end_time, '23:59:59.999999'::time) > closed.start_time
             ))
        )
  )
  select x.id,
         ((p_date + x.start_time) at time zone 'Asia/Taipei'),
         ((p_date + x.end_time) at time zone 'Asia/Taipei'),
         x.capacity, count(a.id)::int, greatest(0, x.capacity - count(a.id))::int
  from sess x
  left join public.appointments a
    on a.template_id=x.id
   and a.start_at = ((p_date + x.start_time) at time zone 'Asia/Taipei')
   and a.status in ('booked','confirmed','done')
  -- 只顯示尚未結束且仍有名額的診次
  where ((p_date + x.start_time) at time zone 'Asia/Taipei') > now() + (v_lead||' minutes')::interval
  group by x.id, x.start_time, x.end_time, x.capacity
  having count(a.id) < x.capacity;
end; $$;

create or replace function book_number(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_template_id uuid, p_date date, p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_service_id uuid default null
) returns table (appointment_id uuid, queue_number int)
language plpgsql security definer set search_path = '' as $$
declare
  st record; v_cap int; v_start time; v_end time;
  v_start_at timestamptz; v_end_at timestamptz; v_used int; v_no int; v_id uuid; v_dep boolean;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id=p_clinic_id;
  if not exists (select 1 from public.doctors where id=p_doctor_id and clinic_id=p_clinic_id and active)
    then raise exception '醫師不存在或已停用'; end if;
  if not exists (select 1 from public.patients where id=p_patient_id and clinic_id=p_clinic_id and active)
    then raise exception '病患不存在或已停用'; end if;
  if p_service_id is not null and not exists (select 1 from public.services where id=p_service_id and clinic_id=p_clinic_id and active)
    then raise exception '服務不存在或已停用'; end if;
  if not exists (
    select 1 from public.schedule_templates
    where id=p_template_id and clinic_id=p_clinic_id and doctor_id=p_doctor_id
      and active and weekday=extract(dow from p_date)
  ) and not exists (
    select 1 from public.schedule_exceptions
    where id=p_template_id and clinic_id=p_clinic_id and doctor_id=p_doctor_id
      and date=p_date and not is_closed
  ) then raise exception '門診段與日期不相符'; end if;

  select capacity,start_time,end_time into v_cap,v_start,v_end from (
    select id,capacity,start_time,end_time from public.schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and active
    union all
    select id,coalesce(capacity,40),start_time,end_time from public.schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=p_date and not is_closed
  ) q where id=p_template_id;
  if not found then raise exception '查無此門診段'; end if;

  v_start_at := (p_date + v_start) at time zone 'Asia/Taipei';
  v_end_at   := (p_date + v_end) at time zone 'Asia/Taipei';
  if v_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '尚未到可預約時間'; end if;
  if p_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days,30))
    then raise exception '超過最長可預約區間'; end if;
  -- 號次制:診次開始前須符合最短前置時間，額滿或已結束則擋下
  if v_end_at <= now() then raise exception '本診已結束'; end if;

  -- 整天休診或只休此診則擋下
  if exists (select 1 from public.schedule_exceptions ec
             where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=p_date
               and ec.is_closed and (ec.start_time is null or (
                 ec.start_time < v_end
                 and coalesce(ec.end_time, '23:59:59.999999'::time) > v_start
               )))
    then raise exception '本診已休診'; end if;

  perform pg_advisory_xact_lock(hashtext('number:' || p_clinic_id::text || p_template_id::text || p_date::text));
  perform pg_advisory_xact_lock(hashtext('patient:' || p_clinic_id::text || p_patient_id::text || p_date::text));
  if exists (
    select 1 from public.appointments
    where clinic_id=p_clinic_id and patient_id=p_patient_id
      and status in ('booked','confirmed','done')
      and (start_at at time zone 'Asia/Taipei')::date = p_date
  ) then raise exception '同一病患當日已有預約'; end if;
  select count(*) filter (where a.status in ('booked','confirmed','done')),
         coalesce(max(a.queue_number),0)
    into v_used, v_no
  from public.appointments a
   where a.clinic_id=p_clinic_id and a.doctor_id=p_doctor_id
     and a.template_id=p_template_id and a.start_at=v_start_at;
  if v_used >= v_cap then raise exception '本診已額滿'; end if;
  v_no := v_no + 1;   -- 接續最大號,取消的號不回收

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into public.appointments(clinic_id,doctor_id,patient_id,template_id,start_at,end_at,service_id,
                           visit_type,queue_number,is_self_pay,deposit_status,deposit_amount,deposit_expires_at)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_template_id,v_start_at,v_end_at,p_service_id,
          p_visit_type,v_no,p_is_self_pay,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end,
          case when v_dep then now() + interval '15 minutes' else null end)
  returning id into v_id;
  return query select v_id, v_no;
end; $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 後台帳號 ↔ 診所對應 (spec 未定義;為實作 §6 後台 clinic 範圍 RLS 所需的最小新增)
-- 一筆 = 某 auth 使用者可存取某診所。
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists clinic_members (
  clinic_id uuid not null references clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','frontdesk','provider','staff')),
  created_at timestamptz default now(),
  primary key (clinic_id, user_id)
);
-- 既有 DB 補欄位(create table if not exists 不會補新欄位)。
-- 上線遷移時把既有成員設為 admin,避免所有人被降級鎖在門外(見 supabase/migration_roles.sql)。
alter table clinic_members add column if not exists role text not null default 'staff';
do $$ begin
  alter table clinic_members drop constraint if exists clinic_members_role_check;
  alter table clinic_members add constraint clinic_members_role_check check (role in ('owner','admin','frontdesk','provider','staff'));
exception when duplicate_object then null; end $$;
-- 以 user_id 起頭的索引:policy 子查詢以 user_id 查 clinic_members 用(PK 為 (clinic_id,user_id))
create index if not exists clinic_members_user_clinic_idx on clinic_members (user_id, clinic_id);

-- 注意:不要用 security definer 的 helper 函式(例如 auth_clinic_ids())包住 auth.uid() 再給 policy 呼叫。
-- 實測該函式單獨當 RPC 會回正確值,但放進 RLS policy 的子查詢內,其中的 auth.uid() 取不到值 → policy 永遠比對不到 → 0 rows。
-- 因此 policy 一律直接內聯 auth.uid() 子查詢(下方)。
-- 舊 helper auth_clinic_ids() 於「所有 policy 重建之後」才 drop(見 §6 結尾),
-- 否則既有 DB 的舊 policy 仍依賴它會導致 drop 失敗。

-- ──────────────────────────────────────────────────────────────────────────
-- §6 RLS 與權限
-- 不給 anon 任何 policy;病患端一律經 Next.js API route 用 service_role(繞過 RLS)。
-- 後台 authenticated 只能存取自己診所。
-- ──────────────────────────────────────────────────────────────────────────

-- 預約寫入只能由本專案 service-role API 呼叫，避免 anon 直接執行 RPC
revoke all on function book_time_slot(uuid, uuid, uuid, timestamptz, text, boolean, uuid) from public, anon, authenticated;
grant execute on function book_time_slot(uuid, uuid, uuid, timestamptz, text, boolean, uuid) to service_role;
revoke all on function book_number(uuid, uuid, uuid, uuid, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function book_number(uuid, uuid, uuid, uuid, date, text, boolean, uuid) to service_role;
revoke all on function claim_reminder(uuid, text) from public, anon, authenticated;
grant execute on function claim_reminder(uuid, text) to service_role;

alter table clinics enable row level security;
alter table clinic_settings enable row level security;
alter table doctors enable row level security;
alter table doctor_assignments enable row level security;
alter table schedule_templates enable row level security;
alter table schedule_exceptions enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table reminder_logs enable row level security;
alter table clinic_members enable row level security;
alter table services enable row level security;
alter table serving_numbers enable row level security;
alter table patient_records enable row level security;
alter table line_auto_replies enable row level security;
alter table line_messages enable row level security;
alter table line_richmenu enable row level security;

-- authenticated:只能讀寫自己所屬診所的資料。
-- 一律內聯 auth.uid() 子查詢比對 clinic_members(不要包成 security definer 函式,理由見上方)。
-- 此子查詢讀 clinic_members 受其自身 policy(user_id = auth.uid())允許,且不會遞迴。
drop policy if exists clinics_member on clinics;
create policy clinics_member on clinics for all to authenticated
  using (id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists clinic_settings_member on clinic_settings;
create policy clinic_settings_member on clinic_settings for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists doctors_member on doctors;
create policy doctors_member on doctors for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists doctor_assignments_self on doctor_assignments;
create policy doctor_assignments_self on doctor_assignments for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from clinic_members cm
       where cm.clinic_id = doctor_assignments.clinic_id
         and cm.user_id = auth.uid()
         and cm.role in ('owner', 'admin')
    )
  );
drop policy if exists doctor_assignments_admin on doctor_assignments;
create policy doctor_assignments_admin on doctor_assignments for all to authenticated
  using (exists (
    select 1 from clinic_members cm
     where cm.clinic_id = doctor_assignments.clinic_id
       and cm.user_id = auth.uid()
       and cm.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from clinic_members cm
     where cm.clinic_id = doctor_assignments.clinic_id
       and cm.user_id = auth.uid()
       and cm.role in ('owner', 'admin')
  ) and exists (
    select 1 from doctors d
     where d.id = doctor_assignments.doctor_id
       and d.clinic_id = doctor_assignments.clinic_id
       and d.active
  ) and exists (
    select 1 from clinic_members target
     where target.clinic_id = doctor_assignments.clinic_id
       and target.user_id = doctor_assignments.user_id
       and target.role = 'provider'
  ));

drop policy if exists schedule_templates_member on schedule_templates;
create policy schedule_templates_member on schedule_templates for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (
    clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and exists (select 1 from doctors d where d.id = schedule_templates.doctor_id and d.clinic_id = schedule_templates.clinic_id and d.active)
  );

drop policy if exists schedule_exceptions_member on schedule_exceptions;
create policy schedule_exceptions_member on schedule_exceptions for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (
    clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and exists (select 1 from doctors d where d.id = schedule_exceptions.doctor_id and d.clinic_id = schedule_exceptions.clinic_id and d.active)
  );

drop policy if exists patients_member on patients;
create policy patients_member on patients for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists appointments_member on appointments;
create policy appointments_member on appointments for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists services_member on services;
create policy services_member on services for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists serving_member on serving_numbers;
create policy serving_member on serving_numbers for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists patient_records_member on patient_records;
create policy patient_records_member on patient_records for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists line_replies_member on line_auto_replies;
create policy line_replies_member on line_auto_replies for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists line_messages_member on line_messages;
create policy line_messages_member on line_messages for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists line_richmenu_member on line_richmenu;
create policy line_richmenu_member on line_richmenu for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists reminder_logs_member on reminder_logs;
create policy reminder_logs_member on reminder_logs for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists clinic_members_self on clinic_members;
create policy clinic_members_self on clinic_members for select to authenticated
  using (user_id = auth.uid());

-- 舊版 helper 一律清掉(此時所有 policy 已改為內聯 auth.uid(),不再依賴這些函式)。
drop function if exists is_clinic_member(uuid);
drop function if exists auth_clinic_ids();

-- RPC:全 security definer。撤掉 anon/authenticated,只給 service_role(病患端走 service_role)。
revoke all on function get_available_slots(uuid,uuid,date,text) from public, anon, authenticated;
revoke all on function get_available_sessions(uuid,uuid,date) from public, anon, authenticated;
revoke all on function book_time_slot(uuid,uuid,uuid,timestamptz,text,boolean,uuid) from public, anon, authenticated;
revoke all on function book_number(uuid,uuid,uuid,uuid,date,text,boolean,uuid) from public, anon, authenticated;

grant execute on function get_available_slots(uuid,uuid,date,text) to service_role;
grant execute on function get_available_sessions(uuid,uuid,date) to service_role;
grant execute on function book_time_slot(uuid,uuid,uuid,timestamptz,text,boolean,uuid) to service_role;
grant execute on function book_number(uuid,uuid,uuid,uuid,date,text,boolean,uuid) to service_role;

-- 後台改期需取消舊約再以 RPC 建新約;取消只改 status(不 DELETE),走一般 update policy。

-- ──────────────────────────────────────────────────────────────────────────
-- 系統內真人客服聊天(見 supabase/migration_chat.sql)。以 line_user_id 為對話串。
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  line_user_id text not null,
  sender text not null check (sender in ('patient','staff')),
  body text not null,
  read_by_staff boolean not null default false,
  read_by_patient boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on chat_messages (clinic_id, line_user_id, created_at);
alter table chat_messages enable row level security;
drop policy if exists chat_messages_member on chat_messages;
create policy chat_messages_member on chat_messages for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

-- 客服黑名單(見 supabase/migration_chat_blocks.sql)。被封鎖者訊息靜默丟棄。
create table if not exists chat_blocks (
  clinic_id uuid not null references clinics(id) on delete cascade,
  line_user_id text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (clinic_id, line_user_id)
);
alter table chat_blocks enable row level security;
drop policy if exists chat_blocks_member on chat_blocks;
create policy chat_blocks_member on chat_blocks for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

-- CRM Lite：顧客分眾、互動時間軸與規則式行銷自動化。
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
    select p_segment_id, p.clinic_id, p.id from patients p
     where p.clinic_id = s.clinic_id and p.active
       and position(lower(s.rule_value) in lower(coalesce(p.tags, ''))) > 0;
  elsif s.rule_type = 'no_booking_days' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id from patients p
     where p.clinic_id = s.clinic_id and p.active
       and not exists (
         select 1 from appointments a where a.clinic_id = s.clinic_id and a.patient_id = p.id
           and a.status in ('booked', 'confirmed') and a.start_at >= now()
       )
       and not exists (
         select 1 from appointments a where a.clinic_id = s.clinic_id and a.patient_id = p.id
           and a.status = 'done' and a.start_at >= now() - (s.rule_value::int || ' days')::interval
       );
  elsif s.rule_type = 'completed_visits_gte' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id from patients p
     where p.clinic_id = s.clinic_id and p.active
       and (select count(*) from appointments a
             where a.clinic_id = s.clinic_id and a.patient_id = p.id and a.status = 'done') >= s.rule_value::int;
  elsif s.rule_type = 'no_show_gte' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id from patients p
     where p.clinic_id = s.clinic_id and p.active
       and (select count(*) from appointments a
             where a.clinic_id = s.clinic_id and a.patient_id = p.id and a.status = 'no_show') >= s.rule_value::int;
  elsif s.rule_type = 'birthday_month' then
    insert into crm_segment_members(segment_id, clinic_id, patient_id)
    select p_segment_id, p.clinic_id, p.id from patients p
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
  p_clinic_id uuid, p_automation_id uuid, p_patient_id uuid,
  p_trigger_key text, p_channel text, p_appointment_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
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
  ) on conflict (automation_id, patient_id, trigger_key, channel) do update
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
-- 預約與報名 SaaS v3：活動報名、標準付款、品牌入口
-- 可重跑；所有業務資料都帶 clinic_id，顧客端只能透過 Next.js API 使用 service role。

create extension if not exists pgcrypto;

alter table clinics add column if not exists slug text;
create unique index if not exists clinics_slug_unique_idx
  on clinics (slug) where slug is not null;

alter table clinic_settings add column if not exists timezone text not null default 'Asia/Taipei';
alter table clinic_settings add column if not exists brand_logo_url text;
alter table clinic_settings add column if not exists brand_primary_color text not null default '#1B6FC4';
alter table clinic_settings add column if not exists brand_accent_color text not null default '#B8862B';
alter table clinic_settings add column if not exists brand_page_enabled boolean not null default false;
alter table clinic_settings add column if not exists brand_page_template text not null default 'beauty';
alter table clinic_settings add column if not exists brand_page_content jsonb not null default '{}'::jsonb;
alter table clinic_settings add column if not exists public_booking_enabled boolean not null default true;
alter table clinic_settings add column if not exists public_registration_enabled boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_settings_brand_page_template_check') then
    alter table clinic_settings add constraint clinic_settings_brand_page_template_check
      check (brand_page_template in ('beauty', 'wellness', 'fitness', 'education', 'consulting', 'pet-care', 'venue', 'event'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_settings_brand_page_content_check') then
    alter table clinic_settings add constraint clinic_settings_brand_page_content_check
      check (jsonb_typeof(brand_page_content) = 'object');
  end if;
end $$;

create table if not exists clinic_domains (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  hostname text not null,
  kind text not null default 'custom' check (kind in ('shared','custom')),
  verification_token text,
  verified_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (hostname)
);
create index if not exists clinic_domains_clinic_idx on clinic_domains (clinic_id, active);

-- Privacy-safe public funnel events: no name, phone, LINE id or patient id is stored.
create table if not exists funnel_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_name text not null check (event_name in (
    'portal_view', 'booking_view', 'booking_start', 'booking_success',
    'registration_view', 'registration_start', 'registration_success',
    'membership_view', 'membership_lookup', 'membership_purchase_start'
  )),
  anonymous_id text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists funnel_events_clinic_time_idx on funnel_events (clinic_id, created_at desc);
create index if not exists funnel_events_clinic_name_idx on funnel_events (clinic_id, event_name, created_at desc);
alter table funnel_events enable row level security;
revoke all on table funnel_events from public, anon, authenticated;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  cover_url text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  access_mode text not null default 'public' check (access_mode in ('public','private')),
  access_token_hash text,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, slug)
);
create index if not exists events_public_idx on events (clinic_id, status, registration_open_at, registration_close_at);

create table if not exists event_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  venue text,
  capacity integer not null check (capacity > 0),
  waitlist_enabled boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists event_sessions_event_idx on event_sessions (clinic_id, event_id, start_at);

create table if not exists event_ticket_types (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  price integer not null default 0 check (price >= 0),
  capacity integer check (capacity is null or capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_ticket_types_event_idx on event_ticket_types (clinic_id, event_id, active);

create table if not exists registration_forms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  unique (event_id, version)
);

create table if not exists registration_form_fields (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  form_id uuid not null references registration_forms(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text','textarea','date','select','checkbox')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  unique (form_id, field_key)
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid references patients(id) on delete restrict,
  event_id uuid not null references events(id) on delete restrict,
  session_id uuid not null references event_sessions(id) on delete restrict,
  ticket_type_id uuid references event_ticket_types(id) on delete restrict,
  registration_no text not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','cancelled','waitlisted','attended','no_show')),
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required','pending','paid','failed','expired','refunded')),
  amount integer not null default 0 check (amount >= 0),
  name text not null,
  phone text not null,
  email text,
  line_user_id text,
  marketing_opt_in boolean not null default false,
  answers jsonb not null default '{}'::jsonb,
  checkin_token_hash text not null unique,
  checkin_token_encrypted text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, registration_no)
);
create index if not exists registrations_event_idx on registrations (clinic_id, event_id, session_id, status);
create index if not exists registrations_contact_idx on registrations (clinic_id, phone, created_at desc);
alter table registrations add column if not exists patient_id uuid references patients(id) on delete restrict;
create index if not exists registrations_patient_idx on registrations (clinic_id, patient_id, created_at desc);

alter table crm_interactions add column if not exists registration_id uuid references registrations(id) on delete set null;
alter table crm_interactions drop constraint if exists crm_interactions_kind_check;
alter table crm_interactions add constraint crm_interactions_kind_check
  check (kind in ('note', 'booking', 'registration', 'message', 'campaign'));
create index if not exists crm_interactions_registration_idx on crm_interactions (clinic_id, registration_id, created_at desc);

create table if not exists registration_answers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null unique references registrations(id) on delete restrict,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists registration_answers_clinic_idx on registration_answers (clinic_id, created_at desc);

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null unique references registrations(id) on delete cascade,
  session_id uuid not null references event_sessions(id) on delete cascade,
  position integer not null check (position > 0),
  status text not null default 'waiting' check (status in ('waiting','offered','promoted','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists waitlist_session_idx on waitlist_entries (clinic_id, session_id, status, position);

create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete restrict,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id) on delete set null,
  result text not null default 'accepted' check (result in ('accepted','duplicate','rejected')),
  unique (registration_id)
);

create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete restrict,
  registration_id uuid references registrations(id) on delete restrict,
  membership_plan_id uuid,
  patient_id uuid references patients(id) on delete restrict,
  provider text not null check (provider in ('ecpay','newebpay')),
  merchant_order_no text not null,
  amount integer not null check (amount > 0),
  currency text not null default 'TWD' check (currency = 'TWD'),
  expires_at timestamptz,
  return_path text not null default '/',
  status text not null default 'pending'
    check (status in ('pending','paid','failed','expired','refunded')),
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (appointment_id is not null and registration_id is null and membership_plan_id is null and patient_id is null)
    or (registration_id is not null and appointment_id is null and membership_plan_id is null and patient_id is null)
    or (membership_plan_id is not null and patient_id is not null and appointment_id is null and registration_id is null)
  ),
  unique (provider, merchant_order_no)
);
alter table payment_orders add column if not exists expires_at timestamptz;
alter table payment_orders add column if not exists membership_plan_id uuid;
alter table payment_orders add column if not exists patient_id uuid references patients(id) on delete restrict;
alter table payment_orders drop constraint if exists payment_orders_check;
alter table payment_orders drop constraint if exists payment_orders_subject_check;
alter table payment_orders add constraint payment_orders_subject_check check (
  (appointment_id is not null and registration_id is null and membership_plan_id is null and patient_id is null)
  or (registration_id is not null and appointment_id is null and membership_plan_id is null and patient_id is null)
  or (membership_plan_id is not null and patient_id is not null and appointment_id is null and registration_id is null)
);
create index if not exists payment_orders_clinic_idx on payment_orders (clinic_id, status, created_at desc);
create unique index if not exists payment_orders_registration_pending_idx
  on payment_orders (registration_id) where registration_id is not null and status = 'pending';
create unique index if not exists payment_orders_appointment_pending_idx
  on payment_orders (appointment_id) where appointment_id is not null and status = 'pending';
create unique index if not exists payment_orders_membership_pending_idx
  on payment_orders (membership_plan_id, patient_id)
  where membership_plan_id is not null and patient_id is not null and status = 'pending';

create table if not exists payment_transactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  payment_order_id uuid not null references payment_orders(id) on delete cascade,
  provider_transaction_no text,
  currency text not null default 'TWD' check (currency = 'TWD'),
  event_key text not null,
  status text not null check (status in ('received','accepted','rejected')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (payment_order_id, event_key)
);

create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id) on delete set null,
  provider text not null check (provider in ('ecpay','newebpay')),
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, event_key)
);

drop trigger if exists trg_events_touch on events;
create trigger trg_events_touch before update on events for each row execute function touch_updated_at();
drop trigger if exists trg_event_sessions_touch on event_sessions;
create trigger trg_event_sessions_touch before update on event_sessions for each row execute function touch_updated_at();
drop trigger if exists trg_event_ticket_types_touch on event_ticket_types;
create trigger trg_event_ticket_types_touch before update on event_ticket_types for each row execute function touch_updated_at();
drop trigger if exists trg_registrations_touch on registrations;
create trigger trg_registrations_touch before update on registrations for each row execute function touch_updated_at();
drop trigger if exists trg_waitlist_entries_touch on waitlist_entries;
create trigger trg_waitlist_entries_touch before update on waitlist_entries for each row execute function touch_updated_at();
drop trigger if exists trg_payment_orders_touch on payment_orders;
create trigger trg_payment_orders_touch before update on payment_orders for each row execute function touch_updated_at();

drop function if exists register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb);
create or replace function register_for_event(
  p_clinic_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_ticket_type_id uuid,
  p_name text,
  p_phone text,
  p_email text default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb,
  p_access_token text default null
) returns table (
  registration_id uuid,
  registration_no text,
  registration_status text,
  payment_status text,
  amount integer,
  checkin_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e record;
  s record;
  v_taken integer;
  v_ticket_taken integer;
  v_ticket_capacity integer;
  v_status text;
  v_payment_status text;
  v_amount integer := 0;
  v_no bigint;
  v_registration_no text;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid;
  v_position integer;
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception '請填寫姓名與電話';
  end if;

  select * into e from events
   where id = p_event_id and clinic_id = p_clinic_id and status = 'published';
  if not found then raise exception '找不到可報名的活動'; end if;
  if e.access_mode = 'private' and (
    nullif(trim(p_access_token), '') is null or
    encode(digest(trim(p_access_token), 'sha256'), 'hex') is distinct from e.access_token_hash
  ) then
    raise exception '此活動需要私密報名連結';
  end if;
  if e.registration_open_at is not null and now() < e.registration_open_at then
    raise exception '報名尚未開始';
  end if;
  if e.registration_close_at is not null and now() > e.registration_close_at then
    raise exception '報名已截止';
  end if;

  select * into s from event_sessions
   where id = p_session_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
  if not found then raise exception '找不到可報名的場次'; end if;

  if p_ticket_type_id is not null then
    select price, capacity into v_amount, v_ticket_capacity from event_ticket_types
     where id = p_ticket_type_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
    if not found then raise exception '找不到可選的票種'; end if;
  else
    v_ticket_capacity := null;
  end if;

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text));

  select count(*)::int into v_taken from registrations r
   where r.clinic_id = p_clinic_id and r.session_id = p_session_id
     and r.status in ('pending','confirmed','attended')
     and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());

  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from registrations r
     where r.clinic_id = p_clinic_id and r.ticket_type_id = p_ticket_type_id
       and r.status in ('pending','confirmed','attended')
       and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());
  else
    v_ticket_taken := 0;
  end if;

  if v_taken >= s.capacity or (v_ticket_capacity is not null and v_ticket_taken >= v_ticket_capacity) then
    if not s.waitlist_enabled then raise exception '此場次已額滿'; end if;
    v_status := 'waitlisted';
    v_payment_status := 'not_required';
  elsif v_amount = 0 then
    v_status := 'confirmed';
    v_payment_status := 'not_required';
  else
    v_status := 'pending';
    v_payment_status := 'pending';
  end if;

  select coalesce(max(nullif(substring(r.registration_no from '([0-9]+)$'), '')::bigint), 0) + 1
    into v_no from registrations r where r.event_id = p_event_id;
  v_registration_no := 'REG-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_no::text, greatest(4, length(v_no::text)), '0');

  insert into registrations (
    clinic_id, event_id, session_id, ticket_type_id, registration_no, status,
    payment_status, amount, name, phone, email, line_user_id, marketing_opt_in,
    answers, checkin_token_hash, expires_at
  ) values (
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, v_registration_no, v_status,
    v_payment_status, v_amount, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    nullif(trim(p_line_user_id), ''), coalesce(p_marketing_opt_in, false), coalesce(p_answers, '{}'::jsonb),
    encode(digest(v_token, 'sha256'), 'hex'),
    case when v_status = 'pending' then now() + interval '15 minutes' else null end
  ) returning id into v_id;

  insert into registration_answers (clinic_id, registration_id, answers)
    values (p_clinic_id, v_id, p_answers);

  if v_status = 'waitlisted' then
    select coalesce(max(position), 0) + 1 into v_position
      from waitlist_entries where session_id = p_session_id and status in ('waiting','offered');
    insert into waitlist_entries (clinic_id, registration_id, session_id, position)
      values (p_clinic_id, v_id, p_session_id, v_position);
  end if;

  return query select v_id, v_registration_no, v_status, v_payment_status, v_amount, v_token;
end; $$;

create or replace function checkin_registration(p_clinic_id uuid, p_token text, p_user_id uuid default null)
returns table (registration_id uuid, registration_status text, checked_in_at timestamptz, result text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_hash text;
  v_now timestamptz := now();
begin
  if nullif(trim(p_token), '') is null then raise exception '缺少報到憑證'; end if;
  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  select * into r from registrations where clinic_id = p_clinic_id and checkin_token_hash = v_hash for update;
  if not found then raise exception '報到憑證無效'; end if;
  if r.status in ('cancelled','waitlisted','pending') then raise exception '此報名目前不可報到'; end if;
  if exists (select 1 from checkins c where c.registration_id = r.id and c.result = 'accepted') then
    return query select r.id, r.status, (select c.checked_in_at from checkins c where c.registration_id = r.id and c.result = 'accepted'), 'duplicate';
    return;
  end if;
  insert into checkins (clinic_id, registration_id, checked_in_by, result)
    values (p_clinic_id, r.id, p_user_id, 'accepted');
  update registrations set status = 'attended', updated_at = v_now where id = r.id;
  return query select r.id, 'attended'::text, v_now, 'accepted'::text;
end; $$;

revoke all on function register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text) from public, anon, authenticated;
grant execute on function register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text) to service_role;
revoke all on function checkin_registration(uuid,text,uuid) from public, anon, authenticated;
grant execute on function checkin_registration(uuid,text,uuid) to service_role;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['clinic_domains','events','event_sessions','event_ticket_types','registration_forms','registration_form_fields','registrations','registration_answers','waitlist_entries','checkins','payment_orders','payment_transactions','payment_webhook_events','appointment_notification_logs'] loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
    $policy$, tbl || '_member', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;



-- Provider row-level hardening: provider 只能讀取被指派醫師的行程與必要病患資料。
-- 其餘租戶資料維持品牌成員隔離，但 provider 不得透過 Supabase client 直接橫向讀取。
drop policy if exists doctors_member on doctors;
drop policy if exists doctors_provider_read on doctors;
drop policy if exists doctors_nonprovider_manage on doctors;
create policy doctors_provider_read on doctors for select to authenticated
  using (
    doctors.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = doctors.clinic_id and da.doctor_id = doctors.id and da.user_id = auth.uid() and da.active)
    )
  );
create policy doctors_nonprovider_manage on doctors for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists schedule_templates_member on schedule_templates;
drop policy if exists schedule_templates_provider_read on schedule_templates;
drop policy if exists schedule_templates_nonprovider_manage on schedule_templates;
create policy schedule_templates_provider_read on schedule_templates for select to authenticated
  using (
    schedule_templates.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_templates.clinic_id and da.doctor_id = schedule_templates.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy schedule_templates_nonprovider_manage on schedule_templates for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
    and exists (select 1 from doctors d where d.id = schedule_templates.doctor_id and d.clinic_id = schedule_templates.clinic_id and d.active)
  );

drop policy if exists schedule_exceptions_member on schedule_exceptions;
drop policy if exists schedule_exceptions_provider_read on schedule_exceptions;
drop policy if exists schedule_exceptions_nonprovider_manage on schedule_exceptions;
create policy schedule_exceptions_provider_read on schedule_exceptions for select to authenticated
  using (
    schedule_exceptions.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_exceptions.clinic_id and da.doctor_id = schedule_exceptions.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy schedule_exceptions_nonprovider_manage on schedule_exceptions for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
    and exists (select 1 from doctors d where d.id = schedule_exceptions.doctor_id and d.clinic_id = schedule_exceptions.clinic_id and d.active)
  );

drop policy if exists patients_member on patients;
drop policy if exists patients_provider_read on patients;
drop policy if exists patients_nonprovider_manage on patients;
create policy patients_provider_read on patients for select to authenticated
  using (
    patients.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a
        join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patients.clinic_id and a.patient_id = patients.id and da.user_id = auth.uid() and da.active
      )
    )
  );
create policy patients_nonprovider_manage on patients for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

drop policy if exists appointments_member on appointments;
drop policy if exists appointments_provider_read on appointments;
drop policy if exists appointments_nonprovider_manage on appointments;
drop policy if exists appointments_provider_status_update on appointments;
create policy appointments_provider_read on appointments for select to authenticated
  using (
    appointments.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy appointments_nonprovider_manage on appointments for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
    and (
      (appointments.doctor_id is not null and exists (select 1 from doctors d where d.id = appointments.doctor_id and d.clinic_id = appointments.clinic_id and d.active))
      or (
        appointments.doctor_id is null
        and appointments.service_id is not null
        and exists (
          select 1 from services s
           where s.id = appointments.service_id
             and s.clinic_id = appointments.clinic_id
             and s.active
             and s.booking_target in ('provider_optional', 'resource_only')
        )
      )
    )
    and exists (select 1 from patients p where p.id = appointments.patient_id and p.clinic_id = appointments.clinic_id)
    and (appointments.service_id is null or exists (select 1 from services s where s.id = appointments.service_id and s.clinic_id = appointments.clinic_id and s.active))
    and (appointments.template_id is null or exists (
      select 1 from schedule_templates t
       where t.id = appointments.template_id and t.clinic_id = appointments.clinic_id
         and (
           t.doctor_id = appointments.doctor_id
           or (appointments.doctor_id is null and t.doctor_id is null and t.service_id = appointments.service_id)
         )
      union all
      select 1 from schedule_exceptions e
       where e.id = appointments.template_id and e.clinic_id = appointments.clinic_id
         and (
           e.doctor_id = appointments.doctor_id
           or (appointments.doctor_id is null and e.doctor_id is null)
         )
    ))
  );
create policy appointments_provider_status_update on appointments for update to authenticated
  using (exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active))
  with check (
    appointments.status in ('done', 'no_show')
    and exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active)
  );

create or replace function prevent_provider_appointment_writes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if exists (select 1 from clinic_members cm where cm.clinic_id = old.clinic_id and cm.user_id = auth.uid() and cm.role = 'provider') then
    if not exists (select 1 from doctor_assignments da where da.clinic_id = old.clinic_id and da.doctor_id = old.doctor_id and da.user_id = auth.uid() and da.active) then
      raise exception '服務提供者未被指派此醫師';
    end if;
    if new.clinic_id is distinct from old.clinic_id
      or new.doctor_id is distinct from old.doctor_id
      or new.patient_id is distinct from old.patient_id
      or new.template_id is distinct from old.template_id
      or new.service_id is distinct from old.service_id
      or new.start_at is distinct from old.start_at
      or new.end_at is distinct from old.end_at
      or new.visit_type is distinct from old.visit_type
      or new.source is distinct from old.source
      or new.queue_number is distinct from old.queue_number
      or new.is_self_pay is distinct from old.is_self_pay
      or new.deposit_status is distinct from old.deposit_status
      or new.deposit_amount is distinct from old.deposit_amount
      or new.deposit_expires_at is distinct from old.deposit_expires_at
      or new.note is distinct from old.note
      or new.status not in ('done', 'no_show')
      or old.status not in ('booked', 'confirmed') then
      raise exception '服務提供者只能將已指派預約標記為完成或未到';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_provider_appointment_writes on appointments;
create trigger trg_prevent_provider_appointment_writes
before update on appointments
for each row execute function prevent_provider_appointment_writes();

drop policy if exists serving_member on serving_numbers;
drop policy if exists serving_numbers_provider_read on serving_numbers;
drop policy if exists serving_numbers_nonprovider_manage on serving_numbers;
create policy serving_numbers_provider_read on serving_numbers for select to authenticated
  using (
    serving_numbers.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = serving_numbers.clinic_id and da.doctor_id = serving_numbers.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy serving_numbers_nonprovider_manage on serving_numbers for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
    and exists (select 1 from doctors d where d.id = serving_numbers.doctor_id and d.clinic_id = serving_numbers.clinic_id and d.active)
  );

drop policy if exists patient_records_member on patient_records;
drop policy if exists patient_records_provider_read on patient_records;
drop policy if exists patient_records_nonprovider_manage on patient_records;
create policy patient_records_provider_read on patient_records for select to authenticated
  using (
    patient_records.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a
        join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patient_records.clinic_id and a.patient_id = patient_records.patient_id and da.user_id = auth.uid() and da.active
      )
    )
  );
create policy patient_records_nonprovider_manage on patient_records for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
    and exists (select 1 from patients p where p.id = patient_records.patient_id and p.clinic_id = patient_records.clinic_id)
  );

-- Provider 不得從 authenticated client 直接讀 CRM、報名、付款、訊息與稽核資料。
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'chat_messages','chat_blocks','crm_segments','crm_segment_members','crm_interactions','crm_automations','crm_delivery_logs',
    'clinic_domains','events','event_sessions','event_ticket_types','registration_forms','registration_form_fields','registrations',
    'registration_answers','waitlist_entries','checkins','payment_orders','payment_transactions','payment_webhook_events',
    'clinic_payment_settings','appointment_status_events','appointment_notification_logs','registration_status_events','registration_notification_logs','payment_status_events',
    'membership_plans','patient_memberships','membership_ledger','discount_codes','discount_redemptions','reminder_logs',
    'service_resources','service_resource_assignments',
    'line_messages','line_auto_replies','line_richmenu'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
    $policy$, tbl || '_member', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;

-- v3 standard customer benefits: membership packages, credits, and coupons.
create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  name text not null,
  description text,
  price integer not null default 0 check (price >= 0),
  credits_total integer not null check (credits_total > 0),
  valid_days integer check (valid_days is null or valid_days > 0),
  usage_scope text not null default 'both' check (usage_scope in ('appointment','registration','both')),
  service_id uuid references services(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists membership_plans_clinic_idx on membership_plans (clinic_id, active, created_at desc);

create table if not exists patient_memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  patient_id uuid not null references patients(id) on delete restrict,
  plan_id uuid not null references membership_plans(id) on delete restrict,
  payment_order_id uuid,
  membership_code text not null,
  status text not null default 'active' check (status in ('active','exhausted','expired','cancelled')),
  credits_total integer not null check (credits_total > 0),
  credits_remaining integer not null check (credits_remaining >= 0 and credits_remaining <= credits_total),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  source text not null default 'manual' check (source in ('manual','purchase','migration')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);
create unique index if not exists patient_memberships_code_idx on patient_memberships (clinic_id, membership_code);
create unique index if not exists patient_memberships_payment_order_idx on patient_memberships (payment_order_id) where payment_order_id is not null;
create index if not exists patient_memberships_patient_idx on patient_memberships (clinic_id, patient_id, status, expires_at);

create table if not exists membership_ledger (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  membership_id uuid not null references patient_memberships(id) on delete restrict,
  patient_id uuid not null references patients(id) on delete restrict,
  kind text not null check (kind in ('grant','consume','restore','adjust','expire')),
  credits_delta integer not null check (credits_delta <> 0),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists membership_ledger_idempotency_idx on membership_ledger (membership_id, idempotency_key) where idempotency_key is not null;
create index if not exists membership_ledger_lookup_idx on membership_ledger (clinic_id, patient_id, created_at desc);

create table if not exists membership_levels (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, code)
);
create table if not exists membership_plan_level_prices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  plan_id uuid not null references membership_plans(id) on delete restrict,
  level_id uuid not null references membership_levels(id) on delete restrict,
  price integer not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, level_id)
);
alter table patients add column if not exists membership_level_id uuid references membership_levels(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.payment_orders'::regclass and conname = 'payment_orders_membership_plan_fk') then
    alter table payment_orders add constraint payment_orders_membership_plan_fk foreign key (membership_plan_id) references membership_plans(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.patient_memberships'::regclass and conname = 'patient_memberships_payment_order_fk') then
    alter table patient_memberships add constraint patient_memberships_payment_order_fk foreign key (payment_order_id) references payment_orders(id) on delete restrict;
  end if;
end $$;
create index if not exists patients_membership_level_idx on patients (clinic_id, membership_level_id);
create index if not exists membership_levels_clinic_idx on membership_levels (clinic_id, active, sort_order);
create index if not exists membership_plan_level_prices_clinic_idx on membership_plan_level_prices (clinic_id, plan_id);

-- Online-course learning center. Customers never read these tables directly;
-- the server verifies the signed browser identity and registration eligibility.
create table if not exists course_units (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  event_id uuid not null references events(id) on delete restrict,
  title text not null,
  summary text,
  unit_type text not null default 'link' check (unit_type in ('video','link','download','text')),
  content_url text,
  body text,
  access_rule text not null default 'registered' check (access_rule in ('registered','paid','attended')),
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_units_content_check check (unit_type in ('quiz','assignment') or content_url is not null or body is not null)
);
create index if not exists course_units_event_idx on course_units (clinic_id, event_id, active, sort_order);

create table if not exists course_unit_progress (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  event_id uuid not null references events(id) on delete restrict,
  unit_id uuid not null references course_units(id) on delete restrict,
  registration_id uuid not null references registrations(id) on delete restrict,
  patient_id uuid not null references patients(id) on delete restrict,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, unit_id)
);
create index if not exists course_unit_progress_patient_idx on course_unit_progress (clinic_id, patient_id, event_id);

drop trigger if exists trg_course_units_touch on course_units;
create trigger trg_course_units_touch before update on course_units for each row execute function touch_updated_at();
drop trigger if exists trg_course_unit_progress_touch on course_unit_progress;
create trigger trg_course_unit_progress_touch before update on course_unit_progress for each row execute function touch_updated_at();

alter table course_units enable row level security;
alter table course_unit_progress enable row level security;
revoke all on table course_units from public, anon;
revoke all on table course_unit_progress from public, anon;
drop policy if exists course_units_member on course_units;
create policy course_units_member on course_units for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from clinic_members cm where cm.clinic_id = course_units.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from clinic_members cm where cm.clinic_id = course_units.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider') and exists (select 1 from events e where e.id = course_units.event_id and e.clinic_id = course_units.clinic_id));
drop policy if exists course_unit_progress_member on course_unit_progress;
create policy course_unit_progress_member on course_unit_progress for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from clinic_members cm where cm.clinic_id = course_unit_progress.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from clinic_members cm where cm.clinic_id = course_unit_progress.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));
drop trigger if exists trg_membership_levels_touch on membership_levels;
create trigger trg_membership_levels_touch before update on membership_levels for each row execute function touch_updated_at();
drop trigger if exists trg_membership_plan_level_prices_touch on membership_plan_level_prices;
create trigger trg_membership_plan_level_prices_touch before update on membership_plan_level_prices for each row execute function touch_updated_at();
alter table membership_levels enable row level security;
alter table membership_plan_level_prices enable row level security;
revoke all on table membership_levels from public, anon;
revoke all on table membership_plan_level_prices from public, anon;

create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  code text not null,
  kind text not null check (kind in ('percent','fixed')),
  value integer not null check (value > 0),
  min_amount integer not null default 0 check (min_amount >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  benefit_type text not null default 'coupon' check (benefit_type in ('coupon','voucher')),
  recipient_name text,
  recipient_phone text,
  issued_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (benefit_type <> 'voucher' or max_uses = 1),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table discount_codes add column if not exists benefit_type text not null default 'coupon';
alter table discount_codes add column if not exists recipient_name text;
alter table discount_codes add column if not exists recipient_phone text;
alter table discount_codes add column if not exists issued_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.discount_codes'::regclass and conname = 'discount_codes_benefit_type_check') then
    alter table discount_codes add constraint discount_codes_benefit_type_check check (benefit_type in ('coupon', 'voucher'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.discount_codes'::regclass and conname = 'discount_codes_voucher_single_use_check') then
    alter table discount_codes add constraint discount_codes_voucher_single_use_check check (benefit_type <> 'voucher' or max_uses = 1);
  end if;
end $$;
create unique index if not exists discount_codes_code_idx on discount_codes (clinic_id, lower(code));
create index if not exists discount_codes_active_idx on discount_codes (clinic_id, active, starts_at, ends_at);

create table if not exists discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete restrict,
  discount_code_id uuid not null references discount_codes(id) on delete restrict,
  patient_id uuid references patients(id) on delete restrict,
  registration_id uuid references registrations(id) on delete restrict,
  appointment_id uuid references appointments(id) on delete restrict,
  original_amount integer not null check (original_amount >= 0),
  discount_amount integer not null check (discount_amount >= 0),
  final_amount integer not null check (final_amount >= 0),
  status text not null default 'reserved' check (status in ('reserved','applied','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((registration_id is null) <> (appointment_id is null))
);
create unique index if not exists discount_redemptions_registration_idx on discount_redemptions (registration_id) where registration_id is not null;
create unique index if not exists discount_redemptions_appointment_idx on discount_redemptions (appointment_id) where appointment_id is not null;
create index if not exists discount_redemptions_code_idx on discount_redemptions (clinic_id, discount_code_id, status);

alter table event_ticket_types add column if not exists membership_plan_id uuid references membership_plans(id) on delete restrict;
alter table registrations add column if not exists discount_code_id uuid references discount_codes(id) on delete restrict;
alter table registrations add column if not exists discount_amount integer not null default 0 check (discount_amount >= 0);
alter table registrations add column if not exists membership_id uuid references patient_memberships(id) on delete restrict;
alter table appointments add column if not exists membership_id uuid references patient_memberships(id) on delete restrict;
alter table appointments add column if not exists discount_code_id uuid references discount_codes(id) on delete restrict;
alter table appointments add column if not exists discount_amount integer not null default 0 check (discount_amount >= 0);
create index if not exists registrations_benefit_idx on registrations (clinic_id, discount_code_id, membership_id);
create index if not exists appointments_benefit_idx on appointments (clinic_id, discount_code_id, membership_id);

drop trigger if exists trg_membership_plans_touch on membership_plans;
create trigger trg_membership_plans_touch before update on membership_plans for each row execute function touch_updated_at();
drop trigger if exists trg_patient_memberships_touch on patient_memberships;
create trigger trg_patient_memberships_touch before update on patient_memberships for each row execute function touch_updated_at();
drop trigger if exists trg_discount_codes_touch on discount_codes;
create trigger trg_discount_codes_touch before update on discount_codes for each row execute function touch_updated_at();
drop trigger if exists trg_discount_redemptions_touch on discount_redemptions;
create trigger trg_discount_redemptions_touch before update on discount_redemptions for each row execute function touch_updated_at();

create or replace function grant_patient_membership(
  p_clinic_id uuid, p_patient_id uuid, p_plan_id uuid, p_actor_user_id uuid,
  p_source text default 'manual', p_note text default null
) returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare plan_row record; v_id uuid; v_code text; v_expires timestamptz;
begin
  if p_source not in ('manual','purchase','migration') then raise exception 'invalid membership source'; end if;
  if not exists (select 1 from clinic_members where clinic_id=p_clinic_id and user_id=p_actor_user_id and role <> 'provider') then raise exception 'membership actor is not allowed'; end if;
  if not exists (select 1 from patients where id=p_patient_id and clinic_id=p_clinic_id and active) then raise exception 'patient not found'; end if;
  select * into plan_row from membership_plans where id=p_plan_id and clinic_id=p_clinic_id and active;
  if not found then raise exception 'membership plan not found'; end if;
  if plan_row.valid_days is not null then v_expires := now() + (plan_row.valid_days || ' days')::interval; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (select 1 from patient_memberships where clinic_id=p_clinic_id and membership_code=v_code);
  end loop;
  insert into patient_memberships (clinic_id,patient_id,plan_id,membership_code,credits_total,credits_remaining,starts_at,expires_at,source,note)
    values (p_clinic_id,p_patient_id,p_plan_id,v_code,plan_row.credits_total,plan_row.credits_total,now(),v_expires,p_source,nullif(btrim(p_note),'')) returning id into v_id;
  insert into membership_ledger (clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,actor_id,note)
    values (p_clinic_id,v_id,p_patient_id,'grant',plan_row.credits_total,'manual',p_actor_user_id,p_note);
  return query select v_id,v_code,v_expires,plan_row.credits_total;
end; $$;

create or replace function consume_membership_credit(
  p_clinic_id uuid, p_membership_id uuid, p_usage_scope text, p_reference_type text, p_reference_id uuid,
  p_service_id uuid default null, p_actor_user_id uuid default null, p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare m record; v_key text := coalesce(p_reference_type,'manual') || ':' || coalesce(p_reference_id::text,'none'); v_remaining integer;
begin
  if p_usage_scope not in ('appointment','registration') then raise exception 'invalid membership usage scope'; end if;
  select pm.*,mp.usage_scope,mp.service_id as plan_service_id into m
    from patient_memberships pm join membership_plans mp on mp.id=pm.plan_id and mp.clinic_id=pm.clinic_id
   where pm.id=p_membership_id and pm.clinic_id=p_clinic_id for update of pm;
  if not found then raise exception 'membership not found'; end if;
  if m.status <> 'active' or m.credits_remaining <= 0 then raise exception 'membership has no available credit'; end if;
  if m.expires_at is not null and m.expires_at <= now() then update patient_memberships set status='expired',updated_at=now() where id=p_membership_id; raise exception 'membership expired'; end if;
  if m.usage_scope not in (p_usage_scope,'both') then raise exception 'membership scope does not match'; end if;
  if m.plan_service_id is not null and m.plan_service_id is distinct from p_service_id then raise exception 'membership is not valid for this service'; end if;
  if p_reference_id is not null and exists (select 1 from membership_ledger where membership_id=p_membership_id and kind='consume' and idempotency_key=v_key) then return m.credits_remaining; end if;
  v_remaining := m.credits_remaining - 1;
  update patient_memberships set credits_remaining=v_remaining,status=case when v_remaining=0 then 'exhausted' else 'active' end,updated_at=now() where id=p_membership_id;
  insert into membership_ledger (clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,reference_id,idempotency_key,actor_id,note)
    values (p_clinic_id,p_membership_id,m.patient_id,'consume',-1,p_reference_type,p_reference_id,v_key,p_actor_user_id,p_note);
  return v_remaining;
end; $$;

create or replace function restore_membership_credit(
  p_clinic_id uuid, p_membership_id uuid, p_reference_type text, p_reference_id uuid, p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare m record; v_key text := 'restore:' || coalesce(p_reference_type,'manual') || ':' || coalesce(p_reference_id::text,'none'); v_remaining integer;
begin
  if exists (select 1 from membership_ledger where membership_id=p_membership_id and kind='restore' and idempotency_key=v_key) then
    select credits_remaining into v_remaining from patient_memberships where id=p_membership_id and clinic_id=p_clinic_id; return coalesce(v_remaining,0);
  end if;
  select * into m from patient_memberships where id=p_membership_id and clinic_id=p_clinic_id for update;
  if not found then raise exception 'membership not found'; end if;
  v_remaining := least(m.credits_total,m.credits_remaining+1);
  update patient_memberships set credits_remaining=v_remaining,status=case when expires_at is not null and expires_at<=now() then 'expired' else 'active' end,updated_at=now() where id=p_membership_id;
  insert into membership_ledger (clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,reference_id,idempotency_key,note)
    values (p_clinic_id,p_membership_id,m.patient_id,'restore',1,p_reference_type,p_reference_id,v_key,p_note);
  return v_remaining;
end; $$;

create or replace function cancel_appointment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_note text default 'cancelled appointment'
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  appt record;
begin
  select id, status, membership_id into appt
    from appointments
   where id = p_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be cancelled'; end if;
  if appt.membership_id is not null then
    perform restore_membership_credit(p_clinic_id, appt.membership_id, 'appointment', appt.id, p_note);
  end if;
  update appointments set status = 'cancelled' where id = appt.id and clinic_id = p_clinic_id;
  return appt.id;
end;
$$;

revoke all on function cancel_appointment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function cancel_appointment(uuid, uuid, text) to service_role;

create or replace function fail_appointment_payment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_note text default 'payment failed'
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  appt record;
begin
  select id, status, membership_id into appt
    from appointments
   where id = p_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if appt.status in ('booked', 'confirmed') then
    if appt.membership_id is not null then
      perform restore_membership_credit(p_clinic_id, appt.membership_id, 'appointment', appt.id, p_note);
    end if;
    update appointments
       set deposit_status = 'failed', deposit_expires_at = null, status = 'cancelled'
     where id = appt.id and clinic_id = p_clinic_id;
  end if;
  return appt.id;
end;
$$;

revoke all on function fail_appointment_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function fail_appointment_payment(uuid, uuid, text) to service_role;

create or replace function cancel_appointment_by_operator(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_actor_user_id uuid,
  p_note text default 'cancelled by operator'
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from clinic_members cm
     where cm.clinic_id = p_clinic_id
       and cm.user_id = p_actor_user_id
       and cm.role <> 'provider'
  ) then
    raise exception 'operator is not authorized';
  end if;

  -- The service-role call still records the authenticated operator in the
  -- status-event trigger for an auditable cancellation history.
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  return cancel_appointment(p_clinic_id, p_appointment_id, p_note);
end;
$$;

revoke all on function cancel_appointment_by_operator(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function cancel_appointment_by_operator(uuid, uuid, uuid, text) to service_role;

create or replace function register_for_event_with_benefits(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null
) returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  e record; s record; ticket record; m record; d record;
  v_taken integer; v_ticket_taken integer; v_status text; v_payment_status text;
  v_original integer := 0; v_amount integer := 0; v_discount integer := 0; v_discount_code_id uuid;
  v_no bigint; v_registration_no text; v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid; v_position integer; v_membership_id uuid; v_membership_applied boolean := false;
  v_code text := lower(nullif(trim(p_discount_code), '')); v_membership_code text := upper(nullif(trim(p_membership_code), ''));
begin
  if nullif(trim(p_name),'') is null or nullif(trim(p_phone),'') is null then raise exception 'name and phone are required'; end if;
  if v_code is not null and v_membership_code is not null then raise exception 'membership and discount cannot be combined'; end if;
  select * into e from events where id=p_event_id and clinic_id=p_clinic_id and status='published';
  if not found then raise exception 'event not found'; end if;
  if e.access_mode='private' and (nullif(trim(p_access_token),'') is null or encode(digest(trim(p_access_token),'sha256'),'hex') is distinct from e.access_token_hash) then raise exception 'private event token is invalid'; end if;
  if e.registration_open_at is not null and now()<e.registration_open_at then raise exception 'registration is not open'; end if;
  if e.registration_close_at is not null and now()>e.registration_close_at then raise exception 'registration is closed'; end if;
  select * into s from event_sessions where id=p_session_id and event_id=p_event_id and clinic_id=p_clinic_id and active;
  if not found then raise exception 'session not found'; end if;
  if p_form_id is not null and not exists (
    select 1 from registration_forms
     where id = p_form_id and event_id = p_event_id and clinic_id = p_clinic_id
       and status = 'published' and version = p_form_version
  ) then
    raise exception 'registration form is invalid';
  end if;
  if p_ticket_type_id is not null then
    select price,capacity,membership_plan_id into ticket from event_ticket_types where id=p_ticket_type_id and event_id=p_event_id and clinic_id=p_clinic_id and active;
    if not found then raise exception 'ticket type not found'; end if;
    v_original := ticket.price;
  end if;
  if v_code is not null and v_original = 0 then raise exception 'discount code requires a paid ticket'; end if;
  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text));
  select count(*)::int into v_taken from registrations r where r.clinic_id=p_clinic_id and r.session_id=p_session_id and r.status in ('pending','confirmed','attended') and (r.status<>'pending' or r.expires_at is null or r.expires_at>now());
  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from registrations r where r.clinic_id=p_clinic_id and r.ticket_type_id=p_ticket_type_id and r.status in ('pending','confirmed','attended') and (r.status<>'pending' or r.expires_at is null or r.expires_at>now());
  else v_ticket_taken := 0; end if;
  if v_taken>=s.capacity or (p_ticket_type_id is not null and ticket.capacity is not null and v_ticket_taken>=ticket.capacity) then
    if not s.waitlist_enabled then raise exception 'session is full'; end if;
    if v_code is not null or v_membership_code is not null then raise exception 'benefits cannot be used while waitlisted'; end if;
    v_status := 'waitlisted'; v_payment_status := 'not_required';
  else
    if v_membership_code is not null then
      select pm.*,mp.usage_scope,mp.service_id as plan_service_id into m
        from patient_memberships pm join membership_plans mp on mp.id=pm.plan_id and mp.clinic_id=pm.clinic_id
        join patients p on p.id=pm.patient_id and p.clinic_id=pm.clinic_id
       where pm.clinic_id=p_clinic_id and pm.membership_code=v_membership_code and p.phone=trim(p_phone) and p.active for update of pm;
      if not found then raise exception 'membership code is invalid'; end if;
      if m.status<>'active' or m.credits_remaining<=0 then raise exception 'membership has no available credit'; end if;
      if m.expires_at is not null and m.expires_at<=now() then raise exception 'membership expired'; end if;
      if m.usage_scope not in ('registration','both') then raise exception 'membership cannot be used for registration'; end if;
      if p_ticket_type_id is not null and ticket.membership_plan_id is not null and ticket.membership_plan_id is distinct from m.plan_id then raise exception 'membership does not match ticket'; end if;
      v_membership_id := m.id;
      v_amount := 0; v_membership_applied := true;
    else
      v_amount := v_original;
      if v_code is not null and v_amount>0 then
        select * into d from discount_codes where clinic_id=p_clinic_id and lower(code)=v_code for update;
        if not found or not d.active then raise exception 'discount code is invalid'; end if;
        if d.starts_at is not null and now()<d.starts_at then raise exception 'discount code is not active'; end if;
        if d.ends_at is not null and now()>=d.ends_at then raise exception 'discount code is expired'; end if;
        if v_amount<d.min_amount then raise exception 'order does not meet discount minimum'; end if;
        if d.max_uses is not null and d.used_count>=d.max_uses then raise exception 'discount code usage limit reached'; end if;
        v_discount_code_id := d.id;
        v_discount := case when d.kind='percent' then floor(v_amount*d.value/100.0)::int else least(v_amount,d.value) end;
        v_amount := greatest(0,v_amount-v_discount);
      end if;
    end if;
    v_status := case when v_amount=0 then 'confirmed' else 'pending' end;
    v_payment_status := case when v_amount=0 then 'not_required' else 'pending' end;
  end if;
  select coalesce(max(nullif(substring(r.registration_no from '([0-9]+)$'),'')::bigint),0)+1 into v_no from registrations r where r.clinic_id=p_clinic_id and r.event_id=p_event_id;
  v_registration_no := 'REG-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(v_no::text,greatest(4,length(v_no::text)),'0');
  insert into registrations (clinic_id,event_id,session_id,ticket_type_id,registration_no,status,payment_status,amount,discount_code_id,discount_amount,membership_id,name,phone,email,line_user_id,marketing_opt_in,answers,checkin_token_hash,expires_at,form_id,form_version)
    values (p_clinic_id,p_event_id,p_session_id,p_ticket_type_id,v_registration_no,v_status,v_payment_status,v_amount,v_discount_code_id,v_discount,v_membership_id,trim(p_name),trim(p_phone),nullif(trim(p_email),''),nullif(trim(p_line_user_id),''),coalesce(p_marketing_opt_in,false),coalesce(p_answers,'{}'::jsonb),encode(digest(v_token,'sha256'),'hex'),case when v_status='pending' then now()+interval '15 minutes' else null end,p_form_id,p_form_version) returning id into v_id;
  insert into registration_answers (clinic_id,registration_id,answers) values (p_clinic_id,v_id,p_answers);
  if v_membership_applied then
    perform consume_membership_credit(p_clinic_id,m.id,'registration','registration',v_id,m.plan_service_id,null,'registration membership redemption');
  elsif v_code is not null then
    update discount_codes set used_count=used_count+1,updated_at=now() where id=d.id;
    insert into discount_redemptions (clinic_id,discount_code_id,patient_id,registration_id,original_amount,discount_amount,final_amount,status)
      values (p_clinic_id,d.id,(select id from patients where clinic_id=p_clinic_id and phone=trim(p_phone) and active order by created_at limit 1),v_id,v_original,v_discount,v_amount,case when v_status='confirmed' then 'applied' else 'reserved' end);
  end if;
  if v_status='waitlisted' then
    select coalesce(max(position),0)+1 into v_position from waitlist_entries where session_id=p_session_id and status in ('waiting','offered');
    insert into waitlist_entries (clinic_id,registration_id,session_id,position) values (p_clinic_id,v_id,p_session_id,v_position);
  end if;
  return query select v_id,v_registration_no,v_status,v_payment_status,v_amount,v_discount,v_membership_applied,v_token;
end; $$;

create or replace function apply_registration_benefits(p_clinic_id uuid,p_registration_id uuid) returns integer
language plpgsql security definer set search_path=public,extensions as $$ declare n integer; begin
  update discount_redemptions set status='applied',updated_at=now() where clinic_id=p_clinic_id and registration_id=p_registration_id and status='reserved';
  get diagnostics n=row_count; return n;
end; $$;

create or replace function release_registration_benefits(p_clinic_id uuid,p_registration_id uuid) returns integer
language plpgsql security definer set search_path=public,extensions as $$
declare r record; d record; released integer:=0;
begin
  select * into r from registrations where id=p_registration_id and clinic_id=p_clinic_id for update;
  if not found then return 0; end if;
  for d in select * from discount_redemptions where clinic_id=p_clinic_id and registration_id=p_registration_id and status='reserved' for update loop
    update discount_redemptions set status='released',updated_at=now() where id=d.id;
    update discount_codes set used_count=greatest(0,used_count-1),updated_at=now() where id=d.discount_code_id; released:=released+1;
  end loop;
  if r.membership_id is not null and exists (select 1 from membership_ledger where membership_id=r.membership_id and kind='consume' and reference_type='registration' and reference_id=r.id) then
    perform restore_membership_credit(p_clinic_id,r.membership_id,'registration',r.id,'cancelled registration'); released:=released+1;
  end if;
  return released;
end; $$;

create or replace function release_expired_registration_benefits() returns integer
language plpgsql security definer set search_path=public,extensions as $$
declare r record; released integer:=0;
begin
  for r in select distinct registrations.clinic_id,registrations.id from registrations join discount_redemptions on discount_redemptions.registration_id=registrations.id and discount_redemptions.status='reserved' where registrations.status='cancelled' and registrations.payment_status in ('failed','expired') loop
    released:=released+release_registration_benefits(r.clinic_id,r.id);
  end loop; return released;
end; $$;

create or replace function book_time_slot_with_membership(
  p_clinic_id uuid,p_doctor_id uuid,p_patient_id uuid,p_start_at timestamptz,
  p_visit_type text default 'return',p_is_self_pay boolean default false,p_membership_code text default null,p_service_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid; m record;
begin
  if nullif(trim(p_membership_code),'') is null then return book_time_slot(p_clinic_id,p_doctor_id,p_patient_id,p_start_at,p_visit_type,p_is_self_pay,p_service_id); end if;
  v_id:=book_time_slot(p_clinic_id,p_doctor_id,p_patient_id,p_start_at,p_visit_type,p_is_self_pay,p_service_id);
  select pm.id into m from patient_memberships pm where pm.clinic_id=p_clinic_id and pm.membership_code=upper(trim(p_membership_code)) and pm.patient_id=p_patient_id;
  if not found then raise exception 'membership code is invalid'; end if;
  perform consume_membership_credit(p_clinic_id,m.id,'appointment','appointment',v_id,p_service_id,null,'appointment membership redemption');
  update appointments set membership_id=m.id,deposit_status='waived',deposit_amount=0,service_id=p_service_id where id=v_id and clinic_id=p_clinic_id;
  return v_id;
end; $$;

create or replace function book_number_with_membership(
  p_clinic_id uuid,p_doctor_id uuid,p_patient_id uuid,p_template_id uuid,p_date date,
  p_visit_type text default 'return',p_is_self_pay boolean default false,p_membership_code text default null,p_service_id uuid default null
) returns table (appointment_id uuid,queue_number integer) language plpgsql security definer set search_path=public,extensions as $$
declare b record; m record;
begin
  if nullif(trim(p_membership_code),'') is null then return query select * from book_number(p_clinic_id,p_doctor_id,p_patient_id,p_template_id,p_date,p_visit_type,p_is_self_pay,p_service_id); return; end if;
  select * into b from book_number(p_clinic_id,p_doctor_id,p_patient_id,p_template_id,p_date,p_visit_type,p_is_self_pay,p_service_id);
  select pm.id into m from patient_memberships pm where pm.clinic_id=p_clinic_id and pm.membership_code=upper(trim(p_membership_code)) and pm.patient_id=p_patient_id;
  if not found then raise exception 'membership code is invalid'; end if;
  perform consume_membership_credit(p_clinic_id,m.id,'appointment','appointment',b.appointment_id,p_service_id,null,'appointment membership redemption');
  update appointments set membership_id=m.id,deposit_status='waived',deposit_amount=0,service_id=p_service_id where id=b.appointment_id and clinic_id=p_clinic_id;
  return query select b.appointment_id,b.queue_number;
end; $$;

create or replace function reschedule_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null,
  p_service_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  old_appt record;
  new_appointment_id uuid;
  new_queue_number integer;
  v_service_id uuid;
begin
  select patient_id, visit_type, is_self_pay, membership_id, service_id, status
    into old_appt
    from appointments
   where id = p_old_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;
  v_service_id := coalesce(p_service_id, old_appt.service_id);

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    new_appointment_id := book_time_slot(
      p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
      old_appt.visit_type, old_appt.is_self_pay, v_service_id
    );
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    select appointment_id, queue_number into new_appointment_id, new_queue_number
      from book_number(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      );
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update appointments
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id
     where id = new_appointment_id and clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update appointments set service_id = v_service_id where id = new_appointment_id and clinic_id = p_clinic_id;
  end if;

  update appointments set status = 'cancelled' where id = p_old_appointment_id and clinic_id = p_clinic_id;
  update appointment_status_events
     set note = 'rescheduled appointment'
   where id = (
     select id from appointment_status_events
      where appointment_id = p_old_appointment_id
        and clinic_id = p_clinic_id
        and to_status = 'cancelled'
      order by created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function reschedule_appointment(uuid,uuid,text,uuid,timestamptz,uuid,date,uuid) from public,anon,authenticated;
grant execute on function reschedule_appointment(uuid,uuid,text,uuid,timestamptz,uuid,date,uuid) to service_role;

revoke all on function grant_patient_membership(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function grant_patient_membership(uuid,uuid,uuid,uuid,text,text) to service_role;
revoke all on function consume_membership_credit(uuid,uuid,text,text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function consume_membership_credit(uuid,uuid,text,text,uuid,uuid,uuid,text) to service_role;
revoke all on function restore_membership_credit(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function restore_membership_credit(uuid,uuid,text,uuid,text) to service_role;
revoke all on function register_for_event_with_benefits(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function register_for_event_with_benefits(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text,text,text,uuid,integer) to service_role;
revoke all on function apply_registration_benefits(uuid,uuid) from public,anon,authenticated;
grant execute on function apply_registration_benefits(uuid,uuid) to service_role;
revoke all on function release_registration_benefits(uuid,uuid) from public,anon,authenticated;
grant execute on function release_registration_benefits(uuid,uuid) to service_role;
revoke all on function release_expired_registration_benefits() from public,anon,authenticated;
grant execute on function release_expired_registration_benefits() to service_role;
revoke all on function book_time_slot_with_membership(uuid,uuid,uuid,timestamptz,text,boolean,text,uuid) from public,anon,authenticated;
grant execute on function book_time_slot_with_membership(uuid,uuid,uuid,timestamptz,text,boolean,text,uuid) to service_role;
revoke all on function book_number_with_membership(uuid,uuid,uuid,uuid,date,text,boolean,text,uuid) from public,anon,authenticated;
grant execute on function book_number_with_membership(uuid,uuid,uuid,uuid,date,text,boolean,text,uuid) to service_role;

do $$ declare tbl text; begin
  foreach tbl in array array['membership_plans','patient_memberships','membership_ledger','discount_codes','discount_redemptions'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('drop policy if exists %I on public.%I',tbl || '_member',tbl);
    execute format($policy$ create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id=auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id=%I.clinic_id and cm.user_id=auth.uid() and cm.role <> 'provider')
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id=auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id=%I.clinic_id and cm.user_id=auth.uid() and cm.role <> 'provider')
      ) $policy$,tbl || '_member',tbl,tbl,tbl,tbl,tbl);
  end loop;
end $$;
-- v3 硬化：報名稽核、租戶金流設定與候補遞補
-- 可重跑；本檔需在 migration_registration_payments.sql 之後執行。
alter table clinic_domains add column if not exists verification_token text;
alter table clinics add column if not exists line_destination text;
create unique index if not exists clinics_line_destination_unique_idx
  on clinics (line_destination) where line_destination is not null;

create table if not exists appointment_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete restrict,
  from_status text,
  to_status text not null,
  source text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  notification_processed_at timestamptz
);
create index if not exists appointment_status_events_lookup_idx
  on appointment_status_events (clinic_id, appointment_id, created_at desc);
create index if not exists appointment_status_events_notification_queue_idx
  on appointment_status_events (created_at, id)
  where notification_processed_at is null;

create table if not exists appointment_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete restrict,
  kind text not null check (kind in ('pending','confirmed','cancelled','rescheduled')),
  channel text not null check (channel in ('line','email')),
  status text not null default 'sending' check (status in ('sending','sent','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, kind, channel)
);
create index if not exists appointment_notification_logs_queue_idx
  on appointment_notification_logs (clinic_id, status, updated_at);

create or replace function record_appointment_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'system' else 'admin' end;
begin
  if tg_op = 'INSERT' then
    insert into appointment_status_events (clinic_id, appointment_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, null, new.status, v_source, v_actor);
  elsif new.status is distinct from old.status then
    insert into appointment_status_events (clinic_id, appointment_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, old.status, new.status, v_source, v_actor);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointment_status_event on appointments;
create trigger trg_appointment_status_event
after insert or update of status on appointments
for each row execute function record_appointment_status_event();

create table if not exists clinic_payment_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  provider text not null check (provider in ('ecpay','newebpay')),
  merchant_id text not null,
  environment text not null default 'test' check (environment in ('test','production')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clinic_payment_provider_merchant_idx
  on clinic_payment_settings (provider, merchant_id);

-- legacy secrets are no longer used; configure server environment before applying this schema.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_payment_settings' and column_name = 'hash_key') then
    execute 'update public.clinic_payment_settings set hash_key = null where hash_key is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_payment_settings' and column_name = 'hash_iv') then
    execute 'update public.clinic_payment_settings set hash_iv = null where hash_iv is not null';
  end if;
end $$;
alter table clinic_payment_settings drop column if exists hash_key;
alter table clinic_payment_settings drop column if exists hash_iv;

create table if not exists registration_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete restrict,
  from_status text,
  to_status text not null,
  source text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  notification_processed_at timestamptz
);
create index if not exists registration_status_events_lookup_idx
  on registration_status_events (clinic_id, registration_id, created_at desc);
create index if not exists registration_status_events_notification_queue_idx
  on registration_status_events (created_at, id)
  where notification_processed_at is null;

create table if not exists registration_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete restrict,
  kind text not null check (kind in ('pending','confirmed','waitlisted','cancelled')),
  channel text not null check (channel in ('line','email')),
  status text not null default 'sending' check (status in ('sending','sent','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, kind, channel)
);
alter table registration_notification_logs drop constraint if exists registration_notification_logs_status_check;
alter table registration_notification_logs add constraint registration_notification_logs_status_check
  check (status in ('sending','sent','failed','skipped'));
create index if not exists registration_notification_logs_queue_idx
  on registration_notification_logs (clinic_id, status, updated_at);

create table if not exists payment_status_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  payment_order_id uuid not null references payment_orders(id) on delete restrict,
  from_status text,
  to_status text not null,
  source text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  provider_event_key text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payment_status_events_lookup_idx
  on payment_status_events (clinic_id, payment_order_id, created_at desc);

create or replace function record_registration_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'system' else 'admin' end;
begin
  if tg_op = 'INSERT' then
    insert into registration_status_events (clinic_id, registration_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, null, new.status, v_source, v_actor);
  elsif new.status is distinct from old.status then
    insert into registration_status_events (clinic_id, registration_id, from_status, to_status, source, actor_id)
    values (new.clinic_id, new.id, old.status, new.status, v_source, v_actor);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registration_status_event on registrations;
create trigger trg_registration_status_event
after insert or update of status on registrations
for each row execute function record_registration_status_event();

drop trigger if exists trg_clinic_payment_settings_touch on clinic_payment_settings;
create trigger trg_clinic_payment_settings_touch before update on clinic_payment_settings
for each row execute function touch_updated_at();

drop trigger if exists trg_registration_notification_logs_touch on registration_notification_logs;
create trigger trg_registration_notification_logs_touch before update on registration_notification_logs
for each row execute function touch_updated_at();

drop trigger if exists trg_appointment_notification_logs_touch on appointment_notification_logs;
create trigger trg_appointment_notification_logs_touch before update on appointment_notification_logs
for each row execute function touch_updated_at();

create or replace function promote_waitlist_for_session(p_clinic_id uuid, p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s record;
  r record;
  v_taken integer;
  v_ticket_taken integer;
  v_promoted integer := 0;
begin
  select * into s from event_sessions
   where id = p_session_id and clinic_id = p_clinic_id and active
   for update;
  if not found then raise exception '找不到場次'; end if;

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || s.event_id::text));

  select count(*)::int into v_taken from registrations
   where clinic_id = p_clinic_id and session_id = p_session_id
     and status in ('pending','confirmed','attended')
     and (status <> 'pending' or expires_at is null or expires_at > now());

  for r in
    select w.id as waitlist_id, w.registration_id, reg.ticket_type_id, tt.capacity as ticket_capacity, reg.amount
      from waitlist_entries w
      join registrations reg on reg.id = w.registration_id
      left join event_ticket_types tt
        on tt.id = reg.ticket_type_id and tt.event_id = s.event_id and tt.clinic_id = p_clinic_id
     where w.clinic_id = p_clinic_id and w.session_id = p_session_id
       and w.status = 'waiting' and reg.status = 'waitlisted'
     order by w.position, w.created_at
     for update of w, reg
  loop
    exit when v_taken >= s.capacity;
    if r.ticket_capacity is not null then
      select count(*)::int into v_ticket_taken
        from registrations active_reg
       where active_reg.clinic_id = p_clinic_id
         and active_reg.ticket_type_id = r.ticket_type_id
         and active_reg.status in ('pending', 'confirmed', 'attended')
         and (active_reg.status <> 'pending' or active_reg.expires_at is null or active_reg.expires_at > now());
      if v_ticket_taken >= r.ticket_capacity then
        continue;
      end if;
    end if;
    if r.amount > 0 then
      update registrations
         set status = 'pending', payment_status = 'pending', expires_at = now() + interval '15 minutes'
       where id = r.registration_id;
    else
      update registrations
         set status = 'confirmed', payment_status = 'not_required', expires_at = null
       where id = r.registration_id;
    end if;
    update waitlist_entries set status = 'promoted' where id = r.waitlist_id;
    v_taken := v_taken + 1;
    v_promoted := v_promoted + 1;
  end loop;
  return v_promoted;
end;
$$;

create or replace function expire_registration_payments()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n integer;
  session_row record;
begin
  with expired_orders as (
    update payment_orders po
       set status = 'expired', updated_at = now()
      from registrations r
     where po.registration_id = r.id
       and po.status = 'pending'
       and r.status = 'pending'
       and r.payment_status = 'pending'
       and r.expires_at is not null
       and r.expires_at <= now()
    returning po.id, po.clinic_id
  )
  insert into payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
    select clinic_id, id, 'pending', 'expired', 'registration_expiry'
      from expired_orders;
  update registrations
     set status = 'cancelled', payment_status = 'expired', expires_at = null
  where status = 'pending' and payment_status = 'pending'
     and expires_at is not null and expires_at <= now();
  get diagnostics n = row_count;
  for session_row in
    select distinct clinic_id, session_id from registrations
     where status = 'cancelled' and payment_status = 'expired'
       and updated_at >= now() - interval '2 minutes'
  loop
    perform promote_waitlist_for_session(session_row.clinic_id, session_row.session_id);
  end loop;
  return n;
end;
$$;

create or replace function expire_pending_appointment_deposits()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a record;
  order_row record;
  n integer := 0;
begin
  for a in
    select id, clinic_id
      from appointments
     where deposit_status = 'pending'
       and deposit_expires_at is not null
       and deposit_expires_at <= now()
       and status in ('booked', 'confirmed')
     for update skip locked
  loop
    perform fail_appointment_payment(a.clinic_id, a.id, 'appointment deposit expired');
    for order_row in
      update payment_orders
         set status = 'expired', updated_at = now()
       where appointment_id = a.id and clinic_id = a.clinic_id and status = 'pending'
       returning id
    loop
      insert into payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
        values (a.clinic_id, order_row.id, 'pending', 'expired', 'appointment_deposit_expiry');
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function cancel_registration(p_clinic_id uuid, p_token text)
returns table (registration_id uuid, registration_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  r record;
begin
  if nullif(trim(p_token), '') is null then raise exception '缺少取消憑證'; end if;
  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  select * into r from registrations
   where clinic_id = p_clinic_id and checkin_token_hash = v_hash
   for update;
  if not found then raise exception '取消憑證無效'; end if;
  if r.status in ('attended','cancelled') then
    return query select r.id, r.status;
    return;
  end if;
  update registrations
     set status = 'cancelled',
         payment_status = case when r.payment_status = 'paid' then 'paid' else r.payment_status end,
         expires_at = null
   where id = r.id;
  perform release_registration_benefits(p_clinic_id, r.id);
  perform promote_waitlist_for_session(p_clinic_id, r.session_id);
  return query select r.id, 'cancelled'::text;
end;
$$;

create or replace function cancel_registration_by_id(
  p_clinic_id uuid,
  p_registration_id uuid,
  p_actor_user_id uuid default null
)
returns table (registration_id uuid, registration_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  if p_actor_user_id is not null and not exists (
    select 1 from clinic_members cm
     where cm.clinic_id = p_clinic_id
       and cm.user_id = p_actor_user_id
       and cm.role <> 'provider'
  ) then
    raise exception 'operator is not authorized';
  end if;

  select * into r from registrations
   where id = p_registration_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'registration not found'; end if;
  if r.status in ('attended', 'cancelled') then
    return query select r.id, r.status;
    return;
  end if;

  update registrations
     set status = 'cancelled',
         payment_status = case when r.payment_status = 'paid' then 'paid' else r.payment_status end,
         expires_at = null
   where id = r.id and clinic_id = p_clinic_id;
  perform release_registration_benefits(p_clinic_id, r.id);
  perform promote_waitlist_for_session(p_clinic_id, r.session_id);
  return query select r.id, 'cancelled'::text;
end;
$$;

revoke all on function promote_waitlist_for_session(uuid,uuid) from public, anon, authenticated;
grant execute on function promote_waitlist_for_session(uuid,uuid) to service_role;
revoke all on function expire_registration_payments() from public, anon, authenticated;
grant execute on function expire_registration_payments() to service_role;
revoke all on function expire_pending_appointment_deposits() from public, anon, authenticated;
grant execute on function expire_pending_appointment_deposits() to service_role;
revoke all on function cancel_registration(uuid,text) from public, anon, authenticated;
grant execute on function cancel_registration(uuid,text) to service_role;
revoke all on function cancel_registration_by_id(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function cancel_registration_by_id(uuid,uuid,uuid) to service_role;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['clinic_payment_settings','appointment_status_events','appointment_notification_logs','registration_status_events','registration_notification_logs','payment_status_events'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      )
    $policy$, tbl || '_member', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;

alter table registrations add column if not exists form_id uuid references registration_forms(id) on delete set null;
alter table registrations add column if not exists form_version integer;
alter table registrations add column if not exists checkin_token_encrypted text;
create index if not exists registrations_form_idx on registrations (clinic_id, form_id, form_version);

-- SaaS 品牌建立：由已授權的品牌管理員在 server action 透過 service_role 呼叫。
-- 以來源品牌成員資格作為授權條件，並在同一個 security-definer function 內建立品牌、擁有者與預設設定。
create or replace function create_brand_with_owner(
  p_actor_user_id uuid,
  p_source_clinic_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
) returns table (clinic_id uuid, clinic_name text, clinic_slug text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from clinic_members cm
     where cm.clinic_id = p_source_clinic_id
       and cm.user_id = p_actor_user_id
       and cm.role in ('owner', 'admin')
  ) then
    raise exception '無權限建立品牌';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception '品牌名稱格式錯誤'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then
    raise exception '品牌短網址格式錯誤';
  end if;

  insert into clinics (name, slug, phone, address)
    values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
    returning id into v_id;

  insert into clinic_settings (clinic_id) values (v_id)
    on conflict (clinic_id) do nothing;
  insert into clinic_members (clinic_id, user_id, role)
    values (v_id, p_actor_user_id, 'owner');

  return query select v_id, v_name, v_slug;
exception
  when unique_violation then
    raise exception '品牌短網址已存在' using errcode = '23505';
end;
$$;

revoke all on function create_brand_with_owner(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function create_brand_with_owner(uuid, uuid, text, text, text, text) to service_role;

-- 品牌採 soft-delete；所有 clinic_id 外鍵禁止刪除品牌時連帶刪除歷史業務資料。
do $$
declare
  fk record;
begin
  for fk in
    select ns.nspname as table_schema, child.relname as table_name, con.conname as constraint_name
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    where con.contype = 'f'
      and ns.nspname = 'public'
      and con.confrelid = 'public.clinics'::regclass
      and array_length(con.conkey, 1) = 1
      and con.conkey[1] = (
        select att.attnum from pg_attribute att
         where att.attrelid = con.conrelid and att.attname = 'clinic_id' and not att.attisdropped
      )
  loop
    execute format('alter table %I.%I drop constraint if exists %I', fk.table_schema, fk.table_name, fk.constraint_name);
   execute format('alter table %I.%I add constraint %I foreign key (clinic_id) references public.clinics(id) on delete restrict', fk.table_schema, fk.table_name, fk.constraint_name);
 end loop;
end $$;
-- v4 role matrix hardening
-- Run after migration_crm_lite.sql, migration_registration_payments.sql,
-- migration_v3_hardening.sql and migration_memberships_coupons.sql.
-- This migration is idempotent and narrows authenticated access without
-- changing service_role RPC permissions.

do $$
declare
  tbl text;
  policy_name text;
begin
  foreach tbl in array array[
    'clinics', 'clinic_settings', 'doctors', 'schedule_templates', 'schedule_exceptions',
    'patients', 'appointments', 'services', 'serving_numbers', 'patient_records',
    'line_auto_replies', 'line_messages', 'line_richmenu', 'reminder_logs',
    'chat_messages', 'chat_blocks',
    'crm_segments', 'crm_segment_members', 'crm_interactions', 'crm_automations', 'crm_delivery_logs',
    'clinic_domains', 'events', 'event_sessions', 'event_ticket_types', 'registration_forms',
    'registration_form_fields', 'registrations', 'registration_answers', 'waitlist_entries', 'checkins',
    'payment_orders', 'payment_transactions', 'payment_webhook_events', 'clinic_payment_settings',
    'appointment_status_events', 'appointment_notification_logs', 'registration_status_events', 'registration_notification_logs',
    'payment_status_events', 'membership_plans', 'patient_memberships', 'membership_ledger',
    'discount_codes', 'discount_redemptions', 'service_resources', 'service_resource_assignments',
    'membership_levels', 'membership_plan_level_prices'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', tbl);
    foreach policy_name in array array[
      tbl || '_member', tbl || '_read', tbl || '_manage', tbl || '_insert',
      tbl || '_provider_read', tbl || '_nonprovider_manage', tbl || '_provider_status_update',
      case when tbl = 'serving_numbers' then 'serving_member' else null end,
      case when tbl = 'line_auto_replies' then 'line_replies_member' else null end
    ] loop
      if policy_name is not null then
        execute format('drop policy if exists %I on public.%I', policy_name, tbl);
      end if;
    end loop;
  end loop;
end $$;

-- Base tenant tables: every member may read the brand context, but only
-- owner/admin may change it.
create policy clinics_read on clinics for select to authenticated
  using (id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
create policy clinics_manage on clinics for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = clinics.id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = clinics.id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

create policy clinic_settings_read on clinic_settings for select to authenticated
  using (
    clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and exists (
      select 1 from clinic_members cm
      where cm.clinic_id = clinic_settings.clinic_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner','admin','frontdesk','staff')
    )
  );
create policy clinic_settings_manage on clinic_settings for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = clinic_settings.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = clinic_settings.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

-- Provider-scoped operational tables.
create policy doctors_provider_read on doctors for select to authenticated
  using (
    doctors.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = doctors.clinic_id and da.doctor_id = doctors.id and da.user_id = auth.uid() and da.active)
    )
  );
create policy doctors_nonprovider_manage on doctors for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

create policy schedule_templates_provider_read on schedule_templates for select to authenticated
  using (
    schedule_templates.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_templates.clinic_id and da.doctor_id = schedule_templates.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy schedule_templates_nonprovider_manage on schedule_templates for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = schedule_templates.doctor_id and d.clinic_id = schedule_templates.clinic_id and d.active)
  );

create policy schedule_exceptions_provider_read on schedule_exceptions for select to authenticated
  using (
    schedule_exceptions.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_exceptions.clinic_id and da.doctor_id = schedule_exceptions.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy schedule_exceptions_nonprovider_manage on schedule_exceptions for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = schedule_exceptions.doctor_id and d.clinic_id = schedule_exceptions.clinic_id and d.active)
  );

create policy patients_provider_read on patients for select to authenticated
  using (
    patients.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a
        join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patients.clinic_id and a.patient_id = patients.id and da.user_id = auth.uid() and da.active
      )
    )
  );
create policy patients_nonprovider_manage on patients for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

create policy appointments_provider_read on appointments for select to authenticated
  using (
    appointments.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy appointments_nonprovider_manage on appointments for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and (
      (appointments.doctor_id is not null and exists (select 1 from doctors d where d.id = appointments.doctor_id and d.clinic_id = appointments.clinic_id and d.active))
      or (
        appointments.doctor_id is null
        and appointments.service_id is not null
        and exists (
          select 1 from services s
           where s.id = appointments.service_id
             and s.clinic_id = appointments.clinic_id
             and s.active
             and s.booking_target in ('provider_optional', 'resource_only')
        )
      )
    )
    and exists (select 1 from patients p where p.id = appointments.patient_id and p.clinic_id = appointments.clinic_id)
    and (appointments.service_id is null or exists (select 1 from services s where s.id = appointments.service_id and s.clinic_id = appointments.clinic_id and s.active))
    and (appointments.template_id is null or exists (
      select 1 from schedule_templates t
       where t.id = appointments.template_id and t.clinic_id = appointments.clinic_id
         and (
           t.doctor_id = appointments.doctor_id
           or (appointments.doctor_id is null and t.doctor_id is null and t.service_id = appointments.service_id)
         )
      union all
      select 1 from schedule_exceptions e
       where e.id = appointments.template_id and e.clinic_id = appointments.clinic_id
         and (
           e.doctor_id = appointments.doctor_id
           or (appointments.doctor_id is null and e.doctor_id is null)
         )
    ))
  );
create policy appointments_provider_status_update on appointments for update to authenticated
  using (exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active))
  with check (
    appointments.status in ('done', 'no_show')
    and exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active)
  );

create policy services_read on services for select to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
create policy services_manage on services for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = services.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = services.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

create policy serving_numbers_provider_read on serving_numbers for select to authenticated
  using (
    serving_numbers.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = serving_numbers.clinic_id and da.doctor_id = serving_numbers.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy serving_numbers_nonprovider_manage on serving_numbers for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = serving_numbers.doctor_id and d.clinic_id = serving_numbers.clinic_id and d.active)
  );

create policy patient_records_provider_read on patient_records for select to authenticated
  using (
    patient_records.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a
        join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patient_records.clinic_id and a.patient_id = patient_records.patient_id and da.user_id = auth.uid() and da.active
      )
    )
  );
create policy patient_records_nonprovider_manage on patient_records for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from patients p where p.id = patient_records.patient_id and p.clinic_id = patient_records.clinic_id)
  );

-- Admin-only configuration and integration data.
do $$
declare tbl text;
begin
  foreach tbl in array array['line_auto_replies','line_messages','line_richmenu','clinic_domains','clinic_payment_settings'] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
    $policy$, tbl || '_read', tbl, tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
      with check (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
    $policy$, tbl || '_manage', tbl, tbl, tbl);
  end loop;
end $$;

-- Non-provider readers may inspect operational records. Writes are performed
-- by the protected server actions or service_role RPCs.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'reminder_logs','registrations','registration_answers','waitlist_entries','checkins',
    'payment_orders','payment_transactions','payment_webhook_events','patient_memberships',
    'membership_ledger','discount_redemptions','appointment_status_events','appointment_notification_logs','registration_status_events',
    'registration_notification_logs','payment_status_events','crm_delivery_logs'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
    $policy$, tbl || '_read', tbl, tbl, tbl);
  end loop;
end $$;

-- Event and form definitions, membership plans, CRM definitions: all
-- non-providers may read; only owner/admin may create or change them.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'events','event_sessions','event_ticket_types','registration_forms','registration_form_fields',
    'membership_plans','membership_levels','membership_plan_level_prices','discount_codes','crm_segments','crm_segment_members','crm_automations'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
    $policy$, tbl || '_read', tbl, tbl, tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
      with check (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
    $policy$, tbl || '_manage', tbl, tbl, tbl);
  end loop;
end $$;

-- Child-record tenant integrity: authenticated writes may not attach a record
-- to a parent object from another brand, even when the supplied clinic_id is valid.
drop policy if exists line_auto_replies_manage on line_auto_replies;
create policy line_auto_replies_manage on line_auto_replies for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = line_auto_replies.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = line_auto_replies.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and (line_auto_replies.message_id is null or exists (select 1 from line_messages m where m.id = line_auto_replies.message_id and m.clinic_id = line_auto_replies.clinic_id))
  );

drop policy if exists event_sessions_manage on event_sessions;
create policy event_sessions_manage on event_sessions for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = event_sessions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = event_sessions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from events e where e.id = event_sessions.event_id and e.clinic_id = event_sessions.clinic_id)
  );

drop policy if exists event_ticket_types_manage on event_ticket_types;
create policy event_ticket_types_manage on event_ticket_types for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = event_ticket_types.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = event_ticket_types.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from events e where e.id = event_ticket_types.event_id and e.clinic_id = event_ticket_types.clinic_id)
    and (event_ticket_types.membership_plan_id is null or exists (select 1 from membership_plans mp where mp.id = event_ticket_types.membership_plan_id and mp.clinic_id = event_ticket_types.clinic_id))
  );

drop policy if exists registration_forms_manage on registration_forms;
create policy registration_forms_manage on registration_forms for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = registration_forms.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = registration_forms.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from events e where e.id = registration_forms.event_id and e.clinic_id = registration_forms.clinic_id)
  );

drop policy if exists registration_form_fields_manage on registration_form_fields;
create policy registration_form_fields_manage on registration_form_fields for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = registration_form_fields.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = registration_form_fields.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from registration_forms f where f.id = registration_form_fields.form_id and f.clinic_id = registration_form_fields.clinic_id)
  );

drop policy if exists membership_plans_manage on membership_plans;
create policy membership_plans_manage on membership_plans for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = membership_plans.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = membership_plans.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and (membership_plans.service_id is null or exists (select 1 from services s where s.id = membership_plans.service_id and s.clinic_id = membership_plans.clinic_id))
  );

drop policy if exists crm_segment_members_manage on crm_segment_members;
create policy crm_segment_members_manage on crm_segment_members for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = crm_segment_members.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = crm_segment_members.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from crm_segments s where s.id = crm_segment_members.segment_id and s.clinic_id = crm_segment_members.clinic_id)
    and exists (select 1 from patients p where p.id = crm_segment_members.patient_id and p.clinic_id = crm_segment_members.clinic_id)
  );

drop policy if exists crm_automations_manage on crm_automations;
create policy crm_automations_manage on crm_automations for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = crm_automations.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = crm_automations.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and (crm_automations.segment_id is null or exists (select 1 from crm_segments s where s.id = crm_automations.segment_id and s.clinic_id = crm_automations.clinic_id))
  );

-- CRM timeline notes can be appended by operational staff; no authenticated
-- role may rewrite or delete the timeline or delivery audit.
create policy crm_interactions_read on crm_interactions for select to authenticated
  using (
    clinic_id in (select cm0.clinic_id from clinic_members cm0 where cm0.user_id = auth.uid())
    and exists (select 1 from clinic_members cm where cm.clinic_id = crm_interactions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
  );
create policy crm_interactions_insert on crm_interactions for insert to authenticated
  with check (
    clinic_id in (select cm0.clinic_id from clinic_members cm0 where cm0.user_id = auth.uid())
    and exists (select 1 from clinic_members cm where cm.clinic_id = crm_interactions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from public.patients p where p.id = crm_interactions.patient_id and p.clinic_id = crm_interactions.clinic_id)
    and (crm_interactions.appointment_id is null or exists (select 1 from public.appointments a where a.id = crm_interactions.appointment_id and a.clinic_id = crm_interactions.clinic_id and a.patient_id = crm_interactions.patient_id))
  );

-- Customer-service chat is operational data and is unavailable to providers.
do $$
declare tbl text;
begin
  foreach tbl in array array['chat_messages','chat_blocks'] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
    $policy$, tbl || '_manage', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;

-- SECURITY DEFINER trigger／內部函式不可由 API roles 直接執行；顧客端一律走本專案 server route。
revoke all on function seed_clinic_settings() from public, anon, authenticated;
revoke all on function sync_patient_birthday_mmdd() from public, anon, authenticated;
revoke all on function touch_updated_at() from public, anon, authenticated;
revoke all on function prevent_provider_appointment_writes() from public, anon, authenticated;
revoke all on function record_appointment_status_event() from public, anon, authenticated;
revoke all on function record_registration_status_event() from public, anon, authenticated;
grant execute on function seed_clinic_settings() to service_role;
grant execute on function sync_patient_birthday_mmdd() to service_role;
grant execute on function touch_updated_at() to service_role;
grant execute on function prevent_provider_appointment_writes() to service_role;
grant execute on function record_appointment_status_event() to service_role;
grant execute on function record_registration_status_event() to service_role;

-- SaaS platform layer. `clinic_id` remains the legacy-compatible tenant key;
-- platform tables are service-role only and are never exposed through anon/RLS.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated;

create table if not exists public.brand_entitlements (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  plan_code text not null default 'standard' check (plan_code in ('standard', 'professional', 'enterprise')),
  feature_flags jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.brand_entitlements enable row level security;
revoke all on table public.brand_entitlements from public, anon, authenticated;

insert into public.brand_entitlements (clinic_id)
select id from public.clinics
on conflict (clinic_id) do nothing;

create or replace function public.seed_brand_entitlements()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.brand_entitlements (clinic_id) values (new.id)
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_clinic_seed_entitlements on public.clinics;
create trigger trg_clinic_seed_entitlements after insert on public.clinics
for each row execute function public.seed_brand_entitlements();

drop trigger if exists trg_platform_admins_touch on public.platform_admins;
create trigger trg_platform_admins_touch before update on public.platform_admins
for each row execute function public.touch_updated_at();
drop trigger if exists trg_brand_entitlements_touch on public.brand_entitlements;
create trigger trg_brand_entitlements_touch before update on public.brand_entitlements
for each row execute function public.touch_updated_at();

create or replace function public.create_brand_with_platform_admin(
  p_actor_user_id uuid, p_owner_user_id uuid, p_name text, p_slug text,
  p_phone text default null, p_address text default null
)
returns table (clinic_id uuid, owner_user_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_clinic_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor_user_id and active)
    then raise exception 'platform admin access required'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'invalid brand name'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception 'invalid brand slug'; end if;
  if not exists (select 1 from auth.users where id = p_owner_user_id) then raise exception 'owner user not found'; end if;
  insert into public.clinics (name, slug, phone, address, active)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''), true)
  returning id into v_clinic_id;
  insert into public.clinic_members (clinic_id, user_id, role)
  values (v_clinic_id, p_owner_user_id, 'owner')
  on conflict (clinic_id, user_id) do update set role = 'owner';
  return query select v_clinic_id, p_owner_user_id;
exception when unique_violation then
  raise exception 'brand slug already exists' using errcode = '23505';
end;
$$;
revoke all on function public.seed_brand_entitlements() from public, anon, authenticated;
grant execute on function public.seed_brand_entitlements() to service_role;
revoke all on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) to service_role;

-- Core booking and registration gaps: service timing, customer change rules,
-- ticket sale windows, and immutable terms consent snapshots.

alter table public.clinic_settings add column if not exists cancel_lead_minutes integer not null default 120;
alter table public.clinic_settings add column if not exists reschedule_lead_minutes integer not null default 120;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_settings_cancel_lead_check') then alter table public.clinic_settings add constraint clinic_settings_cancel_lead_check check (cancel_lead_minutes >= 0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_settings_reschedule_lead_check') then alter table public.clinic_settings add constraint clinic_settings_reschedule_lead_check check (reschedule_lead_minutes >= 0) not valid; end if;
end $$;

alter table public.services add column if not exists category text;
alter table public.services add column if not exists duration_minutes integer;
alter table public.services add column if not exists buffer_minutes integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'services_duration_check') then alter table public.services add constraint services_duration_check check (duration_minutes is null or duration_minutes > 0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname = 'services_buffer_check') then alter table public.services add constraint services_buffer_check check (buffer_minutes >= 0) not valid; end if;
end $$;

alter table public.event_ticket_types add column if not exists sale_start_at timestamptz;
alter table public.event_ticket_types add column if not exists sale_end_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'event_ticket_sale_window_check') then alter table public.event_ticket_types add constraint event_ticket_sale_window_check check (sale_end_at is null or sale_start_at is null or sale_end_at > sale_start_at) not valid; end if;
end $$;
alter table public.events add column if not exists terms_version integer not null default 1;
alter table public.events add column if not exists terms_text text;
alter table public.registrations add column if not exists terms_version integer;
alter table public.registrations add column if not exists terms_accepted_at timestamptz;

create or replace function public.service_booking_minutes(
  p_clinic_id uuid,
  p_service_id uuid,
  p_base_minutes integer,
  p_visit_type text,
  p_first_visit_extends boolean,
  p_first_visit_minutes integer
)
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select greatest(
    coalesce((select s.duration_minutes + s.buffer_minutes from public.services s where s.id = p_service_id and s.clinic_id = p_clinic_id and s.active), p_base_minutes),
    case when p_visit_type = 'first' and p_first_visit_extends then coalesce(p_first_visit_minutes, p_base_minutes) else p_base_minutes end,
    1
  );
$$;

create or replace function public.get_available_slots_for_service(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_service_id uuid default null
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead integer := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30);
  v_first_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id = p_clinic_id), false);
  v_first_minutes integer := (select first_visit_minutes from public.clinic_settings where clinic_id = p_clinic_id);
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  for rec in
    select t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.doctor_id = p_doctor_id and t.weekday = v_weekday and t.active
       and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and e.date = p_date and e.is_closed and e.start_time is null)
    union all
    select e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and e.date = p_date and not e.is_closed
  loop
    v_slot_length := public.service_booking_minutes(p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes);
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as e
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::integer
      from candidate c
      left join public.appointments a on a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
        and a.status in ('booked', 'confirmed', 'done') and a.start_at < c.e and a.end_at > c.s
     where c.s > now() + (v_lead || ' minutes')::interval
       and not exists (
         select 1 from public.schedule_exceptions ec
          where ec.clinic_id = p_clinic_id and ec.doctor_id = p_doctor_id and ec.date = p_date and ec.is_closed and ec.start_time is not null
            and (c.s at time zone 'Asia/Taipei')::time < ec.end_time and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
       )
     group by c.s, c.e, rec.capacity
     having rec.capacity - count(a.id) > 0
     order by c.s;
  end loop;
end;
$$;

create or replace function public.book_time_slot_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_appointment record;
  v_settings record;
  v_segment record;
  v_end_at timestamptz;
  v_minutes integer;
begin
  v_id := public.book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is null then return v_id; end if;

  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  select * into v_appointment from public.appointments where id = v_id and clinic_id = p_clinic_id for update;
  v_minutes := public.service_booking_minutes(p_clinic_id, p_service_id,
    greatest(1, extract(epoch from (v_appointment.end_at - v_appointment.start_at))::integer / 60),
    p_visit_type, coalesce(v_settings.first_visit_extends, false), v_settings.first_visit_minutes);
  v_end_at := v_appointment.start_at + (v_minutes || ' minutes')::interval;

  select x.start_time, x.end_time into v_segment from (
    select t.start_time, t.end_time from public.schedule_templates t
     where t.id = v_appointment.template_id and t.clinic_id = p_clinic_id and t.doctor_id = p_doctor_id and t.active
    union all
    select e.start_time, e.end_time from public.schedule_exceptions e
     where e.id = v_appointment.template_id and e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and not e.is_closed
  ) x limit 1;
  if v_segment.end_time is null or v_end_at > ((v_appointment.start_at at time zone 'Asia/Taipei')::date + v_segment.end_time) at time zone 'Asia/Taipei' then
    raise exception 'service duration exceeds schedule segment';
  end if;
  if exists (
    select 1 from public.appointments a where a.id <> v_id and a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
      and a.status in ('booked', 'confirmed', 'done') and a.start_at < v_end_at and a.end_at > v_appointment.start_at
  ) then raise exception 'service duration slot is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, v_appointment.start_at, v_end_at, v_id) then
    raise exception 'service resource is unavailable';
  end if;
  update public.appointments set end_at = v_end_at where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_time_slot_with_membership_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_membership_code text default null, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_membership_id uuid;
begin
  v_id := public.book_time_slot_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if nullif(trim(p_membership_code), '') is null then return v_id; end if;
  select id into v_membership_id from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code)) for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', v_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.service_booking_minutes(uuid, uuid, integer, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.get_available_slots_for_service(uuid, uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.book_time_slot_with_membership_for_service(uuid, uuid, uuid, timestamptz, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.service_booking_minutes(uuid, uuid, integer, text, boolean, integer) to service_role;
grant execute on function public.get_available_slots_for_service(uuid, uuid, date, text, uuid) to service_role;
grant execute on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid) to service_role;

grant execute on function public.book_time_slot_with_membership_for_service(uuid, uuid, uuid, timestamptz, text, boolean, text, uuid) to service_role;

create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null,
  p_terms_version integer default null, p_terms_accepted_at timestamptz default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  select * into r from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations
     set terms_version = p_terms_version, terms_accepted_at = p_terms_accepted_at
   where id = r.registration_id and clinic_id = p_clinic_id;
  return query select r.registration_id, r.registration_no, r.registration_status, r.payment_status, r.amount, r.discount_amount, r.membership_applied, r.checkin_token;
end;
$$;

-- Customer portal variant: link the verified browser/LINE patient inside the
-- same transaction as the registration and benefit reservation.
create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null,
  p_terms_version integer default null, p_terms_accepted_at timestamptz default null, p_patient_id uuid default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  if p_patient_id is not null and not exists (
    select 1 from public.patients
     where id = p_patient_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'patient is not valid for this brand';
  end if;

  select * into r from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations
     set terms_version = p_terms_version,
         terms_accepted_at = p_terms_accepted_at,
         patient_id = p_patient_id
   where id = r.registration_id and clinic_id = p_clinic_id;
  update public.discount_redemptions
     set patient_id = p_patient_id
   where clinic_id = p_clinic_id and registration_id = r.registration_id;
  return query select r.registration_id, r.registration_no, r.registration_status, r.payment_status, r.amount, r.discount_amount, r.membership_applied, r.checkin_token;
end;
$$;

create or replace function public.service_booking_minutes(
  p_clinic_id uuid,
  p_service_id uuid,
  p_base_minutes integer,
  p_visit_type text,
  p_first_visit_extends boolean,
  p_first_visit_minutes integer
)
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select greatest(
    coalesce((select s.duration_minutes + s.buffer_minutes from public.services s where s.id = p_service_id and s.clinic_id = p_clinic_id and s.active), p_base_minutes),
    case when p_visit_type = 'first' and p_first_visit_extends then coalesce(p_first_visit_minutes, p_base_minutes) else p_base_minutes end,
    1
  );
$$;

create or replace function public.get_available_slots_for_service(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_service_id uuid default null
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead integer := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30);
  v_first_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id = p_clinic_id), false);
  v_first_minutes integer := (select first_visit_minutes from public.clinic_settings where clinic_id = p_clinic_id);
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  for rec in
    select t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.doctor_id = p_doctor_id and t.weekday = v_weekday and t.active
       and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and e.date = p_date and e.is_closed and e.start_time is null)
    union all
    select e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and e.date = p_date and not e.is_closed
  loop
    v_slot_length := public.service_booking_minutes(p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes);
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as e
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::integer
      from candidate c
      left join public.appointments a on a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
        and a.status in ('booked', 'confirmed', 'done') and a.start_at < c.e and a.end_at > c.s
     where c.s > now() + (v_lead || ' minutes')::interval
       and not exists (
         select 1 from public.schedule_exceptions ec
          where ec.clinic_id = p_clinic_id and ec.doctor_id = p_doctor_id and ec.date = p_date and ec.is_closed and ec.start_time is not null
            and (c.s at time zone 'Asia/Taipei')::time < ec.end_time and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
       )
     group by c.s, c.e, rec.capacity
     having rec.capacity - count(a.id) > 0
     order by c.s;
  end loop;
end;
$$;

create or replace function public.book_time_slot_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_appointment record;
  v_settings record;
  v_segment record;
  v_end_at timestamptz;
  v_minutes integer;
begin
  v_id := public.book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is null then return v_id; end if;

  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  select * into v_appointment from public.appointments where id = v_id and clinic_id = p_clinic_id for update;
  v_minutes := public.service_booking_minutes(p_clinic_id, p_service_id,
    greatest(1, extract(epoch from (v_appointment.end_at - v_appointment.start_at))::integer / 60),
    p_visit_type, coalesce(v_settings.first_visit_extends, false), v_settings.first_visit_minutes);
  v_end_at := v_appointment.start_at + (v_minutes || ' minutes')::interval;

  select x.start_time, x.end_time into v_segment from (
    select t.start_time, t.end_time from public.schedule_templates t
     where t.id = v_appointment.template_id and t.clinic_id = p_clinic_id and t.doctor_id = p_doctor_id and t.active
    union all
    select e.start_time, e.end_time from public.schedule_exceptions e
     where e.id = v_appointment.template_id and e.clinic_id = p_clinic_id and e.doctor_id = p_doctor_id and not e.is_closed
  ) x limit 1;
  if v_segment.end_time is null or v_end_at > ((v_appointment.start_at at time zone 'Asia/Taipei')::date + v_segment.end_time) at time zone 'Asia/Taipei' then
    raise exception 'service duration exceeds schedule segment';
  end if;
  if exists (
    select 1 from public.appointments a where a.id <> v_id and a.clinic_id = p_clinic_id and a.doctor_id = p_doctor_id
      and a.status in ('booked', 'confirmed', 'done') and a.start_at < v_end_at and a.end_at > v_appointment.start_at
  ) then raise exception 'service duration slot is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, v_appointment.start_at, v_end_at, v_id) then
    raise exception 'service resource is unavailable';
  end if;
  update public.appointments set end_at = v_end_at where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_time_slot_with_membership_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_membership_code text default null, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_membership_id uuid;
begin
  v_id := public.book_time_slot_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if nullif(trim(p_membership_code), '') is null then return v_id; end if;
  select id into v_membership_id from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code)) for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', v_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.service_booking_minutes(uuid, uuid, integer, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.get_available_slots_for_service(uuid, uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.book_time_slot_with_membership_for_service(uuid, uuid, uuid, timestamptz, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.service_booking_minutes(uuid, uuid, integer, text, boolean, integer) to service_role;
grant execute on function public.get_available_slots_for_service(uuid, uuid, date, text, uuid) to service_role;
grant execute on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid) to service_role;
grant execute on function public.book_time_slot_with_membership_for_service(uuid, uuid, uuid, timestamptz, text, boolean, text, uuid) to service_role;
revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz) to service_role;
revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) to service_role;

-- Membership reminders are service-role only. The unique window prevents a
-- repeated cron run from sending the same low-balance or expiry notice twice.
create table if not exists public.membership_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_membership_id uuid not null references public.patient_memberships(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('low_balance', 'expiry')),
  channel text not null check (channel in ('line', 'email')),
  window_key text not null,
  status text not null check (status in ('claimed', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (patient_membership_id, kind, channel, window_key)
);
create index if not exists membership_notification_logs_clinic_idx
  on public.membership_notification_logs (clinic_id, created_at desc);
alter table public.membership_notification_logs enable row level security;
revoke all on table public.membership_notification_logs from public, anon, authenticated;

create or replace function public.get_membership_plan_price(p_clinic_id uuid, p_plan_id uuid, p_patient_id uuid default null)
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select price from public.membership_plan_level_prices price_rule
      join public.patients patient on patient.membership_level_id = price_rule.level_id and patient.id = p_patient_id and patient.clinic_id = p_clinic_id
     where price_rule.clinic_id = p_clinic_id and price_rule.plan_id = p_plan_id),
    (select price from public.membership_plans plan where plan.id = p_plan_id and plan.clinic_id = p_clinic_id)
  );
$$;
revoke all on function public.get_membership_plan_price(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_membership_plan_price(uuid, uuid, uuid) to service_role;

create or replace function public.service_resources_available(
  p_clinic_id uuid, p_service_id uuid, p_start_at timestamptz, p_end_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select not exists (
    select 1
      from public.service_resource_assignments required
      join public.service_resources resource on resource.id = required.resource_id and resource.clinic_id = required.clinic_id
     where required.clinic_id = p_clinic_id and required.service_id = p_service_id
       and (not resource.active or (
         select coalesce(sum(used.quantity), 0)
           from public.appointments appointment
           join public.service_resource_assignments used
             on used.clinic_id = appointment.clinic_id and used.service_id = appointment.service_id
            and used.resource_id = required.resource_id
          where appointment.clinic_id = p_clinic_id
            and appointment.status in ('booked', 'confirmed', 'done')
            and appointment.start_at < p_end_at and appointment.end_at > p_start_at
            and appointment.id is distinct from p_exclude_appointment_id
       ) + required.quantity > resource.capacity));
$$;

-- Shared resource capacity must be guarded by resource id, not only by
-- service id. This trigger covers every appointment write path, including
-- provider bookings, service-only bookings, admin writes and reschedules.
create or replace function public.enforce_appointment_resource_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  resource_row record;
begin
  if new.service_id is null or new.status not in ('booked', 'confirmed', 'done') then
    return new;
  end if;
  for resource_row in
    select assignment.resource_id
      from public.service_resource_assignments assignment
     where assignment.clinic_id = new.clinic_id
       and assignment.service_id = new.service_id
     order by assignment.resource_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('appointment-resource:' || new.clinic_id::text || ':' || resource_row.resource_id::text, 0)
    );
  end loop;
  if not public.service_resources_available(
    new.clinic_id, new.service_id, new.start_at, new.end_at, new.id
  ) then
    raise exception 'service resource is unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_resource_capacity on public.appointments;
create trigger trg_appointments_resource_capacity
before insert or update of clinic_id, service_id, start_at, end_at, status
on public.appointments
for each row execute function public.enforce_appointment_resource_capacity();
revoke all on function public.enforce_appointment_resource_capacity() from public, anon, authenticated;

create or replace function public.get_available_sessions_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_service_id uuid
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz, total integer, taken integer, remaining integer)
language sql
security definer
set search_path = public, extensions
as $$
  select session.template_id, session.session_start, session.session_end, session.total, session.taken, session.remaining
    from public.get_available_sessions(p_clinic_id, p_doctor_id, p_date) session
   where public.service_resources_available(p_clinic_id, p_service_id, session.session_start, session.session_end, null);
$$;

create or replace function public.book_number_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b record;
  appointment_row record;
begin
  select * into b from public.book_number(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id);
  select start_at, end_at into appointment_row from public.appointments where id = b.appointment_id and clinic_id = p_clinic_id;
  if p_service_id is not null and not public.service_resources_available(p_clinic_id, p_service_id, appointment_row.start_at, appointment_row.end_at, b.appointment_id) then
    raise exception 'service resource is unavailable';
  end if;
  return query select b.appointment_id, b.queue_number;
end;
$$;

create or replace function public.book_number_with_membership_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false,
  p_membership_code text default null, p_service_id uuid default null
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b record;
  v_membership_id uuid;
begin
  select * into b from public.book_number_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id);
  if nullif(trim(p_membership_code), '') is null then return query select b.appointment_id, b.queue_number; return; end if;
  select id into v_membership_id from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code)) for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', b.appointment_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = b.appointment_id and clinic_id = p_clinic_id;
  return query select b.appointment_id, b.queue_number;
end;
$$;

revoke all on function public.service_resources_available(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.get_available_sessions_for_service(uuid, uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.book_number_for_service(uuid, uuid, uuid, uuid, date, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.book_number_with_membership_for_service(uuid, uuid, uuid, uuid, date, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.service_resources_available(uuid, uuid, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.get_available_sessions_for_service(uuid, uuid, date, uuid) to service_role;
grant execute on function public.book_number_for_service(uuid, uuid, uuid, uuid, date, text, boolean, uuid) to service_role;
grant execute on function public.book_number_with_membership_for_service(uuid, uuid, uuid, uuid, date, text, boolean, text, uuid) to service_role;

drop policy if exists service_resource_assignments_tenant on public.service_resource_assignments;
create policy service_resource_assignments_tenant on public.service_resource_assignments for all to authenticated
  using (exists (select 1 from public.clinic_members member where member.clinic_id = service_resource_assignments.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')))
  with check (
    exists (select 1 from public.clinic_members member where member.clinic_id = service_resource_assignments.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin'))
    and exists (select 1 from public.services service where service.id = service_resource_assignments.service_id and service.clinic_id = service_resource_assignments.clinic_id)
    and exists (select 1 from public.service_resources resource where resource.id = service_resource_assignments.resource_id and resource.clinic_id = service_resource_assignments.clinic_id)
  );

create or replace function public.grant_paid_membership_from_order(
  p_clinic_id uuid,
  p_payment_order_id uuid
)
returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o record;
  plan_row record;
  existing record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  select po.id, po.status, po.clinic_id, po.patient_id, po.membership_plan_id
    into o
    from public.payment_orders po
   where po.id = p_payment_order_id and po.clinic_id = p_clinic_id
   for update;
  if not found or o.membership_plan_id is null or o.patient_id is null then
    raise exception 'membership payment order not found';
  end if;
  if o.status <> 'paid' then raise exception 'membership payment is not paid'; end if;
  select pm.id, pm.membership_code, pm.expires_at, pm.credits_remaining
    into existing
    from public.patient_memberships pm
   where pm.payment_order_id = p_payment_order_id;
  if found then
    return query select existing.id, existing.membership_code, existing.expires_at, existing.credits_remaining;
    return;
  end if;
  select * into plan_row from public.membership_plans
   where id = o.membership_plan_id and clinic_id = p_clinic_id;
  if not found then raise exception 'membership plan not found'; end if;
  if not exists (select 1 from public.patients where id = o.patient_id and clinic_id = p_clinic_id and active) then
    raise exception 'patient not found';
  end if;
  if plan_row.valid_days is not null then v_expires := now() + (plan_row.valid_days || ' days')::interval; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (select 1 from public.patient_memberships where clinic_id = p_clinic_id and membership_code = v_code);
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, payment_order_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
    values (p_clinic_id, o.patient_id, o.membership_plan_id, p_payment_order_id, v_code, plan_row.credits_total, plan_row.credits_total, now(), v_expires, 'purchase', 'membership payment purchase')
    returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, note)
    values (p_clinic_id, v_id, o.patient_id, 'grant', plan_row.credits_total, 'payment_order', p_payment_order_id, 'membership payment purchase');
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;
revoke all on function public.grant_paid_membership_from_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_paid_membership_from_order(uuid, uuid) to service_role;

create or replace function public.expire_pending_membership_payments()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n integer;
begin
  with expired_orders as (
    update public.payment_orders
       set status = 'expired', updated_at = now()
     where membership_plan_id is not null
       and patient_id is not null
       and status = 'pending'
       and expires_at is not null
       and expires_at <= now()
    returning id, clinic_id
  )
  insert into public.payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
    select clinic_id, id, 'pending', 'expired', 'membership_expiry'
      from expired_orders;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.expire_pending_membership_payments() from public, anon, authenticated;
grant execute on function public.expire_pending_membership_payments() to service_role;
-- Cross-industry booking foundation.
-- Existing doctor/provider booking remains compatible; service-only schedules may omit doctor_id.
begin;

alter table public.services
  add column if not exists booking_target text not null default 'provider_required';
alter table public.services
  add column if not exists booking_fields jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_booking_target_check') then
    alter table public.services add constraint services_booking_target_check
      check (booking_target in ('provider_required', 'provider_optional', 'resource_only')) not valid;
  end if;
end;
$$;

alter table public.schedule_templates alter column doctor_id drop not null;
alter table public.schedule_templates add column if not exists service_id uuid references public.services(id) on delete restrict;
alter table public.schedule_exceptions alter column doctor_id drop not null;
alter table public.schedule_exceptions add column if not exists service_id uuid references public.services(id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedule_templates_target_check') then
    alter table public.schedule_templates add constraint schedule_templates_target_check
      check (doctor_id is not null or service_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedule_exceptions_target_check') then
    alter table public.schedule_exceptions add constraint schedule_exceptions_target_check
      check (doctor_id is not null or service_id is not null) not valid;
  end if;
end;
$$;
drop index if exists public.uniq_sched_exc;
create unique index if not exists uniq_sched_exc
  on public.schedule_exceptions (
    clinic_id,
    coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    date,
    coalesce(start_time, '00:00'::time)
  );
create index if not exists schedule_templates_service_idx
  on public.schedule_templates (clinic_id, service_id, weekday, active, start_time);
create index if not exists schedule_exceptions_service_idx
  on public.schedule_exceptions (clinic_id, service_id, date, is_closed, start_time);

alter table public.appointments alter column doctor_id drop not null;
alter table public.appointments add column if not exists booking_answers jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_target_check') then
    alter table public.appointments add constraint appointments_target_check
      check (doctor_id is not null or service_id is not null) not valid;
  end if;
end;
$$;
create index if not exists appointments_service_start_idx
  on public.appointments (clinic_id, service_id, start_at);

create or replace function public.get_available_service_slots(
  p_clinic_id uuid,
  p_service_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_doctor_id uuid default null
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead integer := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30);
  v_first_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id = p_clinic_id), false);
  v_first_minutes integer := (select first_visit_minutes from public.clinic_settings where clinic_id = p_clinic_id);
  v_target text;
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select booking_target into v_target
    from public.services
   where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if v_target = 'provider_required' and p_doctor_id is null then raise exception 'provider is required for this service'; end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'provider not found'; end if;

  for rec in
    select t.id as template_id, t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.weekday = v_weekday and t.active
       and (t.service_id is null or t.service_id = p_service_id)
       and (
         (p_doctor_id is not null and t.doctor_id = p_doctor_id)
         or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id)
       )
       and not exists (
         select 1 from public.schedule_exceptions e
          where e.clinic_id = p_clinic_id and e.date = p_date and e.is_closed and e.start_time is null
            and (
              (p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id))
              or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
            )
       )
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
       and (
         (p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id))
         or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
       )
  loop
    v_slot_length := public.service_booking_minutes(
      p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes
    );
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as e
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select c.s, c.e, (rec.capacity - count(a.id))::integer
      from candidate c
      left join public.appointments a
        on a.clinic_id = p_clinic_id
       and a.status in ('booked', 'confirmed', 'done')
       and a.start_at < c.e and a.end_at > c.s
       and (
         (p_doctor_id is not null and a.doctor_id = p_doctor_id)
         or (p_doctor_id is null and a.doctor_id is null and a.service_id = p_service_id)
       )
     where c.s > now() + (v_lead || ' minutes')::interval
       and public.service_resources_available(p_clinic_id, p_service_id, c.s, c.e, null)
       and not exists (
         select 1 from public.schedule_exceptions ec
          where ec.clinic_id = p_clinic_id and ec.date = p_date and ec.is_closed and ec.start_time is not null
            and (
              (p_doctor_id is not null and ec.doctor_id = p_doctor_id and (ec.service_id is null or ec.service_id = p_service_id))
              or (p_doctor_id is null and ec.doctor_id is null and ec.service_id = p_service_id)
            )
            and (c.s at time zone 'Asia/Taipei')::time < ec.end_time
            and (c.e at time zone 'Asia/Taipei')::time > ec.start_time
       )
     group by c.s, c.e, rec.capacity
    having rec.capacity - count(a.id) > 0
     order by c.s;
  end loop;
end;
$$;

create or replace function public.get_available_service_sessions(
  p_clinic_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz, total integer, taken integer, remaining integer)
language sql
security definer
set search_path = public, extensions
as $$
  with sess as (
    select t.id, t.start_time, t.end_time, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.service_id = p_service_id and t.doctor_id is null
       and t.weekday = extract(dow from p_date) and t.active
       and not exists (
         select 1 from public.schedule_exceptions e
          where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null
            and e.date = p_date and e.is_closed
            and (e.start_time is null or (e.start_time < t.end_time and coalesce(e.end_time, '23:59:59.999999'::time) > t.start_time))
       )
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity, 40)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null
       and e.date = p_date and not e.is_closed
       and not exists (
         select 1 from public.schedule_exceptions closed
          where closed.clinic_id = p_clinic_id and closed.service_id = p_service_id and closed.doctor_id is null
            and closed.date = p_date and closed.is_closed
            and (closed.start_time is null or (e.start_time < coalesce(closed.end_time, '23:59:59.999999'::time) and coalesce(e.end_time, '23:59:59.999999'::time) > closed.start_time))
       )
  )
  select x.id,
         ((p_date + x.start_time) at time zone 'Asia/Taipei'),
         ((p_date + x.end_time) at time zone 'Asia/Taipei'),
         x.capacity,
         count(a.id)::integer,
         greatest(0, x.capacity - count(a.id))::integer
    from sess x
    left join public.appointments a
      on a.clinic_id = p_clinic_id and a.template_id = x.id
     and a.doctor_id is null and a.service_id = p_service_id
     and a.start_at = ((p_date + x.start_time) at time zone 'Asia/Taipei')
     and a.status in ('booked', 'confirmed', 'done')
   where ((p_date + x.start_time) at time zone 'Asia/Taipei') > now() + (
     coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30) || ' minutes'
   )::interval
     and public.service_resources_available(
       p_clinic_id, p_service_id,
       ((p_date + x.start_time) at time zone 'Asia/Taipei'),
       ((p_date + x.end_time) at time zone 'Asia/Taipei'), null
     )
   group by x.id, x.start_time, x.end_time, x.capacity
  having count(a.id) < x.capacity;
$$;

create or replace function public.book_service_slot(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_start_at timestamptz,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_booking_answers jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  st record;
  service_row record;
  segment record;
  v_date date := (p_start_at at time zone 'Asia/Taipei')::date;
  v_tod time := (p_start_at at time zone 'Asia/Taipei')::time;
  v_weekday smallint := extract(dow from p_start_at at time zone 'Asia/Taipei');
  v_len integer;
  v_end timestamptz;
  v_used integer;
  v_id uuid;
  v_dep boolean;
  v_match_count integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id = p_clinic_id;
  select * into service_row from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if service_row.booking_target = 'provider_required' then raise exception 'provider is required for this service'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and clinic_id = p_clinic_id and active) then raise exception 'customer not found'; end if;

  select count(*) into v_match_count
    from (
      select start_time, end_time, slot_minutes, capacity
        from public.schedule_templates
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and weekday = v_weekday and active
         and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = v_date and e.is_closed and e.start_time is null)
      union all
      select start_time, end_time, coalesce(slot_minutes, 15), coalesce(capacity, 1)
        from public.schedule_exceptions
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and date = v_date and not is_closed
    ) q
   where v_tod >= start_time and v_tod < end_time;
  if v_match_count = 0 then raise exception 'no available service schedule'; end if;
  if v_match_count > 1 then raise exception 'service schedules overlap'; end if;

  select * into segment
    from (
      select id as template_id, start_time, end_time, slot_minutes, capacity
        from public.schedule_templates
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and weekday = v_weekday and active
         and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = v_date and e.is_closed and e.start_time is null)
      union all
      select id, start_time, end_time, coalesce(slot_minutes, 15), coalesce(capacity, 1)
        from public.schedule_exceptions
       where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and date = v_date and not is_closed
    ) q
   where v_tod >= start_time and v_tod < end_time;
  v_len := public.service_booking_minutes(p_clinic_id, p_service_id, segment.slot_minutes, p_visit_type, coalesce(st.first_visit_extends, false), st.first_visit_minutes);
  v_end := p_start_at + (v_len || ' minutes')::interval;
  if v_end > ((v_date + segment.end_time) at time zone 'Asia/Taipei') then raise exception 'service duration exceeds schedule'; end if;
  if p_start_at < now() + (coalesce(st.min_lead_minutes, 30) || ' minutes')::interval then raise exception 'booking lead time exceeded'; end if;
  if v_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days, 30)) then raise exception 'booking window exceeded'; end if;
  if exists (
    select 1 from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = v_date and e.is_closed and e.start_time is not null
       and v_tod < coalesce(e.end_time, '23:59:59.999999'::time) and (v_end at time zone 'Asia/Taipei')::time > e.start_time
  ) then raise exception 'service schedule is closed'; end if;

  perform pg_advisory_xact_lock(hashtext('service-time:' || p_clinic_id::text || p_service_id::text || v_date::text));
  perform pg_advisory_xact_lock(hashtext('customer:' || p_clinic_id::text || p_patient_id::text || v_date::text));
  if exists (
    select 1 from public.appointments
     where clinic_id = p_clinic_id and patient_id = p_patient_id and status in ('booked', 'confirmed', 'done')
       and (start_at at time zone 'Asia/Taipei')::date = v_date
  ) then raise exception 'customer already has a booking on this date'; end if;
  select count(*) into v_used
    from public.appointments
   where clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null
     and status in ('booked', 'confirmed', 'done') and start_at < v_end and end_at > p_start_at;
  if v_used >= segment.capacity then raise exception 'service slot is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, p_start_at, v_end, null) then raise exception 'service resource is unavailable'; end if;
  v_dep := coalesce(st.deposit_enabled, false) and (st.deposit_scope = 'all' or (st.deposit_scope = 'self_pay' and p_is_self_pay));
  insert into public.appointments (
    clinic_id, doctor_id, patient_id, template_id, service_id, start_at, end_at, visit_type, is_self_pay, booking_answers,
    deposit_status, deposit_amount, deposit_expires_at
  ) values (
    p_clinic_id, null, p_patient_id, segment.template_id, p_service_id, p_start_at, v_end, p_visit_type, p_is_self_pay, coalesce(p_booking_answers, '{}'::jsonb),
    case when v_dep then 'pending' else 'none' end,
    case when v_dep then coalesce(st.deposit_amount, 0) else 0 end,
    case when v_dep then now() + interval '15 minutes' else null end
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.book_service_slot_with_membership(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_start_at timestamptz,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_membership_id uuid;
begin
  v_id := public.book_service_slot(p_clinic_id, p_service_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_booking_answers);
  if nullif(trim(p_membership_code), '') is null then return v_id; end if;
  select id into v_membership_id
    from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code))
   for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', v_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_service_session(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_template_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_booking_answers jsonb default '{}'::jsonb
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  st record;
  service_row record;
  session record;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_used integer;
  v_no integer;
  v_id uuid;
  v_dep boolean;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select * into st from public.clinic_settings where clinic_id = p_clinic_id;
  select * into service_row from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if service_row.booking_target = 'provider_required' then raise exception 'provider is required for this service'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and clinic_id = p_clinic_id and active) then raise exception 'customer not found'; end if;
  select * into session from (
    select id as template_id, start_time, end_time, capacity
      from public.schedule_templates
     where id = p_template_id and clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and weekday = extract(dow from p_date) and active
    union all
    select id, start_time, end_time, coalesce(capacity, 40)
      from public.schedule_exceptions
     where id = p_template_id and clinic_id = p_clinic_id and service_id = p_service_id and doctor_id is null and date = p_date and not is_closed
  ) q limit 1;
  if not found then raise exception 'service session does not match date'; end if;
  v_start_at := (p_date + session.start_time) at time zone 'Asia/Taipei';
  v_end_at := (p_date + session.end_time) at time zone 'Asia/Taipei';
  if v_start_at < now() + (coalesce(st.min_lead_minutes, 30) || ' minutes')::interval then raise exception 'booking lead time exceeded'; end if;
  if p_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(st.max_advance_days, 30)) then raise exception 'booking window exceeded'; end if;
  if exists (
    select 1 from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.service_id = p_service_id and e.doctor_id is null and e.date = p_date and e.is_closed
       and (e.start_time is null or (e.start_time < session.end_time and coalesce(e.end_time, '23:59:59.999999'::time) > session.start_time))
  ) then raise exception 'service session is closed'; end if;
  perform pg_advisory_xact_lock(hashtext('service-session:' || p_clinic_id::text || p_template_id::text || p_date::text));
  perform pg_advisory_xact_lock(hashtext('customer:' || p_clinic_id::text || p_patient_id::text || p_date::text));
  if exists (
    select 1 from public.appointments
     where clinic_id = p_clinic_id and patient_id = p_patient_id and status in ('booked', 'confirmed', 'done')
       and (start_at at time zone 'Asia/Taipei')::date = p_date
  ) then raise exception 'customer already has a booking on this date'; end if;
  select count(*) filter (where a.status in ('booked', 'confirmed', 'done')), coalesce(max(a.queue_number), 0)
    into v_used, v_no
    from public.appointments a
   where a.clinic_id = p_clinic_id and a.template_id = p_template_id and a.doctor_id is null and a.service_id = p_service_id and a.start_at = v_start_at;
  if v_used >= session.capacity then raise exception 'service session is full'; end if;
  if not public.service_resources_available(p_clinic_id, p_service_id, v_start_at, v_end_at, null) then raise exception 'service resource is unavailable'; end if;
  v_no := v_no + 1;
  v_dep := coalesce(st.deposit_enabled, false) and (st.deposit_scope = 'all' or (st.deposit_scope = 'self_pay' and p_is_self_pay));
  insert into public.appointments (
    clinic_id, doctor_id, patient_id, template_id, service_id, start_at, end_at, visit_type, queue_number, is_self_pay, booking_answers,
    deposit_status, deposit_amount, deposit_expires_at
  ) values (
    p_clinic_id, null, p_patient_id, p_template_id, p_service_id, v_start_at, v_end_at, p_visit_type, v_no, p_is_self_pay, coalesce(p_booking_answers, '{}'::jsonb),
    case when v_dep then 'pending' else 'none' end,
    case when v_dep then coalesce(st.deposit_amount, 0) else 0 end,
    case when v_dep then now() + interval '15 minutes' else null end
  ) returning id into v_id;
  return query select v_id, v_no;
end;
$$;

create or replace function public.book_service_session_with_membership(
  p_clinic_id uuid,
  p_service_id uuid,
  p_patient_id uuid,
  p_template_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_row record;
  v_membership_id uuid;
begin
  select * into base_row from public.book_service_session(p_clinic_id, p_service_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_booking_answers);
  if nullif(trim(p_membership_code), '') is null then return query select base_row.appointment_id, base_row.queue_number; return; end if;
  select id into v_membership_id
    from public.patient_memberships
   where clinic_id = p_clinic_id and patient_id = p_patient_id and membership_code = upper(trim(p_membership_code))
   for update;
  if not found then raise exception 'membership code is invalid'; end if;
  perform public.consume_membership_credit(p_clinic_id, v_membership_id, 'appointment', 'appointment', base_row.appointment_id, p_service_id, null, 'appointment membership redemption');
  update public.appointments set membership_id = v_membership_id, deposit_status = 'waived', deposit_amount = 0, service_id = p_service_id where id = base_row.appointment_id and clinic_id = p_clinic_id;
  return query select base_row.appointment_id, base_row.queue_number;
end;
$$;

create or replace function public.cancel_registration_for_customer(
  p_clinic_id uuid,
  p_registration_id uuid,
  p_patient_id uuid
)
returns table (registration_id uuid, registration_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_patient_id is null or not exists (
    select 1 from public.registrations
     where id = p_registration_id and clinic_id = p_clinic_id and patient_id = p_patient_id
  ) then raise exception 'registration customer does not match'; end if;
  return query select * from public.cancel_registration_by_id(p_clinic_id, p_registration_id, null);
end;
$$;

revoke all on function public.get_available_service_slots(uuid, uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.get_available_service_sessions(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.book_service_slot(uuid, uuid, uuid, timestamptz, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.book_service_slot_with_membership(uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.book_service_session(uuid, uuid, uuid, uuid, date, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.book_service_session_with_membership(uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_registration_for_customer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_available_service_slots(uuid, uuid, date, text, uuid) to service_role;
grant execute on function public.get_available_service_sessions(uuid, uuid, date) to service_role;
grant execute on function public.book_service_slot(uuid, uuid, uuid, timestamptz, text, boolean, jsonb) to service_role;
grant execute on function public.book_service_slot_with_membership(uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb) to service_role;
grant execute on function public.book_service_session(uuid, uuid, uuid, uuid, date, text, boolean, jsonb) to service_role;
grant execute on function public.book_service_session_with_membership(uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb) to service_role;
grant execute on function public.cancel_registration_for_customer(uuid, uuid, uuid) to service_role;

commit;

-- Forward declarations for the later checkout replay. Customer value functions below
-- reference these tables, while the complete indexes, policies and RPCs are replayed last.
create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  order_no text not null default ('SO-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  appointment_id uuid references public.appointments(id) on delete restrict, registration_id uuid references public.registrations(id) on delete restrict,
  patient_id uuid references public.patients(id) on delete restrict, status text not null default 'open' check (status in ('open','partially_paid','paid','void')),
  subtotal integer not null default 0 check (subtotal >= 0), discount_amount integer not null default 0 check (discount_amount >= 0), total_amount integer not null default 0 check (total_amount >= 0),
  paid_amount integer not null default 0 check (paid_amount >= 0), note text, created_by uuid references auth.users(id) on delete set null, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (clinic_id, order_no),
  check (not (appointment_id is not null and registration_id is not null)), check (discount_amount <= subtotal), check (total_amount = subtotal - discount_amount), check (paid_amount <= total_amount)
);
create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict, order_id uuid not null references public.sales_orders(id) on delete restrict,
  kind text not null check (kind in ('service','product','package','custom')), reference_id uuid, name text not null, quantity numeric(12,2) not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0), line_total integer not null check (line_total >= 0), created_at timestamptz not null default now()
);
create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict, order_id uuid not null references public.sales_orders(id) on delete restrict,
  method text not null check (method in ('cash','card','transfer','online','other')), amount integer not null check (amount > 0), reference text,
  received_at timestamptz not null default now(), actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

-- Customer value accounts, subscriptions, safe customer merge and scheduled follow-ups.
-- Canonical implementation: supabase/migrations/202609040002_customer_value_and_followups.sql
begin;
alter table public.patients add column if not exists merged_into_patient_id uuid references public.patients(id) on delete restrict;
alter table public.patients add column if not exists merged_at timestamptz;
create index if not exists patients_merged_into_idx on public.patients(clinic_id,merged_into_patient_id) where merged_into_patient_id is not null;
create table if not exists public.customer_wallets(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,balance integer not null default 0 check(balance>=0),lifetime_credit integer not null default 0 check(lifetime_credit>=0),lifetime_debit integer not null default 0 check(lifetime_debit>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(clinic_id,patient_id));
create table if not exists public.customer_wallet_ledger(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,wallet_id uuid not null references public.customer_wallets(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,kind text not null check(kind in('top_up','purchase','refund','adjust','merge')),amount_delta integer not null check(amount_delta<>0),balance_after integer not null check(balance_after>=0),sales_order_id uuid references public.sales_orders(id) on delete restrict,idempotency_key text,note text,actor_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create unique index if not exists customer_wallet_ledger_idempotency_idx on public.customer_wallet_ledger(clinic_id,idempotency_key) where idempotency_key is not null;create index if not exists customer_wallet_ledger_patient_idx on public.customer_wallet_ledger(clinic_id,patient_id,created_at desc);
create table if not exists public.loyalty_accounts(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,points_balance integer not null default 0 check(points_balance>=0),lifetime_earned integer not null default 0 check(lifetime_earned>=0),lifetime_redeemed integer not null default 0 check(lifetime_redeemed>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(clinic_id,patient_id));
create table if not exists public.loyalty_ledger(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,account_id uuid not null references public.loyalty_accounts(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,kind text not null check(kind in('earn','redeem','expire','adjust','merge')),points_delta integer not null check(points_delta<>0),balance_after integer not null check(balance_after>=0),sales_order_id uuid references public.sales_orders(id) on delete restrict,idempotency_key text,note text,actor_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create unique index if not exists loyalty_ledger_idempotency_idx on public.loyalty_ledger(clinic_id,idempotency_key) where idempotency_key is not null;create index if not exists loyalty_ledger_patient_idx on public.loyalty_ledger(clinic_id,patient_id,created_at desc);
create table if not exists public.subscription_plans(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,name text not null,description text,price integer not null default 0 check(price>=0),billing_interval text not null default 'monthly' check(billing_interval in('monthly','quarterly','yearly')),included_credits integer not null default 0 check(included_credits>=0),benefits jsonb not null default '[]'::jsonb,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(jsonb_typeof(benefits)='array'));
create index if not exists subscription_plans_clinic_idx on public.subscription_plans(clinic_id,active,created_at desc);
create table if not exists public.patient_subscriptions(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,plan_id uuid not null references public.subscription_plans(id) on delete restrict,status text not null default 'active' check(status in('active','paused','past_due','cancelled')),started_at timestamptz not null default now(),current_period_start timestamptz not null default now(),current_period_end timestamptz not null,next_billing_at timestamptz,paused_at timestamptz,cancelled_at timestamptz,external_subscription_ref text,note text,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index if not exists patient_subscriptions_active_plan_idx on public.patient_subscriptions(clinic_id,patient_id,plan_id) where status in('active','paused','past_due');create index if not exists patient_subscriptions_due_idx on public.patient_subscriptions(clinic_id,status,next_billing_at);
create table if not exists public.scheduled_followups(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,channel text not null check(channel in('line','email','phone','manual')),purpose text not null default 'service' check(purpose in('service','marketing')),subject text,body text not null,scheduled_for timestamptz not null,status text not null default 'pending' check(status in('pending','processing','sent','completed','failed','cancelled')),attempt_count integer not null default 0 check(attempt_count>=0),last_error text,assigned_to uuid references auth.users(id) on delete set null,created_by uuid references auth.users(id) on delete set null,processed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists scheduled_followups_due_idx on public.scheduled_followups(clinic_id,status,scheduled_for);create index if not exists scheduled_followups_patient_idx on public.scheduled_followups(clinic_id,patient_id,scheduled_for desc);
create table if not exists public.customer_merge_logs(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,source_patient_id uuid not null references public.patients(id) on delete restrict,target_patient_id uuid not null references public.patients(id) on delete restrict,actor_id uuid references auth.users(id) on delete set null,snapshot jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),check(source_patient_id<>target_patient_id));create index if not exists customer_merge_logs_clinic_idx on public.customer_merge_logs(clinic_id,created_at desc);
do $$ declare tbl text;begin foreach tbl in array array['customer_wallets','customer_wallet_ledger','loyalty_accounts','loyalty_ledger','subscription_plans','patient_subscriptions','scheduled_followups','customer_merge_logs'] loop execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on table public.%I from public, anon, authenticated',tbl);execute format('grant select on table public.%I to authenticated',tbl);execute format('grant all on table public.%I to service_role',tbl);execute format('drop policy if exists %I on public.%I',tbl||'_member_read',tbl);execute format($p$create policy %I on public.%I for select to authenticated using(exists(select 1 from public.clinic_members member where member.clinic_id=%I.clinic_id and member.user_id=auth.uid() and member.role<>'provider'))$p$,tbl||'_member_read',tbl,tbl);end loop;end $$;
drop trigger if exists trg_customer_wallets_touch on public.customer_wallets;create trigger trg_customer_wallets_touch before update on public.customer_wallets for each row execute function public.touch_updated_at();drop trigger if exists trg_loyalty_accounts_touch on public.loyalty_accounts;create trigger trg_loyalty_accounts_touch before update on public.loyalty_accounts for each row execute function public.touch_updated_at();drop trigger if exists trg_subscription_plans_touch on public.subscription_plans;create trigger trg_subscription_plans_touch before update on public.subscription_plans for each row execute function public.touch_updated_at();drop trigger if exists trg_patient_subscriptions_touch on public.patient_subscriptions;create trigger trg_patient_subscriptions_touch before update on public.patient_subscriptions for each row execute function public.touch_updated_at();drop trigger if exists trg_scheduled_followups_touch on public.scheduled_followups;create trigger trg_scheduled_followups_touch before update on public.scheduled_followups for each row execute function public.touch_updated_at();
create or replace function public.adjust_customer_wallet(p_clinic_id uuid,p_actor_user_id uuid,p_patient_id uuid,p_amount_delta integer,p_kind text,p_note text default null,p_sales_order_id uuid default null,p_idempotency_key text default null) returns integer language plpgsql security definer set search_path=public,extensions as $$ declare wallet public.customer_wallets%rowtype;new_balance integer;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'wallet actor is not allowed';end if;if p_amount_delta=0 or p_kind not in('top_up','purchase','refund','adjust','merge') then raise exception 'invalid wallet movement';end if;if not exists(select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id and patient.active) then raise exception 'wallet patient not found';end if;if p_sales_order_id is not null and not exists(select 1 from public.sales_orders sales_order where sales_order.id=p_sales_order_id and sales_order.clinic_id=p_clinic_id and sales_order.patient_id=p_patient_id) then raise exception 'wallet sales order not found';end if;if p_idempotency_key is not null and exists(select 1 from public.customer_wallet_ledger ledger where ledger.clinic_id=p_clinic_id and ledger.idempotency_key=p_idempotency_key) then select balance into new_balance from public.customer_wallets where clinic_id=p_clinic_id and patient_id=p_patient_id;return new_balance;end if;insert into public.customer_wallets(clinic_id,patient_id) values(p_clinic_id,p_patient_id) on conflict(clinic_id,patient_id) do nothing;select * into wallet from public.customer_wallets where clinic_id=p_clinic_id and patient_id=p_patient_id for update;new_balance:=wallet.balance+p_amount_delta;if new_balance<0 then raise exception 'insufficient wallet balance';end if;update public.customer_wallets set balance=new_balance,lifetime_credit=lifetime_credit+greatest(p_amount_delta,0),lifetime_debit=lifetime_debit+greatest(-p_amount_delta,0) where id=wallet.id;insert into public.customer_wallet_ledger(clinic_id,wallet_id,patient_id,kind,amount_delta,balance_after,sales_order_id,idempotency_key,note,actor_id) values(p_clinic_id,wallet.id,p_patient_id,p_kind,p_amount_delta,new_balance,p_sales_order_id,nullif(btrim(p_idempotency_key),''),nullif(btrim(p_note),''),p_actor_user_id);return new_balance;end;$$;revoke all on function public.adjust_customer_wallet(uuid,uuid,uuid,integer,text,text,uuid,text) from public,anon,authenticated;grant execute on function public.adjust_customer_wallet(uuid,uuid,uuid,integer,text,text,uuid,text) to service_role;
create or replace function public.adjust_loyalty_points(p_clinic_id uuid,p_actor_user_id uuid,p_patient_id uuid,p_points_delta integer,p_kind text,p_note text default null,p_sales_order_id uuid default null,p_idempotency_key text default null) returns integer language plpgsql security definer set search_path=public,extensions as $$ declare account public.loyalty_accounts%rowtype;new_balance integer;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'points actor is not allowed';end if;if p_points_delta=0 or p_kind not in('earn','redeem','expire','adjust','merge') then raise exception 'invalid points movement';end if;if not exists(select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id and patient.active) then raise exception 'points patient not found';end if;if p_sales_order_id is not null and not exists(select 1 from public.sales_orders sales_order where sales_order.id=p_sales_order_id and sales_order.clinic_id=p_clinic_id and sales_order.patient_id=p_patient_id) then raise exception 'points sales order not found';end if;if p_idempotency_key is not null and exists(select 1 from public.loyalty_ledger ledger where ledger.clinic_id=p_clinic_id and ledger.idempotency_key=p_idempotency_key) then select points_balance into new_balance from public.loyalty_accounts where clinic_id=p_clinic_id and patient_id=p_patient_id;return new_balance;end if;insert into public.loyalty_accounts(clinic_id,patient_id) values(p_clinic_id,p_patient_id) on conflict(clinic_id,patient_id) do nothing;select * into account from public.loyalty_accounts where clinic_id=p_clinic_id and patient_id=p_patient_id for update;new_balance:=account.points_balance+p_points_delta;if new_balance<0 then raise exception 'insufficient points balance';end if;update public.loyalty_accounts set points_balance=new_balance,lifetime_earned=lifetime_earned+greatest(p_points_delta,0),lifetime_redeemed=lifetime_redeemed+greatest(-p_points_delta,0) where id=account.id;insert into public.loyalty_ledger(clinic_id,account_id,patient_id,kind,points_delta,balance_after,sales_order_id,idempotency_key,note,actor_id) values(p_clinic_id,account.id,p_patient_id,p_kind,p_points_delta,new_balance,p_sales_order_id,nullif(btrim(p_idempotency_key),''),nullif(btrim(p_note),''),p_actor_user_id);return new_balance;end;$$;revoke all on function public.adjust_loyalty_points(uuid,uuid,uuid,integer,text,text,uuid,text) from public,anon,authenticated;grant execute on function public.adjust_loyalty_points(uuid,uuid,uuid,integer,text,text,uuid,text) to service_role;
create or replace function public.create_patient_subscription(p_clinic_id uuid,p_actor_user_id uuid,p_patient_id uuid,p_plan_id uuid,p_note text default null) returns uuid language plpgsql security definer set search_path=public,extensions as $$ declare plan public.subscription_plans%rowtype;sub_id uuid;period_end timestamptz;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'subscription actor is not allowed';end if;if not exists(select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id and patient.active) then raise exception 'subscription patient not found';end if;select * into plan from public.subscription_plans where id=p_plan_id and clinic_id=p_clinic_id and active;if not found then raise exception 'subscription plan not found';end if;period_end:=now()+case plan.billing_interval when'monthly'then interval'1 month' when'quarterly'then interval'3 months' else interval'1 year'end;insert into public.patient_subscriptions(clinic_id,patient_id,plan_id,current_period_end,next_billing_at,note,created_by) values(p_clinic_id,p_patient_id,p_plan_id,period_end,period_end,nullif(btrim(p_note),''),p_actor_user_id) returning id into sub_id;return sub_id;end;$$;revoke all on function public.create_patient_subscription(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;grant execute on function public.create_patient_subscription(uuid,uuid,uuid,uuid,text) to service_role;
create or replace function public.set_patient_subscription_status(p_clinic_id uuid,p_actor_user_id uuid,p_subscription_id uuid,p_status text) returns text language plpgsql security definer set search_path=public,extensions as $$ declare current_row public.patient_subscriptions%rowtype;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'subscription actor is not allowed';end if;if p_status not in('active','paused','cancelled') then raise exception 'invalid subscription status';end if;select * into current_row from public.patient_subscriptions where id=p_subscription_id and clinic_id=p_clinic_id for update;if not found then raise exception 'subscription not found';end if;if current_row.status='cancelled' then raise exception 'cancelled subscription cannot be changed';end if;update public.patient_subscriptions set status=p_status,paused_at=case when p_status='paused'then now()else null end,cancelled_at=case when p_status='cancelled'then now()else null end,next_billing_at=case when p_status='active'then current_period_end when p_status='cancelled'then null else next_billing_at end where id=p_subscription_id;return p_status;end;$$;revoke all on function public.set_patient_subscription_status(uuid,uuid,uuid,text) from public,anon,authenticated;grant execute on function public.set_patient_subscription_status(uuid,uuid,uuid,text) to service_role;
-- merge_customers, claim_due_scheduled_followups and finish_scheduled_followup are kept byte-for-byte in the canonical migration above.
-- They are appended below so a fresh schema replay has the same behavior.
create or replace function public.claim_due_scheduled_followups(p_limit integer default 50) returns setof public.scheduled_followups language sql security definer set search_path=public,extensions as $$ with due as(select id from public.scheduled_followups where status='pending' and channel in('line','email') and scheduled_for<=now() order by scheduled_for for update skip locked limit greatest(1,least(p_limit,200))) update public.scheduled_followups followup set status='processing',attempt_count=followup.attempt_count+1,updated_at=now() from due where followup.id=due.id returning followup.*;$$;revoke all on function public.claim_due_scheduled_followups(integer) from public,anon,authenticated;grant execute on function public.claim_due_scheduled_followups(integer) to service_role;
create or replace function public.finish_scheduled_followup(p_followup_id uuid,p_status text,p_error text default null) returns void language plpgsql security definer set search_path=public,extensions as $$ begin if p_status not in('sent','failed')then raise exception'invalid follow-up result';end if;update public.scheduled_followups set status=p_status,last_error=case when p_status='failed'then left(p_error,1000)else null end,processed_at=case when p_status='sent'then now()else processed_at end where id=p_followup_id and status='processing';if not found then raise exception'follow-up claim not found';end if;end;$$;revoke all on function public.finish_scheduled_followup(uuid,text,text) from public,anon,authenticated;grant execute on function public.finish_scheduled_followup(uuid,text,text) to service_role;
commit;

-- Optional beauty operations module: treatment records, private photo references,
-- inventory ledger, and fixed per-service incentive estimates.
begin;

alter table public.clinic_settings add column if not exists beauty_operations_enabled boolean not null default false;
alter table public.patient_records add column if not exists record_type text not null default 'general';
alter table public.patient_records add column if not exists appointment_id uuid references public.appointments(id) on delete restrict;
alter table public.patient_records add column if not exists treatment_name text;
alter table public.patient_records add column if not exists assessment text;
alter table public.patient_records add column if not exists aftercare text;
alter table public.patient_records add column if not exists private_photo_paths text[] not null default '{}';
alter table public.patient_records add column if not exists photo_consent boolean not null default false;
alter table public.patient_records add column if not exists recorded_by uuid references auth.users(id) on delete set null;
alter table public.patient_records add column if not exists updated_at timestamptz not null default now();
alter table public.patient_records drop constraint if exists patient_records_record_type_check;
alter table public.patient_records add constraint patient_records_record_type_check check (record_type in ('general','beauty_treatment'));
create index if not exists patient_records_appointment_idx on public.patient_records (clinic_id, appointment_id, created_at desc);
drop trigger if exists trg_patient_records_touch on public.patient_records;
create trigger trg_patient_records_touch before update on public.patient_records for each row execute function public.touch_updated_at();

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  sku text, name text not null, unit text not null default '件',
  stock_on_hand numeric(12,2) not null default 0 check (stock_on_hand >= 0),
  reorder_level numeric(12,2) not null default 0 check (reorder_level >= 0),
  retail_price integer not null default 0 check (retail_price >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (clinic_id, sku)
);
create index if not exists inventory_items_clinic_idx on public.inventory_items (clinic_id, active, name);
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  kind text not null check (kind in ('stock_in','use','sale','waste')), quantity numeric(12,2) not null check (quantity > 0),
  stock_after numeric(12,2) not null check (stock_after >= 0), note text, actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements (clinic_id, item_id, created_at desc);
create table if not exists public.beauty_commission_rules (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  doctor_id uuid not null references public.doctors(id) on delete restrict, service_id uuid references public.services(id) on delete restrict,
  amount_per_service integer not null default 0 check (amount_per_service >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists beauty_commission_rules_general_idx on public.beauty_commission_rules (clinic_id, doctor_id) where service_id is null;
create unique index if not exists beauty_commission_rules_service_idx on public.beauty_commission_rules (clinic_id, doctor_id, service_id) where service_id is not null;
drop trigger if exists trg_inventory_items_touch on public.inventory_items;
create trigger trg_inventory_items_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
drop trigger if exists trg_beauty_commission_rules_touch on public.beauty_commission_rules;
create trigger trg_beauty_commission_rules_touch before update on public.beauty_commission_rules for each row execute function public.touch_updated_at();

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.beauty_commission_rules enable row level security;
revoke all on table public.inventory_items from public, anon;
revoke all on table public.inventory_movements from public, anon;
revoke all on table public.beauty_commission_rules from public, anon;
do $$ declare tbl text; begin
  foreach tbl in array array['inventory_items','inventory_movements','beauty_commission_rules'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$create policy %I on public.%I for all to authenticated
      using (clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
      with check (clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))$policy$, tbl || '_member', tbl, tbl, tbl);
  end loop;
end $$;

create or replace function public.record_inventory_movement(p_clinic_id uuid, p_item_id uuid, p_kind text, p_quantity numeric, p_note text, p_actor_user_id uuid) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
declare item_row record; new_stock numeric;
begin
  if p_kind not in ('stock_in','use','sale','waste') or p_quantity <= 0 then raise exception 'invalid inventory movement'; end if;
  if not exists (select 1 from clinic_members where clinic_id=p_clinic_id and user_id=p_actor_user_id and role <> 'provider') then raise exception 'inventory actor is not allowed'; end if;
  select * into item_row from inventory_items where id=p_item_id and clinic_id=p_clinic_id and active for update;
  if not found then raise exception 'inventory item not found'; end if;
  new_stock := item_row.stock_on_hand + case when p_kind='stock_in' then p_quantity else -p_quantity end;
  if new_stock < 0 then raise exception 'insufficient inventory'; end if;
  update inventory_items set stock_on_hand=new_stock, updated_at=now() where id=p_item_id;
  insert into inventory_movements (clinic_id,item_id,kind,quantity,stock_after,note,actor_id) values (p_clinic_id,p_item_id,p_kind,p_quantity,new_stock,nullif(btrim(p_note),''),p_actor_user_id);
  return new_stock;
end; $$;
revoke all on function public.record_inventory_movement(uuid,uuid,text,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.record_inventory_movement(uuid,uuid,text,numeric,text,uuid) to service_role;

commit;

-- Compatibility replay of migration 202608120001: time-mode service bookings must
-- resolve their schedule segment without relying on appointments.template_id.

-- Fix time-mode service bookings: book_time_slot does not persist template_id,
-- so the service wrapper must resolve the already-validated schedule segment
-- from the appointment's Taipei date and time.
begin;

create or replace function public.book_time_slot_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_appointment record;
  v_settings record;
  v_segment record;
  v_end_at timestamptz;
  v_minutes integer;
  v_date date;
  v_time time;
begin
  v_id := public.book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is null then return v_id; end if;

  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  select * into v_appointment from public.appointments where id = v_id and clinic_id = p_clinic_id for update;
  v_minutes := public.service_booking_minutes(
    p_clinic_id,
    p_service_id,
    greatest(1, extract(epoch from (v_appointment.end_at - v_appointment.start_at))::integer / 60),
    p_visit_type,
    coalesce(v_settings.first_visit_extends, false),
    v_settings.first_visit_minutes
  );
  v_end_at := v_appointment.start_at + (v_minutes || ' minutes')::interval;
  v_date := (v_appointment.start_at at time zone 'Asia/Taipei')::date;
  v_time := (v_appointment.start_at at time zone 'Asia/Taipei')::time;

  select segment.start_time, segment.end_time
    into v_segment
    from (
      select template.start_time, template.end_time
        from public.schedule_templates template
       where template.clinic_id = p_clinic_id
         and template.doctor_id = p_doctor_id
         and template.weekday = extract(dow from v_date)
         and template.active
         and v_time >= template.start_time
         and v_time < template.end_time
         and not exists (
           select 1
             from public.schedule_exceptions exception
            where exception.clinic_id = p_clinic_id
              and exception.doctor_id = p_doctor_id
              and exception.date = v_date
              and exception.is_closed
              and exception.start_time is null
         )
      union all
      select exception.start_time, exception.end_time
        from public.schedule_exceptions exception
       where exception.clinic_id = p_clinic_id
         and exception.doctor_id = p_doctor_id
         and exception.date = v_date
         and not exception.is_closed
         and v_time >= exception.start_time
         and v_time < exception.end_time
    ) segment
   limit 1;

  if v_segment.end_time is null
     or v_end_at > ((v_date + v_segment.end_time) at time zone 'Asia/Taipei') then
    raise exception 'service duration exceeds schedule segment';
  end if;
  if exists (
    select 1
      from public.appointments appointment
     where appointment.id <> v_id
       and appointment.clinic_id = p_clinic_id
       and appointment.doctor_id = p_doctor_id
       and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < v_end_at
       and appointment.end_at > v_appointment.start_at
  ) then
    raise exception 'service duration slot is full';
  end if;
  if not public.service_resources_available(
    p_clinic_id,
    p_service_id,
    v_appointment.start_at,
    v_end_at,
    v_id
  ) then
    raise exception 'service resource is unavailable';
  end if;

  update public.appointments
     set end_at = v_end_at
   where id = v_id
     and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid)
  to service_role;

commit;



-- Compatibility replay of migration 202608120002 after the legacy RLS definitions.
-- Break the provider patients <-> appointments RLS recursion while preserving
-- assignment-scoped access. The explicit caller check prevents using the helper
-- to probe another authenticated user's assignments.
begin;

create or replace function public.provider_has_patient_assignment(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_user_id = auth.uid()
    and exists (
      select 1
        from public.appointments appointment
        join public.doctor_assignments assignment
          on assignment.clinic_id = appointment.clinic_id
         and assignment.doctor_id = appointment.doctor_id
       where appointment.clinic_id = p_clinic_id
         and appointment.patient_id = p_patient_id
         and assignment.user_id = p_user_id
         and assignment.active
    );
$$;

revoke all on function public.provider_has_patient_assignment(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.provider_has_patient_assignment(uuid, uuid, uuid)
  to authenticated, service_role;

drop policy if exists patients_provider_read on public.patients;
create policy patients_provider_read on public.patients for select to authenticated
  using (
    patients.clinic_id in (
      select member.clinic_id
        from public.clinic_members member
       where member.user_id = auth.uid()
    )
    and (
      exists (
        select 1
          from public.clinic_members member
         where member.clinic_id = patients.clinic_id
           and member.user_id = auth.uid()
           and member.role <> 'provider'
      )
      or public.provider_has_patient_assignment(patients.clinic_id, patients.id, auth.uid())
    )
  );

drop policy if exists patient_records_provider_read on public.patient_records;
create policy patient_records_provider_read on public.patient_records for select to authenticated
  using (
    patient_records.clinic_id in (
      select member.clinic_id
        from public.clinic_members member
       where member.user_id = auth.uid()
    )
    and (
      exists (
        select 1
          from public.clinic_members member
         where member.clinic_id = patient_records.clinic_id
           and member.user_id = auth.uid()
           and member.role <> 'provider'
      )
      or public.provider_has_patient_assignment(
        patient_records.clinic_id,
        patient_records.patient_id,
        auth.uid()
      )
    )
  );

commit;



-- Product restructure M2: appointment waitlist for time and number bookings.
-- Event registration waitlist_entries remains a separate domain.
begin;

create table if not exists public.appointment_waitlist_entries (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  service_id uuid references public.services(id) on delete restrict, doctor_id uuid references public.doctors(id) on delete restrict,
  booking_mode text not null check (booking_mode in ('time', 'number')), template_id uuid,
  requested_date date not null, requested_start_at timestamptz,
  visit_type text not null default 'return' check (visit_type in ('first', 'return')),
  is_self_pay boolean not null default false, booking_answers jsonb not null default '{}'::jsonb,
  target_key text not null, position integer not null check (position > 0),
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  appointment_id uuid references public.appointments(id) on delete restrict,
  offered_at timestamptz, offer_expires_at timestamptz,
  source text not null default 'online' check (source in ('online', 'admin', 'line')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(booking_answers) = 'object'),
  check ((booking_mode = 'time' and requested_start_at is not null and template_id is null) or (booking_mode = 'number' and requested_start_at is null and template_id is not null)),
  check ((status = 'offered' and appointment_id is not null and offer_expires_at is not null) or status <> 'offered'),
  check ((status = 'booked' and appointment_id is not null) or status <> 'booked')
);
create unique index if not exists appointment_waitlist_active_patient_target_idx on public.appointment_waitlist_entries (clinic_id, patient_id, target_key) where status in ('waiting', 'offered');
create index if not exists appointment_waitlist_target_position_idx on public.appointment_waitlist_entries (clinic_id, target_key, status, position);
create index if not exists appointment_waitlist_offer_expiry_idx on public.appointment_waitlist_entries (offer_expires_at) where status = 'offered';
alter table public.appointments add column if not exists waitlist_entry_id uuid;
do $$ begin alter table public.appointments add constraint appointments_waitlist_entry_fkey foreign key (waitlist_entry_id) references public.appointment_waitlist_entries(id) on delete restrict; exception when duplicate_object then null; end $$;
create unique index if not exists appointments_waitlist_entry_unique_idx on public.appointments (waitlist_entry_id) where waitlist_entry_id is not null;

create table if not exists public.appointment_waitlist_events (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  waitlist_id uuid references public.appointment_waitlist_entries(id) on delete restrict, target_key text not null,
  kind text not null check (kind in ('joined', 'status_changed', 'promotion_failed')),
  from_status text, to_status text, actor_id uuid references auth.users(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete restrict, error text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index if not exists appointment_waitlist_events_history_idx on public.appointment_waitlist_events (clinic_id, target_key, created_at desc);
create table if not exists public.appointment_waitlist_notification_logs (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  waitlist_id uuid not null references public.appointment_waitlist_entries(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('joined', 'offered', 'booked', 'cancelled', 'expired')),
  channel text not null check (channel in ('line', 'email')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0), error text, sent_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (waitlist_id, kind, channel)
);
create index if not exists appointment_waitlist_notifications_pending_idx on public.appointment_waitlist_notification_logs (status, created_at) where status in ('pending', 'failed');
drop trigger if exists trg_appointment_waitlist_touch on public.appointment_waitlist_entries;
create trigger trg_appointment_waitlist_touch before update on public.appointment_waitlist_entries for each row execute function public.touch_updated_at();
drop trigger if exists trg_appointment_waitlist_notifications_touch on public.appointment_waitlist_notification_logs;
create trigger trg_appointment_waitlist_notifications_touch before update on public.appointment_waitlist_notification_logs for each row execute function public.touch_updated_at();

create or replace function public.appointment_waitlist_target_key(p_booking_mode text, p_doctor_id uuid, p_service_id uuid, p_template_id uuid, p_requested_date date, p_requested_start_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case when p_booking_mode = 'time' then concat_ws(':', 'time', extract(epoch from p_requested_start_at)::text, coalesce(p_doctor_id::text, '-'), coalesce(p_service_id::text, '-'))
    when p_booking_mode = 'number' then concat_ws(':', 'number', p_requested_date::text, p_template_id::text, coalesce(p_doctor_id::text, '-'), coalesce(p_service_id::text, '-')) else null end;
$$;
create or replace function public.record_appointment_waitlist_change() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_kind text; v_notification_kind text;
begin
  if tg_op = 'INSERT' then v_kind := 'joined'; v_notification_kind := 'joined';
  elsif new.status is distinct from old.status then v_kind := 'status_changed'; v_notification_kind := new.status;
  else return new; end if;
  insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, actor_id, appointment_id)
  values (new.clinic_id, new.id, new.target_key, v_kind, case when tg_op = 'UPDATE' then old.status else null end, new.status, auth.uid(), new.appointment_id);
  if v_notification_kind in ('joined', 'offered', 'booked', 'cancelled', 'expired') then
    insert into public.appointment_waitlist_notification_logs (clinic_id, waitlist_id, patient_id, kind, channel)
    select new.clinic_id, new.id, new.patient_id, v_notification_kind, channel from unnest(array['line'::text, 'email'::text]) channel
    on conflict (waitlist_id, kind, channel) do nothing;
  end if; return new;
end; $$;
drop trigger if exists trg_appointment_waitlist_change on public.appointment_waitlist_entries;
create trigger trg_appointment_waitlist_change after insert or update of status on public.appointment_waitlist_entries for each row execute function public.record_appointment_waitlist_change();

-- Appointment waitlist lifecycle. Keep this block synchronized with
-- supabase/migrations/202608110002_appointment_waitlist.sql.
create or replace function public.join_appointment_waitlist(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_booking_mode text,
  p_doctor_id uuid default null,
  p_service_id uuid default null,
  p_template_id uuid default null,
  p_requested_date date default null,
  p_requested_start_at timestamptz default null,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_booking_answers jsonb default '{}'::jsonb,
  p_source text default 'online'
) returns table (waitlist_id uuid, waitlist_position integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  settings record;
  service record;
  v_date date;
  v_target_start timestamptz;
  v_target_key text;
  v_position integer;
  v_existing record;
  v_available boolean := false;
  v_id uuid;
begin
  if p_booking_mode not in ('time', 'number') then raise exception 'invalid booking mode'; end if;
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  if p_source not in ('online', 'admin', 'line') then raise exception 'invalid waitlist source'; end if;
  if jsonb_typeof(coalesce(p_booking_answers, '{}'::jsonb)) <> 'object' then raise exception 'booking answers must be an object'; end if;
  select * into settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found or settings.booking_mode <> p_booking_mode then raise exception 'booking mode does not match brand settings'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and clinic_id = p_clinic_id and active)
    then raise exception 'customer is unavailable'; end if;
  if p_doctor_id is null and p_service_id is null then raise exception 'service or provider is required'; end if;
  if p_doctor_id is not null and not exists (select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active)
    then raise exception 'provider is unavailable'; end if;
  if p_service_id is not null then
    select id, booking_target into service from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
    if not found then raise exception 'service is unavailable'; end if;
    if service.booking_target = 'provider_required' and p_doctor_id is null then raise exception 'provider is required'; end if;
  end if;

  if p_booking_mode = 'time' then
    if p_requested_start_at is null or p_template_id is not null then raise exception 'time waitlist target is invalid'; end if;
    v_date := (p_requested_start_at at time zone 'Asia/Taipei')::date;
    if p_requested_date is not null and p_requested_date <> v_date then raise exception 'waitlist date does not match start time'; end if;
    v_target_start := p_requested_start_at;
    if p_doctor_id is not null then
      if not exists (
        select 1 from public.schedule_templates template
         where template.clinic_id = p_clinic_id and template.doctor_id = p_doctor_id and template.active
           and template.weekday = extract(dow from v_date)
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= template.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < template.end_time
        union all
        select 1 from public.schedule_exceptions exception
         where exception.clinic_id = p_clinic_id and exception.doctor_id = p_doctor_id and exception.date = v_date
           and not exception.is_closed
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= exception.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < exception.end_time
      ) then raise exception 'waitlist target is not a service slot'; end if;
      if p_service_id is null then
        select exists(select 1 from public.get_available_slots(p_clinic_id, p_doctor_id, v_date, p_visit_type) slot where slot.slot_start = p_requested_start_at) into v_available;
      else
        select exists(select 1 from public.get_available_slots_for_service(p_clinic_id, p_doctor_id, v_date, p_visit_type, p_service_id) slot where slot.slot_start = p_requested_start_at) into v_available;
      end if;
    else
      if not exists (
        select 1 from public.schedule_templates template
         where template.clinic_id = p_clinic_id and template.doctor_id is null and template.service_id = p_service_id and template.active
           and template.weekday = extract(dow from v_date)
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= template.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < template.end_time
        union all
        select 1 from public.schedule_exceptions exception
         where exception.clinic_id = p_clinic_id and exception.doctor_id is null and exception.service_id = p_service_id and exception.date = v_date
           and not exception.is_closed
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= exception.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < exception.end_time
      ) then raise exception 'waitlist target is not a service slot'; end if;
      select exists(select 1 from public.get_available_service_slots(p_clinic_id, p_service_id, v_date, p_visit_type, null) slot where slot.slot_start = p_requested_start_at) into v_available;
    end if;
  else
    if p_requested_date is null or p_template_id is null or p_requested_start_at is not null then raise exception 'number waitlist target is invalid'; end if;
    v_date := p_requested_date;
    if p_doctor_id is not null then
      select target.start_at into v_target_start from (
        select ((v_date + template.start_time) at time zone 'Asia/Taipei') as start_at
          from public.schedule_templates template
         where template.id = p_template_id and template.clinic_id = p_clinic_id and template.doctor_id = p_doctor_id
           and template.active and template.weekday = extract(dow from v_date)
        union all
        select ((v_date + exception.start_time) at time zone 'Asia/Taipei')
          from public.schedule_exceptions exception
         where exception.id = p_template_id and exception.clinic_id = p_clinic_id and exception.doctor_id = p_doctor_id
           and exception.date = v_date and not exception.is_closed
      ) target limit 1;
      if v_target_start is null then raise exception 'waitlist session is invalid'; end if;
      if p_service_id is null then
        select exists(select 1 from public.get_available_sessions(p_clinic_id, p_doctor_id, v_date) session where session.template_id = p_template_id) into v_available;
      else
        select exists(select 1 from public.get_available_sessions_for_service(p_clinic_id, p_doctor_id, v_date, p_service_id) session where session.template_id = p_template_id) into v_available;
      end if;
    else
      select target.start_at into v_target_start from (
        select ((v_date + template.start_time) at time zone 'Asia/Taipei') as start_at
          from public.schedule_templates template
         where template.id = p_template_id and template.clinic_id = p_clinic_id and template.doctor_id is null
           and template.service_id = p_service_id and template.active and template.weekday = extract(dow from v_date)
        union all
        select ((v_date + exception.start_time) at time zone 'Asia/Taipei')
          from public.schedule_exceptions exception
         where exception.id = p_template_id and exception.clinic_id = p_clinic_id and exception.doctor_id is null
           and exception.service_id = p_service_id and exception.date = v_date and not exception.is_closed
      ) target limit 1;
      if v_target_start is null then raise exception 'waitlist session is invalid'; end if;
      select exists(select 1 from public.get_available_service_sessions(p_clinic_id, p_service_id, v_date) session where session.template_id = p_template_id) into v_available;
    end if;
  end if;

  if v_target_start < now() + (coalesce(settings.min_lead_minutes, 30) || ' minutes')::interval then raise exception 'waitlist target is too late'; end if;
  if v_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(settings.max_advance_days, 30)) then raise exception 'waitlist target is too far away'; end if;
  if v_available then raise exception 'slot is still available'; end if;

  v_target_key := public.appointment_waitlist_target_key(p_booking_mode, p_doctor_id, p_service_id, p_template_id, v_date, p_requested_start_at);
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || v_target_key));
  select id, position into v_existing from public.appointment_waitlist_entries
   where clinic_id = p_clinic_id and patient_id = p_patient_id and target_key = v_target_key and status in ('waiting', 'offered')
   for update;
  if found then return query select v_existing.id, v_existing.position; return; end if;
  select coalesce(max(position), 0) + 1 into v_position from public.appointment_waitlist_entries
   where clinic_id = p_clinic_id and target_key = v_target_key;
  insert into public.appointment_waitlist_entries (
    clinic_id, patient_id, service_id, doctor_id, booking_mode, template_id,
    requested_date, requested_start_at, visit_type, is_self_pay, booking_answers,
    target_key, position, source
  ) values (
    p_clinic_id, p_patient_id, p_service_id, p_doctor_id, p_booking_mode, p_template_id,
    v_date, p_requested_start_at, p_visit_type, p_is_self_pay, coalesce(p_booking_answers, '{}'::jsonb),
    v_target_key, v_position, p_source
  ) returning id into v_id;
  return query select v_id, v_position;
end;
$$;

create or replace function public.offer_next_appointment_waitlist(
  p_clinic_id uuid,
  p_target_key text,
  p_offer_minutes integer default 15
) returns table (waitlist_id uuid, appointment_id uuid, patient_id uuid, offer_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  candidate record;
  booking record;
  v_appointment_id uuid;
  v_offer_expires timestamptz;
  v_error text;
begin
  if p_offer_minutes not between 5 and 1440 then raise exception 'invalid waitlist offer duration'; end if;
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || p_target_key));
  for candidate in
    select * from public.appointment_waitlist_entries
     where clinic_id = p_clinic_id and target_key = p_target_key and status = 'waiting'
     order by position, created_at
     for update skip locked
  loop
    v_appointment_id := null;
    v_error := null;
    begin
      if candidate.booking_mode = 'time' then
        if candidate.doctor_id is null then
          v_appointment_id := public.book_service_slot(
            candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
          );
        elsif candidate.service_id is null then
          v_appointment_id := public.book_time_slot(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, null
          );
        else
          v_appointment_id := public.book_time_slot_for_service(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.service_id
          );
        end if;
      elsif candidate.doctor_id is null then
        select * into booking from public.book_service_session(
          candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
        );
        v_appointment_id := booking.appointment_id;
      elsif candidate.service_id is null then
        select * into booking from public.book_number(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, null
        );
        v_appointment_id := booking.appointment_id;
      else
        select * into booking from public.book_number_for_service(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.service_id
        );
        v_appointment_id := booking.appointment_id;
      end if;
    exception when others then
      v_error := sqlerrm;
    end;

    if v_appointment_id is null then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (candidate.clinic_id, candidate.id, candidate.target_key, 'promotion_failed', candidate.status, candidate.status, v_error);
      if v_error like '%額滿%' or v_error like '%capacity%' or v_error like '%resource is unavailable%' then
        return;
      end if;
      update public.appointment_waitlist_entries set status = 'expired' where id = candidate.id;
      continue;
    end if;

    v_offer_expires := now() + (p_offer_minutes || ' minutes')::interval;
    update public.appointments
       set waitlist_entry_id = candidate.id,
           booking_answers = candidate.booking_answers,
           note = concat_ws(E'\n', nullif(note, ''), 'waitlist offer')
     where id = v_appointment_id and clinic_id = candidate.clinic_id;
    update public.appointment_waitlist_entries
       set status = 'offered', appointment_id = v_appointment_id,
           offered_at = now(), offer_expires_at = v_offer_expires
     where id = candidate.id and clinic_id = candidate.clinic_id;
    return query select candidate.id, v_appointment_id, candidate.patient_id, v_offer_expires;
    return;
  end loop;
end;
$$;

create or replace function public.accept_appointment_waitlist_offer(
  p_clinic_id uuid,
  p_waitlist_id uuid,
  p_patient_id uuid
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record;
begin
  select * into entry from public.appointment_waitlist_entries
   where id = p_waitlist_id and clinic_id = p_clinic_id and patient_id = p_patient_id for update;
  if not found then raise exception 'waitlist entry not found'; end if;
  if entry.status = 'booked' then return entry.appointment_id; end if;
  if entry.status <> 'offered' then raise exception 'waitlist offer is unavailable'; end if;
  if entry.offer_expires_at <= now() then
    update public.appointment_waitlist_entries set status = 'expired' where id = entry.id;
    if exists (select 1 from public.appointments where id = entry.appointment_id and clinic_id = p_clinic_id and status in ('booked', 'confirmed')) then
      perform public.cancel_appointment(p_clinic_id, entry.appointment_id, 'waitlist offer expired');
    end if;
    return null;
  end if;
  if not exists (select 1 from public.appointments where id = entry.appointment_id and clinic_id = p_clinic_id and status in ('booked', 'confirmed'))
    then raise exception 'reserved appointment is unavailable'; end if;
  update public.appointment_waitlist_entries set status = 'booked' where id = entry.id;
  return entry.appointment_id;
end;
$$;

create or replace function public.cancel_appointment_waitlist(
  p_clinic_id uuid,
  p_waitlist_id uuid,
  p_patient_id uuid,
  p_note text default null
) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record;
begin
  select * into entry from public.appointment_waitlist_entries
   where id = p_waitlist_id and clinic_id = p_clinic_id and patient_id = p_patient_id for update;
  if not found then raise exception 'waitlist entry not found'; end if;
  if entry.status in ('cancelled', 'expired') then return true; end if;
  if entry.status = 'booked' then raise exception 'booked waitlist entry must use appointment cancellation'; end if;
  update public.appointment_waitlist_entries set status = 'cancelled' where id = entry.id;
  if entry.appointment_id is not null and exists (
    select 1 from public.appointments where id = entry.appointment_id and clinic_id = p_clinic_id and status in ('booked', 'confirmed')
  ) then
    perform public.cancel_appointment(p_clinic_id, entry.appointment_id, coalesce(p_note, 'waitlist cancelled'));
  end if;
  return true;
end;
$$;

create or replace function public.cancel_appointment_waitlist_by_operator(
  p_clinic_id uuid,
  p_waitlist_id uuid,
  p_actor_user_id uuid,
  p_note text default null
) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin', 'frontdesk', 'staff')
  ) then raise exception 'operator access required'; end if;
  select * into entry from public.appointment_waitlist_entries where id = p_waitlist_id and clinic_id = p_clinic_id;
  if not found then raise exception 'waitlist entry not found'; end if;
  return public.cancel_appointment_waitlist(p_clinic_id, p_waitlist_id, entry.patient_id, p_note);
end;
$$;

create or replace function public.expire_appointment_waitlist_offers()
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record; v_count integer := 0;
begin
  for entry in
    select * from public.appointment_waitlist_entries
     where status = 'offered' and offer_expires_at <= now()
     order by offer_expires_at
     for update skip locked
  loop
    begin
      update public.appointment_waitlist_entries set status = 'expired' where id = entry.id;
      if exists (select 1 from public.appointments where id = entry.appointment_id and clinic_id = entry.clinic_id and status in ('booked', 'confirmed')) then
        perform public.cancel_appointment(entry.clinic_id, entry.appointment_id, 'waitlist offer expired');
      end if;
      v_count := v_count + 1;
    exception when others then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (entry.clinic_id, entry.id, entry.target_key, 'promotion_failed', entry.status, entry.status, sqlerrm);
    end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.promote_waitlist_after_appointment_cancel()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare v_mode text; v_target_key text;
begin
  if old.status in ('booked', 'confirmed', 'done') and new.status = 'cancelled' then
    v_mode := case when old.queue_number is null then 'time' else 'number' end;
    v_target_key := public.appointment_waitlist_target_key(
      v_mode, old.doctor_id, old.service_id,
      case when v_mode = 'number' then old.template_id else null end,
      (old.start_at at time zone 'Asia/Taipei')::date,
      case when v_mode = 'time' then old.start_at else null end
    );
    begin
      perform public.offer_next_appointment_waitlist(old.clinic_id, v_target_key, 15);
    exception when others then
      insert into public.appointment_waitlist_events (clinic_id, target_key, kind, from_status, to_status, appointment_id, error)
      values (old.clinic_id, v_target_key, 'promotion_failed', old.status, new.status, old.id, sqlerrm);
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_promote_waitlist_after_appointment_cancel on public.appointments;
create trigger trg_promote_waitlist_after_appointment_cancel
after update of status on public.appointments
for each row execute function public.promote_waitlist_after_appointment_cancel();


alter table public.appointment_waitlist_entries enable row level security;
alter table public.appointment_waitlist_events enable row level security;
alter table public.appointment_waitlist_notification_logs enable row level security;
revoke all on table public.appointment_waitlist_entries from public, anon, authenticated;
revoke all on table public.appointment_waitlist_events from public, anon, authenticated;
revoke all on table public.appointment_waitlist_notification_logs from public, anon, authenticated;
grant select on table public.appointment_waitlist_entries to authenticated;
grant select on table public.appointment_waitlist_events to authenticated;
grant select on table public.appointment_waitlist_notification_logs to authenticated;
drop policy if exists appointment_waitlist_read on public.appointment_waitlist_entries;
create policy appointment_waitlist_read on public.appointment_waitlist_entries for select to authenticated using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_waitlist_entries.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin', 'frontdesk', 'staff')));
drop policy if exists appointment_waitlist_events_read on public.appointment_waitlist_events;
create policy appointment_waitlist_events_read on public.appointment_waitlist_events for select to authenticated using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_waitlist_events.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin', 'frontdesk', 'staff')));
drop policy if exists appointment_waitlist_notifications_read on public.appointment_waitlist_notification_logs;
create policy appointment_waitlist_notifications_read on public.appointment_waitlist_notification_logs for select to authenticated using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_waitlist_notification_logs.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')));

revoke all on function public.appointment_waitlist_target_key(text, uuid, uuid, uuid, date, timestamptz) from public, anon, authenticated;
revoke all on function public.record_appointment_waitlist_change() from public, anon, authenticated;
revoke all on function public.join_appointment_waitlist(uuid, uuid, text, uuid, uuid, uuid, date, timestamptz, text, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function public.offer_next_appointment_waitlist(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.accept_appointment_waitlist_offer(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_appointment_waitlist(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_appointment_waitlist_by_operator(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.expire_appointment_waitlist_offers() from public, anon, authenticated;
revoke all on function public.promote_waitlist_after_appointment_cancel() from public, anon, authenticated;
grant execute on function public.join_appointment_waitlist(uuid, uuid, text, uuid, uuid, uuid, date, timestamptz, text, boolean, jsonb, text) to service_role;
grant execute on function public.offer_next_appointment_waitlist(uuid, text, integer) to service_role;
grant execute on function public.accept_appointment_waitlist_offer(uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_appointment_waitlist(uuid, uuid, uuid, text) to service_role;
grant execute on function public.cancel_appointment_waitlist_by_operator(uuid, uuid, uuid, text) to service_role;
grant execute on function public.expire_appointment_waitlist_offers() to service_role;

commit;

-- Product restructure M2: expose full-but-valid appointment targets and
-- claim waitlist notifications atomically without changing normal availability.
-- Keep synchronized with migrations/202608110003_appointment_waitlist_surfaces.sql.
-- Product restructure M2: expose full-but-valid appointment targets and
-- claim waitlist notifications atomically without changing normal availability.
begin;

create or replace function public.get_appointment_waitlist_targets(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_service_id uuid,
  p_date date,
  p_visit_type text default 'return'
)
returns table (
  booking_mode text,
  template_id uuid,
  target_start timestamptz,
  target_end timestamptz,
  total integer,
  taken integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings record;
  schedule record;
  candidate record;
  v_length integer;
  v_taken integer;
  v_start timestamptz;
  v_end timestamptz;
  v_resources_available boolean;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  if p_doctor_id is null and p_service_id is null then raise exception 'service or provider is required'; end if;
  select * into settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found then raise exception 'brand settings not found'; end if;
  if p_date < (now() at time zone 'Asia/Taipei')::date
     or p_date > (now() at time zone 'Asia/Taipei')::date + settings.max_advance_days then
    return;
  end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'provider is unavailable'; end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and clinic_id = p_clinic_id and active
  ) then raise exception 'service is unavailable'; end if;

  if settings.booking_mode = 'time' then
    for schedule in
      select t.id, t.start_time, t.end_time, t.slot_minutes, t.capacity
        from public.schedule_templates t
       where t.clinic_id = p_clinic_id and t.weekday = extract(dow from p_date) and t.active
         and (
           (p_doctor_id is not null and t.doctor_id = p_doctor_id and (p_service_id is null or t.service_id is null or t.service_id = p_service_id))
           or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id)
         )
         and not exists (
           select 1 from public.schedule_exceptions closed
            where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed and closed.start_time is null
              and (
                (p_doctor_id is not null and closed.doctor_id = p_doctor_id and (p_service_id is null or closed.service_id is null or closed.service_id = p_service_id))
                or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)
              )
         )
      union all
      select e.id, e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
        from public.schedule_exceptions e
       where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
         and (
           (p_doctor_id is not null and e.doctor_id = p_doctor_id and (p_service_id is null or e.service_id is null or e.service_id = p_service_id))
           or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
         )
    loop
      v_length := case
        when p_service_id is not null then public.service_booking_minutes(
          p_clinic_id, p_service_id, schedule.slot_minutes, p_visit_type,
          coalesce(settings.first_visit_extends, false), settings.first_visit_minutes
        )
        when p_visit_type = 'first' and coalesce(settings.first_visit_extends, false)
          then coalesce(settings.first_visit_minutes, schedule.slot_minutes)
        else schedule.slot_minutes
      end;
      for candidate in
        select
          ((p_date + schedule.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as starts_at,
          ((p_date + schedule.start_time + ((n + v_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as ends_at
          from generate_series(
            0,
            (extract(epoch from (schedule.end_time - schedule.start_time)) / 60)::integer - v_length,
            schedule.slot_minutes
          ) n
      loop
        if candidate.starts_at <= now() + (coalesce(settings.min_lead_minutes, 30) || ' minutes')::interval then continue; end if;
        if exists (
          select 1 from public.schedule_exceptions closed
           where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed and closed.start_time is not null
             and (
               (p_doctor_id is not null and closed.doctor_id = p_doctor_id and (p_service_id is null or closed.service_id is null or closed.service_id = p_service_id))
               or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)
             )
             and (candidate.starts_at at time zone 'Asia/Taipei')::time < coalesce(closed.end_time, '23:59:59.999999'::time)
             and (candidate.ends_at at time zone 'Asia/Taipei')::time > closed.start_time
        ) then continue; end if;

        select count(*)::integer into v_taken
          from public.appointments appointment
         where appointment.clinic_id = p_clinic_id
           and appointment.status in ('booked', 'confirmed', 'done')
           and appointment.start_at < candidate.ends_at and appointment.end_at > candidate.starts_at
           and (
             (p_doctor_id is not null and appointment.doctor_id = p_doctor_id)
             or (p_doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id)
           );
        v_resources_available := p_service_id is null or public.service_resources_available(
          p_clinic_id, p_service_id, candidate.starts_at, candidate.ends_at, null
        );
        if v_taken >= schedule.capacity or not v_resources_available then
          return query select 'time'::text, null::uuid, candidate.starts_at, candidate.ends_at,
            schedule.capacity::integer, greatest(v_taken, schedule.capacity)::integer;
        end if;
      end loop;
    end loop;
  elsif settings.booking_mode = 'number' then
    for schedule in
      select t.id, t.start_time, t.end_time, t.capacity
        from public.schedule_templates t
       where t.clinic_id = p_clinic_id and t.weekday = extract(dow from p_date) and t.active
         and (
           (p_doctor_id is not null and t.doctor_id = p_doctor_id and (p_service_id is null or t.service_id is null or t.service_id = p_service_id))
           or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id)
         )
         and not exists (
           select 1 from public.schedule_exceptions closed
            where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed
              and (
                (p_doctor_id is not null and closed.doctor_id = p_doctor_id and (p_service_id is null or closed.service_id is null or closed.service_id = p_service_id))
                or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)
              )
              and (closed.start_time is null or (closed.start_time < t.end_time and coalesce(closed.end_time, '23:59:59.999999'::time) > t.start_time))
         )
      union all
      select e.id, e.start_time, e.end_time, coalesce(e.capacity, 40)
        from public.schedule_exceptions e
       where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
         and (
           (p_doctor_id is not null and e.doctor_id = p_doctor_id and (p_service_id is null or e.service_id is null or e.service_id = p_service_id))
           or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)
         )
    loop
      v_start := (p_date + schedule.start_time) at time zone 'Asia/Taipei';
      v_end := (p_date + schedule.end_time) at time zone 'Asia/Taipei';
      if v_start <= now() + (coalesce(settings.min_lead_minutes, 30) || ' minutes')::interval then continue; end if;
      select count(*)::integer into v_taken
        from public.appointments appointment
       where appointment.clinic_id = p_clinic_id and appointment.template_id = schedule.id
         and appointment.start_at = v_start and appointment.status in ('booked', 'confirmed', 'done')
         and (
           (p_doctor_id is not null and appointment.doctor_id = p_doctor_id)
           or (p_doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id)
         );
      v_resources_available := p_service_id is null or public.service_resources_available(
        p_clinic_id, p_service_id, v_start, v_end, null
      );
      if v_taken >= schedule.capacity or not v_resources_available then
        return query select 'number'::text, schedule.id, v_start, v_end,
          schedule.capacity::integer, greatest(v_taken, schedule.capacity)::integer;
      end if;
    end loop;
  else
    raise exception 'invalid booking mode';
  end if;
end;
$$;

create or replace function public.claim_appointment_waitlist_notifications(p_limit integer default 50)
returns table (
  log_id uuid,
  clinic_id uuid,
  waitlist_id uuid,
  kind text,
  channel text,
  patient_name text,
  line_user_id text,
  email text,
  booking_mode text,
  requested_date date,
  target_start_at timestamptz,
  "position" integer,
  offer_expires_at timestamptz,
  appointment_id uuid,
  doctor_name text,
  service_name text,
  clinic_name text,
  line_destination text,
  email_enabled boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit not between 1 and 200 then raise exception 'invalid claim limit'; end if;
  return query
  with candidates as (
    select notification.id
      from public.appointment_waitlist_notification_logs notification
     where (
       notification.status in ('pending', 'failed') and notification.attempt_count < 5
     ) or (
       notification.status = 'claimed' and notification.updated_at < now() - interval '10 minutes' and notification.attempt_count < 5
     )
     order by notification.created_at, notification.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.appointment_waitlist_notification_logs notification
       set status = 'claimed', attempt_count = notification.attempt_count + 1, error = null
      from candidates
     where notification.id = candidates.id
    returning notification.*
  )
  select claimed.id, claimed.clinic_id, claimed.waitlist_id, claimed.kind, claimed.channel,
         patient.name, patient.line_user_id, patient.email,
         entry.booking_mode, entry.requested_date,
         coalesce(
           entry.requested_start_at,
           ((entry.requested_date + coalesce(template.start_time, schedule_exception.start_time)) at time zone 'Asia/Taipei')
         ),
         entry.position, entry.offer_expires_at, entry.appointment_id,
         doctor.name, service.name, clinic.name, clinic.line_destination,
         coalesce(settings.email_enabled, false)
    from claimed
    join public.appointment_waitlist_entries entry on entry.id = claimed.waitlist_id and entry.clinic_id = claimed.clinic_id
    join public.patients patient on patient.id = claimed.patient_id and patient.clinic_id = claimed.clinic_id
    join public.clinics clinic on clinic.id = claimed.clinic_id
    join public.clinic_settings settings on settings.clinic_id = claimed.clinic_id
    left join public.doctors doctor on doctor.id = entry.doctor_id and doctor.clinic_id = entry.clinic_id
    left join public.services service on service.id = entry.service_id and service.clinic_id = entry.clinic_id
    left join public.schedule_templates template on template.id = entry.template_id and template.clinic_id = entry.clinic_id
    left join public.schedule_exceptions schedule_exception on schedule_exception.id = entry.template_id and schedule_exception.clinic_id = entry.clinic_id
   order by claimed.created_at, claimed.id;
end;
$$;

create or replace function public.finish_appointment_waitlist_notification(
  p_log_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  changed integer;
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'invalid notification result'; end if;
  update public.appointment_waitlist_notification_logs
     set status = p_status,
         error = left(nullif(p_error, ''), 1000),
         sent_at = case when p_status = 'sent' then now() else null end
   where id = p_log_id and status = 'claimed';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.get_appointment_waitlist_targets(uuid, uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public.claim_appointment_waitlist_notifications(integer) from public, anon, authenticated;
revoke all on function public.finish_appointment_waitlist_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_appointment_waitlist_targets(uuid, uuid, uuid, date, text) to service_role;
grant execute on function public.claim_appointment_waitlist_notifications(integer) to service_role;
grant execute on function public.finish_appointment_waitlist_notification(uuid, text, text) to service_role;

commit;


-- Product restructure M2: standard module activation, per-brand LINE metadata,
-- and a versioned Rich Menu lifecycle. Secrets remain server-environment only.
begin;

alter table public.clinic_settings
  add column if not exists events_enabled boolean not null default false,
  add column if not exists memberships_enabled boolean not null default false,
  add column if not exists crm_automation_enabled boolean not null default false,
  add column if not exists line_channel_enabled boolean not null default false;

update public.clinic_settings settings
set events_enabled = settings.events_enabled
  or settings.public_registration_enabled
  or exists (select 1 from public.events event where event.clinic_id = settings.clinic_id),
    memberships_enabled = settings.memberships_enabled
  or exists (select 1 from public.membership_plans plan where plan.clinic_id = settings.clinic_id)
  or exists (select 1 from public.patient_memberships membership where membership.clinic_id = settings.clinic_id),
    crm_automation_enabled = settings.crm_automation_enabled
  or exists (select 1 from public.crm_segments segment where segment.clinic_id = settings.clinic_id)
  or exists (select 1 from public.crm_automations automation where automation.clinic_id = settings.clinic_id),
    line_channel_enabled = settings.line_channel_enabled
  or exists (
    select 1 from public.clinics clinic
     where clinic.id = settings.clinic_id
       and (clinic.line_destination is not null or clinic.line_basic_id is not null)
  );

alter table public.clinic_settings alter column public_registration_enabled set default false;

create table if not exists public.clinic_line_channels (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  connection_mode text not null default 'shared' check (connection_mode in ('shared', 'brand')),
  provider_id text,
  messaging_channel_id text,
  login_channel_id text,
  liff_id text,
  liff_endpoint_path text not null default '/book',
  verification_status text not null default 'unconfigured'
    check (verification_status in ('unconfigured', 'pending', 'ready', 'error')),
  verification_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (liff_endpoint_path like '/%')
);
insert into public.clinic_line_channels (clinic_id, verification_status)
select settings.clinic_id, case when settings.line_channel_enabled then 'pending' else 'unconfigured' end
  from public.clinic_settings settings
on conflict (clinic_id) do nothing;

create table if not exists public.line_richmenu_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  name text not null default '未命名版本',
  template_key text not null default 'custom' check (template_key in ('booking', 'events', 'mixed', 'custom')),
  layout text not null check (layout in ('full-3', 'full-6', 'compact-2', 'compact-3')),
  chat_bar_text text not null default '選單',
  slots jsonb not null default '[]'::jsonb,
  image_storage_path text,
  image_content_type text,
  image_sha256 text,
  image_width integer,
  image_height integer,
  status text not null default 'draft'
    check (status in ('draft', 'validating', 'ready', 'publishing', 'published', 'failed', 'archived')),
  line_rich_menu_id text,
  validation_errors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, version_no),
  check (jsonb_typeof(slots) = 'array'),
  check (jsonb_typeof(validation_errors) = 'array'),
  check (image_width is null or image_width > 0),
  check (image_height is null or image_height > 0)
);
create unique index if not exists line_richmenu_versions_one_published_idx
  on public.line_richmenu_versions (clinic_id) where status = 'published';
create index if not exists line_richmenu_versions_history_idx
  on public.line_richmenu_versions (clinic_id, version_no desc);

alter table public.line_richmenu
  add column if not exists draft_version_id uuid,
  add column if not exists published_version_id uuid;
do $$ begin
  alter table public.line_richmenu add constraint line_richmenu_draft_version_fkey
    foreign key (draft_version_id) references public.line_richmenu_versions(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.line_richmenu add constraint line_richmenu_published_version_fkey
    foreign key (published_version_id) references public.line_richmenu_versions(id) on delete restrict;
exception when duplicate_object then null; end $$;

insert into public.line_richmenu_versions (
  clinic_id,
  version_no,
  name,
  template_key,
  layout,
  chat_bar_text,
  slots,
  status,
  line_rich_menu_id,
  published_at,
  created_at,
  updated_at
)
select menu.clinic_id,
       1,
       '既有 Rich Menu',
       'custom',
       menu.layout,
       menu.chat_bar_text,
       coalesce(menu.slots, '[]'::jsonb),
       case when menu.published_id is null then 'draft' else 'published' end,
       menu.published_id,
       case when menu.published_id is null then null else coalesce(menu.updated_at, now()) end,
       coalesce(menu.updated_at, now()),
       coalesce(menu.updated_at, now())
  from public.line_richmenu menu
 where not exists (
   select 1
     from public.line_richmenu_versions version
    where version.clinic_id = menu.clinic_id
 )
on conflict (clinic_id, version_no) do nothing;

update public.line_richmenu menu
   set draft_version_id = coalesce(menu.draft_version_id, version.id),
       published_version_id = case
         when menu.published_id is null then menu.published_version_id
         else coalesce(menu.published_version_id, version.id)
       end
  from public.line_richmenu_versions version
 where version.clinic_id = menu.clinic_id
   and version.version_no = 1;

create table if not exists public.line_richmenu_publication_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  version_id uuid not null references public.line_richmenu_versions(id) on delete restrict,
  kind text not null check (kind in ('validated', 'validation_failed', 'published', 'publish_failed', 'rolled_back', 'unpublished')),
  actor_id uuid references auth.users(id) on delete set null,
  line_rich_menu_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index if not exists line_richmenu_publication_events_history_idx
  on public.line_richmenu_publication_events (clinic_id, created_at desc);

drop trigger if exists trg_clinic_line_channels_touch on public.clinic_line_channels;
create trigger trg_clinic_line_channels_touch before update on public.clinic_line_channels for each row execute function public.touch_updated_at();
drop trigger if exists trg_line_richmenu_versions_touch on public.line_richmenu_versions;
create trigger trg_line_richmenu_versions_touch before update on public.line_richmenu_versions for each row execute function public.touch_updated_at();

alter table public.clinic_line_channels enable row level security;
alter table public.line_richmenu_versions enable row level security;
alter table public.line_richmenu_publication_events enable row level security;
revoke all on table public.clinic_line_channels from public, anon;
revoke all on table public.line_richmenu_versions from public, anon;
revoke all on table public.line_richmenu_publication_events from public, anon;

drop policy if exists clinic_line_channels_admin on public.clinic_line_channels;
create policy clinic_line_channels_admin on public.clinic_line_channels for all to authenticated
  using (exists (select 1 from public.clinic_members member where member.clinic_id = clinic_line_channels.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')))
  with check (exists (select 1 from public.clinic_members member where member.clinic_id = clinic_line_channels.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')));
drop policy if exists line_richmenu_versions_admin on public.line_richmenu_versions;
create policy line_richmenu_versions_admin on public.line_richmenu_versions for all to authenticated
  using (exists (select 1 from public.clinic_members member where member.clinic_id = line_richmenu_versions.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')))
  with check (exists (select 1 from public.clinic_members member where member.clinic_id = line_richmenu_versions.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')));
drop policy if exists line_richmenu_publication_events_admin on public.line_richmenu_publication_events;
create policy line_richmenu_publication_events_admin on public.line_richmenu_publication_events for all to authenticated
  using (exists (select 1 from public.clinic_members member where member.clinic_id = line_richmenu_publication_events.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')))
  with check (exists (select 1 from public.clinic_members member where member.clinic_id = line_richmenu_publication_events.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')));

create or replace function public.create_line_richmenu_version(
  p_clinic_id uuid, p_actor_user_id uuid, p_name text, p_template_key text,
  p_layout text, p_chat_bar_text text, p_slots jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid; v_version integer;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  if p_layout not in ('full-3', 'full-6', 'compact-2', 'compact-3') then raise exception 'invalid rich menu layout'; end if;
  if p_template_key not in ('booking', 'events', 'mixed', 'custom') then raise exception 'invalid rich menu template'; end if;
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then raise exception 'rich menu slots must be an array'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'rich menu version name is invalid'; end if;
  if length(btrim(coalesce(p_chat_bar_text, ''))) not between 1 and 14 then raise exception 'rich menu chat bar text is invalid'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-version:' || p_clinic_id::text));
  select coalesce(max(version_no), 0) + 1 into v_version from public.line_richmenu_versions where clinic_id = p_clinic_id;
  insert into public.line_richmenu_versions (clinic_id, version_no, name, template_key, layout, chat_bar_text, slots, created_by)
  values (p_clinic_id, v_version, btrim(p_name), p_template_key, p_layout, btrim(p_chat_bar_text), coalesce(p_slots, '[]'::jsonb), p_actor_user_id)
  returning id into v_id;
  insert into public.line_richmenu (clinic_id) values (p_clinic_id) on conflict (clinic_id) do nothing;
  update public.line_richmenu set draft_version_id = v_id, updated_at = now() where clinic_id = p_clinic_id;
  return v_id;
end; $$;
revoke all on function public.create_line_richmenu_version(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_line_richmenu_version(uuid, uuid, text, text, text, text, jsonb) to service_role;


create or replace function public.update_clinic_line_channel(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_enabled boolean,
  p_connection_mode text,
  p_destination text default null,
  p_login_channel_id text default null,
  p_liff_id text default null,
  p_liff_endpoint_path text default '/book'
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_destination text := nullif(btrim(coalesce(p_destination, '')), '');
  v_login_channel_id text := nullif(btrim(coalesce(p_login_channel_id, '')), '');
  v_liff_id text := nullif(btrim(coalesce(p_liff_id, '')), '');
  v_endpoint_path text := btrim(coalesce(p_liff_endpoint_path, '/book'));
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception 'actor identity mismatch';
  end if;
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  if p_connection_mode not in ('shared', 'brand') then raise exception 'invalid LINE connection mode'; end if;
  if v_destination is not null and v_destination !~ '^U[A-Za-z0-9_-]{8,100}$' then raise exception 'invalid LINE destination'; end if;
  if v_login_channel_id is not null and v_login_channel_id !~ '^[0-9]{6,30}$' then raise exception 'invalid LINE Login Channel ID'; end if;
  if v_liff_id is not null and v_liff_id !~ '^[0-9]{6,30}-[A-Za-z0-9_-]{4,100}$' then raise exception 'invalid LIFF ID'; end if;
  if v_endpoint_path !~ '^/[^\\]*$' or length(v_endpoint_path) > 200 then raise exception 'invalid LIFF endpoint path'; end if;
  if p_enabled and p_connection_mode = 'brand' and (v_destination is null or v_login_channel_id is null or v_liff_id is null) then
    raise exception 'brand LINE channel metadata is incomplete';
  end if;

  update public.clinics set line_destination = v_destination, updated_at = now() where id = p_clinic_id and active;
  if not found then raise exception 'brand not found'; end if;
  update public.clinic_settings set line_channel_enabled = p_enabled, updated_at = now() where clinic_id = p_clinic_id;
  if not found then raise exception 'brand settings not found'; end if;
  insert into public.clinic_line_channels (
    clinic_id, connection_mode, login_channel_id, liff_id, liff_endpoint_path,
    verification_status, verification_error, last_verified_at
  ) values (
    p_clinic_id, p_connection_mode, v_login_channel_id, v_liff_id, v_endpoint_path,
    case when p_enabled then 'pending' else 'unconfigured' end, null, null
  )
  on conflict (clinic_id) do update set
    connection_mode = excluded.connection_mode,
    login_channel_id = excluded.login_channel_id,
    liff_id = excluded.liff_id,
    liff_endpoint_path = excluded.liff_endpoint_path,
    verification_status = excluded.verification_status,
    verification_error = null,
    last_verified_at = null,
    updated_at = now();
end;
$$;
revoke all on function public.update_clinic_line_channel(uuid, uuid, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.update_clinic_line_channel(uuid, uuid, boolean, text, text, text, text, text) to authenticated, service_role;


create or replace function public.record_line_richmenu_publication(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_line_rich_menu_id text,
  p_kind text default 'published',
  p_image_sha256 text default null,
  p_image_width integer default null,
  p_image_height integer default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_kind not in ('published', 'rolled_back') then raise exception 'invalid publication kind'; end if;
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  if nullif(btrim(coalesce(p_line_rich_menu_id, '')), '') is null then raise exception 'LINE Rich Menu ID is required'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || p_clinic_id::text));
  if not exists (select 1 from public.line_richmenu_versions version where version.id = p_version_id and version.clinic_id = p_clinic_id) then
    raise exception 'Rich Menu version not found';
  end if;
  update public.line_richmenu_versions
     set status = 'archived', updated_at = now()
   where clinic_id = p_clinic_id and status = 'published' and id <> p_version_id;
  update public.line_richmenu_versions
     set status = 'published', line_rich_menu_id = btrim(p_line_rich_menu_id),
         image_sha256 = coalesce(p_image_sha256, image_sha256),
         image_width = coalesce(p_image_width, image_width),
         image_height = coalesce(p_image_height, image_height),
         validation_errors = '[]'::jsonb, published_at = now(), updated_at = now()
   where id = p_version_id and clinic_id = p_clinic_id;
  insert into public.line_richmenu (clinic_id, published_id, published_version_id, draft_version_id, updated_at)
  values (p_clinic_id, btrim(p_line_rich_menu_id), p_version_id, p_version_id, now())
  on conflict (clinic_id) do update set
    published_id = excluded.published_id,
    published_version_id = excluded.published_version_id,
    draft_version_id = excluded.draft_version_id,
    updated_at = now();
  insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, line_rich_menu_id)
  values (p_clinic_id, p_version_id, p_kind, p_actor_user_id, btrim(p_line_rich_menu_id));
end;
$$;

create or replace function public.record_line_richmenu_publish_failure(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_error text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  update public.line_richmenu_versions
     set status = 'failed', validation_errors = jsonb_build_array(left(coalesce(p_error, 'publish failed'), 1000)), updated_at = now()
   where id = p_version_id and clinic_id = p_clinic_id and status <> 'published';
  if not found then raise exception 'Rich Menu version not found or already published'; end if;
  insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, error)
  values (p_clinic_id, p_version_id, 'publish_failed', p_actor_user_id, left(coalesce(p_error, 'publish failed'), 1000));
end;
$$;

create or replace function public.record_line_richmenu_unpublished(
  p_clinic_id uuid,
  p_actor_user_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare current_version uuid; current_line_id text;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || p_clinic_id::text));
  select published_version_id, published_id into current_version, current_line_id
    from public.line_richmenu where clinic_id = p_clinic_id for update;
  if current_version is not null then
    update public.line_richmenu_versions set status = 'archived', updated_at = now()
     where id = current_version and clinic_id = p_clinic_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, line_rich_menu_id)
    values (p_clinic_id, current_version, 'unpublished', p_actor_user_id, current_line_id);
  end if;
  update public.line_richmenu set published_id = null, published_version_id = null, updated_at = now()
   where clinic_id = p_clinic_id;
end;
$$;

revoke all on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_line_richmenu_publish_failure(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_line_richmenu_unpublished(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.record_line_richmenu_publish_failure(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_line_richmenu_unpublished(uuid, uuid) to service_role;

commit;

-- Allow a service/resource booking to be rescheduled without inventing a provider.
begin;

create or replace function public.reschedule_service_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid default null,
  p_service_id uuid default null,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_appt record;
  new_appointment_id uuid;
  new_queue_number integer;
  v_service_id uuid;
  v_answers jsonb;
begin
  select patient_id, visit_type, is_self_pay, membership_id, service_id, booking_answers, status
    into old_appt
    from public.appointments
   where id = p_old_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;

  v_service_id := coalesce(p_service_id, old_appt.service_id);
  v_answers := coalesce(old_appt.booking_answers, '{}'::jsonb);
  if p_doctor_id is null and v_service_id is null then
    raise exception 'service or provider is required';
  end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'doctor is unavailable'; end if;
  if v_service_id is not null and not exists (
    select 1 from public.services where id = v_service_id and clinic_id = p_clinic_id and active
  ) then raise exception 'service is unavailable'; end if;

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    if p_doctor_id is null then
      new_appointment_id := public.book_service_slot(
        p_clinic_id, v_service_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_answers
      );
    else
      new_appointment_id := public.book_time_slot(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      );
    end if;
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    if p_doctor_id is null then
      select appointment_id, queue_number into new_appointment_id, new_queue_number
        from public.book_service_session(
          p_clinic_id, v_service_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_answers
        );
    else
      select appointment_id, queue_number into new_appointment_id, new_queue_number
        from public.book_number(
          p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_service_id
        );
    end if;
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform public.restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform public.consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update public.appointments
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id,
           booking_answers = v_answers
     where id = new_appointment_id and clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments
       set service_id = v_service_id, booking_answers = v_answers
     where id = new_appointment_id and clinic_id = p_clinic_id;
  end if;

  update public.appointments set status = 'cancelled' where id = p_old_appointment_id and clinic_id = p_clinic_id;
  update public.appointment_status_events
     set note = 'rescheduled appointment'
   where id = (
     select id from public.appointment_status_events
      where appointment_id = p_old_appointment_id
        and clinic_id = p_clinic_id
        and to_status = 'cancelled'
      order by created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) from public, anon, authenticated;
grant execute on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) to service_role;
-- Allow a service/resource booking to be rescheduled without inventing a provider.
begin;

create or replace function public.reschedule_service_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid default null,
  p_service_id uuid default null,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_appt record;
  new_appointment_id uuid;
  new_queue_number integer;
  v_service_id uuid;
  v_answers jsonb;
begin
  select patient_id, visit_type, is_self_pay, membership_id, service_id, booking_answers, status
    into old_appt
    from public.appointments
   where id = p_old_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;

  v_service_id := coalesce(p_service_id, old_appt.service_id);
  v_answers := coalesce(old_appt.booking_answers, '{}'::jsonb);

  -- Mark the old row cancelled before booking so same-day reschedule passes the duplicate-day guard.
  -- The enclosing transaction rolls this back automatically if the new slot cannot be booked.
  update public.appointments set status = 'cancelled' where id = p_old_appointment_id and clinic_id = p_clinic_id;
  if p_doctor_id is null and v_service_id is null then
    raise exception 'service or provider is required';
  end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active
  ) then raise exception 'doctor is unavailable'; end if;
  if v_service_id is not null and not exists (
    select 1 from public.services where id = v_service_id and clinic_id = p_clinic_id and active
  ) then raise exception 'service is unavailable'; end if;

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    if p_doctor_id is null then
      new_appointment_id := public.book_service_slot(
        p_clinic_id, v_service_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_answers
      );
    else
      new_appointment_id := public.book_time_slot(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      );
    end if;
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    if p_doctor_id is null then
      select appointment_id, queue_number into new_appointment_id, new_queue_number
        from public.book_service_session(
          p_clinic_id, v_service_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_answers
        );
    else
      select appointment_id, queue_number into new_appointment_id, new_queue_number
        from public.book_number(
          p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_service_id
        );
    end if;
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform public.restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform public.consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update public.appointments
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id,
           booking_answers = v_answers
     where id = new_appointment_id and clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments
       set service_id = v_service_id, booking_answers = v_answers
     where id = new_appointment_id and clinic_id = p_clinic_id;
  end if;

  update public.appointments set status = 'cancelled' where id = p_old_appointment_id and clinic_id = p_clinic_id;
  update public.appointment_status_events
     set note = 'rescheduled appointment'
   where id = (
     select id from public.appointment_status_events
      where appointment_id = p_old_appointment_id
        and clinic_id = p_clinic_id
        and to_status = 'cancelled'
      order by created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) from public, anon, authenticated;
grant execute on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) to service_role;

commit;
commit;
-- Keep the legacy queue/progress surface available only when a brand explicitly opts in.
begin;

alter table public.clinic_settings
  add column if not exists legacy_progress_enabled boolean not null default false;

commit;
-- Rich Menu second-batch product capabilities: aliases, scheduled display windows,
-- privacy-safe insight linkage, explicit cloning, and auditable schedule execution.
begin;

alter table public.line_richmenu_versions
  add column if not exists source_version_id uuid;

create unique index if not exists line_richmenu_versions_clinic_id_id_uidx
  on public.line_richmenu_versions (clinic_id, id);

do $$
begin
  alter table public.line_richmenu_versions
    add constraint line_richmenu_versions_source_tenant_fkey
    foreign key (clinic_id, source_version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict;
exception when duplicate_object then null;
end $$;

create index if not exists line_richmenu_versions_source_idx
  on public.line_richmenu_versions (clinic_id, source_version_id)
  where source_version_id is not null;

create table if not exists public.line_richmenu_aliases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  channel_destination text not null,
  alias_id text not null,
  label text not null,
  version_id uuid not null,
  line_rich_menu_id text not null,
  status text not null default 'ready'
    check (status in ('ready', 'error', 'removed')),
  last_error text,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, alias_id),
  foreign key (clinic_id, version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict,
  check (alias_id ~ '^[a-z0-9_-]{1,32}$'),
  check (length(btrim(label)) between 1 and 40)
);

create index if not exists line_richmenu_aliases_version_idx
  on public.line_richmenu_aliases (clinic_id, version_id)
  where status <> 'removed';
create unique index if not exists line_richmenu_aliases_channel_alias_uidx
  on public.line_richmenu_aliases (channel_destination, alias_id)
  where status <> 'removed';

create table if not exists public.line_richmenu_schedules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  version_id uuid not null,
  previous_version_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'activating', 'active', 'expiring', 'completed', 'cancelled', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict,
  foreign key (clinic_id, previous_version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict,
  check (ends_at > starts_at)
);

create index if not exists line_richmenu_schedules_due_idx
  on public.line_richmenu_schedules (status, starts_at, ends_at)
  where status in ('scheduled', 'activating', 'active', 'expiring');
create index if not exists line_richmenu_schedules_clinic_idx
  on public.line_richmenu_schedules (clinic_id, starts_at desc);

drop trigger if exists trg_line_richmenu_aliases_touch on public.line_richmenu_aliases;
create trigger trg_line_richmenu_aliases_touch before update on public.line_richmenu_aliases
for each row execute function public.touch_updated_at();
drop trigger if exists trg_line_richmenu_schedules_touch on public.line_richmenu_schedules;
create trigger trg_line_richmenu_schedules_touch before update on public.line_richmenu_schedules
for each row execute function public.touch_updated_at();

alter table public.line_richmenu_aliases enable row level security;
alter table public.line_richmenu_schedules enable row level security;
revoke all on table public.line_richmenu_aliases from public, anon, authenticated;
revoke all on table public.line_richmenu_schedules from public, anon, authenticated;
grant select on table public.line_richmenu_aliases to authenticated;
grant select on table public.line_richmenu_schedules to authenticated;

drop policy if exists line_richmenu_aliases_admin on public.line_richmenu_aliases;
create policy line_richmenu_aliases_admin on public.line_richmenu_aliases
for select to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_aliases.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

drop policy if exists line_richmenu_schedules_admin on public.line_richmenu_schedules;
create policy line_richmenu_schedules_admin on public.line_richmenu_schedules
for select to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_schedules.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

alter table public.line_richmenu_publication_events
  drop constraint if exists line_richmenu_publication_events_kind_check;
alter table public.line_richmenu_publication_events
  add constraint line_richmenu_publication_events_kind_check check (kind in (
    'validated', 'validation_failed', 'published', 'publish_failed', 'rolled_back', 'unpublished',
    'scheduled', 'scheduled_published', 'schedule_failed', 'schedule_completed'
  ));

create or replace function public.clone_line_richmenu_version(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_source_version_id uuid,
  p_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  source_version public.line_richmenu_versions%rowtype;
  v_id uuid;
  v_version integer;
  v_name text;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;

  select * into source_version
    from public.line_richmenu_versions version
   where version.id = p_source_version_id
     and version.clinic_id = p_clinic_id;
  if not found then raise exception 'Rich Menu source version not found'; end if;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), source_version.name || ' 複本');
  if length(v_name) > 120 then raise exception 'rich menu version name is invalid'; end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-version:' || p_clinic_id::text));
  select coalesce(max(version.version_no), 0) + 1 into v_version
    from public.line_richmenu_versions version where version.clinic_id = p_clinic_id;

  insert into public.line_richmenu_versions (
    clinic_id, version_no, name, template_key, layout, chat_bar_text, slots,
    status, validation_errors, created_by, source_version_id
  ) values (
    p_clinic_id, v_version, v_name, source_version.template_key, source_version.layout,
    source_version.chat_bar_text, source_version.slots, 'draft', '[]'::jsonb,
    p_actor_user_id, source_version.id
  ) returning id into v_id;

  insert into public.line_richmenu (clinic_id) values (p_clinic_id)
  on conflict (clinic_id) do nothing;
  update public.line_richmenu
     set draft_version_id = v_id, updated_at = now()
   where clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.create_line_richmenu_schedule(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  if p_starts_at <= now() then raise exception 'schedule start must be in the future'; end if;
  if p_ends_at <= p_starts_at then raise exception 'schedule end must be after start'; end if;
  if not exists (
    select 1 from public.line_richmenu_versions version
     where version.id = p_version_id
       and version.clinic_id = p_clinic_id
       and version.line_rich_menu_id is not null
  ) then raise exception 'scheduled version must already exist on LINE'; end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-schedule:' || p_clinic_id::text));
  if exists (
    select 1 from public.line_richmenu_schedules schedule
     where schedule.clinic_id = p_clinic_id
       and schedule.status in ('scheduled', 'activating', 'active', 'expiring')
       and tstzrange(schedule.starts_at, schedule.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'Rich Menu display schedule overlaps an existing schedule'; end if;

  insert into public.line_richmenu_schedules (
    clinic_id, version_id, starts_at, ends_at, created_by
  ) values (
    p_clinic_id, p_version_id, p_starts_at, p_ends_at, p_actor_user_id
  ) returning id into v_id;
  insert into public.line_richmenu_publication_events (
    clinic_id, version_id, kind, actor_id, metadata
  ) values (
    p_clinic_id, p_version_id, 'scheduled', p_actor_user_id,
    jsonb_build_object('schedule_id', v_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at)
  );
  return v_id;
end;
$$;

create or replace function public.cancel_line_richmenu_schedule(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_schedule_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  update public.line_richmenu_schedules schedule
     set status = 'cancelled', completed_at = now(), claimed_at = null,
         last_error = 'cancelled by operator', updated_at = now()
   where schedule.id = p_schedule_id
     and schedule.clinic_id = p_clinic_id
     and schedule.status = 'scheduled';
  if not found then raise exception 'only a pending Rich Menu schedule can be cancelled'; end if;
end;
$$;

create or replace function public.claim_due_line_richmenu_schedules(p_limit integer default 10)
returns table (
  schedule_id uuid,
  clinic_id uuid,
  action text,
  version_id uuid,
  line_rich_menu_id text,
  restore_version_id uuid,
  restore_line_rich_menu_id text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare candidate record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;

  update public.line_richmenu_schedules schedule
     set status = case when schedule.status = 'activating' then 'scheduled' else 'active' end,
         claimed_at = null,
         last_error = coalesce(schedule.last_error, 'stale claim recovered'),
         updated_at = now()
   where schedule.status in ('activating', 'expiring')
     and schedule.claimed_at < now() - interval '10 minutes'
     and schedule.attempt_count < 5;

  update public.line_richmenu_schedules schedule
     set status = 'failed', claimed_at = null,
         last_error = coalesce(schedule.last_error, 'retry limit reached'), updated_at = now()
   where schedule.status in ('activating', 'expiring')
     and schedule.claimed_at < now() - interval '10 minutes'
     and schedule.attempt_count >= 5;

  with expired_windows as (
    update public.line_richmenu_schedules schedule
       set status = 'failed', completed_at = now(), claimed_at = null,
           last_error = 'display window ended before activation', updated_at = now()
     where schedule.status = 'scheduled'
       and schedule.ends_at <= now()
     returning schedule.id, schedule.clinic_id, schedule.version_id
  )
  insert into public.line_richmenu_publication_events (
    clinic_id, version_id, kind, error, metadata
  )
  select expired.clinic_id, expired.version_id, 'schedule_failed',
         'display window ended before activation', jsonb_build_object('schedule_id', expired.id, 'action', 'activate')
    from expired_windows expired;

  for candidate in
    select schedule.id, schedule.clinic_id, schedule.version_id, schedule.previous_version_id,
           schedule.status, schedule.starts_at, schedule.ends_at, schedule.attempt_count,
           version.line_rich_menu_id,
           previous.line_rich_menu_id as previous_line_rich_menu_id,
           menu.published_version_id
      from public.line_richmenu_schedules schedule
      join public.line_richmenu_versions version
        on version.id = schedule.version_id and version.clinic_id = schedule.clinic_id
      left join public.line_richmenu_versions previous
        on previous.id = schedule.previous_version_id and previous.clinic_id = schedule.clinic_id
      left join public.line_richmenu menu on menu.clinic_id = schedule.clinic_id
     where schedule.attempt_count < 5
       and ((schedule.status = 'scheduled' and schedule.starts_at <= now())
         or (schedule.status = 'active' and schedule.ends_at <= now()))
     order by case when schedule.status = 'active' then schedule.ends_at else schedule.starts_at end,
              schedule.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update of schedule skip locked
  loop
    if candidate.status = 'active' and candidate.published_version_id is distinct from candidate.version_id then
      update public.line_richmenu_schedules schedule
         set status = 'completed', completed_at = now(),
             last_error = 'manual publication superseded this schedule', updated_at = now()
       where schedule.id = candidate.id;
      continue;
    end if;

    update public.line_richmenu_schedules schedule
       set status = case when candidate.status = 'scheduled' then 'activating' else 'expiring' end,
           claimed_at = now(), attempt_count = schedule.attempt_count + 1,
           last_error = null, updated_at = now()
     where schedule.id = candidate.id;

    schedule_id := candidate.id;
    clinic_id := candidate.clinic_id;
    action := case when candidate.status = 'scheduled' then 'activate' else 'expire' end;
    version_id := candidate.version_id;
    line_rich_menu_id := candidate.line_rich_menu_id;
    restore_version_id := candidate.previous_version_id;
    restore_line_rich_menu_id := candidate.previous_line_rich_menu_id;
    attempt_count := candidate.attempt_count + 1;
    return next;
  end loop;
end;
$$;

create or replace function public.finish_line_richmenu_schedule(
  p_schedule_id uuid,
  p_action text,
  p_success boolean,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  schedule_row public.line_richmenu_schedules%rowtype;
  current_version_id uuid;
  restore_line_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_action not in ('activate', 'expire') then raise exception 'invalid Rich Menu schedule action'; end if;

  select * into schedule_row from public.line_richmenu_schedules schedule
   where schedule.id = p_schedule_id for update;
  if not found then raise exception 'Rich Menu schedule not found'; end if;
  if (p_action = 'activate' and schedule_row.status <> 'activating')
     or (p_action = 'expire' and schedule_row.status <> 'expiring') then
    raise exception 'Rich Menu schedule is not claimed for this action';
  end if;

  if not p_success then
    update public.line_richmenu_schedules schedule
       set status = case
         when schedule.attempt_count >= 5 then 'failed'
         when p_action = 'activate' then 'scheduled'
         else 'active'
       end,
       claimed_at = null,
       last_error = left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
       updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (
      clinic_id, version_id, kind, error, metadata
    ) values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_failed',
      left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
      jsonb_build_object('schedule_id', schedule_row.id, 'action', p_action, 'attempt', schedule_row.attempt_count)
    );
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || schedule_row.clinic_id::text));
  select menu.published_version_id
    into current_version_id
    from public.line_richmenu menu
   where menu.clinic_id = schedule_row.clinic_id for update;

  if p_action = 'activate' then
    update public.line_richmenu_versions version
       set status = 'archived', updated_at = now()
     where version.clinic_id = schedule_row.clinic_id
       and version.status = 'published'
       and version.id <> schedule_row.version_id;
    update public.line_richmenu_versions version
       set status = 'published', published_at = now(), updated_at = now()
     where version.id = schedule_row.version_id and version.clinic_id = schedule_row.clinic_id;
    insert into public.line_richmenu (clinic_id, published_id, published_version_id, draft_version_id, updated_at)
    select schedule_row.clinic_id, version.line_rich_menu_id, version.id, version.id, now()
      from public.line_richmenu_versions version
     where version.id = schedule_row.version_id
    on conflict (clinic_id) do update set
      published_id = excluded.published_id,
      published_version_id = excluded.published_version_id,
      draft_version_id = excluded.draft_version_id,
      updated_at = now();
    update public.line_richmenu_schedules schedule
       set status = 'active', previous_version_id = coalesce(schedule.previous_version_id, current_version_id),
           activated_at = now(), claimed_at = null, last_error = null, updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (
      clinic_id, version_id, kind, line_rich_menu_id, metadata
    ) select schedule_row.clinic_id, schedule_row.version_id, 'scheduled_published',
             version.line_rich_menu_id, jsonb_build_object('schedule_id', schedule_row.id)
        from public.line_richmenu_versions version where version.id = schedule_row.version_id;
  else
    if current_version_id is distinct from schedule_row.version_id then
      update public.line_richmenu_schedules schedule
         set status = 'completed', completed_at = now(), claimed_at = null,
             last_error = 'manual publication superseded this schedule', updated_at = now()
       where schedule.id = p_schedule_id;
      return;
    end if;

    update public.line_richmenu_versions version
       set status = 'archived', updated_at = now()
     where version.id = schedule_row.version_id and version.clinic_id = schedule_row.clinic_id;
    select version.line_rich_menu_id into restore_line_id
      from public.line_richmenu_versions version
     where version.id = schedule_row.previous_version_id
       and version.clinic_id = schedule_row.clinic_id;
    if schedule_row.previous_version_id is not null and restore_line_id is not null then
      update public.line_richmenu_versions version
         set status = 'published', published_at = now(), updated_at = now()
       where version.id = schedule_row.previous_version_id and version.clinic_id = schedule_row.clinic_id;
    end if;
    update public.line_richmenu menu
       set published_id = restore_line_id,
           published_version_id = case when restore_line_id is null then null else schedule_row.previous_version_id end,
           updated_at = now()
     where menu.clinic_id = schedule_row.clinic_id;
    update public.line_richmenu_schedules schedule
       set status = 'completed', completed_at = now(), claimed_at = null,
           last_error = null, updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (
      clinic_id, version_id, kind, line_rich_menu_id, metadata
    ) values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_completed',
      restore_line_id, jsonb_build_object('schedule_id', schedule_row.id, 'restored_version_id', schedule_row.previous_version_id)
    );
  end if;
end;
$$;

revoke all on function public.clone_line_richmenu_version(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_line_richmenu_schedule(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_line_richmenu_schedule(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_due_line_richmenu_schedules(integer) from public, anon, authenticated;
revoke all on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.clone_line_richmenu_version(uuid, uuid, uuid, text) to service_role;
grant execute on function public.create_line_richmenu_schedule(uuid, uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.cancel_line_richmenu_schedule(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_due_line_richmenu_schedules(integer) to service_role;
grant execute on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) to service_role;

commit;

-- Resolve PL/pgSQL output-column ambiguity reported by `supabase db lint`
-- without changing business behavior or grants.
begin;

create or replace function public.create_brand_with_owner(
  p_actor_user_id uuid,
  p_source_clinic_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
) returns table (clinic_id uuid, clinic_name text, clinic_slug text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_source_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then
    raise exception '無權限建立品牌';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception '品牌名稱格式錯誤'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then
    raise exception '品牌短網址格式錯誤';
  end if;

  insert into public.clinics (name, slug, phone, address)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
  returning id into v_id;

  insert into public.clinic_settings (clinic_id) values (v_id)
  on conflict on constraint clinic_settings_pkey do nothing;
  insert into public.clinic_members (clinic_id, user_id, role)
  values (v_id, p_actor_user_id, 'owner');

  return query select v_id, v_name, v_slug;
exception
  when unique_violation then
    raise exception '品牌短網址已存在' using errcode = '23505';
end;
$$;

create or replace function public.create_brand_with_platform_admin(
  p_actor_user_id uuid,
  p_owner_user_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
)
returns table (clinic_id uuid, owner_user_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.platform_admins platform_admin
     where platform_admin.user_id = p_actor_user_id and platform_admin.active
  ) then
    raise exception 'platform admin access required';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'invalid brand name'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception 'invalid brand slug'; end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = p_owner_user_id) then
    raise exception 'owner user not found';
  end if;

  insert into public.clinics (name, slug, phone, address, active)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''), true)
  returning id into v_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role)
  values (v_clinic_id, p_owner_user_id, 'owner')
  on conflict on constraint clinic_members_pkey do update set role = 'owner';

  return query select v_clinic_id, p_owner_user_id;
exception
  when unique_violation then
    raise exception 'brand slug already exists' using errcode = '23505';
end;
$$;

create or replace function public.grant_patient_membership(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_plan_id uuid,
  p_actor_user_id uuid,
  p_source text default 'manual',
  p_note text default null
) returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  plan_row record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  if p_source not in ('manual', 'purchase', 'migration') then raise exception 'invalid membership source'; end if;
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role <> 'provider'
  ) then raise exception 'membership actor is not allowed'; end if;
  if not exists (
    select 1 from public.patients patient
     where patient.id = p_patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then raise exception 'patient not found'; end if;
  select plan.* into plan_row
    from public.membership_plans plan
   where plan.id = p_plan_id and plan.clinic_id = p_clinic_id and plan.active;
  if not found then raise exception 'membership plan not found'; end if;
  if plan_row.valid_days is not null then
    v_expires := now() + (plan_row.valid_days || ' days')::interval;
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (
      select 1 from public.patient_memberships membership
       where membership.clinic_id = p_clinic_id and membership.membership_code = v_code
    );
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
  values
    (p_clinic_id, p_patient_id, p_plan_id, v_code, plan_row.credits_total, plan_row.credits_total, now(), v_expires, p_source, nullif(btrim(p_note), ''))
  returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, actor_id, note)
  values
    (p_clinic_id, v_id, p_patient_id, 'grant', plan_row.credits_total, 'manual', p_actor_user_id, p_note);
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;

create or replace function public.grant_paid_membership_from_order(
  p_clinic_id uuid,
  p_payment_order_id uuid
)
returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_row record;
  plan_row record;
  existing record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  select payment_order.id, payment_order.status, payment_order.clinic_id, payment_order.patient_id, payment_order.membership_plan_id
    into order_row
    from public.payment_orders payment_order
   where payment_order.id = p_payment_order_id and payment_order.clinic_id = p_clinic_id
   for update;
  if not found or order_row.membership_plan_id is null or order_row.patient_id is null then
    raise exception 'membership payment order not found';
  end if;
  if order_row.status <> 'paid' then raise exception 'membership payment is not paid'; end if;
  select membership.id, membership.membership_code, membership.expires_at, membership.credits_remaining
    into existing
    from public.patient_memberships membership
   where membership.payment_order_id = p_payment_order_id;
  if found then
    return query select existing.id, existing.membership_code, existing.expires_at, existing.credits_remaining;
    return;
  end if;
  select plan.* into plan_row
    from public.membership_plans plan
   where plan.id = order_row.membership_plan_id and plan.clinic_id = p_clinic_id;
  if not found then raise exception 'membership plan not found'; end if;
  if not exists (
    select 1 from public.patients patient
     where patient.id = order_row.patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then raise exception 'patient not found'; end if;
  if plan_row.valid_days is not null then
    v_expires := now() + (plan_row.valid_days || ' days')::interval;
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (
      select 1 from public.patient_memberships membership
       where membership.clinic_id = p_clinic_id and membership.membership_code = v_code
    );
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, payment_order_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
  values
    (p_clinic_id, order_row.patient_id, order_row.membership_plan_id, p_payment_order_id, v_code, plan_row.credits_total, plan_row.credits_total, now(), v_expires, 'purchase', 'membership payment purchase')
  returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, note)
  values
    (p_clinic_id, v_id, order_row.patient_id, 'grant', plan_row.credits_total, 'payment_order', p_payment_order_id, 'membership payment purchase');
  return query select v_id, v_code, v_expires, plan_row.credits_total;
end;
$$;

create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_ticket_type_id uuid,
  p_name text,
  p_phone text,
  p_email text default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb,
  p_access_token text default null,
  p_discount_code text default null,
  p_membership_code text default null,
  p_form_id uuid default null,
  p_form_version integer default null,
  p_terms_version integer default null,
  p_terms_accepted_at timestamptz default null,
  p_patient_id uuid default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  registration_result record;
begin
  if p_patient_id is not null and not exists (
    select 1 from public.patients patient
     where patient.id = p_patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then
    raise exception 'patient is not valid for this brand';
  end if;

  select * into registration_result from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations registration
     set terms_version = p_terms_version,
         terms_accepted_at = p_terms_accepted_at,
         patient_id = p_patient_id
   where registration.id = registration_result.registration_id
     and registration.clinic_id = p_clinic_id;
  update public.discount_redemptions redemption
     set patient_id = p_patient_id
   where redemption.clinic_id = p_clinic_id
     and redemption.registration_id = registration_result.registration_id;
  return query select
    registration_result.registration_id,
    registration_result.registration_no,
    registration_result.registration_status,
    registration_result.payment_status,
    registration_result.amount,
    registration_result.discount_amount,
    registration_result.membership_applied,
    registration_result.checkin_token;
end;
$$;

create or replace function public.reschedule_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null,
  p_service_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_appt record;
  new_appointment_id uuid;
  v_service_id uuid;
begin
  select appointment.patient_id, appointment.visit_type, appointment.is_self_pay,
         appointment.membership_id, appointment.service_id, appointment.status
    into old_appt
    from public.appointments appointment
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;
  v_service_id := coalesce(p_service_id, old_appt.service_id);

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    new_appointment_id := public.book_time_slot(
      p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
      old_appt.visit_type, old_appt.is_self_pay, v_service_id
    );
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    select booking.appointment_id into new_appointment_id
      from public.book_number(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      ) booking;
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform public.restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform public.consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update public.appointments appointment
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments appointment
       set service_id = v_service_id
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  end if;

  update public.appointments appointment
     set status = 'cancelled'
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id;
  update public.appointment_status_events status_event
     set note = 'rescheduled appointment'
   where status_event.id = (
     select latest_status.id from public.appointment_status_events latest_status
      where latest_status.appointment_id = p_old_appointment_id
        and latest_status.clinic_id = p_clinic_id
        and latest_status.to_status = 'cancelled'
      order by latest_status.created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

create or replace function public.reschedule_service_appointment(
  p_clinic_id uuid,
  p_old_appointment_id uuid,
  p_mode text,
  p_doctor_id uuid default null,
  p_service_id uuid default null,
  p_start_at timestamptz default null,
  p_template_id uuid default null,
  p_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_appt record;
  new_appointment_id uuid;
  v_service_id uuid;
  v_answers jsonb;
begin
  select appointment.patient_id, appointment.visit_type, appointment.is_self_pay,
         appointment.membership_id, appointment.service_id, appointment.booking_answers, appointment.status
    into old_appt
    from public.appointments appointment
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id
   for update;
  if not found then raise exception 'appointment not found'; end if;
  if old_appt.status not in ('booked', 'confirmed') then raise exception 'appointment cannot be rescheduled'; end if;

  v_service_id := coalesce(p_service_id, old_appt.service_id);
  v_answers := coalesce(old_appt.booking_answers, '{}'::jsonb);

  update public.appointments appointment
     set status = 'cancelled'
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id;
  if p_doctor_id is null and v_service_id is null then raise exception 'service or provider is required'; end if;
  if p_doctor_id is not null and not exists (
    select 1 from public.doctors doctor
     where doctor.id = p_doctor_id and doctor.clinic_id = p_clinic_id and doctor.active
  ) then raise exception 'doctor is unavailable'; end if;
  if v_service_id is not null and not exists (
    select 1 from public.services service
     where service.id = v_service_id and service.clinic_id = p_clinic_id and service.active
  ) then raise exception 'service is unavailable'; end if;

  if p_mode = 'time' then
    if p_start_at is null then raise exception 'start_at is required'; end if;
    if p_doctor_id is null then
      new_appointment_id := public.book_service_slot(
        p_clinic_id, v_service_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_answers
      );
    else
      new_appointment_id := public.book_time_slot(
        p_clinic_id, p_doctor_id, old_appt.patient_id, p_start_at,
        old_appt.visit_type, old_appt.is_self_pay, v_service_id
      );
    end if;
  elsif p_mode = 'number' then
    if p_template_id is null or p_date is null then raise exception 'template_id and date are required'; end if;
    if p_doctor_id is null then
      select booking.appointment_id into new_appointment_id
        from public.book_service_session(
          p_clinic_id, v_service_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_answers
        ) booking;
    else
      select booking.appointment_id into new_appointment_id
        from public.book_number(
          p_clinic_id, p_doctor_id, old_appt.patient_id, p_template_id, p_date,
          old_appt.visit_type, old_appt.is_self_pay, v_service_id
        ) booking;
    end if;
  else
    raise exception 'invalid booking mode';
  end if;

  if old_appt.membership_id is not null then
    perform public.restore_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', p_old_appointment_id,
      'rescheduled appointment'
    );
    perform public.consume_membership_credit(
      p_clinic_id, old_appt.membership_id, 'appointment', 'appointment',
      new_appointment_id, v_service_id, null, 'rescheduled appointment'
    );
    update public.appointments appointment
       set membership_id = old_appt.membership_id,
           deposit_status = 'waived',
           deposit_amount = 0,
           service_id = v_service_id,
           booking_answers = v_answers
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  elsif v_service_id is not null then
    update public.appointments appointment
       set service_id = v_service_id, booking_answers = v_answers
     where appointment.id = new_appointment_id and appointment.clinic_id = p_clinic_id;
  end if;

  update public.appointments appointment
     set status = 'cancelled'
   where appointment.id = p_old_appointment_id and appointment.clinic_id = p_clinic_id;
  update public.appointment_status_events status_event
     set note = 'rescheduled appointment'
   where status_event.id = (
     select latest_status.id from public.appointment_status_events latest_status
      where latest_status.appointment_id = p_old_appointment_id
        and latest_status.clinic_id = p_clinic_id
        and latest_status.to_status = 'cancelled'
      order by latest_status.created_at desc
      limit 1
   );
  return new_appointment_id;
end;
$$;

revoke all on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.grant_patient_membership(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.grant_paid_membership_from_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, uuid, text, uuid, timestamptz, uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) from public, anon, authenticated;

grant execute on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.grant_patient_membership(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.grant_paid_membership_from_order(uuid, uuid) to service_role;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) to service_role;
grant execute on function public.reschedule_appointment(uuid, uuid, text, uuid, timestamptz, uuid, date, uuid) to service_role;
grant execute on function public.reschedule_service_appointment(uuid, uuid, text, uuid, uuid, timestamptz, uuid, date) to service_role;

commit;

-- Follow up the staging DB lint findings without rewriting an applied migration.
begin;

alter table public.clinics
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_clinics_touch on public.clinics;
create trigger trg_clinics_touch
before update on public.clinics
for each row execute function public.touch_updated_at();

create or replace function public.record_line_richmenu_publication(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_line_rich_menu_id text,
  p_kind text default 'published',
  p_image_sha256 text default null,
  p_image_width integer default null,
  p_image_height integer default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_kind not in ('published', 'rolled_back') then raise exception 'invalid publication kind'; end if;
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  if nullif(btrim(coalesce(p_line_rich_menu_id, '')), '') is null then raise exception 'LINE Rich Menu ID is required'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || p_clinic_id::text));
  if not exists (select 1 from public.line_richmenu_versions version where version.id = p_version_id and version.clinic_id = p_clinic_id) then
    raise exception 'Rich Menu version not found';
  end if;
  update public.line_richmenu_versions
     set status = 'archived', updated_at = now()
   where clinic_id = p_clinic_id and status = 'published' and id <> p_version_id;
  update public.line_richmenu_versions
     set status = 'published', line_rich_menu_id = btrim(p_line_rich_menu_id),
         image_sha256 = coalesce(p_image_sha256, image_sha256),
         image_width = coalesce(p_image_width, image_width),
         image_height = coalesce(p_image_height, image_height),
         validation_errors = '[]'::jsonb, published_at = now(), updated_at = now()
   where id = p_version_id and clinic_id = p_clinic_id;
  insert into public.line_richmenu (clinic_id, published_id, published_version_id, draft_version_id, updated_at)
  values (p_clinic_id, btrim(p_line_rich_menu_id), p_version_id, p_version_id, now())
  on conflict (clinic_id) do update set
    published_id = excluded.published_id,
    published_version_id = excluded.published_version_id,
    draft_version_id = excluded.draft_version_id,
    updated_at = now();
  insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, line_rich_menu_id)
  values (p_clinic_id, p_version_id, p_kind, p_actor_user_id, btrim(p_line_rich_menu_id));
end;
$$;

create or replace function public.finish_line_richmenu_schedule(
  p_schedule_id uuid,
  p_action text,
  p_success boolean,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  schedule_row public.line_richmenu_schedules%rowtype;
  current_version_id uuid;
  restore_line_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_action not in ('activate', 'expire') then raise exception 'invalid Rich Menu schedule action'; end if;

  select * into schedule_row from public.line_richmenu_schedules schedule
   where schedule.id = p_schedule_id for update;
  if not found then raise exception 'Rich Menu schedule not found'; end if;
  if (p_action = 'activate' and schedule_row.status <> 'activating')
     or (p_action = 'expire' and schedule_row.status <> 'expiring') then
    raise exception 'Rich Menu schedule is not claimed for this action';
  end if;

  if not p_success then
    update public.line_richmenu_schedules schedule
       set status = case
         when schedule.attempt_count >= 5 then 'failed'
         when p_action = 'activate' then 'scheduled'
         else 'active'
       end,
       claimed_at = null,
       last_error = left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
       updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, error, metadata)
    values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_failed',
      left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
      jsonb_build_object('schedule_id', schedule_row.id, 'action', p_action, 'attempt', schedule_row.attempt_count)
    );
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || schedule_row.clinic_id::text));
  select menu.published_version_id
    into current_version_id
    from public.line_richmenu menu
   where menu.clinic_id = schedule_row.clinic_id for update;

  if p_action = 'activate' then
    update public.line_richmenu_versions version
       set status = 'archived', updated_at = now()
     where version.clinic_id = schedule_row.clinic_id
       and version.status = 'published'
       and version.id <> schedule_row.version_id;
    update public.line_richmenu_versions version
       set status = 'published', published_at = now(), updated_at = now()
     where version.id = schedule_row.version_id and version.clinic_id = schedule_row.clinic_id;
    insert into public.line_richmenu (clinic_id, published_id, published_version_id, draft_version_id, updated_at)
    select schedule_row.clinic_id, version.line_rich_menu_id, version.id, version.id, now()
      from public.line_richmenu_versions version
     where version.id = schedule_row.version_id
    on conflict (clinic_id) do update set
      published_id = excluded.published_id,
      published_version_id = excluded.published_version_id,
      draft_version_id = excluded.draft_version_id,
      updated_at = now();
    update public.line_richmenu_schedules schedule
       set status = 'active', previous_version_id = coalesce(schedule.previous_version_id, current_version_id),
           activated_at = now(), claimed_at = null, last_error = null, updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, line_rich_menu_id, metadata)
    select schedule_row.clinic_id, schedule_row.version_id, 'scheduled_published',
           version.line_rich_menu_id, jsonb_build_object('schedule_id', schedule_row.id)
      from public.line_richmenu_versions version where version.id = schedule_row.version_id;
  else
    if current_version_id is distinct from schedule_row.version_id then
      update public.line_richmenu_schedules schedule
         set status = 'completed', completed_at = now(), claimed_at = null,
             last_error = 'manual publication superseded this schedule', updated_at = now()
       where schedule.id = p_schedule_id;
      return;
    end if;

    update public.line_richmenu_versions version
       set status = 'archived', updated_at = now()
     where version.id = schedule_row.version_id and version.clinic_id = schedule_row.clinic_id;
    select version.line_rich_menu_id into restore_line_id
      from public.line_richmenu_versions version
     where version.id = schedule_row.previous_version_id
       and version.clinic_id = schedule_row.clinic_id;
    if schedule_row.previous_version_id is not null and restore_line_id is not null then
      update public.line_richmenu_versions version
         set status = 'published', published_at = now(), updated_at = now()
       where version.id = schedule_row.previous_version_id and version.clinic_id = schedule_row.clinic_id;
    end if;
    update public.line_richmenu menu
       set published_id = restore_line_id,
           published_version_id = case when restore_line_id is null then null else schedule_row.previous_version_id end,
           updated_at = now()
     where menu.clinic_id = schedule_row.clinic_id;
    update public.line_richmenu_schedules schedule
       set status = 'completed', completed_at = now(), claimed_at = null,
           last_error = null, updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, line_rich_menu_id, metadata)
    values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_completed',
      restore_line_id, jsonb_build_object('schedule_id', schedule_row.id, 'restored_version_id', schedule_row.previous_version_id)
    );
  end if;
end;
$$;

create or replace function public.offer_next_appointment_waitlist(
  p_clinic_id uuid,
  p_target_key text,
  p_offer_minutes integer default 15
) returns table (waitlist_id uuid, appointment_id uuid, patient_id uuid, offer_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  candidate record;
  booking record;
  v_appointment_id uuid;
  v_offer_expires timestamptz;
  v_error text;
begin
  if p_offer_minutes not between 5 and 1440 then raise exception 'invalid waitlist offer duration'; end if;
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || p_target_key));
  for candidate in
    select * from public.appointment_waitlist_entries
     where clinic_id = p_clinic_id and target_key = p_target_key and status = 'waiting'
     order by position, created_at
     for update skip locked
  loop
    v_appointment_id := null;
    v_error := null;
    begin
      if candidate.booking_mode = 'time' then
        if candidate.doctor_id is null then
          v_appointment_id := public.book_service_slot(
            candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
          );
        elsif candidate.service_id is null then
          v_appointment_id := public.book_time_slot(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, null
          );
        else
          v_appointment_id := public.book_time_slot_for_service(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.service_id
          );
        end if;
      elsif candidate.doctor_id is null then
        select * into booking from public.book_service_session(
          candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
        );
        v_appointment_id := booking.appointment_id;
      elsif candidate.service_id is null then
        select * into booking from public.book_number(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, null
        );
        v_appointment_id := booking.appointment_id;
      else
        select * into booking from public.book_number_for_service(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.service_id
        );
        v_appointment_id := booking.appointment_id;
      end if;
    exception when others then
      v_error := sqlerrm;
    end;

    if v_appointment_id is null then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (candidate.clinic_id, candidate.id, candidate.target_key, 'promotion_failed', candidate.status, candidate.status, v_error);
      if v_error like '%憿遛%' or v_error like '%capacity%' or v_error like '%resource is unavailable%' then
        return;
      end if;
      update public.appointment_waitlist_entries set status = 'expired' where id = candidate.id;
      continue;
    end if;

    v_offer_expires := now() + (p_offer_minutes || ' minutes')::interval;
    update public.appointments
       set waitlist_entry_id = candidate.id,
           booking_answers = candidate.booking_answers,
           note = concat_ws(E'\n', nullif(note, ''), 'waitlist offer')
     where id = v_appointment_id and clinic_id = candidate.clinic_id;
    update public.appointment_waitlist_entries
       set status = 'offered', appointment_id = v_appointment_id,
           offered_at = now(), offer_expires_at = v_offer_expires
     where id = candidate.id and clinic_id = candidate.clinic_id;
    return query select candidate.id, v_appointment_id, candidate.patient_id, v_offer_expires;
    return;
  end loop;
end;
$$;

revoke all on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.offer_next_appointment_waitlist(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) to service_role;
grant execute on function public.offer_next_appointment_waitlist(uuid, text, integer) to service_role;

commit;

-- Preserve a waiting entry when the target is still full. The applied 006
-- migration contained a mojibake replacement for the Chinese capacity marker.
begin;

create or replace function public.offer_next_appointment_waitlist(
  p_clinic_id uuid,
  p_target_key text,
  p_offer_minutes integer default 15
) returns table (waitlist_id uuid, appointment_id uuid, patient_id uuid, offer_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  candidate record;
  booking record;
  v_appointment_id uuid;
  v_offer_expires timestamptz;
  v_error text;
begin
  if p_offer_minutes not between 5 and 1440 then raise exception 'invalid waitlist offer duration'; end if;
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || p_target_key));
  for candidate in
    select * from public.appointment_waitlist_entries
     where clinic_id = p_clinic_id and target_key = p_target_key and status = 'waiting'
     order by position, created_at
     for update skip locked
  loop
    v_appointment_id := null;
    v_error := null;
    begin
      if candidate.booking_mode = 'time' then
        if candidate.doctor_id is null then
          v_appointment_id := public.book_service_slot(
            candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
          );
        elsif candidate.service_id is null then
          v_appointment_id := public.book_time_slot(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, null
          );
        else
          v_appointment_id := public.book_time_slot_for_service(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.service_id
          );
        end if;
      elsif candidate.doctor_id is null then
        select * into booking from public.book_service_session(
          candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
        );
        v_appointment_id := booking.appointment_id;
      elsif candidate.service_id is null then
        select * into booking from public.book_number(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, null
        );
        v_appointment_id := booking.appointment_id;
      else
        select * into booking from public.book_number_for_service(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.service_id
        );
        v_appointment_id := booking.appointment_id;
      end if;
    exception when others then
      v_error := sqlerrm;
    end;

    if v_appointment_id is null then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (candidate.clinic_id, candidate.id, candidate.target_key, 'promotion_failed', candidate.status, candidate.status, v_error);
      if v_error like '%額滿%'
         or v_error like '%capacity%'
         or v_error like '%slot is full%'
         or v_error like '%session is full%'
         or v_error like '%resource is unavailable%' then
        return;
      end if;
      update public.appointment_waitlist_entries
         set status = 'expired'
       where id = candidate.id and clinic_id = candidate.clinic_id;
      continue;
    end if;

    v_offer_expires := now() + (p_offer_minutes || ' minutes')::interval;
    update public.appointments
       set waitlist_entry_id = candidate.id,
           booking_answers = candidate.booking_answers,
           note = concat_ws(E'\n', nullif(note, ''), 'waitlist offer')
     where id = v_appointment_id and clinic_id = candidate.clinic_id;
    update public.appointment_waitlist_entries
       set status = 'offered', appointment_id = v_appointment_id,
           offered_at = now(), offer_expires_at = v_offer_expires
     where id = candidate.id and clinic_id = candidate.clinic_id;
    return query select candidate.id, v_appointment_id, candidate.patient_id, v_offer_expires;
    return;
  end loop;
end;
$$;

revoke all on function public.offer_next_appointment_waitlist(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.offer_next_appointment_waitlist(uuid, text, integer) to service_role;

commit;

-- Final replay of migration 202608110008 after all compatibility definitions.
begin;

alter table public.platform_admins add column if not exists access_type text;
alter table public.platform_admins add column if not exists permissions text[];
update public.platform_admins set access_type = coalesce(access_type, 'system_admin'), permissions = coalesce(permissions, '{}'::text[]);
alter table public.platform_admins alter column access_type set default 'employee';
alter table public.platform_admins alter column access_type set not null;
alter table public.platform_admins alter column permissions set default '{}'::text[];
alter table public.platform_admins alter column permissions set not null;
alter table public.platform_admins drop constraint if exists platform_admins_access_type_check;
alter table public.platform_admins add constraint platform_admins_access_type_check check (access_type in ('system_admin', 'employee'));
alter table public.platform_admins drop constraint if exists platform_admins_permissions_check;
alter table public.platform_admins add constraint platform_admins_permissions_check check (permissions <@ array['platform.overview', 'brands.manage', 'entitlements.manage', 'operations.view', 'reports.view', 'audit.view', 'settings.view']::text[]);

alter table public.clinic_members add column if not exists access_type text;
alter table public.clinic_members add column if not exists permissions text[];
update public.clinic_members
set access_type = coalesce(access_type, case when role in ('owner', 'admin') then 'brand_admin' else 'employee' end),
    permissions = coalesce(permissions, case when role in ('owner', 'admin') then array['brand.manage', 'operations.manage']::text[] when role = 'provider' then array['provider.assigned']::text[] else array['operations.manage']::text[] end);
alter table public.clinic_members alter column access_type set default 'employee';
alter table public.clinic_members alter column access_type set not null;
alter table public.clinic_members alter column permissions set default '{}'::text[];
alter table public.clinic_members alter column permissions set not null;
alter table public.clinic_members drop constraint if exists clinic_members_access_type_check;
alter table public.clinic_members add constraint clinic_members_access_type_check check (access_type in ('brand_admin', 'employee'));
alter table public.clinic_members drop constraint if exists clinic_members_permissions_check;
alter table public.clinic_members add constraint clinic_members_permissions_check check (permissions <@ array['brand.manage', 'operations.manage', 'provider.assigned']::text[]);

create or replace function public.create_brand_with_owner(
  p_actor_user_id uuid, p_source_clinic_id uuid, p_name text, p_slug text,
  p_phone text default null, p_address text default null
) returns table (clinic_id uuid, clinic_name text, clinic_slug text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_source_clinic_id and member.user_id = p_actor_user_id and member.access_type = 'brand_admin') then raise exception '無權限建立品牌'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception '品牌名稱格式錯誤'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception '品牌短網址格式錯誤'; end if;
  insert into public.clinics (name, slug, phone, address) values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), '')) returning id into v_id;
  insert into public.clinic_settings (clinic_id) values (v_id) on conflict on constraint clinic_settings_pkey do nothing;
  insert into public.clinic_members (clinic_id, user_id, role, access_type, permissions) values (v_id, p_actor_user_id, 'owner', 'brand_admin', array['brand.manage', 'operations.manage']::text[]);
  return query select v_id, v_name, v_slug;
exception when unique_violation then raise exception '品牌短網址已存在' using errcode = '23505';
end;
$$;

create or replace function public.create_brand_with_platform_admin(
  p_actor_user_id uuid, p_owner_user_id uuid, p_name text, p_slug text,
  p_phone text default null, p_address text default null
) returns table (clinic_id uuid, owner_user_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_clinic_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.platform_admins platform_member
     where platform_member.user_id = p_actor_user_id and platform_member.active
       and (platform_member.access_type = 'system_admin' or 'brands.manage' = any(platform_member.permissions))
  ) then raise exception 'system brand management permission required'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'invalid brand name'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception 'invalid brand slug'; end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = p_owner_user_id) then raise exception 'brand administrator user not found'; end if;
  insert into public.clinics (name, slug, phone, address, active) values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''), true) returning id into v_clinic_id;
  insert into public.clinic_members (clinic_id, user_id, role, access_type, permissions)
  values (v_clinic_id, p_owner_user_id, 'owner', 'brand_admin', array['brand.manage', 'operations.manage']::text[])
  on conflict on constraint clinic_members_pkey do update set role = 'owner', access_type = 'brand_admin', permissions = array['brand.manage', 'operations.manage']::text[];
  return query select v_clinic_id, p_owner_user_id;
exception when unique_violation then raise exception 'brand slug already exists' using errcode = '23505';
end;
$$;

revoke all on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) to service_role;

commit;

-- Final brand configuration permission boundary. Operational employees retain
-- read access needed for daily work; configuration writes require brand.manage.
-- Align configuration writes with the explicit brand permission model.
-- Operational staff may read schedule context for daily work, but only a
-- brand administrator or an employee with brand.manage may change it.
begin;

drop policy if exists doctors_nonprovider_manage on public.doctors;
drop policy if exists doctors_brand_manage on public.doctors;
create policy doctors_brand_manage on public.doctors for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = doctors.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = doctors.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
);

drop policy if exists schedule_templates_nonprovider_manage on public.schedule_templates;
drop policy if exists schedule_templates_brand_manage on public.schedule_templates;
create policy schedule_templates_brand_manage on public.schedule_templates for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_templates.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_templates.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
  and (schedule_templates.doctor_id is not null or schedule_templates.service_id is not null)
  and (
    schedule_templates.doctor_id is null
    or exists (
      select 1 from public.doctors doctor
       where doctor.id = schedule_templates.doctor_id
         and doctor.clinic_id = schedule_templates.clinic_id
         and doctor.active
    )
  )
  and (
    schedule_templates.service_id is null
    or exists (
      select 1 from public.services service
       where service.id = schedule_templates.service_id
         and service.clinic_id = schedule_templates.clinic_id
         and service.active
    )
  )
);

drop policy if exists schedule_exceptions_nonprovider_manage on public.schedule_exceptions;
drop policy if exists schedule_exceptions_brand_manage on public.schedule_exceptions;
create policy schedule_exceptions_brand_manage on public.schedule_exceptions for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_exceptions.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_exceptions.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
  and (schedule_exceptions.doctor_id is not null or schedule_exceptions.service_id is not null)
  and (
    schedule_exceptions.doctor_id is null
    or exists (
      select 1 from public.doctors doctor
       where doctor.id = schedule_exceptions.doctor_id
         and doctor.clinic_id = schedule_exceptions.clinic_id
         and doctor.active
    )
  )
  and (
    schedule_exceptions.service_id is null
    or exists (
      select 1 from public.services service
       where service.id = schedule_exceptions.service_id
         and service.clinic_id = schedule_exceptions.clinic_id
         and service.active
    )
  )
);

drop policy if exists services_manage on public.services;
drop policy if exists services_brand_manage on public.services;
create policy services_brand_manage on public.services for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = services.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = services.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
);

commit;

-- Final replay of migration 202608120001 after all compatibility definitions.
-- Fix time-mode service bookings: book_time_slot does not persist template_id,
-- so the service wrapper must resolve the already-validated schedule segment
-- from the appointment's Taipei date and time.
begin;

create or replace function public.book_time_slot_for_service(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_appointment record;
  v_settings record;
  v_segment record;
  v_end_at timestamptz;
  v_minutes integer;
  v_date date;
  v_time time;
begin
  v_id := public.book_time_slot(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
  if p_service_id is null then return v_id; end if;

  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  select * into v_appointment from public.appointments where id = v_id and clinic_id = p_clinic_id for update;
  v_minutes := public.service_booking_minutes(
    p_clinic_id,
    p_service_id,
    greatest(1, extract(epoch from (v_appointment.end_at - v_appointment.start_at))::integer / 60),
    p_visit_type,
    coalesce(v_settings.first_visit_extends, false),
    v_settings.first_visit_minutes
  );
  v_end_at := v_appointment.start_at + (v_minutes || ' minutes')::interval;
  v_date := (v_appointment.start_at at time zone 'Asia/Taipei')::date;
  v_time := (v_appointment.start_at at time zone 'Asia/Taipei')::time;

  select segment.start_time, segment.end_time
    into v_segment
    from (
      select template.start_time, template.end_time
        from public.schedule_templates template
       where template.clinic_id = p_clinic_id
         and template.doctor_id = p_doctor_id
         and template.weekday = extract(dow from v_date)
         and template.active
         and v_time >= template.start_time
         and v_time < template.end_time
         and not exists (
           select 1
             from public.schedule_exceptions exception
            where exception.clinic_id = p_clinic_id
              and exception.doctor_id = p_doctor_id
              and exception.date = v_date
              and exception.is_closed
              and exception.start_time is null
         )
      union all
      select exception.start_time, exception.end_time
        from public.schedule_exceptions exception
       where exception.clinic_id = p_clinic_id
         and exception.doctor_id = p_doctor_id
         and exception.date = v_date
         and not exception.is_closed
         and v_time >= exception.start_time
         and v_time < exception.end_time
    ) segment
   limit 1;

  if v_segment.end_time is null
     or v_end_at > ((v_date + v_segment.end_time) at time zone 'Asia/Taipei') then
    raise exception 'service duration exceeds schedule segment';
  end if;
  if exists (
    select 1
      from public.appointments appointment
     where appointment.id <> v_id
       and appointment.clinic_id = p_clinic_id
       and appointment.doctor_id = p_doctor_id
       and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < v_end_at
       and appointment.end_at > v_appointment.start_at
  ) then
    raise exception 'service duration slot is full';
  end if;
  if not public.service_resources_available(
    p_clinic_id,
    p_service_id,
    v_appointment.start_at,
    v_end_at,
    v_id
  ) then
    raise exception 'service resource is unavailable';
  end if;

  update public.appointments
     set end_at = v_end_at
   where id = v_id
     and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.book_time_slot_for_service(uuid, uuid, uuid, timestamptz, text, boolean, uuid)
  to service_role;

commit;

-- Final replay of migration 202608130005: adoption metrics and first-stage operational tooling.
-- Adoption metrics and first-stage operational tooling.
-- All tenant-scoped data is keyed by clinic_id. Anonymous access is denied.
begin;

create table if not exists public.clinic_activation_metrics (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  measurement_started_at timestamptz not null default now(),
  first_bookable_at timestamptz,
  first_booking_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.trial_brand_observations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'active' and ended_at is null) or (status = 'completed' and ended_at is not null))
);
create unique index if not exists trial_brand_observations_one_active_idx
  on public.trial_brand_observations (clinic_id) where status = 'active';

create table if not exists public.admin_product_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  event_name text not null check (event_name in (
    'settings_view', 'settings_exit', 'settings_submit',
    'permission_denied', 'permission_help_requested'
  )),
  session_id text not null,
  actor_scope text not null default 'brand_employee' check (actor_scope in ('brand_admin', 'brand_employee', 'system_admin', 'system_employee')),
  pathname text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(session_id) between 8 and 128),
  check (pathname is null or length(pathname) <= 240),
  check (pg_column_size(metadata) <= 4096)
);
create index if not exists admin_product_events_clinic_time_idx
  on public.admin_product_events (clinic_id, created_at desc);
create index if not exists admin_product_events_clinic_name_idx
  on public.admin_product_events (clinic_id, event_name, created_at desc);

create table if not exists public.data_import_jobs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  entity text not null check (entity in ('patients', 'services', 'memberships')),
  idempotency_key text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0 and total_rows <= 500),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  error_summary jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (clinic_id, idempotency_key),
  check (length(idempotency_key) between 8 and 128),
  check (pg_column_size(error_summary) <= 16384)
);
create index if not exists data_import_jobs_clinic_time_idx
  on public.data_import_jobs (clinic_id, created_at desc);

create table if not exists public.channel_test_runs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  channel text not null check (channel in ('line', 'liff', 'email', 'payment', 'domain')),
  status text not null check (status in ('passed', 'warning', 'failed')),
  checks jsonb not null default '[]'::jsonb,
  ran_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (pg_column_size(checks) <= 16384)
);
create index if not exists channel_test_runs_clinic_time_idx
  on public.channel_test_runs (clinic_id, channel, created_at desc);

create table if not exists public.handoff_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null,
  category text not null default 'other' check (category in ('appointment', 'payment', 'customer', 'channel', 'other')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  related_appointment_id uuid references public.appointments(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(title) between 1 and 160),
  check (note is null or length(note) <= 1000)
);
create index if not exists handoff_tasks_clinic_filter_idx
  on public.handoff_tasks (clinic_id, status, priority, due_at, created_at desc);

create table if not exists public.feature_interest_signals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'calendar_sync', 'refund_reconciliation', 'pos_inventory', 'commission',
    'multilingual', 'white_label'
  )),
  interest text not null check (interest in ('unknown', 'interested', 'not_interested', 'quoted', 'won')),
  willingness_monthly integer check (willingness_monthly is null or willingness_monthly >= 0),
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, feature_key),
  check (note is null or length(note) <= 1000)
);

alter table public.clinic_activation_metrics enable row level security;
alter table public.trial_brand_observations enable row level security;
alter table public.admin_product_events enable row level security;
alter table public.data_import_jobs enable row level security;
alter table public.channel_test_runs enable row level security;
alter table public.handoff_tasks enable row level security;
alter table public.feature_interest_signals enable row level security;

revoke all on table public.clinic_activation_metrics from public, anon, authenticated;
revoke all on table public.trial_brand_observations from public, anon, authenticated;
revoke all on table public.admin_product_events from public, anon, authenticated;
revoke all on table public.data_import_jobs from public, anon, authenticated;
revoke all on table public.channel_test_runs from public, anon, authenticated;
revoke all on table public.feature_interest_signals from public, anon, authenticated;
revoke all on table public.handoff_tasks from public, anon;

drop policy if exists handoff_tasks_member on public.handoff_tasks;
create policy handoff_tasks_member on public.handoff_tasks for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
    where member.clinic_id = handoff_tasks.clinic_id
      and member.user_id = auth.uid()
      and (
        member.access_type = 'brand_admin'
        or 'operations.manage' = any(member.permissions)
        or 'brand.manage' = any(member.permissions)
      )
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
    where member.clinic_id = handoff_tasks.clinic_id
      and member.user_id = auth.uid()
      and (
        member.access_type = 'brand_admin'
        or 'operations.manage' = any(member.permissions)
        or 'brand.manage' = any(member.permissions)
      )
  )
);

drop trigger if exists trg_clinic_activation_metrics_touch on public.clinic_activation_metrics;
create trigger trg_clinic_activation_metrics_touch before update on public.clinic_activation_metrics
for each row execute function public.touch_updated_at();
drop trigger if exists trg_trial_brand_observations_touch on public.trial_brand_observations;
create trigger trg_trial_brand_observations_touch before update on public.trial_brand_observations
for each row execute function public.touch_updated_at();
drop trigger if exists trg_handoff_tasks_touch on public.handoff_tasks;
create trigger trg_handoff_tasks_touch before update on public.handoff_tasks
for each row execute function public.touch_updated_at();
drop trigger if exists trg_feature_interest_signals_touch on public.feature_interest_signals;
create trigger trg_feature_interest_signals_touch before update on public.feature_interest_signals
for each row execute function public.touch_updated_at();

create or replace function public.refresh_clinic_activation_metric(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_is_bookable boolean;
begin
  insert into public.clinic_activation_metrics (clinic_id)
  values (p_clinic_id)
  on conflict (clinic_id) do nothing;

  select
    coalesce(settings.public_booking_enabled, false)
    and exists (
      select 1 from public.services service
      where service.clinic_id = p_clinic_id and service.active
    )
    and exists (
      select 1 from public.schedule_templates template
      where template.clinic_id = p_clinic_id and template.active
    )
  into v_is_bookable
  from public.clinic_settings settings
  where settings.clinic_id = p_clinic_id;

  if coalesce(v_is_bookable, false) then
    update public.clinic_activation_metrics
       set first_bookable_at = coalesce(first_bookable_at, now())
     where clinic_id = p_clinic_id;
  end if;
end;
$$;

create or replace function public.refresh_clinic_activation_from_row()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic_id uuid;
begin
  v_clinic_id := coalesce(new.clinic_id, old.clinic_id);
  perform public.refresh_clinic_activation_metric(v_clinic_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.seed_clinic_activation_metric()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.clinic_activation_metrics (clinic_id) values (new.id)
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;

create or replace function public.record_first_clinic_booking()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status <> 'cancelled' then
    insert into public.clinic_activation_metrics (clinic_id, first_booking_at)
    values (new.clinic_id, coalesce(new.created_at, now()))
    on conflict (clinic_id) do update
      set first_booking_at = coalesce(public.clinic_activation_metrics.first_booking_at, excluded.first_booking_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinic_seed_activation_metric on public.clinics;
create trigger trg_clinic_seed_activation_metric after insert on public.clinics
for each row execute function public.seed_clinic_activation_metric();
drop trigger if exists trg_clinic_settings_activation on public.clinic_settings;
create trigger trg_clinic_settings_activation after insert or update of public_booking_enabled on public.clinic_settings
for each row execute function public.refresh_clinic_activation_from_row();
drop trigger if exists trg_services_activation on public.services;
create trigger trg_services_activation after insert or update of active or delete on public.services
for each row execute function public.refresh_clinic_activation_from_row();
drop trigger if exists trg_schedule_templates_activation on public.schedule_templates;
create trigger trg_schedule_templates_activation after insert or update of active or delete on public.schedule_templates
for each row execute function public.refresh_clinic_activation_from_row();
drop trigger if exists trg_appointments_first_booking on public.appointments;
create trigger trg_appointments_first_booking after insert on public.appointments
for each row execute function public.record_first_clinic_booking();

insert into public.clinic_activation_metrics (clinic_id)
select id from public.clinics
on conflict (clinic_id) do nothing;
select public.refresh_clinic_activation_metric(id) from public.clinics;
update public.clinic_activation_metrics metric
set first_booking_at = first_row.first_booking_at
from (
  select clinic_id, min(created_at) as first_booking_at
  from public.appointments
  where status <> 'cancelled'
  group by clinic_id
) first_row
where metric.clinic_id = first_row.clinic_id
  and metric.first_booking_at is null;

create or replace function public.execute_data_import(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_entity text,
  p_idempotency_key text,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job_id uuid;
  v_row jsonb;
  v_index integer := 0;
  v_imported integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_patient_id uuid;
  v_plan_id uuid;
  v_membership_id uuid;
  v_name text;
  v_phone text;
  v_credits integer;
  v_code text;
  v_allowed boolean;
  v_max integer;
  v_existing integer;
begin
  if p_entity not in ('patients', 'services', 'memberships') then raise exception 'unsupported import entity'; end if;
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'invalid idempotency key'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'import rows must contain 1 to 500 items';
  end if;
  if not exists (
    select 1 from public.clinic_members member
    where member.clinic_id = p_clinic_id
      and member.user_id = p_actor_user_id
      and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  ) then raise exception 'brand management permission required'; end if;

  insert into public.data_import_jobs (clinic_id, entity, idempotency_key, total_rows, created_by)
  values (p_clinic_id, p_entity, p_idempotency_key, jsonb_array_length(p_rows), p_actor_user_id)
  on conflict (clinic_id, idempotency_key) do nothing
  returning id into v_job_id;
  if v_job_id is null then
    select id into v_job_id from public.data_import_jobs
    where clinic_id = p_clinic_id and idempotency_key = p_idempotency_key;
    return v_job_id;
  end if;

  select allow_multi_patient_per_phone, max_patients_per_phone
  into v_allowed, v_max
  from public.clinic_settings where clinic_id = p_clinic_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    begin
      if jsonb_typeof(v_row) <> 'object' then raise exception 'row must be an object'; end if;
      if p_entity = 'patients' then
        v_name := btrim(coalesce(v_row->>'name', ''));
        v_phone := regexp_replace(coalesce(v_row->>'phone', ''), '[^0-9+]', '', 'g');
        if v_name = '' or length(v_name) > 120 then raise exception 'invalid name'; end if;
        if length(v_phone) < 8 or length(v_phone) > 20 then raise exception 'invalid phone'; end if;
        select id into v_patient_id from public.patients
        where clinic_id = p_clinic_id and phone = v_phone and lower(name) = lower(v_name) and active
        order by created_at limit 1;
        if v_patient_id is null then
          select count(*) into v_existing from public.patients where clinic_id = p_clinic_id and phone = v_phone and active;
          if (not coalesce(v_allowed, false) and v_existing > 0) or (coalesce(v_allowed, false) and v_existing >= greatest(1, coalesce(v_max, 1))) then
            raise exception 'phone patient limit reached';
          end if;
          insert into public.patients (clinic_id, name, phone, birthday, email, marketing_opt_in)
          values (
            p_clinic_id, v_name, v_phone,
            case when coalesce(v_row->>'birthday', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row->>'birthday')::date else null end,
            nullif(btrim(v_row->>'email'), ''), coalesce((v_row->>'marketing_opt_in')::boolean, false)
          ) returning id into v_patient_id;
        end if;
      elsif p_entity = 'services' then
        v_name := btrim(coalesce(v_row->>'name', ''));
        if v_name = '' or length(v_name) > 120 then raise exception 'invalid service name'; end if;
        if exists (select 1 from public.services where clinic_id = p_clinic_id and lower(name) = lower(v_name) and active) then
          raise exception 'service already exists';
        end if;
        insert into public.services (clinic_id, name, category, description, duration_minutes, buffer_minutes, booking_target, active)
        values (
          p_clinic_id, v_name, nullif(btrim(v_row->>'category'), ''), nullif(btrim(v_row->>'description'), ''),
          case when coalesce(v_row->>'duration_minutes', '') ~ '^\d+$' then greatest(1, (v_row->>'duration_minutes')::integer) else null end,
          case when coalesce(v_row->>'buffer_minutes', '') ~ '^\d+$' then greatest(0, (v_row->>'buffer_minutes')::integer) else 0 end,
          case when v_row->>'booking_target' in ('provider_required', 'provider_optional', 'resource_only') then v_row->>'booking_target' else 'provider_required' end,
          true
        );
      else
        v_name := btrim(coalesce(v_row->>'patient_name', ''));
        v_phone := regexp_replace(coalesce(v_row->>'patient_phone', ''), '[^0-9+]', '', 'g');
        select id into v_patient_id from public.patients
        where clinic_id = p_clinic_id and phone = v_phone and lower(name) = lower(v_name) and active
        order by created_at limit 1;
        if v_patient_id is null then raise exception 'patient not found'; end if;
        select id into v_plan_id from public.membership_plans
        where clinic_id = p_clinic_id and lower(name) = lower(btrim(coalesce(v_row->>'plan_name', ''))) and active
        order by created_at limit 1;
        if v_plan_id is null then raise exception 'membership plan not found'; end if;
        v_credits := case when coalesce(v_row->>'credits_remaining', '') ~ '^\d+$' then (v_row->>'credits_remaining')::integer else 0 end;
        if v_credits <= 0 then raise exception 'credits must be positive'; end if;
        v_code := 'MIG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
        insert into public.patient_memberships (
          clinic_id, patient_id, plan_id, membership_code, credits_total, credits_remaining,
          expires_at, source, note
        ) values (
          p_clinic_id, v_patient_id, v_plan_id, v_code, v_credits, v_credits,
          case when coalesce(v_row->>'expires_at', '') ~ '^\d{4}-\d{2}-\d{2}$' then ((v_row->>'expires_at') || 'T23:59:59+08:00')::timestamptz else null end,
          'migration', 'CSV 匯入'
        ) returning id into v_membership_id;
        insert into public.membership_ledger (
          clinic_id, membership_id, patient_id, kind, credits_delta, reference_type,
          idempotency_key, actor_id, note
        ) values (
          p_clinic_id, v_membership_id, v_patient_id, 'grant', v_credits, 'migration',
          p_idempotency_key || ':' || v_index::text, p_actor_user_id, 'CSV 匯入初始堂數'
        );
      end if;
      v_imported := v_imported + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'reason', left(sqlerrm, 240)));
    end;
  end loop;

  update public.data_import_jobs
     set status = 'completed', imported_rows = v_imported, failed_rows = v_failed,
         error_summary = v_errors, completed_at = now()
   where id = v_job_id;
  return v_job_id;
exception when others then
  if v_job_id is not null then
    update public.data_import_jobs
       set status = 'failed', failed_rows = greatest(1, failed_rows),
           error_summary = jsonb_build_array(jsonb_build_object('row', 0, 'reason', left(sqlerrm, 240))),
           completed_at = now()
     where id = v_job_id;
  end if;
  raise;
end;
$$;

revoke all on function public.refresh_clinic_activation_metric(uuid) from public, anon, authenticated;
revoke all on function public.refresh_clinic_activation_from_row() from public, anon, authenticated;
revoke all on function public.seed_clinic_activation_metric() from public, anon, authenticated;
revoke all on function public.record_first_clinic_booking() from public, anon, authenticated;
revoke all on function public.execute_data_import(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_clinic_activation_metric(uuid) to service_role;
grant execute on function public.refresh_clinic_activation_from_row() to service_role;
grant execute on function public.seed_clinic_activation_metric() to service_role;
grant execute on function public.record_first_clinic_booking() to service_role;
grant execute on function public.execute_data_import(uuid, uuid, text, text, jsonb) to service_role;

commit;

-- Final replay of migration 202608130006: guarded three-brand observations.
-- Enforce the three-brand trial observation limit atomically.
begin;

create or replace function public.start_trial_brand_observation(
  p_actor_user_id uuid,
  p_clinic_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.platform_admins member
    where member.user_id = p_actor_user_id and member.active
      and (member.access_type = 'system_admin' or 'brands.manage' = any(member.permissions))
  ) then raise exception 'system brand management permission required'; end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and active) then raise exception 'active brand not found'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'notes too long'; end if;

  perform pg_advisory_xact_lock(hashtextextended('trial-brand-observations', 0));
  select id into v_id from public.trial_brand_observations where clinic_id = p_clinic_id and status = 'active';
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.trial_brand_observations where status = 'active') >= 3 then
    raise exception 'only three trial brands may be active';
  end if;
  insert into public.trial_brand_observations (clinic_id, started_by, notes)
  values (p_clinic_id, p_actor_user_id, nullif(btrim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.complete_trial_brand_observation(
  p_actor_user_id uuid,
  p_observation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.platform_admins member
    where member.user_id = p_actor_user_id and member.active
      and (member.access_type = 'system_admin' or 'brands.manage' = any(member.permissions))
  ) then raise exception 'system brand management permission required'; end if;
  update public.trial_brand_observations
     set status = 'completed', ended_at = now()
   where id = p_observation_id and status = 'active';
  if not found then raise exception 'active trial observation not found'; end if;
end;
$$;

revoke all on function public.start_trial_brand_observation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_trial_brand_observation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_trial_brand_observation(uuid, uuid, text) to service_role;
grant execute on function public.complete_trial_brand_observation(uuid, uuid) to service_role;

commit;

-- Final replay of migration 202608130007: booking growth features.
-- Second-stage booking growth: consent snapshots, service add-ons and recurring bookings.
begin;

alter table public.clinic_settings add column if not exists recurring_booking_enabled boolean not null default false;
alter table public.clinic_settings add column if not exists max_recurring_occurrences integer not null default 8;
alter table public.clinic_settings drop constraint if exists clinic_settings_recurring_occurrences_check;
alter table public.clinic_settings add constraint clinic_settings_recurring_occurrences_check
  check (max_recurring_occurrences between 2 and 12);

create table if not exists public.service_addons (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 0 check (duration_minutes between 0 and 480),
  price integer not null default 0 check (price between 0 and 1000000),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(name) between 1 and 120),
  check (description is null or length(description) <= 500)
);
create index if not exists service_addons_service_idx on public.service_addons (clinic_id, service_id, active, sort_order, created_at);

create table if not exists public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  recurrence_rule text not null default 'weekly' check (recurrence_rule = 'weekly'),
  occurrence_count integer not null check (occurrence_count between 2 and 12),
  interval_weeks integer not null default 1 check (interval_weeks between 1 and 4),
  created_at timestamptz not null default now()
);
create index if not exists appointment_series_clinic_idx on public.appointment_series (clinic_id, created_at desc);

alter table public.appointments add column if not exists series_id uuid references public.appointment_series(id) on delete set null;
alter table public.appointments add column if not exists series_sequence integer;
alter table public.appointments add column if not exists booking_form_snapshot jsonb not null default '[]'::jsonb;
alter table public.appointments add column if not exists addons_snapshot jsonb not null default '[]'::jsonb;
alter table public.appointments add column if not exists addons_amount integer not null default 0;
alter table public.appointments drop constraint if exists appointments_booking_form_snapshot_check;
alter table public.appointments add constraint appointments_booking_form_snapshot_check check (jsonb_typeof(booking_form_snapshot) = 'array');
alter table public.appointments drop constraint if exists appointments_addons_snapshot_check;
alter table public.appointments add constraint appointments_addons_snapshot_check check (jsonb_typeof(addons_snapshot) = 'array');
alter table public.appointments drop constraint if exists appointments_addons_amount_check;
alter table public.appointments add constraint appointments_addons_amount_check check (addons_amount >= 0);
alter table public.appointments drop constraint if exists appointments_series_sequence_check;
alter table public.appointments add constraint appointments_series_sequence_check check ((series_id is null and series_sequence is null) or (series_id is not null and series_sequence > 0));
create index if not exists appointments_series_idx on public.appointments (clinic_id, series_id, series_sequence) where series_id is not null;

alter table public.service_addons enable row level security;
alter table public.appointment_series enable row level security;
revoke all on table public.service_addons from public, anon;
revoke all on table public.appointment_series from public, anon;

drop policy if exists service_addons_brand_manage on public.service_addons;
create policy service_addons_brand_manage on public.service_addons for all to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = service_addons.clinic_id and member.user_id = auth.uid() and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))))
with check (
  exists (select 1 from public.clinic_members member where member.clinic_id = service_addons.clinic_id and member.user_id = auth.uid() and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions)))
  and exists (select 1 from public.services service where service.id = service_addons.service_id and service.clinic_id = service_addons.clinic_id)
);
drop policy if exists appointment_series_member_read on public.appointment_series;
create policy appointment_series_member_read on public.appointment_series for select to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_series.clinic_id and member.user_id = auth.uid()));

drop trigger if exists trg_service_addons_touch on public.service_addons;
create trigger trg_service_addons_touch before update on public.service_addons
for each row execute function public.touch_updated_at();

create or replace function public.apply_appointment_addons(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_service_id uuid,
  p_addon_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ids uuid[] := array(select distinct id from unnest(coalesce(p_addon_ids, '{}'::uuid[])) as id order by id);
  v_count integer;
  v_minutes integer;
  v_amount integer;
  v_snapshot jsonb;
  v_appt record;
  v_settings record;
  v_segment record;
  v_date date;
  v_time time;
  v_new_end timestamptz;
  v_used integer;
begin
  select count(*), coalesce(sum(duration_minutes), 0), coalesce(sum(price), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration_minutes', duration_minutes, 'price', price) order by sort_order, created_at), '[]'::jsonb)
    into v_count, v_minutes, v_amount, v_snapshot
    from public.service_addons
   where clinic_id = p_clinic_id and service_id = p_service_id and active and id = any(v_ids);
  if v_count <> cardinality(v_ids) then raise exception 'one or more add-ons are invalid'; end if;
  select * into v_appt from public.appointments where id = p_appointment_id and clinic_id = p_clinic_id and service_id = p_service_id for update;
  if not found then raise exception 'appointment not found'; end if;
  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  if v_settings.booking_mode = 'time' and v_minutes > 0 then
    v_date := (v_appt.start_at at time zone 'Asia/Taipei')::date;
    v_time := (v_appt.start_at at time zone 'Asia/Taipei')::time;
    select segment.end_time, segment.capacity into v_segment
      from (
        select template.end_time, template.capacity
          from public.schedule_templates template
         where template.clinic_id = p_clinic_id and template.active
           and template.weekday = extract(dow from v_date)
           and v_time >= template.start_time and v_time < template.end_time
           and ((v_appt.doctor_id is not null and template.doctor_id = v_appt.doctor_id and (template.service_id is null or template.service_id = p_service_id))
             or (v_appt.doctor_id is null and template.doctor_id is null and template.service_id = p_service_id))
           and not exists (select 1 from public.schedule_exceptions closed where closed.clinic_id = p_clinic_id and closed.date = v_date and closed.is_closed and closed.start_time is null and ((v_appt.doctor_id is not null and closed.doctor_id = v_appt.doctor_id and (closed.service_id is null or closed.service_id = p_service_id)) or (v_appt.doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)))
        union all
        select exception.end_time, coalesce(exception.capacity, 1)
          from public.schedule_exceptions exception
         where exception.clinic_id = p_clinic_id and exception.date = v_date and not exception.is_closed
           and v_time >= exception.start_time and v_time < exception.end_time
           and ((v_appt.doctor_id is not null and exception.doctor_id = v_appt.doctor_id and (exception.service_id is null or exception.service_id = p_service_id))
             or (v_appt.doctor_id is null and exception.doctor_id is null and exception.service_id = p_service_id))
      ) segment
      limit 1;
    if not found then raise exception 'appointment schedule segment not found'; end if;
    v_new_end := v_appt.end_at + (v_minutes || ' minutes')::interval;
    if v_new_end > ((v_date + v_segment.end_time) at time zone 'Asia/Taipei') then raise exception 'add-on duration exceeds schedule'; end if;
    perform pg_advisory_xact_lock(hashtextextended('appointment-options:' || p_clinic_id::text || ':' || coalesce(v_appt.doctor_id::text, p_service_id::text) || ':' || v_date::text, 0));
    select count(*) into v_used from public.appointments appointment
     where appointment.id <> p_appointment_id and appointment.clinic_id = p_clinic_id
       and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < v_new_end and appointment.end_at > v_appt.start_at
       and ((v_appt.doctor_id is not null and appointment.doctor_id = v_appt.doctor_id)
         or (v_appt.doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id));
    if v_used >= v_segment.capacity then raise exception 'add-on duration slot is full'; end if;
    if not public.service_resources_available(p_clinic_id, p_service_id, v_appt.start_at, v_new_end, p_appointment_id) then raise exception 'service resource is unavailable'; end if;
    update public.appointments set end_at = v_new_end, addons_snapshot = v_snapshot, addons_amount = v_amount where id = p_appointment_id;
  else
    update public.appointments set addons_snapshot = v_snapshot, addons_amount = v_amount where id = p_appointment_id;
  end if;
end;
$$;

create or replace function public.book_time_slot_with_options(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb, p_booking_form_snapshot jsonb default '[]'::jsonb,
  p_addon_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if jsonb_typeof(coalesce(p_booking_answers, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_booking_form_snapshot, '[]'::jsonb)) <> 'array' then raise exception 'invalid booking form data'; end if;
  if p_doctor_id is null then
    if nullif(btrim(p_membership_code), '') is null then
      v_id := public.book_service_slot(p_clinic_id, p_service_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_booking_answers);
    else
      v_id := public.book_service_slot_with_membership(p_clinic_id, p_service_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers);
    end if;
  else
    if nullif(btrim(p_membership_code), '') is null then
      v_id := public.book_time_slot_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
    else
      v_id := public.book_time_slot_with_membership_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_membership_code, p_service_id);
    end if;
    update public.appointments set booking_answers = coalesce(p_booking_answers, '{}'::jsonb) where id = v_id and clinic_id = p_clinic_id;
  end if;
  perform public.apply_appointment_addons(p_clinic_id, v_id, p_service_id, p_addon_ids);
  update public.appointments set booking_form_snapshot = coalesce(p_booking_form_snapshot, '[]'::jsonb) where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_number_with_options(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb, p_booking_form_snapshot jsonb default '[]'::jsonb,
  p_addon_ids uuid[] default '{}'::uuid[]
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_row record;
begin
  if jsonb_typeof(coalesce(p_booking_answers, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_booking_form_snapshot, '[]'::jsonb)) <> 'array' then raise exception 'invalid booking form data'; end if;
  if p_doctor_id is null then
    if nullif(btrim(p_membership_code), '') is null then
      select row.appointment_id, row.queue_number into v_row from public.book_service_session(p_clinic_id, p_service_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_booking_answers) row;
    else
      select row.appointment_id, row.queue_number into v_row from public.book_service_session_with_membership(p_clinic_id, p_service_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers) row;
    end if;
  else
    if nullif(btrim(p_membership_code), '') is null then
      select row.appointment_id, row.queue_number into v_row from public.book_number_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id) row;
    else
      select row.appointment_id, row.queue_number into v_row from public.book_number_with_membership_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_membership_code, p_service_id) row;
    end if;
    update public.appointments set booking_answers = coalesce(p_booking_answers, '{}'::jsonb) where id = v_row.appointment_id and clinic_id = p_clinic_id;
  end if;
  perform public.apply_appointment_addons(p_clinic_id, v_row.appointment_id, p_service_id, p_addon_ids);
  update public.appointments set booking_form_snapshot = coalesce(p_booking_form_snapshot, '[]'::jsonb) where id = v_row.appointment_id and clinic_id = p_clinic_id;
  return query select v_row.appointment_id::uuid, v_row.queue_number::integer;
end;
$$;

create or replace function public.book_recurring_appointments(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_template_id uuid, p_date date,
  p_visit_type text, p_is_self_pay boolean, p_membership_code text,
  p_booking_answers jsonb, p_booking_form_snapshot jsonb, p_addon_ids uuid[],
  p_occurrence_count integer, p_interval_weeks integer default 1
)
returns table (appointment_id uuid, occurrence_number integer, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings record;
  v_series_id uuid;
  v_index integer;
  v_id uuid;
  v_queue integer;
  v_row record;
begin
  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found or not coalesce(v_settings.recurring_booking_enabled, false) then raise exception 'recurring booking is disabled'; end if;
  if coalesce(v_settings.deposit_enabled, false) then raise exception 'recurring booking is unavailable while deposit is enabled'; end if;
  if p_occurrence_count < 2 or p_occurrence_count > least(12, coalesce(v_settings.max_recurring_occurrences, 8)) then raise exception 'invalid recurring occurrence count'; end if;
  if p_interval_weeks < 1 or p_interval_weeks > 4 then raise exception 'invalid recurring interval'; end if;
  insert into public.appointment_series (clinic_id, patient_id, service_id, occurrence_count, interval_weeks)
  values (p_clinic_id, p_patient_id, p_service_id, p_occurrence_count, p_interval_weeks)
  returning id into v_series_id;
  for v_index in 1..p_occurrence_count loop
    v_queue := null;
    if v_settings.booking_mode = 'time' then
      if p_start_at is null then raise exception 'recurring time booking requires start time'; end if;
      v_id := public.book_time_slot_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_start_at + ((v_index - 1) * p_interval_weeks || ' weeks')::interval, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids);
    else
      if p_template_id is null or p_date is null then raise exception 'recurring session booking requires template and date'; end if;
      select row.appointment_id, row.queue_number into v_row from public.book_number_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_template_id, p_date + ((v_index - 1) * p_interval_weeks * 7), p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids) row;
      v_id := v_row.appointment_id; v_queue := v_row.queue_number;
    end if;
    update public.appointments set series_id = v_series_id, series_sequence = v_index where id = v_id and clinic_id = p_clinic_id;
    appointment_id := v_id; occurrence_number := v_index; queue_number := v_queue;
    return next;
  end loop;
end;
$$;

revoke all on function public.apply_appointment_addons(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.book_time_slot_with_options(uuid, uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.book_number_with_options(uuid, uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.apply_appointment_addons(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function public.book_time_slot_with_options(uuid, uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb, jsonb, uuid[]) to service_role;
grant execute on function public.book_number_with_options(uuid, uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb, jsonb, uuid[]) to service_role;
grant execute on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) to service_role;

commit;

-- Shared API rate limiting for multi-instance production deployments.
begin;

create table if not exists public.api_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_rate_limit_buckets_expires_at
  on public.api_rate_limit_buckets (expires_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_expires_at timestamptz;
begin
  if length(p_bucket_key) <> 64 or p_limit < 1 or p_limit > 10000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.api_rate_limit_buckets as bucket (
    bucket_key,
    window_started_at,
    request_count,
    expires_at,
    updated_at
  )
  values (
    p_bucket_key,
    v_now,
    1,
    v_now + make_interval(secs => p_window_seconds),
    v_now
  )
  on conflict (bucket_key) do update
  set window_started_at = case when bucket.expires_at <= v_now then v_now else bucket.window_started_at end,
      request_count = case when bucket.expires_at <= v_now then 1 else bucket.request_count + 1 end,
      expires_at = case when bucket.expires_at <= v_now then v_now + make_interval(secs => p_window_seconds) else bucket.expires_at end,
      updated_at = v_now
  returning bucket.request_count, bucket.expires_at into v_count, v_expires_at;

  if random() < 0.01 then
    delete from public.api_rate_limit_buckets
     where bucket_key in (
       select expired.bucket_key
         from public.api_rate_limit_buckets expired
        where expired.expires_at < v_now - interval '1 day'
        order by expired.expires_at
        limit 100
     );
  end if;

  return query
  select v_count <= p_limit,
         case when v_count <= p_limit then 0 else greatest(1, ceil(extract(epoch from (v_expires_at - v_now)))::integer) end;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

commit;

-- Aggregate platform usage in PostgreSQL instead of loading every tenant row into Node.js.
begin;

create or replace function public.get_platform_usage_summary()
returns table (
  id uuid,
  name text,
  slug text,
  active boolean,
  created_at timestamptz,
  members bigint,
  services bigint,
  appointments bigint,
  registrations bigint,
  patients bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    clinic.id,
    clinic.name,
    clinic.slug,
    clinic.active,
    clinic.created_at,
    coalesce(member_count.total, 0)::bigint as members,
    coalesce(service_count.total, 0)::bigint as services,
    coalesce(appointment_count.total, 0)::bigint as appointments,
    coalesce(registration_count.total, 0)::bigint as registrations,
    coalesce(patient_count.total, 0)::bigint as patients
  from public.clinics clinic
  left join (
    select clinic_id, count(*) as total from public.clinic_members group by clinic_id
  ) member_count on member_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.services where active group by clinic_id
  ) service_count on service_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.appointments group by clinic_id
  ) appointment_count on appointment_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.registrations group by clinic_id
  ) registration_count on registration_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.patients group by clinic_id
  ) patient_count on patient_count.clinic_id = clinic.id
  order by clinic.created_at desc;
$$;

revoke all on function public.get_platform_usage_summary() from public, anon, authenticated;
grant execute on function public.get_platform_usage_summary() to service_role;

commit;

-- Final replay of migration 202608130008: add-on aware availability.
-- Availability must include selected add-on duration, not only the base service.
begin;

create or replace function public.get_available_service_slots_with_options(
  p_clinic_id uuid,
  p_service_id uuid,
  p_date date,
  p_visit_type text default 'return',
  p_doctor_id uuid default null,
  p_addon_ids uuid[] default '{}'::uuid[]
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead integer := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id = p_clinic_id), 30);
  v_first_extends boolean := coalesce((select first_visit_extends from public.clinic_settings where clinic_id = p_clinic_id), false);
  v_first_minutes integer := (select first_visit_minutes from public.clinic_settings where clinic_id = p_clinic_id);
  v_target text;
  v_ids uuid[] := array(select distinct id from unnest(coalesce(p_addon_ids, '{}'::uuid[])) as id order by id);
  v_addon_count integer;
  v_addon_minutes integer;
  rec record;
  v_slot_length integer;
begin
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  select booking_target into v_target from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
  if not found then raise exception 'service not found'; end if;
  if v_target = 'provider_required' and p_doctor_id is null then raise exception 'provider is required for this service'; end if;
  if p_doctor_id is not null and not exists (select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active) then raise exception 'provider not found'; end if;
  select count(*), coalesce(sum(duration_minutes), 0) into v_addon_count, v_addon_minutes
    from public.service_addons where clinic_id = p_clinic_id and service_id = p_service_id and active and id = any(v_ids);
  if v_addon_count <> cardinality(v_ids) then raise exception 'one or more add-ons are invalid'; end if;

  for rec in
    select t.id as template_id, t.start_time, t.end_time, t.slot_minutes, t.capacity
      from public.schedule_templates t
     where t.clinic_id = p_clinic_id and t.weekday = v_weekday and t.active
       and (t.service_id is null or t.service_id = p_service_id)
       and ((p_doctor_id is not null and t.doctor_id = p_doctor_id) or (p_doctor_id is null and t.doctor_id is null and t.service_id = p_service_id))
       and not exists (select 1 from public.schedule_exceptions e where e.clinic_id = p_clinic_id and e.date = p_date and e.is_closed and e.start_time is null and ((p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id)) or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id)))
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.slot_minutes, 15), coalesce(e.capacity, 1)
      from public.schedule_exceptions e
     where e.clinic_id = p_clinic_id and e.date = p_date and not e.is_closed
       and ((p_doctor_id is not null and e.doctor_id = p_doctor_id and (e.service_id is null or e.service_id = p_service_id)) or (p_doctor_id is null and e.doctor_id is null and e.service_id = p_service_id))
  loop
    v_slot_length := public.service_booking_minutes(p_clinic_id, p_service_id, rec.slot_minutes, p_visit_type, v_first_extends, v_first_minutes) + v_addon_minutes;
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n || ' minutes')::interval) at time zone 'Asia/Taipei') as starts_at,
             ((p_date + rec.start_time + ((n + v_slot_length) || ' minutes')::interval) at time zone 'Asia/Taipei') as ends_at
        from generate_series(0, (extract(epoch from (rec.end_time - rec.start_time)) / 60)::integer - v_slot_length, rec.slot_minutes) as n
    )
    select candidate.starts_at, candidate.ends_at, (rec.capacity - count(appointment.id))::integer
      from candidate
      left join public.appointments appointment
        on appointment.clinic_id = p_clinic_id and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < candidate.ends_at and appointment.end_at > candidate.starts_at
       and ((p_doctor_id is not null and appointment.doctor_id = p_doctor_id) or (p_doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id))
     where candidate.starts_at > now() + (v_lead || ' minutes')::interval
       and public.service_resources_available(p_clinic_id, p_service_id, candidate.starts_at, candidate.ends_at, null)
       and not exists (
         select 1 from public.schedule_exceptions closed
          where closed.clinic_id = p_clinic_id and closed.date = p_date and closed.is_closed and closed.start_time is not null
            and ((p_doctor_id is not null and closed.doctor_id = p_doctor_id and (closed.service_id is null or closed.service_id = p_service_id)) or (p_doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id))
            and (candidate.starts_at at time zone 'Asia/Taipei')::time < closed.end_time
            and (candidate.ends_at at time zone 'Asia/Taipei')::time > closed.start_time
       )
     group by candidate.starts_at, candidate.ends_at, rec.capacity
    having rec.capacity - count(appointment.id) > 0
     order by candidate.starts_at;
  end loop;
end;
$$;

revoke all on function public.get_available_service_slots_with_options(uuid, uuid, date, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_available_service_slots_with_options(uuid, uuid, date, text, uuid, uuid[]) to service_role;

commit;

-- Final replay of migration 202608130009: keep the recurring booking function lint-clean.
begin;

create or replace function public.book_recurring_appointments(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_template_id uuid, p_date date,
  p_visit_type text, p_is_self_pay boolean, p_membership_code text,
  p_booking_answers jsonb, p_booking_form_snapshot jsonb, p_addon_ids uuid[],
  p_occurrence_count integer, p_interval_weeks integer default 1
)
returns table (appointment_id uuid, occurrence_number integer, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings record;
  v_series_id uuid;
  v_id uuid;
  v_queue integer;
  v_row record;
begin
  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found or not coalesce(v_settings.recurring_booking_enabled, false) then raise exception 'recurring booking is disabled'; end if;
  if coalesce(v_settings.deposit_enabled, false) then raise exception 'recurring booking is unavailable while deposit is enabled'; end if;
  if p_occurrence_count < 2 or p_occurrence_count > least(12, coalesce(v_settings.max_recurring_occurrences, 8)) then raise exception 'invalid recurring occurrence count'; end if;
  if p_interval_weeks < 1 or p_interval_weeks > 4 then raise exception 'invalid recurring interval'; end if;
  insert into public.appointment_series (clinic_id, patient_id, service_id, occurrence_count, interval_weeks)
  values (p_clinic_id, p_patient_id, p_service_id, p_occurrence_count, p_interval_weeks)
  returning id into v_series_id;
  for v_index in 1..p_occurrence_count loop
    v_queue := null;
    if v_settings.booking_mode = 'time' then
      if p_start_at is null then raise exception 'recurring time booking requires start time'; end if;
      v_id := public.book_time_slot_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_start_at + ((v_index - 1) * p_interval_weeks || ' weeks')::interval, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids);
    else
      if p_template_id is null or p_date is null then raise exception 'recurring session booking requires template and date'; end if;
      select row.appointment_id, row.queue_number into v_row from public.book_number_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_template_id, p_date + ((v_index - 1) * p_interval_weeks * 7), p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids) row;
      v_id := v_row.appointment_id; v_queue := v_row.queue_number;
    end if;
    update public.appointments set series_id = v_series_id, series_sequence = v_index where id = v_id and clinic_id = p_clinic_id;
    appointment_id := v_id; occurrence_number := v_index; queue_number := v_queue;
    return next;
  end loop;
end;
$$;

revoke all on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) to service_role;

commit;
-- Unified checkout center for appointments, registrations, packages and products.
begin;

alter table public.services add column if not exists price integer not null default 0;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'services_price_check') then alter table public.services add constraint services_price_check check (price between 0 and 1000000) not valid; end if; end; $$;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  order_no text not null default ('SO-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  appointment_id uuid references public.appointments(id) on delete restrict, registration_id uuid references public.registrations(id) on delete restrict,
  patient_id uuid references public.patients(id) on delete restrict, status text not null default 'open' check (status in ('open','partially_paid','paid','void')),
  subtotal integer not null default 0 check (subtotal >= 0), discount_amount integer not null default 0 check (discount_amount >= 0),
  total_amount integer not null default 0 check (total_amount >= 0), paid_amount integer not null default 0 check (paid_amount >= 0), note text,
  created_by uuid references auth.users(id) on delete set null, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (clinic_id, order_no), check (not (appointment_id is not null and registration_id is not null)), check (discount_amount <= subtotal),
  check (total_amount = subtotal - discount_amount), check (paid_amount <= total_amount)
);
create unique index if not exists sales_orders_appointment_active_idx on public.sales_orders (appointment_id) where appointment_id is not null and status <> 'void';
create unique index if not exists sales_orders_registration_active_idx on public.sales_orders (registration_id) where registration_id is not null and status <> 'void';
create index if not exists sales_orders_clinic_created_idx on public.sales_orders (clinic_id, created_at desc);
create index if not exists sales_orders_patient_idx on public.sales_orders (clinic_id, patient_id, created_at desc);
create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict, order_id uuid not null references public.sales_orders(id) on delete restrict,
  kind text not null check (kind in ('service','product','package','custom')), reference_id uuid, name text not null, quantity numeric(12,2) not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0), line_total integer not null check (line_total >= 0), created_at timestamptz not null default now()
);
create index if not exists sales_order_items_order_idx on public.sales_order_items (clinic_id, order_id, created_at);
create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict, order_id uuid not null references public.sales_orders(id) on delete restrict,
  method text not null check (method in ('cash','card','transfer','online','other')), amount integer not null check (amount > 0), reference text,
  received_at timestamptz not null default now(), actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists sales_payments_order_idx on public.sales_payments (clinic_id, order_id, received_at desc);
drop trigger if exists trg_sales_orders_touch on public.sales_orders;
create trigger trg_sales_orders_touch before update on public.sales_orders for each row execute function public.touch_updated_at();
alter table public.sales_orders enable row level security; alter table public.sales_order_items enable row level security; alter table public.sales_payments enable row level security;
revoke all on table public.sales_orders from public, anon, authenticated; revoke all on table public.sales_order_items from public, anon, authenticated; revoke all on table public.sales_payments from public, anon, authenticated;
grant select on table public.sales_orders, public.sales_order_items, public.sales_payments to authenticated; grant all on table public.sales_orders, public.sales_order_items, public.sales_payments to service_role;
drop policy if exists sales_orders_member_read on public.sales_orders;
create policy sales_orders_member_read on public.sales_orders for select to authenticated using (exists (select 1 from public.clinic_members member where member.clinic_id=sales_orders.clinic_id and member.user_id=auth.uid() and member.role <> 'provider'));
drop policy if exists sales_order_items_member_read on public.sales_order_items;
create policy sales_order_items_member_read on public.sales_order_items for select to authenticated using (exists (select 1 from public.clinic_members member where member.clinic_id=sales_order_items.clinic_id and member.user_id=auth.uid() and member.role <> 'provider'));
drop policy if exists sales_payments_member_read on public.sales_payments;
create policy sales_payments_member_read on public.sales_payments for select to authenticated using (exists (select 1 from public.clinic_members member where member.clinic_id=sales_payments.clinic_id and member.user_id=auth.uid() and member.role <> 'provider'));

create or replace function public.recalculate_sales_order(p_clinic_id uuid,p_order_id uuid) returns void language plpgsql security definer set search_path=public,extensions as $$
declare v_subtotal integer; v_discount integer; v_paid integer; begin
  select coalesce(sum(line_total),0) into v_subtotal from public.sales_order_items where clinic_id=p_clinic_id and order_id=p_order_id;
  select discount_amount,paid_amount into v_discount,v_paid from public.sales_orders where id=p_order_id and clinic_id=p_clinic_id for update; if not found then raise exception 'sales order not found'; end if;
  if v_discount>v_subtotal then raise exception 'discount exceeds subtotal'; end if; if v_paid>v_subtotal-v_discount then raise exception 'paid amount exceeds order total'; end if;
  update public.sales_orders set subtotal=v_subtotal,total_amount=v_subtotal-v_discount,status=case when v_subtotal-v_discount=0 then 'open' when v_paid=0 then 'open' when v_paid<v_subtotal-v_discount then 'partially_paid' else 'paid' end,
    completed_at=case when v_subtotal-v_discount>0 and v_paid=v_subtotal-v_discount then coalesce(completed_at,now()) else null end where id=p_order_id and clinic_id=p_clinic_id;
end; $$;
revoke all on function public.recalculate_sales_order(uuid,uuid) from public,anon,authenticated; grant execute on function public.recalculate_sales_order(uuid,uuid) to service_role;

create or replace function public.create_sales_order(p_clinic_id uuid,p_actor_user_id uuid,p_appointment_id uuid default null,p_registration_id uuid default null,p_patient_id uuid default null,p_discount_amount integer default 0,p_note text default null) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare v_order_id uuid; v_existing uuid; v_total integer:=0; v_paid integer:=0; v_appointment record; v_registration record; v_addon jsonb; v_addon_price integer; v_item_name text; begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'checkout actor is not allowed'; end if;
  if p_appointment_id is not null and p_registration_id is not null then raise exception 'checkout source must be unique'; end if;
  if p_appointment_id is null and p_registration_id is null and p_patient_id is null then raise exception 'checkout customer is required'; end if; if p_discount_amount<0 then raise exception 'invalid discount'; end if;
  if p_appointment_id is not null then
    select id into v_existing from public.sales_orders where clinic_id=p_clinic_id and appointment_id=p_appointment_id and status<>'void' limit 1; if v_existing is not null then return v_existing; end if;
    select appointment.*,service.name service_name,coalesce(service.price,0) service_price into v_appointment from public.appointments appointment left join public.services service on service.id=appointment.service_id and service.clinic_id=appointment.clinic_id where appointment.id=p_appointment_id and appointment.clinic_id=p_clinic_id for update of appointment;
    if not found or v_appointment.status in ('cancelled','no_show') then raise exception 'appointment is not eligible for checkout'; end if;
    insert into public.sales_orders(clinic_id,appointment_id,patient_id,discount_amount,note,created_by) values(p_clinic_id,p_appointment_id,v_appointment.patient_id,p_discount_amount,nullif(btrim(p_note),''),p_actor_user_id) returning id into v_order_id;
    insert into public.sales_order_items(clinic_id,order_id,kind,reference_id,name,quantity,unit_price,line_total) values(p_clinic_id,v_order_id,'service',v_appointment.service_id,coalesce(v_appointment.service_name,'預約服務'),1,v_appointment.service_price,v_appointment.service_price);
    if jsonb_typeof(coalesce(v_appointment.addons_snapshot,'[]'::jsonb))='array' then for v_addon in select value from jsonb_array_elements(coalesce(v_appointment.addons_snapshot,'[]'::jsonb)) loop v_addon_price:=case when coalesce(v_addon->>'price','')~'^\d+$' then (v_addon->>'price')::integer else 0 end; insert into public.sales_order_items(clinic_id,order_id,kind,reference_id,name,quantity,unit_price,line_total) values(p_clinic_id,v_order_id,'service',case when coalesce(v_addon->>'id','')~'^[0-9a-fA-F-]{36}$' then (v_addon->>'id')::uuid else null end,coalesce(nullif(v_addon->>'name',''),'加購服務'),1,v_addon_price,v_addon_price); end loop; end if;
    perform public.recalculate_sales_order(p_clinic_id,v_order_id); select total_amount into v_total from public.sales_orders where id=v_order_id;
    if v_appointment.deposit_status='paid' and v_appointment.deposit_amount>0 and v_total>0 then v_paid:=least(v_appointment.deposit_amount,v_total); insert into public.sales_payments(clinic_id,order_id,method,amount,reference,actor_id) values(p_clinic_id,v_order_id,'online',v_paid,'預約訂金',p_actor_user_id); update public.sales_orders set paid_amount=v_paid where id=v_order_id; perform public.recalculate_sales_order(p_clinic_id,v_order_id); end if;
  elsif p_registration_id is not null then
    select id into v_existing from public.sales_orders where clinic_id=p_clinic_id and registration_id=p_registration_id and status<>'void' limit 1; if v_existing is not null then return v_existing; end if;
    select registration.*,event.title event_title,ticket.name ticket_name into v_registration from public.registrations registration join public.events event on event.id=registration.event_id and event.clinic_id=registration.clinic_id left join public.event_ticket_types ticket on ticket.id=registration.ticket_type_id and ticket.clinic_id=registration.clinic_id where registration.id=p_registration_id and registration.clinic_id=p_clinic_id for update of registration;
    if not found or v_registration.status in ('cancelled','waitlisted','no_show') then raise exception 'registration is not eligible for checkout'; end if;
    insert into public.sales_orders(clinic_id,registration_id,patient_id,discount_amount,note,created_by) values(p_clinic_id,p_registration_id,v_registration.patient_id,p_discount_amount,nullif(btrim(p_note),''),p_actor_user_id) returning id into v_order_id;
    v_item_name:=v_registration.event_title||coalesce(' · '||nullif(v_registration.ticket_name,''),''); insert into public.sales_order_items(clinic_id,order_id,kind,reference_id,name,quantity,unit_price,line_total) values(p_clinic_id,v_order_id,'service',v_registration.event_id,v_item_name,1,v_registration.amount,v_registration.amount);
    perform public.recalculate_sales_order(p_clinic_id,v_order_id); select total_amount into v_total from public.sales_orders where id=v_order_id;
    if v_registration.payment_status='paid' and v_total>0 then insert into public.sales_payments(clinic_id,order_id,method,amount,reference,actor_id) values(p_clinic_id,v_order_id,'online',v_total,'活動線上付款',p_actor_user_id); update public.sales_orders set paid_amount=v_total where id=v_order_id; perform public.recalculate_sales_order(p_clinic_id,v_order_id); end if;
  else if not exists(select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id) then raise exception 'checkout customer not found'; end if; insert into public.sales_orders(clinic_id,patient_id,discount_amount,note,created_by) values(p_clinic_id,p_patient_id,p_discount_amount,nullif(btrim(p_note),''),p_actor_user_id) returning id into v_order_id; end if; return v_order_id;
end; $$;
revoke all on function public.create_sales_order(uuid,uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated; grant execute on function public.create_sales_order(uuid,uuid,uuid,uuid,uuid,integer,text) to service_role;

create or replace function public.add_sales_order_item(p_clinic_id uuid,p_actor_user_id uuid,p_order_id uuid,p_kind text,p_reference_id uuid,p_name text,p_quantity numeric,p_unit_price integer) returns uuid
language plpgsql security definer set search_path=public,extensions as $$ declare v_order record; v_item record; v_line_id uuid; v_name text; v_price integer; begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'checkout actor is not allowed'; end if;
  if p_kind not in ('service','product','package','custom') or p_quantity<=0 then raise exception 'invalid sales item'; end if; select * into v_order from public.sales_orders where id=p_order_id and clinic_id=p_clinic_id for update; if not found or v_order.status in ('paid','void') then raise exception 'sales order cannot be changed'; end if;
  if p_kind='product' then select name,retail_price into v_item from public.inventory_items where id=p_reference_id and clinic_id=p_clinic_id and active for update; if not found then raise exception 'inventory item not found'; end if; v_name:=v_item.name;v_price:=v_item.retail_price;perform public.record_inventory_movement(p_clinic_id,p_reference_id,'sale',p_quantity,'銷售單 '||v_order.order_no,p_actor_user_id);
  elsif p_kind='service' then select name,price into v_item from public.services where id=p_reference_id and clinic_id=p_clinic_id and active; if not found then raise exception 'service not found'; end if;v_name:=v_item.name;v_price:=v_item.price;
  elsif p_kind='package' then select name,price into v_item from public.membership_plans where id=p_reference_id and clinic_id=p_clinic_id and active; if not found then raise exception 'membership plan not found'; end if;v_name:=v_item.name;v_price:=v_item.price;
  else v_name:=nullif(btrim(p_name),'');v_price:=p_unit_price;if v_name is null or v_price<0 then raise exception 'custom sales item is invalid';end if;end if;
  insert into public.sales_order_items(clinic_id,order_id,kind,reference_id,name,quantity,unit_price,line_total) values(p_clinic_id,p_order_id,p_kind,p_reference_id,v_name,p_quantity,v_price,round(p_quantity*v_price)::integer) returning id into v_line_id;perform public.recalculate_sales_order(p_clinic_id,p_order_id);return v_line_id;
end; $$;
revoke all on function public.add_sales_order_item(uuid,uuid,uuid,text,uuid,text,numeric,integer) from public,anon,authenticated;grant execute on function public.add_sales_order_item(uuid,uuid,uuid,text,uuid,text,numeric,integer) to service_role;

create or replace function public.record_sales_payment(p_clinic_id uuid,p_actor_user_id uuid,p_order_id uuid,p_method text,p_amount integer,p_reference text default null) returns uuid
language plpgsql security definer set search_path=public,extensions as $$ declare v_order record;v_payment_id uuid;v_new_paid integer;begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'checkout actor is not allowed';end if;
  if p_method not in ('cash','card','transfer','online','other') or p_amount<=0 then raise exception 'invalid payment';end if;select * into v_order from public.sales_orders where id=p_order_id and clinic_id=p_clinic_id for update;if not found or v_order.status in ('paid','void') then raise exception 'sales order cannot receive payment';end if;if p_amount>v_order.total_amount-v_order.paid_amount then raise exception 'payment exceeds outstanding amount';end if;
  insert into public.sales_payments(clinic_id,order_id,method,amount,reference,actor_id) values(p_clinic_id,p_order_id,p_method,p_amount,nullif(btrim(p_reference),''),p_actor_user_id) returning id into v_payment_id;v_new_paid:=v_order.paid_amount+p_amount;update public.sales_orders set paid_amount=v_new_paid,status=case when v_new_paid=total_amount then 'paid' else 'partially_paid' end,completed_at=case when v_new_paid=total_amount then now() else null end where id=p_order_id and clinic_id=p_clinic_id;return v_payment_id;
end; $$;
revoke all on function public.record_sales_payment(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;grant execute on function public.record_sales_payment(uuid,uuid,uuid,text,integer,text) to service_role;

-- Safe customer merge is placed after checkout replay so every referenced history table exists.
create or replace function public.merge_customers(p_clinic_id uuid,p_actor_user_id uuid,p_source_patient_id uuid,p_target_patient_id uuid) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare source_row public.patients%rowtype;target_row public.patients%rowtype;source_wallet integer:=0;source_points integer:=0;
begin
  if p_source_patient_id=p_target_patient_id then raise exception 'merge source and target must differ';end if;
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and (member.role in ('owner','admin') or 'brand.manage'=any(coalesce(member.permissions,'{}'::text[])))) then raise exception 'customer merge requires brand management';end if;
  perform 1 from public.patients patient where patient.clinic_id=p_clinic_id and patient.id in(p_source_patient_id,p_target_patient_id) order by patient.id for update;
  select * into source_row from public.patients where id=p_source_patient_id and clinic_id=p_clinic_id;
  select * into target_row from public.patients where id=p_target_patient_id and clinic_id=p_clinic_id;
  if source_row.id is null or target_row.id is null or not source_row.active or not target_row.active or source_row.merged_into_patient_id is not null then raise exception 'customer merge target is invalid';end if;
  if source_row.line_user_id is not null and target_row.line_user_id is not null and source_row.line_user_id<>target_row.line_user_id then raise exception 'customers are bound to different LINE accounts';end if;
  select balance into source_wallet from public.customer_wallets where clinic_id=p_clinic_id and patient_id=p_source_patient_id for update;source_wallet:=coalesce(source_wallet,0);
  if source_wallet>0 then
    perform public.adjust_customer_wallet(p_clinic_id,p_actor_user_id,p_target_patient_id,source_wallet,'merge','合併顧客轉入',null,'merge-wallet-in:'||p_source_patient_id::text||':'||p_target_patient_id::text);
    perform public.adjust_customer_wallet(p_clinic_id,p_actor_user_id,p_source_patient_id,-source_wallet,'merge','合併顧客轉出',null,'merge-wallet-out:'||p_source_patient_id::text||':'||p_target_patient_id::text);
  end if;
  select points_balance into source_points from public.loyalty_accounts where clinic_id=p_clinic_id and patient_id=p_source_patient_id for update;source_points:=coalesce(source_points,0);
  if source_points>0 then
    perform public.adjust_loyalty_points(p_clinic_id,p_actor_user_id,p_target_patient_id,source_points,'merge','合併顧客轉入',null,'merge-points-in:'||p_source_patient_id::text||':'||p_target_patient_id::text);
    perform public.adjust_loyalty_points(p_clinic_id,p_actor_user_id,p_source_patient_id,-source_points,'merge','合併顧客轉出',null,'merge-points-out:'||p_source_patient_id::text||':'||p_target_patient_id::text);
  end if;
  delete from public.crm_segment_members source_member where source_member.clinic_id=p_clinic_id and source_member.patient_id=p_source_patient_id and exists(select 1 from public.crm_segment_members target_member where target_member.segment_id=source_member.segment_id and target_member.patient_id=p_target_patient_id);
  update public.crm_segment_members set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  delete from public.crm_delivery_logs source_log where source_log.clinic_id=p_clinic_id and source_log.patient_id=p_source_patient_id and exists(select 1 from public.crm_delivery_logs target_log where target_log.automation_id=source_log.automation_id and target_log.patient_id=p_target_patient_id and target_log.trigger_key=source_log.trigger_key and target_log.channel=source_log.channel);
  update public.crm_delivery_logs set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_waitlist_entries source_wait set status='cancelled',updated_at=now() where source_wait.clinic_id=p_clinic_id and source_wait.patient_id=p_source_patient_id and source_wait.status in('waiting','offered') and exists(select 1 from public.appointment_waitlist_entries target_wait where target_wait.clinic_id=p_clinic_id and target_wait.patient_id=p_target_patient_id and target_wait.target_key=source_wait.target_key and target_wait.status in('waiting','offered'));
  update public.patient_subscriptions source_sub set status='cancelled',cancelled_at=now() where source_sub.clinic_id=p_clinic_id and source_sub.patient_id=p_source_patient_id and source_sub.status in('active','paused','past_due') and exists(select 1 from public.patient_subscriptions target_sub where target_sub.clinic_id=p_clinic_id and target_sub.patient_id=p_target_patient_id and target_sub.plan_id=source_sub.plan_id and target_sub.status in('active','paused','past_due'));
  update public.patient_records set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointments set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.crm_interactions set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.registrations set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.payment_orders set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.patient_memberships set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.membership_ledger set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.course_unit_progress set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.discount_redemptions set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.membership_notification_logs set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_waitlist_entries set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_waitlist_notification_logs set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_series set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.sales_orders set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.patient_subscriptions set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.scheduled_followups set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.patients set email=coalesce(target_row.email,source_row.email),birthday=coalesce(target_row.birthday,source_row.birthday),gender=coalesce(target_row.gender,source_row.gender),line_user_id=coalesce(target_row.line_user_id,source_row.line_user_id),marketing_opt_in=target_row.marketing_opt_in or source_row.marketing_opt_in,tags=nullif(concat_ws(', ',nullif(target_row.tags,''),nullif(source_row.tags,'')),'') where id=p_target_patient_id;
  update public.patients set active=false,merged_into_patient_id=p_target_patient_id,merged_at=now() where id=p_source_patient_id;
  insert into public.customer_merge_logs(clinic_id,source_patient_id,target_patient_id,actor_id,snapshot) values(p_clinic_id,p_source_patient_id,p_target_patient_id,p_actor_user_id,jsonb_build_object('source_name',source_row.name,'source_phone',source_row.phone,'target_name',target_row.name,'target_phone',target_row.phone));
  return p_target_patient_id;
end; $$;
revoke all on function public.merge_customers(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.merge_customers(uuid,uuid,uuid,uuid) to service_role;
commit;

-- Industry operation packs. Canonical implementation and full comments:
-- supabase/migrations/202609040003_industry_packs.sql
begin;
alter table public.inventory_movements drop constraint if exists inventory_movements_kind_check;alter table public.inventory_movements add constraint inventory_movements_kind_check check(kind in('stock_in','use','sale','waste','stocktake'));
alter table public.beauty_commission_rules add column if not exists calculation_type text not null default'fixed';alter table public.beauty_commission_rules add column if not exists rate_percent numeric(5,2) not null default 0;alter table public.beauty_commission_rules drop constraint if exists beauty_commission_rules_calculation_type_check;alter table public.beauty_commission_rules add constraint beauty_commission_rules_calculation_type_check check(calculation_type in('fixed','percent'));alter table public.beauty_commission_rules drop constraint if exists beauty_commission_rules_rate_percent_check;alter table public.beauty_commission_rules add constraint beauty_commission_rules_rate_percent_check check(rate_percent between 0 and 100);
create table if not exists public.inventory_suppliers(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,name text not null,contact_name text,phone text,email text,note text,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());create index if not exists inventory_suppliers_clinic_idx on public.inventory_suppliers(clinic_id,active,name);
create table if not exists public.purchase_orders(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,order_no text not null default('PO-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))),status text not null default'draft' check(status in('draft','ordered','received','cancelled')),expected_at date,note text,ordered_at timestamptz,received_at timestamptz,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(clinic_id,order_no));
create table if not exists public.purchase_order_items(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,item_id uuid not null references public.inventory_items(id) on delete restrict,quantity numeric(12,2) not null check(quantity>0),unit_cost integer not null default 0 check(unit_cost>=0),received_quantity numeric(12,2) not null default 0 check(received_quantity>=0),created_at timestamptz not null default now(),unique(purchase_order_id,item_id));create index if not exists purchase_orders_clinic_idx on public.purchase_orders(clinic_id,status,created_at desc);
create table if not exists public.inventory_stocktakes(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,stocktake_no text not null default('ST-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))),status text not null default'draft' check(status in('draft','completed','cancelled')),note text,created_by uuid references auth.users(id) on delete set null,completed_at timestamptz,created_at timestamptz not null default now(),unique(clinic_id,stocktake_no));
create table if not exists public.inventory_stocktake_items(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,stocktake_id uuid not null references public.inventory_stocktakes(id) on delete restrict,item_id uuid not null references public.inventory_items(id) on delete restrict,system_quantity numeric(12,2) not null check(system_quantity>=0),actual_quantity numeric(12,2) not null check(actual_quantity>=0),variance numeric(12,2) not null,created_at timestamptz not null default now(),unique(stocktake_id,item_id));create index if not exists inventory_stocktakes_clinic_idx on public.inventory_stocktakes(clinic_id,status,created_at desc);
create table if not exists public.subscription_freezes(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,subscription_id uuid not null references public.patient_subscriptions(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,starts_on date not null,ends_on date not null,freeze_days integer not null check(freeze_days between 1 and 90),status text not null default'scheduled' check(status in('scheduled','active','completed','cancelled')),reason text,paused_subscription boolean not null default false,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_on>=starts_on));create index if not exists subscription_freezes_subscription_idx on public.subscription_freezes(clinic_id,subscription_id,starts_on desc);
alter table public.course_units drop constraint if exists course_units_unit_type_check;alter table public.course_units add constraint course_units_unit_type_check check(unit_type in('video','link','download','text','quiz','assignment'));alter table public.course_units add column if not exists release_mode text not null default'immediate';alter table public.course_units add column if not exists release_days integer not null default 0;alter table public.course_units drop constraint if exists course_units_release_mode_check;alter table public.course_units add constraint course_units_release_mode_check check(release_mode in('immediate','days_after_registration','after_previous'));alter table public.course_units drop constraint if exists course_units_release_days_check;alter table public.course_units add constraint course_units_release_days_check check(release_days between 0 and 3650);
create table if not exists public.course_assessments(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,event_id uuid not null references public.events(id) on delete restrict,unit_id uuid not null unique references public.course_units(id) on delete restrict,kind text not null check(kind in('quiz','assignment')),prompt text not null,options jsonb not null default'[]'::jsonb,correct_option integer,passing_score integer not null default 100 check(passing_score between 0 and 100),active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(jsonb_typeof(options)='array'),check((kind='quiz' and jsonb_array_length(options)>=2 and correct_option>=0)or(kind='assignment' and jsonb_array_length(options)=0 and correct_option is null)));
create table if not exists public.course_assessment_submissions(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,assessment_id uuid not null references public.course_assessments(id) on delete restrict,unit_id uuid not null references public.course_units(id) on delete restrict,registration_id uuid not null references public.registrations(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,answer jsonb not null default'{}'::jsonb,submission_text text,score integer check(score is null or score between 0 and 100),status text not null default'submitted' check(status in('submitted','passed','revision')),feedback text,reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,submitted_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(registration_id,unit_id));create index if not exists course_assessment_submissions_review_idx on public.course_assessment_submissions(clinic_id,status,submitted_at desc);
create table if not exists public.course_certificates(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,event_id uuid not null references public.events(id) on delete restrict,registration_id uuid not null unique references public.registrations(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,certificate_no text not null default('CERT-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),issued_at timestamptz not null default now(),created_at timestamptz not null default now(),unique(clinic_id,certificate_no));create index if not exists course_certificates_patient_idx on public.course_certificates(clinic_id,patient_id,issued_at desc);
create table if not exists public.document_templates(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,name text not null,kind text not null check(kind in('consent','waiver','intake')),version integer not null default 1 check(version>0),body text not null,active boolean not null default true,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.customer_document_requests(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id) on delete restrict,patient_id uuid not null references public.patients(id) on delete restrict,template_id uuid not null references public.document_templates(id) on delete restrict,token_hash text not null unique,content_snapshot text not null,template_version integer not null,status text not null default'pending' check(status in('pending','signed','expired','cancelled')),expires_at timestamptz not null,signer_name text,signed_at timestamptz,signature_text text,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());create index if not exists customer_document_requests_patient_idx on public.customer_document_requests(clinic_id,patient_id,created_at desc);
do $$ declare tbl text;begin foreach tbl in array array['inventory_suppliers','purchase_orders','purchase_order_items','inventory_stocktakes','inventory_stocktake_items','subscription_freezes','course_assessments','course_assessment_submissions','course_certificates','document_templates','customer_document_requests'] loop execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on table public.%I from public, anon, authenticated',tbl);execute format('grant select on table public.%I to authenticated',tbl);execute format('grant all on table public.%I to service_role',tbl);execute format('drop policy if exists %I on public.%I',tbl||'_member_read',tbl);execute format($p$create policy %I on public.%I for select to authenticated using(exists(select 1 from public.clinic_members member where member.clinic_id=%I.clinic_id and member.user_id=auth.uid() and member.role<>'provider'))$p$,tbl||'_member_read',tbl,tbl);end loop;end $$;
do $$ declare tbl text;begin foreach tbl in array array['inventory_suppliers','purchase_orders','inventory_stocktakes','subscription_freezes','course_assessments','course_assessment_submissions','document_templates','customer_document_requests'] loop execute format('drop trigger if exists %I on public.%I','trg_'||tbl||'_touch',tbl);execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()','trg_'||tbl||'_touch',tbl);end loop;end $$;
create or replace function public.receive_purchase_order(p_clinic_id uuid,p_actor_user_id uuid,p_purchase_order_id uuid) returns integer language plpgsql security definer set search_path=public,extensions as $$ declare purchase public.purchase_orders%rowtype;line record;line_count integer:=0;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider')then raise exception'purchase actor is not allowed';end if;select * into purchase from public.purchase_orders where id=p_purchase_order_id and clinic_id=p_clinic_id for update;if not found or purchase.status not in('draft','ordered')then raise exception'purchase order cannot be received';end if;for line in select * from public.purchase_order_items where purchase_order_id=p_purchase_order_id and clinic_id=p_clinic_id for update loop perform public.record_inventory_movement(p_clinic_id,line.item_id,'stock_in',line.quantity,'採購單 '||purchase.order_no,p_actor_user_id);update public.purchase_order_items set received_quantity=line.quantity where id=line.id;line_count:=line_count+1;end loop;if line_count=0 then raise exception'purchase order has no items';end if;update public.purchase_orders set status='received',received_at=now(),ordered_at=coalesce(ordered_at,now()) where id=p_purchase_order_id;return line_count;end;$$;revoke all on function public.receive_purchase_order(uuid,uuid,uuid) from public,anon,authenticated;grant execute on function public.receive_purchase_order(uuid,uuid,uuid) to service_role;
create or replace function public.finalize_inventory_stocktake(p_clinic_id uuid,p_actor_user_id uuid,p_note text,p_counts jsonb) returns uuid language plpgsql security definer set search_path=public,extensions as $$ declare stocktake_id uuid;entry jsonb;item public.inventory_items%rowtype;actual numeric;difference numeric;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider')then raise exception'stocktake actor is not allowed';end if;if jsonb_typeof(p_counts)<>'array'or jsonb_array_length(p_counts)=0 then raise exception'stocktake counts are required';end if;insert into public.inventory_stocktakes(clinic_id,status,note,created_by,completed_at)values(p_clinic_id,'completed',nullif(btrim(p_note),''),p_actor_user_id,now())returning id into stocktake_id;for entry in select value from jsonb_array_elements(p_counts)loop actual:=(entry->>'actual_quantity')::numeric;if actual<0 then raise exception'invalid stocktake quantity';end if;select * into item from public.inventory_items where id=(entry->>'item_id')::uuid and clinic_id=p_clinic_id and active for update;if not found then raise exception'stocktake item not found';end if;difference:=actual-item.stock_on_hand;insert into public.inventory_stocktake_items(clinic_id,stocktake_id,item_id,system_quantity,actual_quantity,variance)values(p_clinic_id,stocktake_id,item.id,item.stock_on_hand,actual,difference);if difference<>0 then update public.inventory_items set stock_on_hand=actual where id=item.id;insert into public.inventory_movements(clinic_id,item_id,kind,quantity,stock_after,note,actor_id)values(p_clinic_id,item.id,'stocktake',abs(difference),actual,'盤點調整',p_actor_user_id);end if;end loop;return stocktake_id;end;$$;revoke all on function public.finalize_inventory_stocktake(uuid,uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.finalize_inventory_stocktake(uuid,uuid,text,jsonb) to service_role;
create or replace function public.freeze_patient_subscription(p_clinic_id uuid,p_actor_user_id uuid,p_subscription_id uuid,p_starts_on date,p_ends_on date,p_reason text) returns uuid language plpgsql security definer set search_path=public,extensions as $$ declare sub public.patient_subscriptions%rowtype;freeze_id uuid;days integer;state text;today_taipei date;begin if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider')then raise exception'freeze actor is not allowed';end if;days:=p_ends_on-p_starts_on+1;if days<1 or days>90 then raise exception'freeze period must be 1 to 90 days';end if;select * into sub from public.patient_subscriptions where id=p_subscription_id and clinic_id=p_clinic_id and status in('active','paused')for update;if not found then raise exception'subscription cannot be frozen';end if;if exists(select 1 from public.subscription_freezes f where f.subscription_id=p_subscription_id and f.status in('scheduled','active')and daterange(f.starts_on,f.ends_on,'[]')&&daterange(p_starts_on,p_ends_on,'[]'))then raise exception'freeze period overlaps';end if;today_taipei:=(now()at time zone'Asia/Taipei')::date;if p_ends_on<today_taipei then raise exception'freeze period cannot be in the past';end if;state:=case when today_taipei between p_starts_on and p_ends_on then'active'else'scheduled'end;insert into public.subscription_freezes(clinic_id,subscription_id,patient_id,starts_on,ends_on,freeze_days,status,reason,paused_subscription,created_by)values(p_clinic_id,p_subscription_id,sub.patient_id,p_starts_on,p_ends_on,days,state,nullif(btrim(p_reason),''),state='active'and sub.status='active',p_actor_user_id)returning id into freeze_id;update public.patient_subscriptions set current_period_end=current_period_end+make_interval(days=>days),next_billing_at=case when next_billing_at is null then null else next_billing_at+make_interval(days=>days)end,status=case when state='active'and sub.status='active'then'paused'else status end,paused_at=case when state='active'and sub.status='active'then now()else paused_at end where id=p_subscription_id;return freeze_id;end;$$;revoke all on function public.freeze_patient_subscription(uuid,uuid,uuid,date,date,text) from public,anon,authenticated;grant execute on function public.freeze_patient_subscription(uuid,uuid,uuid,date,date,text) to service_role;
create or replace function public.sync_subscription_freezes() returns integer language plpgsql security definer set search_path=public,extensions as $$ declare changed integer:=0;row_count integer;today_taipei date:=(now()at time zone'Asia/Taipei')::date;begin update public.subscription_freezes f set status='active',paused_subscription=(select subscription.status='active'from public.patient_subscriptions subscription where subscription.id=f.subscription_id)where f.status='scheduled'and f.starts_on<=today_taipei and f.ends_on>=today_taipei;get diagnostics row_count=row_count;changed:=changed+row_count;update public.patient_subscriptions subscription set status='paused',paused_at=coalesce(subscription.paused_at,now())where subscription.status='active'and exists(select 1 from public.subscription_freezes f where f.subscription_id=subscription.id and f.status='active'and f.paused_subscription);update public.subscription_freezes set status='completed'where status in('scheduled','active')and ends_on<today_taipei;get diagnostics row_count=row_count;changed:=changed+row_count;update public.patient_subscriptions subscription set status='active',paused_at=null where subscription.status='paused'and not exists(select 1 from public.subscription_freezes f where f.subscription_id=subscription.id and f.status='active'and f.paused_subscription)and exists(select 1 from public.subscription_freezes f where f.subscription_id=subscription.id and f.status='completed'and f.paused_subscription);return changed;end;$$;revoke all on function public.sync_subscription_freezes() from public,anon,authenticated;grant execute on function public.sync_subscription_freezes() to service_role;
create or replace function public.issue_course_certificate_if_complete(p_clinic_id uuid,p_registration_id uuid) returns text language plpgsql security definer set search_path=public,extensions as $$ declare registration public.registrations%rowtype;required_count integer;completed_count integer;certificate text;begin select * into registration from public.registrations where id=p_registration_id and clinic_id=p_clinic_id and status in('confirmed','attended');if not found then return null;end if;select count(*)into required_count from public.course_units where clinic_id=p_clinic_id and event_id=registration.event_id and active;select count(*)into completed_count from public.course_unit_progress where clinic_id=p_clinic_id and event_id=registration.event_id and registration_id=p_registration_id;if required_count=0 or completed_count<required_count then return null;end if;insert into public.course_certificates(clinic_id,event_id,registration_id,patient_id)values(p_clinic_id,registration.event_id,p_registration_id,registration.patient_id)on conflict(registration_id)do nothing;select certificate_no into certificate from public.course_certificates where registration_id=p_registration_id;return certificate;end;$$;revoke all on function public.issue_course_certificate_if_complete(uuid,uuid) from public,anon,authenticated;grant execute on function public.issue_course_certificate_if_complete(uuid,uuid) to service_role;
commit;
