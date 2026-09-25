begin;
-- Explicit tenant and record scopes for operational drills; never call global fallback.
create or replace function public.claim_line_richmenu_schedules_for_clinic(p_clinic_id uuid, p_schedule_ids uuid[])
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
  if p_clinic_id is null or p_schedule_ids is null or cardinality(p_schedule_ids) not between 1 and 100
     or array_position(p_schedule_ids, null) is not null
     or (select count(distinct x) from unnest(p_schedule_ids) x) <> cardinality(p_schedule_ids)
  then raise exception 'clinic and 1 to 100 unique schedule IDs required'; end if;
  if not exists(select 1 from public.clinics where id=p_clinic_id and active) then return; end if;


  update public.line_richmenu_schedules schedule
     set status = case when schedule.status = 'activating' then 'scheduled' else 'active' end,
         claimed_at = null,
         last_error = coalesce(schedule.last_error, 'stale claim recovered'),
         updated_at = now()
   where schedule.clinic_id = p_clinic_id and schedule.id = any(p_schedule_ids) and schedule.status in ('activating', 'expiring')
     and schedule.claimed_at < now() - interval '10 minutes'
     and schedule.attempt_count < 5;

  update public.line_richmenu_schedules schedule
     set status = 'failed', claimed_at = null,
         last_error = coalesce(schedule.last_error, 'retry limit reached'), updated_at = now()
   where schedule.clinic_id = p_clinic_id and schedule.id = any(p_schedule_ids) and schedule.status in ('activating', 'expiring')
     and schedule.claimed_at < now() - interval '10 minutes'
     and schedule.attempt_count >= 5;

  with expired_windows as (
    update public.line_richmenu_schedules schedule
       set status = 'failed', completed_at = now(), claimed_at = null,
           last_error = 'display window ended before activation', updated_at = now()
     where schedule.clinic_id = p_clinic_id and schedule.id = any(p_schedule_ids) and schedule.status = 'scheduled'
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
     where schedule.clinic_id = p_clinic_id and schedule.id = any(p_schedule_ids) and schedule.attempt_count < 5
       and ((schedule.status = 'scheduled' and schedule.starts_at <= now())
         or (schedule.status = 'active' and schedule.ends_at <= now()))
     order by case when schedule.status = 'active' then schedule.ends_at else schedule.starts_at end,
              schedule.created_at
     limit 100
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
revoke all on function public.claim_line_richmenu_schedules_for_clinic(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_line_richmenu_schedules_for_clinic(uuid,uuid[]) to service_role;
create or replace function public.sync_subscription_freezes_for_clinic(p_clinic_id uuid, p_subscription_ids uuid[])
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare
  sub record;
  changed integer := 0;
  affected integer;
  ended_owned_pause boolean;
  active_owned_pause boolean;
  today_taipei date := (now() at time zone 'Asia/Taipei')::date;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  if p_clinic_id is null or p_subscription_ids is null or cardinality(p_subscription_ids) not between 1 and 100
    or array_position(p_subscription_ids,null) is not null
    or (select count(distinct x) from unnest(p_subscription_ids) x) <> cardinality(p_subscription_ids)
  then raise exception 'clinic and 1 to 100 unique subscription IDs required'; end if;
  if not exists(select 1 from public.clinics where id=p_clinic_id and active) then return 0; end if;

  -- Lock the entire subscription, not a single freeze: adjacent windows must
  -- share pause ownership, and concurrent runs must not reactivate it early.
  for sub in select s.id,s.status from public.patient_subscriptions s
    where s.clinic_id=p_clinic_id and s.id=any(p_subscription_ids) and s.status in ('active','paused')
    order by s.id for update skip locked
  loop
    with ended as (
      update public.subscription_freezes f set status='completed'
      where f.clinic_id=p_clinic_id and f.subscription_id=sub.id
        and f.status in ('scheduled','active') and f.ends_on<today_taipei
      returning f.paused_subscription
    ) select count(*),coalesce(bool_or(paused_subscription),false) into affected,ended_owned_pause from ended;
    changed:=changed+affected;

    update public.subscription_freezes f
      set status='active',paused_subscription=(sub.status='active' or ended_owned_pause)
      where f.clinic_id=p_clinic_id and f.subscription_id=sub.id and f.status='scheduled'
        and f.starts_on<=today_taipei and f.ends_on>=today_taipei;
    get diagnostics affected=row_count;
    changed:=changed+affected;
    select exists(select 1 from public.subscription_freezes f
      where f.clinic_id=p_clinic_id and f.subscription_id=sub.id and f.status='active' and f.paused_subscription)
      into active_owned_pause;
    if active_owned_pause and sub.status='active' then
      update public.patient_subscriptions set status='paused',paused_at=coalesce(paused_at,now())
      where clinic_id=p_clinic_id and id=sub.id;
    elsif ended_owned_pause and not active_owned_pause and sub.status='paused' then
      update public.patient_subscriptions set status='active',paused_at=null
      where clinic_id=p_clinic_id and id=sub.id;
    end if;
  end loop;
  return changed;
end $$;
revoke all on function public.sync_subscription_freezes_for_clinic(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.sync_subscription_freezes_for_clinic(uuid,uuid[]) to service_role;

create or replace function public.resolve_crm_targets_for_patients(p_clinic_id uuid, p_segment_id uuid, p_patient_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;

begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  if p_clinic_id is null or p_patient_ids is null or cardinality(p_patient_ids) not between 1 and 100
    or array_position(p_patient_ids,null) is not null
    or (select count(distinct x) from unnest(p_patient_ids) x) <> cardinality(p_patient_ids)
  then raise exception 'clinic and 1 to 100 unique patient IDs required'; end if;
  if not exists(select 1 from public.clinics where id=p_clinic_id and active) then return; end if;
  if p_segment_id is null then
    return query select p.id from public.patients p where p.clinic_id=p_clinic_id and p.active and p.id=any(p_patient_ids);
    return;
  end if;
  select * into s from crm_segments where id = p_segment_id and clinic_id = p_clinic_id and active;
  if not found then raise exception '找不到有效的 CRM 分眾'; end if;



  if s.rule_type = 'tag_contains' then
    return query select p.id from patients p
     where p.clinic_id = s.clinic_id and p.active and p.id=any(p_patient_ids)
       and position(lower(s.rule_value) in lower(coalesce(p.tags, ''))) > 0;
  elsif s.rule_type = 'no_booking_days' then
    return query select p.id from patients p
     where p.clinic_id = s.clinic_id and p.active and p.id=any(p_patient_ids)
       and not exists (
         select 1 from appointments a where a.clinic_id = s.clinic_id and a.patient_id = p.id
           and a.status in ('booked', 'confirmed') and a.start_at >= now()
       )
       and not exists (
         select 1 from appointments a where a.clinic_id = s.clinic_id and a.patient_id = p.id
           and a.status = 'done' and a.start_at >= now() - (s.rule_value::int || ' days')::interval
       );
  elsif s.rule_type = 'completed_visits_gte' then
    return query select p.id from patients p
     where p.clinic_id = s.clinic_id and p.active and p.id=any(p_patient_ids)
       and (select count(*) from appointments a
             where a.clinic_id = s.clinic_id and a.patient_id = p.id and a.status = 'done') >= s.rule_value::int;
  elsif s.rule_type = 'no_show_gte' then
    return query select p.id from patients p
     where p.clinic_id = s.clinic_id and p.active and p.id=any(p_patient_ids)
       and (select count(*) from appointments a
             where a.clinic_id = s.clinic_id and a.patient_id = p.id and a.status = 'no_show') >= s.rule_value::int;
  elsif s.rule_type = 'birthday_month' then
    return query select p.id from patients p
     where p.clinic_id = s.clinic_id and p.active and p.id=any(p_patient_ids)
       and extract(month from p.birthday)::int = s.rule_value::int;
  else
    raise exception '不支援的 CRM 分眾規則';
  end if;

  return;
end; $$;
revoke all on function public.resolve_crm_targets_for_patients(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.resolve_crm_targets_for_patients(uuid,uuid,uuid[]) to service_role;
commit;
