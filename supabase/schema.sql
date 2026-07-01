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
  -- Email 提醒(後台可自行設定;金鑰僅 server 端讀取,anon 無 policy 讀不到)
  email_enabled boolean not null default false,
  resend_api_key text,
  email_from text,
  updated_at timestamptz default now()
);
alter table clinic_settings add column if not exists email_enabled boolean not null default false;
alter table clinic_settings add column if not exists resend_api_key text;
alter table clinic_settings add column if not exists email_from text;

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  specialty text,
  active boolean default true,                         -- soft-delete,不硬刪
  created_at timestamptz default now()
);

-- 門診段。同 (doctor_id, weekday) 可多筆 = 一天多診(上午/下午/晚診)
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

-- LINE 自動回覆規則(後台可編輯)。keywords 命中(包含)→ 依 action 回覆。
-- action:text=自訂文字 / booking=開啟預約 / query=查詢預約 / progress=看診進度
create table if not exists line_auto_replies (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  keywords text not null,              -- 以逗號分隔,任一命中即觸發
  action text not null default 'text' check (action in ('text','booking','query','progress')),
  reply_text text,                     -- action=text 時回覆的內容
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);

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
  appointment_id uuid not null references appointments(id) on delete cascade,
  channel text not null default 'line',
  sent_at timestamptz default now(),
  result text,
  unique (appointment_id, channel)
);

-- updated_at 自動更新
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_appt_touch on appointments;
create trigger trg_appt_touch before update on appointments
  for each row execute function touch_updated_at();

drop trigger if exists trg_settings_touch on clinic_settings;
create trigger trg_settings_touch before update on clinic_settings
  for each row execute function touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- §3 時間制 (booking_mode='time')
-- ──────────────────────────────────────────────────────────────────────────

create or replace function get_available_slots(
  p_clinic_id uuid, p_doctor_id uuid, p_date date
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql security definer set search_path = '' as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead int := coalesce((select min_lead_minutes from public.clinic_settings where clinic_id=p_clinic_id),30);
  rec record;
begin
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
    return query
    with candidate as (
      select ((p_date + rec.start_time + (n||' minutes')::interval) at time zone 'Asia/Taipei') as s,
             ((p_date + rec.start_time + ((n+rec.slot_minutes)||' minutes')::interval) at time zone 'Asia/Taipei') as e
      from generate_series(0,
        (extract(epoch from (rec.end_time-rec.start_time))/60)::int - rec.slot_minutes,
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
          and (c.s at time zone 'Asia/Taipei')::time >= ec.start_time
          and (c.s at time zone 'Asia/Taipei')::time <  ec.end_time
      )
    group by c.s, c.e, rec.capacity
    having rec.capacity - count(a.id) > 0
    order by c.s;
  end loop;
end; $$;

create or replace function book_time_slot(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_visit_type text default 'return', p_is_self_pay boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (p_start_at at time zone 'Asia/Taipei')::date;
  v_tod time := (p_start_at at time zone 'Asia/Taipei')::time;
  v_weekday smallint := extract(dow from v_date);
  st record; s record; v_len int; v_end timestamptz; v_used int; v_id uuid;
  v_dep boolean;
begin
  select * into st from public.clinic_settings where clinic_id=p_clinic_id;

  select start_time,end_time,slot_minutes,capacity into s from (
    select start_time,end_time,slot_minutes,capacity from public.schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and weekday=v_weekday and active
        and not exists (select 1 from public.schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=v_date and e.is_closed and e.start_time is null)
    union all
    select start_time,end_time,coalesce(slot_minutes,15),coalesce(capacity,1)
      from public.schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=v_date and not is_closed
  ) q where v_tod >= start_time and v_tod < end_time limit 1;
  if not found then raise exception '此時段非門診時間'; end if;

  -- 只休某診:落在被休時段內則擋下
  if exists (select 1 from public.schedule_exceptions ec
             where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=v_date
               and ec.is_closed and ec.start_time is not null
               and v_tod >= ec.start_time and v_tod < ec.end_time)
    then raise exception '此時段已休診'; end if;

  if p_visit_type='first' and coalesce(st.first_visit_extends,false)
    then v_len := coalesce(st.first_visit_minutes, s.slot_minutes);
    else v_len := s.slot_minutes; end if;
  v_end := p_start_at + (v_len||' minutes')::interval;

  if p_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '已超過可預約時間'; end if;

  perform pg_advisory_xact_lock(hashtext(p_doctor_id::text || p_start_at::text));
  select count(*) into v_used from public.appointments
   where clinic_id=p_clinic_id and doctor_id=p_doctor_id
     and status in ('booked','confirmed','done')
     and start_at < v_end and end_at > p_start_at;
  if v_used >= s.capacity then raise exception '時段已額滿'; end if;

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into public.appointments(clinic_id,doctor_id,patient_id,start_at,end_at,visit_type,is_self_pay,
                           deposit_status,deposit_amount)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_start_at,v_end,p_visit_type,p_is_self_pay,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end)
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
              and (e.start_time is null or e.start_time = t.start_time))  -- 整天休診或只休此診
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity,40) from public.schedule_exceptions e
      where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id and e.date=p_date and not e.is_closed
  )
  select x.id,
         ((p_date + x.start_time) at time zone 'Asia/Taipei'),
         ((p_date + x.end_time) at time zone 'Asia/Taipei'),
         x.capacity, count(a.id)::int, (x.capacity - count(a.id))::int
  from sess x
  left join public.appointments a
    on a.template_id=x.id
   and a.start_at = ((p_date + x.start_time) at time zone 'Asia/Taipei')
   and a.status in ('booked','confirmed','done')
  -- 只顯示未來、且距現在已達最短前置時間的診次(今天已過或太接近的不顯示)
  where ((p_date + x.start_time) at time zone 'Asia/Taipei') > now() + (v_lead||' minutes')::interval
  group by x.id, x.start_time, x.end_time, x.capacity
  having (x.capacity - count(a.id)) > 0;
end; $$;

create or replace function book_number(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_template_id uuid, p_date date, p_visit_type text default 'return', p_is_self_pay boolean default false
) returns table (appointment_id uuid, queue_number int)
language plpgsql security definer set search_path = '' as $$
declare
  st record; v_cap int; v_start time; v_end time;
  v_start_at timestamptz; v_end_at timestamptz; v_used int; v_no int; v_id uuid; v_dep boolean;
begin
  select * into st from public.clinic_settings where clinic_id=p_clinic_id;
  select capacity,start_time,end_time into v_cap,v_start,v_end from (
    select id,capacity,start_time,end_time from public.schedule_templates where clinic_id=p_clinic_id
    union all
    select id,coalesce(capacity,40),start_time,end_time from public.schedule_exceptions
      where clinic_id=p_clinic_id and not is_closed
  ) q where id=p_template_id;
  if not found then raise exception '查無此門診段'; end if;

  v_start_at := (p_date + v_start) at time zone 'Asia/Taipei';
  v_end_at   := (p_date + v_end) at time zone 'Asia/Taipei';
  if v_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '已超過可預約時間'; end if;

  -- 整天休診或只休此診則擋下
  if exists (select 1 from public.schedule_exceptions ec
             where ec.clinic_id=p_clinic_id and ec.doctor_id=p_doctor_id and ec.date=p_date
               and ec.is_closed and (ec.start_time is null or ec.start_time = v_start))
    then raise exception '本診已休診'; end if;

  perform pg_advisory_xact_lock(hashtext(p_template_id::text || p_date::text));
  select count(*) filter (where a.status in ('booked','confirmed','done')),
         coalesce(max(a.queue_number),0)
    into v_used, v_no
  from public.appointments a where a.template_id=p_template_id and a.start_at=v_start_at;
  if v_used >= v_cap then raise exception '本診已額滿'; end if;
  v_no := v_no + 1;   -- 接續最大號,取消的號不回收

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into public.appointments(clinic_id,doctor_id,patient_id,template_id,start_at,end_at,
                           visit_type,queue_number,is_self_pay,deposit_status,deposit_amount)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_template_id,v_start_at,v_end_at,
          p_visit_type,v_no,p_is_self_pay,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end)
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
  created_at timestamptz default now(),
  primary key (clinic_id, user_id)
);
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

alter table clinics enable row level security;
alter table clinic_settings enable row level security;
alter table doctors enable row level security;
alter table schedule_templates enable row level security;
alter table schedule_exceptions enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table reminder_logs enable row level security;
alter table clinic_members enable row level security;
alter table services enable row level security;
alter table serving_numbers enable row level security;
alter table line_auto_replies enable row level security;
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

drop policy if exists line_replies_member on line_auto_replies;
create policy line_replies_member on line_auto_replies for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists line_richmenu_member on line_richmenu;
create policy line_richmenu_member on line_richmenu for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists reminder_logs_member on reminder_logs;
create policy reminder_logs_member on reminder_logs for all to authenticated
  using ((select clinic_id from public.appointments a where a.id = appointment_id)
         in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check ((select clinic_id from public.appointments a where a.id = appointment_id)
         in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists clinic_members_self on clinic_members;
create policy clinic_members_self on clinic_members for select to authenticated
  using (user_id = auth.uid());

-- 舊版 helper 一律清掉(此時所有 policy 已改為內聯 auth.uid(),不再依賴這些函式)。
drop function if exists is_clinic_member(uuid);
drop function if exists auth_clinic_ids();

-- RPC:全 security definer。撤掉 anon/authenticated,只給 service_role(病患端走 service_role)。
revoke execute on function get_available_slots(uuid,uuid,date) from anon, authenticated;
revoke execute on function get_available_sessions(uuid,uuid,date) from anon, authenticated;
revoke execute on function book_time_slot(uuid,uuid,uuid,timestamptz,text,boolean) from anon, authenticated;
revoke execute on function book_number(uuid,uuid,uuid,uuid,date,text,boolean) from anon, authenticated;

grant execute on function get_available_slots(uuid,uuid,date) to service_role;
grant execute on function get_available_sessions(uuid,uuid,date) to service_role;
grant execute on function book_time_slot(uuid,uuid,uuid,timestamptz,text,boolean) to service_role;
grant execute on function book_number(uuid,uuid,uuid,uuid,date,text,boolean) to service_role;

-- 後台改期需取消舊約再以 RPC 建新約;取消只改 status(不 DELETE),走一般 update policy。
