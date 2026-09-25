-- Run against an isolated acceptance database. Every fixture and trigger rolls back.
-- Requires one existing Auth user; never creates a real account or sends messages.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local plpgsql.check_asserts = on;
create function pg_temp.reject_manual_fixture_update() returns trigger language plpgsql as $$
begin
  if new.id::text = current_setting('test.manual_checkin_failure', true) then
    raise exception using errcode = 'P9001', message = 'synthetic status update failure';
  end if;
  return new;
end; $$;
create trigger manual_checkin_acceptance_failure before update of status on public.registrations
for each row execute function pg_temp.reject_manual_fixture_update();
do $$
declare
  c uuid; other_c uuid; e uuid; s uuid; r uuid; actor uuid; receipt record;
  first_time timestamptz; before_count integer; rejected boolean; state text;
begin
  select id into actor from auth.users order by id limit 1;
  assert actor is not null, 'existing Auth fixture required';
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.clinics(name,slug) values('Atomic check-in fixture','manual-'||gen_random_uuid()) returning id into c;
  insert into public.clinics(name,slug) values('Other check-in fixture','manual-'||gen_random_uuid()) returning id into other_c;
  insert into public.events(clinic_id,slug,title) values(c,'atomic','Atomic fixture') returning id into e;
  insert into public.event_sessions(clinic_id,event_id,name,start_at,end_at,capacity)
    values(c,e,'Past session',now()-interval '2 days',now()-interval '1 day',10) returning id into s;
  insert into public.registrations(clinic_id,event_id,session_id,registration_no,checkin_token_hash,name,phone,status)
    values(c,e,s,'ATOMIC',gen_random_uuid()::text,'Synthetic','0900000000','confirmed') returning id into r;
  select count(*) into before_count from public.registration_status_events where registration_id=r;
  perform set_config('test.manual_checkin_failure', r::text, true);
  rejected := false;
  begin
    perform * from public.checkin_registration_by_id(c,r,actor);
  exception when sqlstate 'P9001' then rejected := true;
  end;
  assert rejected, 'injected update must fail';
  assert not exists(select from public.checkins where registration_id=r), 'insert must roll back';
  assert (select status='confirmed' from public.registrations where id=r), 'status must roll back';
  assert (select count(*)=before_count from public.registration_status_events where registration_id=r), 'audit must roll back';
  assert coalesce(current_setting('request.jwt.claim.sub',true),'')='', 'failed call restores actor';
  perform set_config('test.manual_checkin_failure','',true);
  assert not exists(select from public.checkin_registration_by_id(other_c,r,actor)), 'cross-brand is not found';
  assert not exists(select from public.checkin_registration_by_id(c,gen_random_uuid(),actor)), 'missing registration is not found';
  select * into receipt from public.checkin_registration_by_id(c,r,actor);
  assert receipt.result='accepted' and receipt.registration_status='attended', 'retry succeeds even for past manual session';
  first_time := receipt.checked_in_at;
  assert (select checked_in_by=actor from public.checkins where registration_id=r), 'operator retained';
  assert exists(select from public.registration_status_events where registration_id=r and to_status='attended' and actor_id=actor and source='admin'), 'audit identifies operator';
  assert coalesce(current_setting('request.jwt.claim.sub',true),'')='', 'success restores actor';
  select * into receipt from public.checkin_registration_by_id(c,r,actor);
  assert receipt.result='duplicate' and receipt.checked_in_at=first_time, 'retry retains original receipt';
  assert (select count(*)=1 from public.checkins where registration_id=r), 'only one check-in';
  assert (select count(*)=before_count+1 from public.registration_status_events where registration_id=r), 'duplicate creates no status event';
  update public.registrations set status='confirmed' where id=r;
  select * into receipt from public.checkin_registration_by_id(c,r,actor);
  assert receipt.result='duplicate' and receipt.registration_status='attended' and receipt.checked_in_at=first_time, 'legacy partial write repaired';
  assert (select status='attended' from public.registrations where id=r), 'legacy repair persisted';
  assert (select checked_in_by=actor and checked_in_at=first_time from public.checkins where registration_id=r), 'legacy evidence unchanged';
  foreach state in array array['cancelled','waitlisted','pending'] loop
    update public.registrations set status=state where id=r;
    rejected := false;
    begin
      perform * from public.checkin_registration_by_id(c,r,actor);
    exception when raise_exception then
      if sqlerrm <> '此報名目前不可報到' then raise; end if;
      rejected := true;
    end;
    assert rejected, 'invalid state must reject even with historical check-in';
    assert (select status=state from public.registrations where id=r), 'invalid state must not be resurrected';
  end loop;
  update public.registrations set status='no_show' where id=r;
  select * into receipt from public.checkin_registration_by_id(c,r,actor);
  assert receipt.registration_status='attended', 'operator may repair no-show';
  assert not has_function_privilege('anon','public.checkin_registration_by_id(uuid,uuid,uuid)','execute'), 'anon forbidden';
  assert not has_function_privilege('authenticated','public.checkin_registration_by_id(uuid,uuid,uuid)','execute'), 'authenticated must use authorized API';
  assert has_function_privilege('service_role','public.checkin_registration_by_id(uuid,uuid,uuid)','execute'), 'server may invoke';
  raise notice 'PASS: rollback, retry, idempotency, audit, legacy repair, tenant/state/role boundaries';
end; $$;
rollback;
