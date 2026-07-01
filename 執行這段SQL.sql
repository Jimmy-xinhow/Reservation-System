-- ============================================================================
-- 號次制:診次顯示到「結束為止」(含已額滿),已結束才隱藏/擋掛號。
-- 在 Supabase → SQL Editor 跑一次即可(更新兩個函式)。
-- ============================================================================

-- 查可掛診次:未結束就顯示(remaining 可為 0=額滿)
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
              and (e.start_time is null or e.start_time = t.start_time))
    union all
    select e.id, e.start_time, e.end_time, coalesce(e.capacity,40) from public.schedule_exceptions e
      where e.clinic_id=p_clinic_id and e.doctor_id=p_doctor_id and e.date=p_date and not e.is_closed
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
  where ((p_date + x.end_time) at time zone 'Asia/Taipei') > now()
  group by x.id, x.start_time, x.end_time, x.capacity;
end; $$;

-- 掛號:未結束都可掛(額滿另擋);已結束擋下
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
  if v_end_at <= now() then raise exception '本診已結束'; end if;

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

select 'sessions show until end + book_number ended-check' as status;
