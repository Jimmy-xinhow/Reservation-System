# 診所預約系統 — 建置規格 v2(取代 v1)

> 本檔取代 `clinic-booking-spec.md`(v1)。與 `CLAUDE.md` 衝突時以 CLAUDE.md 為準。
> v2 重點:**設定驅動**。診所的行為差異全部放 `clinic_settings`,程式不寫死任何單一模式。

範圍:預約、提醒、後台管理。不做:健保 / HIS、叫號進度、報表、金流串接。

---

## 1. 設定驅動原則

每間診所一筆 `clinic_settings`,控制下列四項可切換行為。新建診所時自動帶預設值,後台「診所設定」頁可改。程式邏輯一律讀設定,**禁止寫死模式或門檻**。

| 設定 | 欄位 | 預設 | 作用 |
|---|---|---|---|
| 預約模式 | `booking_mode` | `time` | `time` 選確切時段 / `number` 選診次給號 |
| 初診延長 | `first_visit_extends` + `first_visit_minutes` | `false` / null | 開啟時初診佔較長區間(時間制) |
| 一電話多病患 | `allow_multi_patient_per_phone` + `max_patients_per_phone` | `false` / 1 | 開放時可多名病患共用電話,但有上限 |
| 訂金 | `deposit_enabled` + `deposit_amount` + `deposit_scope` | `false` / 0 / `self_pay` | 是否收訂金、金額、套用範圍 |
| 預約區間 | `min_lead_minutes` / `max_advance_days` | 30 / 30 | 最短前置與最長可約天數 |

---

## 2. 資料表(完整,直接貼進 Supabase)

```sql
create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean default true,
  created_at timestamptz default now()
);

create table clinic_settings (
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
  updated_at timestamptz default now()
);

create table doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  specialty text,
  active boolean default true,                         -- soft-delete,不硬刪
  created_at timestamptz default now()
);

-- 門診段。同 (doctor_id, weekday) 可多筆 = 一天多診(上午/下午/晚診)
create table schedule_templates (
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
create table schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  date date not null,
  is_closed boolean default true,                      -- true=當天整天休診
  start_time time, end_time time,
  slot_minutes smallint, capacity smallint,            -- is_closed=false(加診)時使用
  unique (clinic_id, doctor_id, date, coalesce(start_time, '00:00'::time))
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  phone text not null,                                 -- 不設 unique;多病患共用電話由設定控管
  line_user_id text,
  created_at timestamptz default now()
);
create index on patients (clinic_id, phone);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references doctors(id),
  patient_id uuid not null references patients(id),
  template_id uuid references schedule_templates(id), -- 所屬門診段(號次制必填)
  start_at timestamptz not null,
  end_at timestamptz not null,
  visit_type text not null default 'return' check (visit_type in ('first','return')),
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
create index on appointments (clinic_id, doctor_id, start_at);
create index on appointments (start_at);
create index on appointments (template_id, start_at);

create table reminder_logs (
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
create trigger trg_appt_touch before update on appointments
  for each row execute function touch_updated_at();
create trigger trg_settings_touch before update on clinic_settings
  for each row execute function touch_updated_at();
```

---

## 3. 時間制(`booking_mode='time'`)

### 算空檔(多診次 + 區間重疊 + 前置時間)
```sql
create or replace function get_available_slots(
  p_clinic_id uuid, p_doctor_id uuid, p_date date
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql security definer as $$
declare
  v_weekday smallint := extract(dow from p_date);
  v_lead int := coalesce((select min_lead_minutes from clinic_settings where clinic_id=p_clinic_id),30);
  rec record;
begin
  for rec in
    select t.start_time, t.end_time, t.slot_minutes, t.capacity
      from schedule_templates t
     where t.clinic_id=p_clinic_id and t.doctor_id=p_doctor_id
       and t.weekday=v_weekday and t.active
       and not exists (select 1 from schedule_exceptions e
              where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id
                and e.date=p_date and e.is_closed)
    union all
    select e.start_time, e.end_time, coalesce(e.slot_minutes,15), coalesce(e.capacity,1)
      from schedule_exceptions e
     where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id
       and e.date=p_date and not e.is_closed
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
    left join appointments a
      on a.clinic_id=p_clinic_id and a.doctor_id=p_doctor_id
     and a.status in ('booked','confirmed','done')
     and a.start_at < c.e and a.end_at > c.s              -- 區間重疊
    where c.s > now() + (v_lead||' minutes')::interval
    group by c.s, c.e, rec.capacity
    having rec.capacity - count(a.id) > 0
    order by c.s;
  end loop;
end; $$;
```

### 訂位(含初診延長 / 訂金 / 容量)
```sql
create or replace function book_time_slot(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_visit_type text default 'return', p_is_self_pay boolean default false
) returns uuid
language plpgsql security definer as $$
declare
  v_date date := (p_start_at at time zone 'Asia/Taipei')::date;
  v_tod time := (p_start_at at time zone 'Asia/Taipei')::time;
  v_weekday smallint := extract(dow from v_date);
  st record; s record; v_len int; v_end timestamptz; v_used int; v_id uuid;
  v_dep boolean;
begin
  select * into st from clinic_settings where clinic_id=p_clinic_id;

  select start_time,end_time,slot_minutes,capacity into s from (
    select start_time,end_time,slot_minutes,capacity from schedule_templates
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and weekday=v_weekday and active
        and not exists (select 1 from schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=v_date and e.is_closed)
    union all
    select start_time,end_time,coalesce(slot_minutes,15),coalesce(capacity,1)
      from schedule_exceptions
      where clinic_id=p_clinic_id and doctor_id=p_doctor_id and date=v_date and not is_closed
  ) q where v_tod >= start_time and v_tod < end_time limit 1;
  if not found then raise exception '此時段非門診時間'; end if;

  if p_visit_type='first' and coalesce(st.first_visit_extends,false)
    then v_len := coalesce(st.first_visit_minutes, s.slot_minutes);
    else v_len := s.slot_minutes; end if;
  v_end := p_start_at + (v_len||' minutes')::interval;

  if p_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '已超過可預約時間'; end if;

  perform pg_advisory_xact_lock(hashtext(p_doctor_id::text || p_start_at::text));
  select count(*) into v_used from appointments
   where clinic_id=p_clinic_id and doctor_id=p_doctor_id
     and status in ('booked','confirmed','done')
     and start_at < v_end and end_at > p_start_at;
  if v_used >= s.capacity then raise exception '時段已額滿'; end if;

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into appointments(clinic_id,doctor_id,patient_id,start_at,end_at,visit_type,is_self_pay,
                           deposit_status,deposit_amount)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_start_at,v_end,p_visit_type,p_is_self_pay,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end)
  returning id into v_id;
  return v_id;
end; $$;
```

---

## 4. 號次制(`booking_mode='number'`)

病患選「某醫師某天的某一診」,系統給下一個號次。`capacity` 視為整診總號數。

### 查可掛診次
```sql
create or replace function get_available_sessions(
  p_clinic_id uuid, p_doctor_id uuid, p_date date
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz,
               total int, taken int, remaining int)
language plpgsql security definer as $$
declare v_weekday smallint := extract(dow from p_date);
begin
  return query
  with sess as (
    select t.id, t.start_time, t.end_time, t.capacity from schedule_templates t
      where t.clinic_id=p_clinic_id and t.doctor_id=p_doctor_id and t.weekday=v_weekday and t.active
        and not exists (select 1 from schedule_exceptions e where e.clinic_id=p_clinic_id
              and e.doctor_id=p_doctor_id and e.date=p_date and e.is_closed)
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity,40) from schedule_exceptions e
      where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id and e.date=p_date and not e.is_closed
  )
  select x.id,
         ((p_date + x.start_time) at time zone 'Asia/Taipei'),
         ((p_date + x.end_time) at time zone 'Asia/Taipei'),
         x.capacity, count(a.id)::int, (x.capacity - count(a.id))::int
  from sess x
  left join appointments a
    on a.template_id=x.id
   and a.start_at = ((p_date + x.start_time) at time zone 'Asia/Taipei')
   and a.status in ('booked','confirmed','done')
  group by x.id, x.start_time, x.end_time, x.capacity
  having (x.capacity - count(a.id)) > 0;
end; $$;
```

### 掛號給號(號次不重用,取消後不補回同號)
```sql
create or replace function book_number(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_template_id uuid, p_date date, p_visit_type text default 'return', p_is_self_pay boolean default false
) returns table (appointment_id uuid, queue_number int)
language plpgsql security definer as $$
declare
  st record; v_cap int; v_start time; v_end time;
  v_start_at timestamptz; v_end_at timestamptz; v_used int; v_no int; v_id uuid; v_dep boolean;
begin
  select * into st from clinic_settings where clinic_id=p_clinic_id;
  select capacity,start_time,end_time into v_cap,v_start,v_end from (
    select id,capacity,start_time,end_time from schedule_templates where clinic_id=p_clinic_id
    union all
    select id,coalesce(capacity,40),start_time,end_time from schedule_exceptions
      where clinic_id=p_clinic_id and not is_closed
  ) q where id=p_template_id;
  if not found then raise exception '查無此門診段'; end if;

  v_start_at := (p_date + v_start) at time zone 'Asia/Taipei';
  v_end_at   := (p_date + v_end) at time zone 'Asia/Taipei';
  if v_start_at < now() + (coalesce(st.min_lead_minutes,30)||' minutes')::interval
    then raise exception '已超過可預約時間'; end if;

  perform pg_advisory_xact_lock(hashtext(p_template_id::text || p_date::text));
  select count(*) filter (where status in ('booked','confirmed','done')),
         coalesce(max(queue_number),0)
    into v_used, v_no
  from appointments where template_id=p_template_id and start_at=v_start_at;
  if v_used >= v_cap then raise exception '本診已額滿'; end if;
  v_no := v_no + 1;   -- 接續最大號,取消的號不回收

  v_dep := coalesce(st.deposit_enabled,false)
           and (st.deposit_scope='all' or (st.deposit_scope='self_pay' and p_is_self_pay));
  insert into appointments(clinic_id,doctor_id,patient_id,template_id,start_at,end_at,
                           visit_type,queue_number,is_self_pay,deposit_status,deposit_amount)
  values (p_clinic_id,p_doctor_id,p_patient_id,p_template_id,v_start_at,v_end_at,
          p_visit_type,v_no,p_is_self_pay,
          case when v_dep then 'pending' else 'none' end,
          case when v_dep then coalesce(st.deposit_amount,0) else 0 end)
  returning id into v_id;
  return query select v_id, v_no;
end; $$;
```

---

## 5. 四項可切換行為的實作要點

1. **模式切換**:預約頁先讀 `clinic_settings.booking_mode`,`time` 走 `get_available_slots` + `book_time_slot`、`number` 走 `get_available_sessions` + `book_number`。UI 兩套畫面依設定渲染。後台「今日約診」時間制顯示時間、號次制顯示號次。
2. **初診延長**:已內建於 `book_time_slot`。靠區間重疊保證延長時段不被重複佔用。號次制不適用(本來就不綁時間)。
3. **一電話多病患**:`patients` 不設 unique。建立病患的 server route 流程:同 `clinic_id+phone` 查現有筆數 → 若 `allow_multi_patient_per_phone=false` 且已有 1 筆,沿用該筆或擋下;若 `true`,筆數 ≥ `max_patients_per_phone` 則回「此電話可登記人數已達上限」。
4. **訂金**:`book_*` 依設定自動把 `deposit_status` 設成 `pending` 並帶金額。**不串金流**;後台可手動改 `paid / waived`。前端訂位成功頁,若 `deposit_status='pending'` 要顯示「需繳訂金 NT$X,完成後保留名額」之類提示(文案後設)。

> 模式目前是診所層級。若日後要同診所不同醫師混用模式,把 `booking_mode` 下放到 `doctors` 即可,先不做。

---

## 6. RLS 與權限(必做)

```sql
alter table clinics enable row level security;
alter table clinic_settings enable row level security;
alter table doctors enable row level security;
alter table schedule_templates enable row level security;
alter table schedule_exceptions enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table reminder_logs enable row level security;
```
- **不給 anon 任何 policy。** 病患端一律經 Next.js API route 用 `service_role` 操作(service_role 繞過 RLS)。
- 後台用 Supabase Auth(authenticated);policy 限定登入櫃檯只能存取自己診所(`clinic_id` 比對)。
- RPC 全部 `security definer`,並 `revoke execute from anon, authenticated; grant execute to service_role;`(後台需要的查詢另開 authenticated policy 或專屬 RPC)。

---

## 7. 提醒(同 v1,差異標註)

- Vercel Cron(**UTC**),涵蓋「當天才新增」的預約:用「看診前 N 小時」邏輯,而非固定掃隔天。
- `reminder_logs` unique 防重複。
- Flex 訊息:時間制顯示日期+時間;號次制顯示「X/X(週) 上午診 第 N 號」。
- webhook postback `confirm/cancel` 回寫 `status`,驗 `x-line-signature`。
- LIFF 取得的 `line_user_id` 須經 ID token 後端驗證才採用。

## 8. 後台

- 今日約診(依模式顯示時間/號次)、改狀態(完成/未到)、建立/改期/取消。
- 門診表(`schedule_templates`,支援一天多診)、休診/加診(`schedule_exceptions`)。
- 病患查詢、訂金狀態管理。
- **診所設定頁**:第 1 節五組設定的開關與數值。
- Supabase Auth 登入 + middleware 擋未登入。

## 9. 不做(未經同意不要碰)
健保 / HIS、叫號進度、報表、分眾行銷、評價導流、金流串接。
