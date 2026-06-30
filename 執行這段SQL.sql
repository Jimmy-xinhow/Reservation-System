-- ============================================================================
-- 休診支援「只休某一診」(不只整天)。更新 4 個排程函式。
-- 在 Supabase → SQL Editor 整段貼上 Run。create or replace 會保留既有權限。
-- 資料模型:schedule_exceptions
--   is_closed=true  且 start_time 為 null → 整天休診
--   is_closed=true  且 start_time 有值     → 只休該時段
--   is_closed=false                        → 加診
-- ============================================================================

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

create or replace function get_available_sessions(
  p_clinic_id uuid, p_doctor_id uuid, p_date date
)
returns table (template_id uuid, session_start timestamptz, session_end timestamptz,
               total int, taken int, remaining int)
language plpgsql security definer set search_path = '' as $$
declare v_weekday smallint := extract(dow from p_date);
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
  select count(*) filter (where status in ('booked','confirmed','done')),
         coalesce(max(queue_number),0)
    into v_used, v_no
  from public.appointments where template_id=p_template_id and start_at=v_start_at;
  if v_used >= v_cap then raise exception '本診已額滿'; end if;
  v_no := v_no + 1;

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
