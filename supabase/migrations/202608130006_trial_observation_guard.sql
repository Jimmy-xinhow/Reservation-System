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
