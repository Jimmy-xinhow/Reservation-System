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
  created_at timestamptz default now()
);
-- 既有資料庫補欄位(idempotent)
alter table clinics add column if not exists line_basic_id text;
alter table clinics add column if not exists phone text;
alter table clinics add column if not exists address text;
alter table clinics add column if not exists intro text;

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
    check (deposit_status in ('none','pending','paid','waived','refunded')),
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

-- updated_at 自動更新
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

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
  ));

drop policy if exists schedule_templates_member on schedule_templates;
create policy schedule_templates_member on schedule_templates for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists schedule_exceptions_member on schedule_exceptions;
create policy schedule_exceptions_member on schedule_exceptions for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

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
revoke execute on function get_available_slots(uuid,uuid,date,text) from anon, authenticated;
revoke execute on function get_available_sessions(uuid,uuid,date) from anon, authenticated;
revoke execute on function book_time_slot(uuid,uuid,uuid,timestamptz,text,boolean,uuid) from anon, authenticated;
revoke execute on function book_number(uuid,uuid,uuid,uuid,date,text,boolean,uuid) from anon, authenticated;

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
alter table clinic_settings add column if not exists public_booking_enabled boolean not null default true;
alter table clinic_settings add column if not exists public_registration_enabled boolean not null default true;

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
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, registration_no)
);
create index if not exists registrations_event_idx on registrations (clinic_id, event_id, session_id, status);
create index if not exists registrations_contact_idx on registrations (clinic_id, phone, created_at desc);

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
  check ((appointment_id is null) <> (registration_id is null)),
  unique (provider, merchant_order_no)
);
alter table payment_orders add column if not exists expires_at timestamptz;
create index if not exists payment_orders_clinic_idx on payment_orders (clinic_id, status, created_at desc);
create unique index if not exists payment_orders_registration_pending_idx
  on payment_orders (registration_id) where registration_id is not null and status = 'pending';
create unique index if not exists payment_orders_appointment_pending_idx
  on payment_orders (appointment_id) where appointment_id is not null and status = 'pending';

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
  v_no integer;
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

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_event_id::text));

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

  select coalesce(max(nullif(regexp_replace(registration_no, '[^0-9]', '', 'g'), '')::int), 0) + 1
    into v_no from registrations where event_id = p_event_id;
  v_registration_no := 'REG-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_no::text, 4, '0');

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
  if exists (select 1 from checkins where registration_id = r.id and result = 'accepted') then
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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));
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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'));

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
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
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
  v_original integer := 0; v_amount integer := 0; v_discount integer := 0;
  v_no integer; v_registration_no text; v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid; v_position integer; v_membership_applied boolean := false;
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
  perform pg_advisory_xact_lock(hashtext('registration-benefit:' || p_clinic_id::text || ':' || p_event_id::text));
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
        v_discount := case when d.kind='percent' then floor(v_amount*d.value/100.0)::int else least(v_amount,d.value) end;
        v_amount := greatest(0,v_amount-v_discount);
      end if;
    end if;
    v_status := case when v_amount=0 then 'confirmed' else 'pending' end;
    v_payment_status := case when v_amount=0 then 'not_required' else 'pending' end;
  end if;
  select coalesce(max(nullif(regexp_replace(registration_no,'[^0-9]','','g'),'')::int),0)+1 into v_no from registrations where clinic_id=p_clinic_id and event_id=p_event_id;
  v_registration_no := 'REG-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(v_no::text,4,'0');
  insert into registrations (clinic_id,event_id,session_id,ticket_type_id,registration_no,status,payment_status,amount,discount_code_id,discount_amount,membership_id,name,phone,email,line_user_id,marketing_opt_in,answers,checkin_token_hash,expires_at,form_id,form_version)
    values (p_clinic_id,p_event_id,p_session_id,p_ticket_type_id,v_registration_no,v_status,v_payment_status,v_amount,case when v_code is null then null else d.id end,v_discount,case when v_membership_applied then m.id else null end,trim(p_name),trim(p_phone),nullif(trim(p_email),''),nullif(trim(p_line_user_id),''),coalesce(p_marketing_opt_in,false),coalesce(p_answers,'{}'::jsonb),encode(digest(v_token,'sha256'),'hex'),case when v_status='pending' then now()+interval '15 minutes' else null end,p_form_id,p_form_version) returning id into v_id;
  insert into registration_answers (clinic_id,registration_id,answers) values (p_clinic_id,v_id,p_answers);
  if v_membership_applied then
    perform consume_membership_credit(p_clinic_id,m.id,'registration','registration',v_id,null,null,'registration membership redemption');
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

  perform pg_advisory_xact_lock(hashtext('registration-session:' || p_clinic_id::text || p_session_id::text));

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
    update appointments
       set status = 'cancelled', deposit_status = 'failed', deposit_expires_at = null, updated_at = now()
     where id = a.id and clinic_id = a.clinic_id and status in ('booked', 'confirmed') and deposit_status = 'pending';
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
    'discount_codes', 'discount_redemptions'
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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));
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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

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
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

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
    'membership_plans','discount_codes','crm_segments','crm_segment_members','crm_automations'
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
