begin;

-- G1-05: reject unused QR credentials after the configured session end.
create or replace function checkin_registration(p_clinic_id uuid, p_token text, p_user_id uuid default null)
returns table (registration_id uuid, registration_status text, checked_in_at timestamptz, result text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_hash text;
  v_now timestamptz := now();
begin
  if nullif(trim(p_token), '') is null then raise exception '缺少報到憑證'; end if;
  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  select * into r from registrations where clinic_id = p_clinic_id and checkin_token_hash = v_hash for update;
  if not found then raise exception '報到憑證無效'; end if;
  if r.status in ('cancelled','waitlisted','pending') then raise exception '此報名目前不可報到'; end if;
  if exists (select 1 from checkins c where c.registration_id = r.id and c.result = 'accepted') then
    return query select r.id, r.status, (select c.checked_in_at from checkins c where c.registration_id = r.id and c.result = 'accepted'), 'duplicate';
    return;
  end if;
  -- A successful historical scan remains a duplicate even after the session ends.
  -- The expiry follows each session's configured end time, with no fixed grace period.
  if not exists (
    select 1 from event_sessions session
    where session.id = r.session_id and session.clinic_id = p_clinic_id
      and session.event_id = r.event_id and session.end_at > v_now
  ) then
    raise exception '報到憑證已過期，活動場次已結束';
  end if;
  insert into checkins (clinic_id, registration_id, checked_in_by, result)
    values (p_clinic_id, r.id, p_user_id, 'accepted');
  update registrations set status = 'attended', updated_at = v_now where id = r.id;
  return query select r.id, 'attended'::text, v_now, 'accepted'::text;
end; $$;

revoke all on function checkin_registration(uuid,text,uuid) from public, anon, authenticated;
grant execute on function checkin_registration(uuid,text,uuid) to service_role;

commit;
