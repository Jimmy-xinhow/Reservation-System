-- ============================================================================
-- 修復:book_number 的 queue_number 有歧義(回傳欄位 vs appointments 欄位)。
-- 加表別名 a.queue_number 消除歧義。在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

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

select 'book_number fixed' as status;
