begin;
create or replace function consume_membership_credit(
  p_clinic_id uuid, p_membership_id uuid, p_usage_scope text, p_reference_type text, p_reference_id uuid,
  p_service_id uuid default null, p_actor_user_id uuid default null, p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare m record; v_key text := coalesce(p_reference_type,'manual') || ':' || coalesce(p_reference_id::text,'none'); v_remaining integer;
begin
  if p_usage_scope not in ('appointment','registration') then raise exception 'invalid membership usage scope'; end if;
  select pm.*,mp.usage_scope,mp.service_id as plan_service_id into m
    from patient_memberships pm join membership_plans mp on mp.id=pm.plan_id and mp.clinic_id=pm.clinic_id
   where pm.id=p_membership_id and pm.clinic_id=p_clinic_id for update of pm;
  if not found then raise exception 'membership not found'; end if;
  if m.usage_scope not in (p_usage_scope,'both') then raise exception 'membership scope does not match'; end if;
  if m.plan_service_id is not null and m.plan_service_id is distinct from p_service_id then raise exception 'membership is not valid for this service'; end if;
  if p_reference_id is not null and exists (select 1 from membership_ledger where membership_id=p_membership_id and kind='consume' and idempotency_key=v_key) then return m.credits_remaining; end if;
  if m.status <> 'active' or m.credits_remaining <= 0 then raise exception 'membership has no available credit'; end if;
  if m.expires_at is not null and m.expires_at <= now() then update patient_memberships set status='expired',updated_at=now() where id=p_membership_id; raise exception 'membership expired'; end if;
  v_remaining := m.credits_remaining - 1;
  update patient_memberships set credits_remaining=v_remaining,status=case when v_remaining=0 then 'exhausted' else 'active' end,updated_at=now() where id=p_membership_id;
  insert into membership_ledger (clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,reference_id,idempotency_key,actor_id,note)
    values (p_clinic_id,p_membership_id,m.patient_id,'consume',-1,p_reference_type,p_reference_id,v_key,p_actor_user_id,p_note);
  return v_remaining;
end; $$;
create or replace function restore_membership_credit(
  p_clinic_id uuid, p_membership_id uuid, p_reference_type text, p_reference_id uuid, p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare m record; v_key text := 'restore:' || coalesce(p_reference_type,'manual') || ':' || coalesce(p_reference_id::text,'none'); v_remaining integer;
begin
  select * into m from patient_memberships where id=p_membership_id and clinic_id=p_clinic_id for update;
  if not found then raise exception 'membership not found'; end if;
  if exists (select 1 from membership_ledger where clinic_id=p_clinic_id and membership_id=p_membership_id and kind='restore' and idempotency_key=v_key) then
    return m.credits_remaining;
  end if;
  if not exists (select 1 from membership_ledger where clinic_id=p_clinic_id and membership_id=p_membership_id and kind='consume'
    and reference_type is not distinct from p_reference_type and reference_id is not distinct from p_reference_id) then
    raise exception 'membership consumption not found';
  end if;
  v_remaining := least(m.credits_total,m.credits_remaining+1);
  update patient_memberships set credits_remaining=v_remaining,
    status=case when m.status='cancelled' then 'cancelled' when expires_at is not null and expires_at<=now() then 'expired' else 'active' end,
    updated_at=now() where id=p_membership_id;
  insert into membership_ledger (clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,reference_id,idempotency_key,note)
    values (p_clinic_id,p_membership_id,m.patient_id,'restore',1,p_reference_type,p_reference_id,v_key,p_note);
  return v_remaining;
end; $$;

commit;
