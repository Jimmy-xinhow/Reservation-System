-- Explicit operational replay: never fall back to the global queue.
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
      select f.id from public.scheduled_followups f
      where f.clinic_id=p_clinic_id and f.id=any(p_followup_ids)
        and f.status='pending' and f.channel in ('line','email')
        and f.scheduled_for<=now()
      order by f.scheduled_for,f.id for update skip locked
    )
    update public.scheduled_followups f
      set status='processing',attempt_count=f.attempt_count+1,updated_at=now()
      from due where f.id=due.id and f.clinic_id=p_clinic_id
      returning f.*;
end;
$$;
revoke all on function public.claim_scheduled_followups_for_clinic(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_scheduled_followups_for_clinic(uuid,uuid[]) to service_role;
