begin;
alter table public.payment_orders add column if not exists membership_redemption_snapshot jsonb;
alter table public.patient_memberships add column if not exists redemption_snapshot jsonb;

create or replace function public.capture_membership_purchase_terms()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare plan_row record;
begin
  if TG_OP = 'UPDATE' then
    if new.membership_credits_snapshot is distinct from old.membership_credits_snapshot
      or new.membership_valid_days_snapshot is distinct from old.membership_valid_days_snapshot
      or new.membership_redemption_snapshot is distinct from old.membership_redemption_snapshot then
      raise exception 'membership purchase snapshot is immutable';
    end if;
    if old.membership_credits_snapshot is not null and
      (new.clinic_id is distinct from old.clinic_id
       or new.membership_plan_id is distinct from old.membership_plan_id
       or new.patient_id is distinct from old.patient_id
       or new.amount is distinct from old.amount) then
      raise exception 'membership purchase subject and amount are immutable';
    end if;
    return new;
  end if;
  if new.membership_plan_id is null then
    new.membership_redemption_snapshot := null;
    new.membership_credits_snapshot := null;
    new.membership_valid_days_snapshot := null;
    return new;
  end if;
  select plan.credits_total, plan.valid_days, plan.usage_scope, plan.service_id, plan.redeem_channels into plan_row
    from public.membership_plans plan
   where plan.id = new.membership_plan_id and plan.clinic_id = new.clinic_id and plan.active
   for share;
  if not found then raise exception 'membership plan not found or inactive'; end if;
  new.membership_redemption_snapshot := jsonb_build_object('usage_scope',plan_row.usage_scope,'service_id',plan_row.service_id,'redeem_channels',plan_row.redeem_channels);
  new.membership_credits_snapshot := plan_row.credits_total;
  new.membership_valid_days_snapshot := plan_row.valid_days;
  return new;
end;
$$;

create or replace function public.capture_membership_redemption_terms()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare terms jsonb;
begin
 if TG_OP='UPDATE' then
   if new.redemption_snapshot is distinct from old.redemption_snapshot then raise exception 'membership redemption snapshot is immutable'; end if;
   if old.redemption_snapshot is not null and (new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id or new.plan_id is distinct from old.plan_id or new.payment_order_id is distinct from old.payment_order_id) then raise exception 'membership redemption subject is immutable'; end if;
   return new;
 end if;
 if new.payment_order_id is not null then
   select po.membership_redemption_snapshot into terms from public.payment_orders po
    where po.id=new.payment_order_id and po.clinic_id=new.clinic_id and po.patient_id=new.patient_id and po.membership_plan_id=new.plan_id and po.status='paid';
   if not found or terms is null then raise exception 'membership redemption purchase snapshot missing'; end if;
 else
   select jsonb_build_object('usage_scope',mp.usage_scope,'service_id',mp.service_id,'redeem_channels',mp.redeem_channels) into terms
     from public.membership_plans mp where mp.id=new.plan_id and mp.clinic_id=new.clinic_id and mp.active for share;
   if not found then raise exception 'membership plan not found'; end if;
 end if;
 new.redemption_snapshot:=terms;
 return new;
end; $$;
revoke all on function public.capture_membership_redemption_terms() from public,anon,authenticated;
drop trigger if exists patient_memberships_redemption_terms on public.patient_memberships;
create trigger patient_memberships_redemption_terms before insert or update on public.patient_memberships for each row execute function public.capture_membership_redemption_terms();

create or replace function consume_membership_credit(
  p_clinic_id uuid, p_membership_id uuid, p_usage_scope text, p_reference_type text, p_reference_id uuid,
  p_service_id uuid default null, p_actor_user_id uuid default null, p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare m record; v_key text := coalesce(p_reference_type,'manual') || ':' || coalesce(p_reference_id::text,'none'); v_remaining integer;
begin
  if p_usage_scope not in ('appointment','registration') then raise exception 'invalid membership usage scope'; end if;
  select pm.*,coalesce(pm.redemption_snapshot->>'usage_scope',mp.usage_scope) as usage_scope,case when pm.redemption_snapshot is null then mp.service_id else (pm.redemption_snapshot->>'service_id')::uuid end as plan_service_id,case when pm.redemption_snapshot is null then mp.redeem_channels else array(select jsonb_array_elements_text(pm.redemption_snapshot->'redeem_channels')) end as redeem_channels into m
    from patient_memberships pm join membership_plans mp on mp.id=pm.plan_id and mp.clinic_id=pm.clinic_id
   where pm.id=p_membership_id and pm.clinic_id=p_clinic_id for update of pm;
  if not found then raise exception 'membership not found'; end if;
  if not (p_usage_scope=any(m.redeem_channels)) then raise exception 'membership channel is not allowed'; end if;
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

create or replace function register_for_event_with_benefits(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null
) returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  e record; s record; ticket public.event_ticket_types%rowtype; m record; d record;
  v_taken integer; v_ticket_taken integer; v_status text; v_payment_status text;
  v_original integer := 0; v_amount integer := 0; v_discount integer := 0; v_discount_code_id uuid;
  v_no bigint; v_registration_no text; v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid; v_position integer; v_membership_id uuid; v_membership_applied boolean := false;
  v_code text := lower(nullif(trim(p_discount_code), '')); v_membership_code text := upper(nullif(trim(p_membership_code), ''));
begin
  if nullif(trim(p_name),'') is null or nullif(trim(p_phone),'') is null then raise exception 'name and phone are required'; end if;
  if v_code is not null and v_membership_code is not null then raise exception 'membership and discount cannot be combined'; end if;
  select * into e from events where id=p_event_id and clinic_id=p_clinic_id and status='published';
  if not found then raise exception 'event not found'; end if;
  if e.access_mode='private' and (nullif(trim(p_access_token),'') is null or encode(digest(trim(p_access_token),'sha256'),'hex') is distinct from e.access_token_hash) then raise exception 'private event token is invalid'; end if;
  if e.registration_open_at is not null and now()<e.registration_open_at then raise exception 'registration is not open'; end if;
  if e.registration_close_at is not null and now()>e.registration_close_at then raise exception 'registration is closed'; end if;
  select * into s from event_sessions where id=p_session_id and event_id=p_event_id and clinic_id=p_clinic_id and active;
  if not found then raise exception 'session not found'; end if;
  if s.end_at <= now() then raise exception '活動場次已結束'; end if;
  if p_form_id is not null and not exists (
    select 1 from registration_forms
     where id = p_form_id and event_id = p_event_id and clinic_id = p_clinic_id
       and status = 'published' and version = p_form_version
  ) then
    raise exception 'registration form is invalid';
  end if;
  if p_ticket_type_id is not null then
    select * into ticket from event_ticket_types where id=p_ticket_type_id and event_id=p_event_id and clinic_id=p_clinic_id and active;
    if not found then raise exception 'ticket type not found'; end if;
    v_original := ticket.price;
  end if;
  if v_code is not null and v_original = 0 then raise exception 'discount code requires a paid ticket'; end if;
  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text));
  select count(*)::int into v_taken from registrations r where r.clinic_id=p_clinic_id and r.session_id=p_session_id and r.status in ('pending','confirmed','attended') and (r.status<>'pending' or r.expires_at is null or r.expires_at>now());
  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from registrations r where r.clinic_id=p_clinic_id and r.ticket_type_id=p_ticket_type_id and r.status in ('pending','confirmed','attended') and (r.status<>'pending' or r.expires_at is null or r.expires_at>now());
  else v_ticket_taken := 0; end if;
  if v_taken>=s.capacity or (p_ticket_type_id is not null and ticket.capacity is not null and v_ticket_taken>=ticket.capacity) then
    if not s.waitlist_enabled then raise exception 'session is full'; end if;
    if v_code is not null or v_membership_code is not null then raise exception 'benefits cannot be used while waitlisted'; end if;
    v_status := 'waitlisted'; v_payment_status := 'not_required';
  else
    if v_membership_code is not null then
      select pm.*,coalesce(pm.redemption_snapshot->>'usage_scope',mp.usage_scope) as usage_scope,case when pm.redemption_snapshot is null then mp.service_id else (pm.redemption_snapshot->>'service_id')::uuid end as plan_service_id into m
        from patient_memberships pm join membership_plans mp on mp.id=pm.plan_id and mp.clinic_id=pm.clinic_id
        join patients p on p.id=pm.patient_id and p.clinic_id=pm.clinic_id
       where pm.clinic_id=p_clinic_id and pm.membership_code=v_membership_code and p.phone=trim(p_phone) and p.active for update of pm;
      if not found then raise exception 'membership code is invalid'; end if;
      if m.status<>'active' or m.credits_remaining<=0 then raise exception 'membership has no available credit'; end if;
      if m.expires_at is not null and m.expires_at<=now() then raise exception 'membership expired'; end if;
      if m.usage_scope not in ('registration','both') then raise exception 'membership cannot be used for registration'; end if;
      if p_ticket_type_id is not null and ticket.membership_plan_id is not null and ticket.membership_plan_id is distinct from m.plan_id then raise exception 'membership does not match ticket'; end if;
      v_membership_id := m.id;
      v_amount := 0; v_membership_applied := true;
    else
      v_amount := v_original;
      if v_code is not null and v_amount>0 then
        select * into d from discount_codes where clinic_id=p_clinic_id and lower(code)=v_code for update;
        if not found or not d.active then raise exception 'discount code is invalid'; end if;
        if d.starts_at is not null and now()<d.starts_at then raise exception 'discount code is not active'; end if;
        if d.ends_at is not null and now()>=d.ends_at then raise exception 'discount code is expired'; end if;
        if v_amount<d.min_amount then raise exception 'order does not meet discount minimum'; end if;
        if d.max_uses is not null and d.used_count>=d.max_uses then raise exception 'discount code usage limit reached'; end if;
        v_discount_code_id := d.id;
        v_discount := case when d.kind='percent' then floor(v_amount*d.value/100.0)::int else least(v_amount,d.value) end;
        v_amount := greatest(0,v_amount-v_discount);
      end if;
    end if;
    v_status := case when v_amount=0 then 'confirmed' else 'pending' end;
    v_payment_status := case when v_amount=0 then 'not_required' else 'pending' end;
  end if;
  select coalesce(max(nullif(substring(r.registration_no from '([0-9]+)$'),'')::bigint),0)+1 into v_no from registrations r where r.clinic_id=p_clinic_id and r.event_id=p_event_id;
  v_registration_no := 'REG-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(v_no::text,greatest(4,length(v_no::text)),'0');
  insert into registrations (clinic_id,event_id,session_id,ticket_type_id,registration_no,status,payment_status,amount,discount_code_id,discount_amount,membership_id,name,phone,email,line_user_id,marketing_opt_in,answers,checkin_token_hash,expires_at,form_id,form_version)
    values (p_clinic_id,p_event_id,p_session_id,p_ticket_type_id,v_registration_no,v_status,v_payment_status,v_amount,v_discount_code_id,v_discount,v_membership_id,trim(p_name),trim(p_phone),nullif(trim(p_email),''),nullif(trim(p_line_user_id),''),coalesce(p_marketing_opt_in,false),coalesce(p_answers,'{}'::jsonb),encode(digest(v_token,'sha256'),'hex'),case when v_status='pending' then now()+interval '15 minutes' else null end,p_form_id,p_form_version) returning id into v_id;
  insert into registration_answers (clinic_id,registration_id,answers) values (p_clinic_id,v_id,p_answers);
  if v_membership_applied then
    perform consume_membership_credit(p_clinic_id,m.id,'registration','registration',v_id,m.plan_service_id,null,'registration membership redemption');
  elsif v_code is not null then
    update discount_codes set used_count=used_count+1,updated_at=now() where id=d.id;
    insert into discount_redemptions (clinic_id,discount_code_id,patient_id,registration_id,original_amount,discount_amount,final_amount,status)
      values (p_clinic_id,d.id,(select id from patients where clinic_id=p_clinic_id and phone=trim(p_phone) and active order by created_at limit 1),v_id,v_original,v_discount,v_amount,case when v_status='confirmed' then 'applied' else 'reserved' end);
  end if;
  if v_status='waitlisted' then
    select coalesce(max(position),0)+1 into v_position from waitlist_entries where session_id=p_session_id and status in ('waiting','offered');
    insert into waitlist_entries (clinic_id,registration_id,session_id,position) values (p_clinic_id,v_id,p_session_id,v_position);
  end if;
  return query select v_id,v_registration_no,v_status,v_payment_status,v_amount,v_discount,v_membership_applied,v_token;
end; $$;

create or replace function public.redeem_patient_membership_credit(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_channel text,
  p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  membership_row record;
  next_credits integer;
begin
  if not exists (
    select 1 from public.clinic_members member
    where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role <> 'provider'
  ) then raise exception 'membership redemption actor is not allowed'; end if;
  if p_channel not in ('appointment','registration','product','course','offline') then raise exception 'invalid redemption channel'; end if;

  select membership.*, case when membership.redemption_snapshot is null then plan.redeem_channels else array(select jsonb_array_elements_text(membership.redemption_snapshot->'redeem_channels')) end as redeem_channels, coalesce(membership.redemption_snapshot->>'usage_scope',plan.usage_scope) as usage_scope, case when membership.redemption_snapshot is null then plan.service_id else (membership.redemption_snapshot->>'service_id')::uuid end as plan_service_id into membership_row
  from public.patient_memberships membership
  join public.membership_plans plan on plan.id = membership.plan_id and plan.clinic_id = membership.clinic_id
  where membership.id = p_membership_id and membership.clinic_id = p_clinic_id
  for update of membership;
  if not found then raise exception 'membership not found'; end if;
  if membership_row.status <> 'active' or membership_row.credits_remaining < 1 then raise exception 'membership is not available'; end if;
  if membership_row.expires_at is not null and membership_row.expires_at <= now() then raise exception 'membership has expired'; end if;
  if not (p_channel = any(membership_row.redeem_channels)) then raise exception 'membership channel is not allowed'; end if;

  if p_channel in ('appointment','registration') then
    if membership_row.usage_scope not in (p_channel,'both') then raise exception 'membership scope does not match'; end if;
    if membership_row.plan_service_id is not null then raise exception 'restricted membership requires a booking or registration'; end if;
  end if;
  next_credits := membership_row.credits_remaining - 1;
  update public.patient_memberships
    set credits_remaining = next_credits,
        status = case when next_credits = 0 then 'exhausted' else status end,
        updated_at = now()
  where id = p_membership_id and clinic_id = p_clinic_id;
  insert into public.membership_ledger(clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,idempotency_key,actor_id,note)
  values(p_clinic_id,p_membership_id,membership_row.patient_id,'consume',-1,p_channel,'manual:'||gen_random_uuid()::text,p_actor_user_id,nullif(btrim(p_note),''));
  return next_credits;
end;
$$;
commit;
