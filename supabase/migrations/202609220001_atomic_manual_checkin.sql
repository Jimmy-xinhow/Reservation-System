begin;

-- Manual operator check-in keeps its existing permission to record past sessions.
-- Lock the same registration row as QR check-in so both paths serialize.
create or replace function public.checkin_registration_by_id(
  p_clinic_id uuid, p_registration_id uuid, p_user_id uuid
)
returns table (registration_id uuid, registration_status text, checked_in_at timestamptz, result text)
language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations;
  previous public.checkins;
  checked_at timestamptz := now();
  prior_actor text := current_setting('request.jwt.claim.sub', true);
begin
  if p_user_id is null then raise exception '缺少報到操作人員'; end if;
  select * into r from public.registrations
   where id = p_registration_id and clinic_id = p_clinic_id for update;
  if not found then return; end if;
  if r.status not in ('confirmed', 'attended', 'no_show') then
    raise exception '此報名目前不可報到';
  end if;
  select * into previous from public.checkins c
   where c.clinic_id = p_clinic_id and c.registration_id = r.id and c.result = 'accepted';
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  if previous.id is not null then
    -- Repair a prior partially completed manual check-in only when retried;
    -- retain its original time and operator, and never resurrect cancellation.
    if r.status <> 'attended' then
      update public.registrations set status = 'attended'
       where id = r.id and clinic_id = p_clinic_id;
    end if;
    perform set_config('request.jwt.claim.sub', coalesce(prior_actor, ''), true);
    return query select r.id, 'attended'::text, previous.checked_in_at, 'duplicate'::text;
    return;
  end if;
  insert into public.checkins (clinic_id, registration_id, checked_in_by, checked_in_at, result)
   values (p_clinic_id, r.id, p_user_id, checked_at, 'accepted');
  update public.registrations set status = 'attended'
   where id = r.id and clinic_id = p_clinic_id;
  perform set_config('request.jwt.claim.sub', coalesce(prior_actor, ''), true);
  return query select r.id, 'attended'::text, checked_at, 'accepted'::text;
end;
$$;
revoke all on function public.checkin_registration_by_id(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.checkin_registration_by_id(uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
