-- A disabled CRM module must pause queued LINE/Email follow-ups before a worker claims them.
begin;

create or replace function public.claim_due_scheduled_followups(p_limit integer default 50)
returns setof public.scheduled_followups
language sql security definer set search_path=public,extensions as $$
  with due as (
    select f.id
    from public.scheduled_followups f
    join public.clinic_settings s on s.clinic_id=f.clinic_id
    where s.crm_automation_enabled=true
      and f.status='pending' and f.channel in ('line','email')
      and f.scheduled_for<=now()
    order by f.scheduled_for,f.id
    for update of f skip locked
    limit greatest(1,least(p_limit,200))
  )
  update public.scheduled_followups f
    set status='processing',attempt_count=f.attempt_count+1,updated_at=now()
    from due where f.id=due.id
    returning f.*;
$$;
revoke all on function public.claim_due_scheduled_followups(integer) from public,anon,authenticated;
grant execute on function public.claim_due_scheduled_followups(integer) to service_role;

create or replace function public.claim_scheduled_followups_for_clinic(
  p_clinic_id uuid, p_followup_ids uuid[]
) returns setof public.scheduled_followups
language plpgsql security definer set search_path=public,extensions as $$
begin
  if p_clinic_id is null or coalesce(cardinality(p_followup_ids),0) not between 1 and 100
     or array_position(p_followup_ids,null) is not null then
    raise exception 'clinic and 1 to 100 follow-up ids are required';
  end if;
  return query
    with due as (
      select f.id
      from public.scheduled_followups f
      join public.clinic_settings s on s.clinic_id=f.clinic_id
      where f.clinic_id=p_clinic_id and f.id=any(p_followup_ids)
        and s.crm_automation_enabled=true
        and f.status='pending' and f.channel in ('line','email')
        and f.scheduled_for<=now()
      order by f.scheduled_for,f.id
      for update of f skip locked
    )
    update public.scheduled_followups f
      set status='processing',attempt_count=f.attempt_count+1,updated_at=now()
      from due where f.id=due.id and f.clinic_id=p_clinic_id
      returning f.*;
end;
$$;
revoke all on function public.claim_scheduled_followups_for_clinic(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_scheduled_followups_for_clinic(uuid,uuid[]) to service_role;

notify pgrst, 'reload schema';
commit;
