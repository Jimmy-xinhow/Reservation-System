-- Keep event registration numbers monotonic without mixing the YYYYMMDD prefix
-- into the numeric sequence. PostgreSQL lpad truncates values longer than the
-- requested width, so the previous all-digits expression repeated "2026" on
-- the third registration of an event.
begin;

create or replace function public.register_for_event(
  p_clinic_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_ticket_type_id uuid,
  p_name text,
  p_phone text,
  p_email text default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb,
  p_access_token text default null
) returns table (
  registration_id uuid,
  registration_no text,
  registration_status text,
  payment_status text,
  amount integer,
  checkin_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e record;
  s record;
  v_taken integer;
  v_ticket_taken integer;
  v_ticket_capacity integer;
  v_status text;
  v_payment_status text;
  v_amount integer := 0;
  v_no bigint;
  v_registration_no text;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid;
  v_position integer;
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception '請填寫姓名與電話';
  end if;

  select * into e from public.events
   where id = p_event_id and clinic_id = p_clinic_id and status = 'published';
  if not found then raise exception '找不到可報名的活動'; end if;
  if e.access_mode = 'private' and (
    nullif(trim(p_access_token), '') is null or
    encode(digest(trim(p_access_token), 'sha256'), 'hex') is distinct from e.access_token_hash
  ) then
    raise exception '此活動需要私密報名連結';
  end if;
  if e.registration_open_at is not null and now() < e.registration_open_at then
    raise exception '報名尚未開始';
  end if;
  if e.registration_close_at is not null and now() > e.registration_close_at then
    raise exception '報名已截止';
  end if;

  select * into s from public.event_sessions
   where id = p_session_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
  if not found then raise exception '找不到可報名的場次'; end if;

  if p_ticket_type_id is not null then
    select price, capacity into v_amount, v_ticket_capacity from public.event_ticket_types
     where id = p_ticket_type_id and event_id = p_event_id and clinic_id = p_clinic_id and active;
    if not found then raise exception '找不到可選的票種'; end if;
  else
    v_ticket_capacity := null;
  end if;

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text));

  select count(*)::int into v_taken from public.registrations r
   where r.clinic_id = p_clinic_id and r.session_id = p_session_id
     and r.status in ('pending','confirmed','attended')
     and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());

  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from public.registrations r
     where r.clinic_id = p_clinic_id and r.ticket_type_id = p_ticket_type_id
       and r.status in ('pending','confirmed','attended')
       and (r.status <> 'pending' or r.expires_at is null or r.expires_at > now());
  else
    v_ticket_taken := 0;
  end if;

  if v_taken >= s.capacity or (v_ticket_capacity is not null and v_ticket_taken >= v_ticket_capacity) then
    if not s.waitlist_enabled then raise exception '此場次已額滿'; end if;
    v_status := 'waitlisted';
    v_payment_status := 'not_required';
  elsif v_amount = 0 then
    v_status := 'confirmed';
    v_payment_status := 'not_required';
  else
    v_status := 'pending';
    v_payment_status := 'pending';
  end if;

  select coalesce(max(nullif(substring(r.registration_no from '([0-9]+)$'), '')::bigint), 0) + 1
    into v_no from public.registrations r
   where r.clinic_id = p_clinic_id and r.event_id = p_event_id;
  v_registration_no := 'REG-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    lpad(v_no::text, greatest(4, length(v_no::text)), '0');

  insert into public.registrations (
    clinic_id, event_id, session_id, ticket_type_id, registration_no, status,
    payment_status, amount, name, phone, email, line_user_id, marketing_opt_in,
    answers, checkin_token_hash, expires_at
  ) values (
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, v_registration_no, v_status,
    v_payment_status, v_amount, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    nullif(trim(p_line_user_id), ''), coalesce(p_marketing_opt_in, false), coalesce(p_answers, '{}'::jsonb),
    encode(digest(v_token, 'sha256'), 'hex'),
    case when v_status = 'pending' then now() + interval '15 minutes' else null end
  ) returning id into v_id;

  insert into public.registration_answers (clinic_id, registration_id, answers)
    values (p_clinic_id, v_id, p_answers);

  if v_status = 'waitlisted' then
    select coalesce(max(position), 0) + 1 into v_position
      from public.waitlist_entries where session_id = p_session_id and status in ('waiting','offered');
    insert into public.waitlist_entries (clinic_id, registration_id, session_id, position)
      values (p_clinic_id, v_id, p_session_id, v_position);
  end if;

  return query select v_id, v_registration_no, v_status, v_payment_status, v_amount, v_token;
end;
$$;

create or replace function public.register_for_event_with_benefits(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null
) returns table (
  registration_id uuid, registration_no text, registration_status text, payment_status text,
  amount integer, discount_amount integer, membership_applied boolean, checkin_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e record; s record; ticket record; m record; d record;
  v_taken integer; v_ticket_taken integer; v_status text; v_payment_status text;
  v_original integer := 0; v_amount integer := 0; v_discount integer := 0; v_discount_code_id uuid;
  v_no bigint; v_registration_no text; v_token text := encode(gen_random_bytes(24), 'hex');
  v_id uuid; v_position integer; v_membership_id uuid; v_membership_applied boolean := false;
  v_code text := lower(nullif(trim(p_discount_code), ''));
  v_membership_code text := upper(nullif(trim(p_membership_code), ''));
begin
  if nullif(trim(p_name),'') is null or nullif(trim(p_phone),'') is null then raise exception 'name and phone are required'; end if;
  if v_code is not null and v_membership_code is not null then raise exception 'membership and discount cannot be combined'; end if;
  select * into e from public.events where id=p_event_id and clinic_id=p_clinic_id and status='published';
  if not found then raise exception 'event not found'; end if;
  if e.access_mode='private' and (nullif(trim(p_access_token),'') is null or encode(digest(trim(p_access_token),'sha256'),'hex') is distinct from e.access_token_hash) then raise exception 'private event token is invalid'; end if;
  if e.registration_open_at is not null and now()<e.registration_open_at then raise exception 'registration is not open'; end if;
  if e.registration_close_at is not null and now()>e.registration_close_at then raise exception 'registration is closed'; end if;
  select * into s from public.event_sessions where id=p_session_id and event_id=p_event_id and clinic_id=p_clinic_id and active;
  if not found then raise exception 'session not found'; end if;
  if p_form_id is not null and not exists (
    select 1 from public.registration_forms
     where id = p_form_id and event_id = p_event_id and clinic_id = p_clinic_id
       and status = 'published' and version = p_form_version
  ) then
    raise exception 'registration form is invalid';
  end if;
  if p_ticket_type_id is not null then
    select price,capacity,membership_plan_id into ticket from public.event_ticket_types
     where id=p_ticket_type_id and event_id=p_event_id and clinic_id=p_clinic_id and active;
    if not found then raise exception 'ticket type not found'; end if;
    v_original := ticket.price;
  end if;
  if v_code is not null and v_original = 0 then raise exception 'discount code requires a paid ticket'; end if;

  perform pg_advisory_xact_lock(hashtext('registration-event:' || p_clinic_id::text || ':' || p_event_id::text));
  select count(*)::int into v_taken from public.registrations r
   where r.clinic_id=p_clinic_id and r.session_id=p_session_id and r.status in ('pending','confirmed','attended')
     and (r.status<>'pending' or r.expires_at is null or r.expires_at>now());
  if p_ticket_type_id is not null then
    select count(*)::int into v_ticket_taken from public.registrations r
     where r.clinic_id=p_clinic_id and r.ticket_type_id=p_ticket_type_id and r.status in ('pending','confirmed','attended')
       and (r.status<>'pending' or r.expires_at is null or r.expires_at>now());
  else
    v_ticket_taken := 0;
  end if;

  if v_taken>=s.capacity or (p_ticket_type_id is not null and ticket.capacity is not null and v_ticket_taken>=ticket.capacity) then
    if not s.waitlist_enabled then raise exception 'session is full'; end if;
    if v_code is not null or v_membership_code is not null then raise exception 'benefits cannot be used while waitlisted'; end if;
    v_status := 'waitlisted';
    v_payment_status := 'not_required';
  else
    if v_membership_code is not null then
      select pm.*,mp.usage_scope,mp.service_id as plan_service_id into m
        from public.patient_memberships pm
        join public.membership_plans mp on mp.id=pm.plan_id and mp.clinic_id=pm.clinic_id
        join public.patients p on p.id=pm.patient_id and p.clinic_id=pm.clinic_id
       where pm.clinic_id=p_clinic_id and pm.membership_code=v_membership_code
         and p.phone=trim(p_phone) and p.active
       for update of pm;
      if not found then raise exception 'membership code is invalid'; end if;
      if m.status<>'active' or m.credits_remaining<=0 then raise exception 'membership has no available credit'; end if;
      if m.expires_at is not null and m.expires_at<=now() then raise exception 'membership expired'; end if;
      if m.usage_scope not in ('registration','both') then raise exception 'membership cannot be used for registration'; end if;
      if p_ticket_type_id is not null and ticket.membership_plan_id is not null and ticket.membership_plan_id is distinct from m.plan_id then raise exception 'membership does not match ticket'; end if;
      v_membership_id := m.id;
      v_amount := 0;
      v_membership_applied := true;
    else
      v_amount := v_original;
      if v_code is not null and v_amount>0 then
        select * into d from public.discount_codes where clinic_id=p_clinic_id and lower(code)=v_code for update;
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

  select coalesce(max(nullif(substring(r.registration_no from '([0-9]+)$'),'')::bigint),0)+1 into v_no
    from public.registrations r where r.clinic_id=p_clinic_id and r.event_id=p_event_id;
  v_registration_no := 'REG-' || to_char(current_date,'YYYYMMDD') || '-' ||
    lpad(v_no::text,greatest(4,length(v_no::text)),'0');

  insert into public.registrations (
    clinic_id,event_id,session_id,ticket_type_id,registration_no,status,payment_status,amount,
    discount_code_id,discount_amount,membership_id,name,phone,email,line_user_id,marketing_opt_in,
    answers,checkin_token_hash,expires_at,form_id,form_version
  ) values (
    p_clinic_id,p_event_id,p_session_id,p_ticket_type_id,v_registration_no,v_status,v_payment_status,v_amount,
    v_discount_code_id,v_discount,v_membership_id,trim(p_name),trim(p_phone),nullif(trim(p_email),''),
    nullif(trim(p_line_user_id),''),coalesce(p_marketing_opt_in,false),coalesce(p_answers,'{}'::jsonb),
    encode(digest(v_token,'sha256'),'hex'),case when v_status='pending' then now()+interval '15 minutes' else null end,
    p_form_id,p_form_version
  ) returning id into v_id;
  insert into public.registration_answers (clinic_id,registration_id,answers)
    values (p_clinic_id,v_id,p_answers);
  if v_membership_applied then
    perform public.consume_membership_credit(p_clinic_id,m.id,'registration','registration',v_id,m.plan_service_id,null,'registration membership redemption');
  elsif v_code is not null then
    update public.discount_codes set used_count=used_count+1,updated_at=now() where id=d.id;
    insert into public.discount_redemptions (
      clinic_id,discount_code_id,patient_id,registration_id,original_amount,discount_amount,final_amount,status
    ) values (
      p_clinic_id,d.id,
      (select id from public.patients where clinic_id=p_clinic_id and phone=trim(p_phone) and active order by created_at limit 1),
      v_id,v_original,v_discount,v_amount,case when v_status='confirmed' then 'applied' else 'reserved' end
    );
  end if;
  if v_status='waitlisted' then
    select coalesce(max(position),0)+1 into v_position from public.waitlist_entries
     where session_id=p_session_id and status in ('waiting','offered');
    insert into public.waitlist_entries (clinic_id,registration_id,session_id,position)
      values (p_clinic_id,v_id,p_session_id,v_position);
  end if;
  return query select v_id,v_registration_no,v_status,v_payment_status,v_amount,v_discount,v_membership_applied,v_token;
end;
$$;

revoke all on function public.register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text) from public, anon, authenticated;
grant execute on function public.register_for_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text) to service_role;
revoke all on function public.register_for_event_with_benefits(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text,text,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.register_for_event_with_benefits(uuid,uuid,uuid,uuid,text,text,text,text,boolean,jsonb,text,text,text,uuid,integer) to service_role;

commit;
