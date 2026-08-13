-- Product restructure M2: appointment waitlist for both booking modes.
-- Event registration waitlist_entries remains a separate domain.
begin;

create table if not exists public.appointment_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  service_id uuid references public.services(id) on delete restrict,
  doctor_id uuid references public.doctors(id) on delete restrict,
  booking_mode text not null check (booking_mode in ('time', 'number')),
  template_id uuid,
  requested_date date not null,
  requested_start_at timestamptz,
  visit_type text not null default 'return' check (visit_type in ('first', 'return')),
  is_self_pay boolean not null default false,
  booking_answers jsonb not null default '{}'::jsonb,
  target_key text not null,
  position integer not null check (position > 0),
  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  appointment_id uuid references public.appointments(id) on delete restrict,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  source text not null default 'online' check (source in ('online', 'admin', 'line')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(booking_answers) = 'object'),
  check (
    (booking_mode = 'time' and requested_start_at is not null and template_id is null)
    or (booking_mode = 'number' and requested_start_at is null and template_id is not null)
  ),
  check ((status = 'offered' and appointment_id is not null and offer_expires_at is not null) or status <> 'offered'),
  check ((status = 'booked' and appointment_id is not null) or status <> 'booked')
);

create unique index if not exists appointment_waitlist_active_patient_target_idx
  on public.appointment_waitlist_entries (clinic_id, patient_id, target_key)
  where status in ('waiting', 'offered');
create index if not exists appointment_waitlist_target_position_idx
  on public.appointment_waitlist_entries (clinic_id, target_key, status, position);
create index if not exists appointment_waitlist_offer_expiry_idx
  on public.appointment_waitlist_entries (offer_expires_at)
  where status = 'offered';

alter table public.appointments add column if not exists waitlist_entry_id uuid;
do $$ begin
  alter table public.appointments add constraint appointments_waitlist_entry_fkey
    foreign key (waitlist_entry_id) references public.appointment_waitlist_entries(id) on delete restrict;
exception when duplicate_object then null; end $$;
create unique index if not exists appointments_waitlist_entry_unique_idx
  on public.appointments (waitlist_entry_id) where waitlist_entry_id is not null;

create table if not exists public.appointment_waitlist_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  waitlist_id uuid references public.appointment_waitlist_entries(id) on delete restrict,
  target_key text not null,
  kind text not null check (kind in ('joined', 'status_changed', 'promotion_failed')),
  from_status text,
  to_status text,
  actor_id uuid references auth.users(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete restrict,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index if not exists appointment_waitlist_events_history_idx
  on public.appointment_waitlist_events (clinic_id, target_key, created_at desc);

create table if not exists public.appointment_waitlist_notification_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  waitlist_id uuid not null references public.appointment_waitlist_entries(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('joined', 'offered', 'booked', 'cancelled', 'expired')),
  channel text not null check (channel in ('line', 'email')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (waitlist_id, kind, channel)
);
create index if not exists appointment_waitlist_notifications_pending_idx
  on public.appointment_waitlist_notification_logs (status, created_at)
  where status in ('pending', 'failed');

drop trigger if exists trg_appointment_waitlist_touch on public.appointment_waitlist_entries;
create trigger trg_appointment_waitlist_touch before update on public.appointment_waitlist_entries
for each row execute function public.touch_updated_at();
drop trigger if exists trg_appointment_waitlist_notifications_touch on public.appointment_waitlist_notification_logs;
create trigger trg_appointment_waitlist_notifications_touch before update on public.appointment_waitlist_notification_logs
for each row execute function public.touch_updated_at();

create or replace function public.appointment_waitlist_target_key(
  p_booking_mode text,
  p_doctor_id uuid,
  p_service_id uuid,
  p_template_id uuid,
  p_requested_date date,
  p_requested_start_at timestamptz
) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_booking_mode = 'time' then concat_ws(':', 'time', extract(epoch from p_requested_start_at)::text, coalesce(p_doctor_id::text, '-'), coalesce(p_service_id::text, '-'))
    when p_booking_mode = 'number' then concat_ws(':', 'number', p_requested_date::text, p_template_id::text, coalesce(p_doctor_id::text, '-'), coalesce(p_service_id::text, '-'))
    else null
  end;
$$;

create or replace function public.record_appointment_waitlist_change()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_kind text;
  v_notification_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'joined';
    v_notification_kind := 'joined';
  elsif new.status is distinct from old.status then
    v_kind := 'status_changed';
    v_notification_kind := new.status;
  else
    return new;
  end if;
  insert into public.appointment_waitlist_events (
    clinic_id, waitlist_id, target_key, kind, from_status, to_status, actor_id, appointment_id
  ) values (
    new.clinic_id, new.id, new.target_key, v_kind,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, auth.uid(), new.appointment_id
  );
  if v_notification_kind in ('joined', 'offered', 'booked', 'cancelled', 'expired') then
    insert into public.appointment_waitlist_notification_logs (clinic_id, waitlist_id, patient_id, kind, channel)
    select new.clinic_id, new.id, new.patient_id, v_notification_kind, channel
      from unnest(array['line'::text, 'email'::text]) channel
    on conflict (waitlist_id, kind, channel) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_appointment_waitlist_change on public.appointment_waitlist_entries;
create trigger trg_appointment_waitlist_change
after insert or update of status on public.appointment_waitlist_entries
for each row execute function public.record_appointment_waitlist_change();

create or replace function public.join_appointment_waitlist(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_booking_mode text,
  p_doctor_id uuid default null,
  p_service_id uuid default null,
  p_template_id uuid default null,
  p_requested_date date default null,
  p_requested_start_at timestamptz default null,
  p_visit_type text default 'return',
  p_is_self_pay boolean default false,
  p_booking_answers jsonb default '{}'::jsonb,
  p_source text default 'online'
) returns table (waitlist_id uuid, waitlist_position integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  settings record;
  service record;
  v_date date;
  v_target_start timestamptz;
  v_target_key text;
  v_position integer;
  v_existing record;
  v_available boolean := false;
  v_id uuid;
begin
  if p_booking_mode not in ('time', 'number') then raise exception 'invalid booking mode'; end if;
  if p_visit_type not in ('first', 'return') then raise exception 'invalid visit type'; end if;
  if p_source not in ('online', 'admin', 'line') then raise exception 'invalid waitlist source'; end if;
  if jsonb_typeof(coalesce(p_booking_answers, '{}'::jsonb)) <> 'object' then raise exception 'booking answers must be an object'; end if;
  select * into settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found or settings.booking_mode <> p_booking_mode then raise exception 'booking mode does not match brand settings'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and clinic_id = p_clinic_id and active)
    then raise exception 'customer is unavailable'; end if;
  if p_doctor_id is null and p_service_id is null then raise exception 'service or provider is required'; end if;
  if p_doctor_id is not null and not exists (select 1 from public.doctors where id = p_doctor_id and clinic_id = p_clinic_id and active)
    then raise exception 'provider is unavailable'; end if;
  if p_service_id is not null then
    select id, booking_target into service from public.services where id = p_service_id and clinic_id = p_clinic_id and active;
    if not found then raise exception 'service is unavailable'; end if;
    if service.booking_target = 'provider_required' and p_doctor_id is null then raise exception 'provider is required'; end if;
  end if;

  if p_booking_mode = 'time' then
    if p_requested_start_at is null or p_template_id is not null then raise exception 'time waitlist target is invalid'; end if;
    v_date := (p_requested_start_at at time zone 'Asia/Taipei')::date;
    if p_requested_date is not null and p_requested_date <> v_date then raise exception 'waitlist date does not match start time'; end if;
    v_target_start := p_requested_start_at;
    if p_doctor_id is not null then
      if not exists (
        select 1 from public.schedule_templates template
         where template.clinic_id = p_clinic_id and template.doctor_id = p_doctor_id and template.active
           and template.weekday = extract(dow from v_date)
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= template.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < template.end_time
        union all
        select 1 from public.schedule_exceptions exception
         where exception.clinic_id = p_clinic_id and exception.doctor_id = p_doctor_id and exception.date = v_date
           and not exception.is_closed
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= exception.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < exception.end_time
      ) then raise exception 'waitlist target is not a service slot'; end if;
      if p_service_id is null then
        select exists(select 1 from public.get_available_slots(p_clinic_id, p_doctor_id, v_date, p_visit_type) slot where slot.slot_start = p_requested_start_at) into v_available;
      else
        select exists(select 1 from public.get_available_slots_for_service(p_clinic_id, p_doctor_id, v_date, p_visit_type, p_service_id) slot where slot.slot_start = p_requested_start_at) into v_available;
      end if;
    else
      if not exists (
        select 1 from public.schedule_templates template
         where template.clinic_id = p_clinic_id and template.doctor_id is null and template.service_id = p_service_id and template.active
           and template.weekday = extract(dow from v_date)
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= template.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < template.end_time
        union all
        select 1 from public.schedule_exceptions exception
         where exception.clinic_id = p_clinic_id and exception.doctor_id is null and exception.service_id = p_service_id and exception.date = v_date
           and not exception.is_closed
           and (p_requested_start_at at time zone 'Asia/Taipei')::time >= exception.start_time
           and (p_requested_start_at at time zone 'Asia/Taipei')::time < exception.end_time
      ) then raise exception 'waitlist target is not a service slot'; end if;
      select exists(select 1 from public.get_available_service_slots(p_clinic_id, p_service_id, v_date, p_visit_type, null) slot where slot.slot_start = p_requested_start_at) into v_available;
    end if;
  else
    if p_requested_date is null or p_template_id is null or p_requested_start_at is not null then raise exception 'number waitlist target is invalid'; end if;
    v_date := p_requested_date;
    if p_doctor_id is not null then
      select target.start_at into v_target_start from (
        select ((v_date + template.start_time) at time zone 'Asia/Taipei') as start_at
          from public.schedule_templates template
         where template.id = p_template_id and template.clinic_id = p_clinic_id and template.doctor_id = p_doctor_id
           and template.active and template.weekday = extract(dow from v_date)
        union all
        select ((v_date + exception.start_time) at time zone 'Asia/Taipei')
          from public.schedule_exceptions exception
         where exception.id = p_template_id and exception.clinic_id = p_clinic_id and exception.doctor_id = p_doctor_id
           and exception.date = v_date and not exception.is_closed
      ) target limit 1;
      if v_target_start is null then raise exception 'waitlist session is invalid'; end if;
      if p_service_id is null then
        select exists(select 1 from public.get_available_sessions(p_clinic_id, p_doctor_id, v_date) session where session.template_id = p_template_id) into v_available;
      else
        select exists(select 1 from public.get_available_sessions_for_service(p_clinic_id, p_doctor_id, v_date, p_service_id) session where session.template_id = p_template_id) into v_available;
      end if;
    else
      select target.start_at into v_target_start from (
        select ((v_date + template.start_time) at time zone 'Asia/Taipei') as start_at
          from public.schedule_templates template
         where template.id = p_template_id and template.clinic_id = p_clinic_id and template.doctor_id is null
           and template.service_id = p_service_id and template.active and template.weekday = extract(dow from v_date)
        union all
        select ((v_date + exception.start_time) at time zone 'Asia/Taipei')
          from public.schedule_exceptions exception
         where exception.id = p_template_id and exception.clinic_id = p_clinic_id and exception.doctor_id is null
           and exception.service_id = p_service_id and exception.date = v_date and not exception.is_closed
      ) target limit 1;
      if v_target_start is null then raise exception 'waitlist session is invalid'; end if;
      select exists(select 1 from public.get_available_service_sessions(p_clinic_id, p_service_id, v_date) session where session.template_id = p_template_id) into v_available;
    end if;
  end if;

  if v_target_start < now() + (coalesce(settings.min_lead_minutes, 30) || ' minutes')::interval then raise exception 'waitlist target is too late'; end if;
  if v_date > ((now() at time zone 'Asia/Taipei')::date + coalesce(settings.max_advance_days, 30)) then raise exception 'waitlist target is too far away'; end if;
  if v_available then raise exception 'slot is still available'; end if;

  v_target_key := public.appointment_waitlist_target_key(p_booking_mode, p_doctor_id, p_service_id, p_template_id, v_date, p_requested_start_at);
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || v_target_key));
  select id, position into v_existing from public.appointment_waitlist_entries
   where clinic_id = p_clinic_id and patient_id = p_patient_id and target_key = v_target_key and status in ('waiting', 'offered')
   for update;
  if found then return query select v_existing.id, v_existing.position; return; end if;
  select coalesce(max(position), 0) + 1 into v_position from public.appointment_waitlist_entries
   where clinic_id = p_clinic_id and target_key = v_target_key;
  insert into public.appointment_waitlist_entries (
    clinic_id, patient_id, service_id, doctor_id, booking_mode, template_id,
    requested_date, requested_start_at, visit_type, is_self_pay, booking_answers,
    target_key, position, source
  ) values (
    p_clinic_id, p_patient_id, p_service_id, p_doctor_id, p_booking_mode, p_template_id,
    v_date, p_requested_start_at, p_visit_type, p_is_self_pay, coalesce(p_booking_answers, '{}'::jsonb),
    v_target_key, v_position, p_source
  ) returning id into v_id;
  return query select v_id, v_position;
end;
$$;

create or replace function public.offer_next_appointment_waitlist(
  p_clinic_id uuid,
  p_target_key text,
  p_offer_minutes integer default 15
) returns table (waitlist_id uuid, appointment_id uuid, patient_id uuid, offer_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  candidate record;
  booking record;
  v_appointment_id uuid;
  v_queue_number integer;
  v_offer_expires timestamptz;
  v_error text;
begin
  if p_offer_minutes not between 5 and 1440 then raise exception 'invalid waitlist offer duration'; end if;
  perform pg_advisory_xact_lock(hashtext('appointment-waitlist:' || p_clinic_id::text || ':' || p_target_key));
  for candidate in
    select * from public.appointment_waitlist_entries
     where clinic_id = p_clinic_id and target_key = p_target_key and status = 'waiting'
     order by position, created_at
     for update skip locked
  loop
    v_appointment_id := null;
    v_error := null;
    begin
      if candidate.booking_mode = 'time' then
        if candidate.doctor_id is null then
          v_appointment_id := public.book_service_slot(
            candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
          );
        elsif candidate.service_id is null then
          v_appointment_id := public.book_time_slot(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, null
          );
        else
          v_appointment_id := public.book_time_slot_for_service(
            candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.requested_start_at,
            candidate.visit_type, candidate.is_self_pay, candidate.service_id
          );
        end if;
      elsif candidate.doctor_id is null then
        select * into booking from public.book_service_session(
          candidate.clinic_id, candidate.service_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.booking_answers
        );
        v_appointment_id := booking.appointment_id;
        v_queue_number := booking.queue_number;
      elsif candidate.service_id is null then
        select * into booking from public.book_number(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, null
        );
        v_appointment_id := booking.appointment_id;
        v_queue_number := booking.queue_number;
      else
        select * into booking from public.book_number_for_service(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.service_id
        );
        v_appointment_id := booking.appointment_id;
        v_queue_number := booking.queue_number;
      end if;
    exception when others then
      v_error := sqlerrm;
    end;

    if v_appointment_id is null then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (candidate.clinic_id, candidate.id, candidate.target_key, 'promotion_failed', candidate.status, candidate.status, v_error);
      if v_error like '%額滿%' or v_error like '%capacity%' or v_error like '%resource is unavailable%' then
        return;
      end if;
      update public.appointment_waitlist_entries set status = 'expired' where id = candidate.id;
      continue;
    end if;

    v_offer_expires := now() + (p_offer_minutes || ' minutes')::interval;
    update public.appointments
       set waitlist_entry_id = candidate.id,
           booking_answers = candidate.booking_answers,
           note = concat_ws(E'\n', nullif(note, ''), 'waitlist offer')
     where id = v_appointment_id and clinic_id = candidate.clinic_id;
    update public.appointment_waitlist_entries
       set status = 'offered', appointment_id = v_appointment_id,
           offered_at = now(), offer_expires_at = v_offer_expires
     where id = candidate.id and clinic_id = candidate.clinic_id;
    return query select candidate.id, v_appointment_id, candidate.patient_id, v_offer_expires;
    return;
  end loop;
end;
$$;

create or replace function public.accept_appointment_waitlist_offer(
  p_clinic_id uuid,
  p_waitlist_id uuid,
  p_patient_id uuid
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record;
begin
  select * into entry from public.appointment_waitlist_entries
   where id = p_waitlist_id and clinic_id = p_clinic_id and patient_id = p_patient_id for update;
  if not found then raise exception 'waitlist entry not found'; end if;
  if entry.status = 'booked' then return entry.appointment_id; end if;
  if entry.status <> 'offered' then raise exception 'waitlist offer is unavailable'; end if;
  if entry.offer_expires_at <= now() then
    update public.appointment_waitlist_entries set status = 'expired' where id = entry.id;
    if exists (select 1 from public.appointments where id = entry.appointment_id and clinic_id = p_clinic_id and status in ('booked', 'confirmed')) then
      perform public.cancel_appointment(p_clinic_id, entry.appointment_id, 'waitlist offer expired');
    end if;
    return null;
  end if;
  if not exists (select 1 from public.appointments where id = entry.appointment_id and clinic_id = p_clinic_id and status in ('booked', 'confirmed'))
    then raise exception 'reserved appointment is unavailable'; end if;
  update public.appointment_waitlist_entries set status = 'booked' where id = entry.id;
  return entry.appointment_id;
end;
$$;

create or replace function public.cancel_appointment_waitlist(
  p_clinic_id uuid,
  p_waitlist_id uuid,
  p_patient_id uuid,
  p_note text default null
) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record;
begin
  select * into entry from public.appointment_waitlist_entries
   where id = p_waitlist_id and clinic_id = p_clinic_id and patient_id = p_patient_id for update;
  if not found then raise exception 'waitlist entry not found'; end if;
  if entry.status in ('cancelled', 'expired') then return true; end if;
  if entry.status = 'booked' then raise exception 'booked waitlist entry must use appointment cancellation'; end if;
  update public.appointment_waitlist_entries set status = 'cancelled' where id = entry.id;
  if entry.appointment_id is not null and exists (
    select 1 from public.appointments where id = entry.appointment_id and clinic_id = p_clinic_id and status in ('booked', 'confirmed')
  ) then
    perform public.cancel_appointment(p_clinic_id, entry.appointment_id, coalesce(p_note, 'waitlist cancelled'));
  end if;
  return true;
end;
$$;

create or replace function public.cancel_appointment_waitlist_by_operator(
  p_clinic_id uuid,
  p_waitlist_id uuid,
  p_actor_user_id uuid,
  p_note text default null
) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin', 'frontdesk', 'staff')
  ) then raise exception 'operator access required'; end if;
  select * into entry from public.appointment_waitlist_entries where id = p_waitlist_id and clinic_id = p_clinic_id;
  if not found then raise exception 'waitlist entry not found'; end if;
  return public.cancel_appointment_waitlist(p_clinic_id, p_waitlist_id, entry.patient_id, p_note);
end;
$$;

create or replace function public.expire_appointment_waitlist_offers()
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare entry record; v_count integer := 0;
begin
  for entry in
    select * from public.appointment_waitlist_entries
     where status = 'offered' and offer_expires_at <= now()
     order by offer_expires_at
     for update skip locked
  loop
    begin
      update public.appointment_waitlist_entries set status = 'expired' where id = entry.id;
      if exists (select 1 from public.appointments where id = entry.appointment_id and clinic_id = entry.clinic_id and status in ('booked', 'confirmed')) then
        perform public.cancel_appointment(entry.clinic_id, entry.appointment_id, 'waitlist offer expired');
      end if;
      v_count := v_count + 1;
    exception when others then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (entry.clinic_id, entry.id, entry.target_key, 'promotion_failed', entry.status, entry.status, sqlerrm);
    end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.promote_waitlist_after_appointment_cancel()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare v_mode text; v_target_key text;
begin
  if old.status in ('booked', 'confirmed', 'done') and new.status = 'cancelled' then
    v_mode := case when old.queue_number is null then 'time' else 'number' end;
    v_target_key := public.appointment_waitlist_target_key(
      v_mode, old.doctor_id, old.service_id,
      case when v_mode = 'number' then old.template_id else null end,
      (old.start_at at time zone 'Asia/Taipei')::date,
      case when v_mode = 'time' then old.start_at else null end
    );
    begin
      perform public.offer_next_appointment_waitlist(old.clinic_id, v_target_key, 15);
    exception when others then
      insert into public.appointment_waitlist_events (clinic_id, target_key, kind, from_status, to_status, appointment_id, error)
      values (old.clinic_id, v_target_key, 'promotion_failed', old.status, new.status, old.id, sqlerrm);
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_promote_waitlist_after_appointment_cancel on public.appointments;
create trigger trg_promote_waitlist_after_appointment_cancel
after update of status on public.appointments
for each row execute function public.promote_waitlist_after_appointment_cancel();

alter table public.appointment_waitlist_entries enable row level security;
alter table public.appointment_waitlist_events enable row level security;
alter table public.appointment_waitlist_notification_logs enable row level security;
revoke all on table public.appointment_waitlist_entries from public, anon, authenticated;
revoke all on table public.appointment_waitlist_events from public, anon, authenticated;
revoke all on table public.appointment_waitlist_notification_logs from public, anon, authenticated;
grant select on table public.appointment_waitlist_entries to authenticated;
grant select on table public.appointment_waitlist_events to authenticated;
grant select on table public.appointment_waitlist_notification_logs to authenticated;

drop policy if exists appointment_waitlist_read on public.appointment_waitlist_entries;
create policy appointment_waitlist_read on public.appointment_waitlist_entries for select to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_waitlist_entries.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin', 'frontdesk', 'staff')));
drop policy if exists appointment_waitlist_events_read on public.appointment_waitlist_events;
create policy appointment_waitlist_events_read on public.appointment_waitlist_events for select to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_waitlist_events.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin', 'frontdesk', 'staff')));
drop policy if exists appointment_waitlist_notifications_read on public.appointment_waitlist_notification_logs;
create policy appointment_waitlist_notifications_read on public.appointment_waitlist_notification_logs for select to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_waitlist_notification_logs.clinic_id and member.user_id = auth.uid() and member.role in ('owner', 'admin')));

revoke all on function public.appointment_waitlist_target_key(text, uuid, uuid, uuid, date, timestamptz) from public, anon, authenticated;
revoke all on function public.record_appointment_waitlist_change() from public, anon, authenticated;
revoke all on function public.join_appointment_waitlist(uuid, uuid, text, uuid, uuid, uuid, date, timestamptz, text, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function public.offer_next_appointment_waitlist(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.accept_appointment_waitlist_offer(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_appointment_waitlist(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_appointment_waitlist_by_operator(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.expire_appointment_waitlist_offers() from public, anon, authenticated;
revoke all on function public.promote_waitlist_after_appointment_cancel() from public, anon, authenticated;
grant execute on function public.join_appointment_waitlist(uuid, uuid, text, uuid, uuid, uuid, date, timestamptz, text, boolean, jsonb, text) to service_role;
grant execute on function public.offer_next_appointment_waitlist(uuid, text, integer) to service_role;
grant execute on function public.accept_appointment_waitlist_offer(uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_appointment_waitlist(uuid, uuid, uuid, text) to service_role;
grant execute on function public.cancel_appointment_waitlist_by_operator(uuid, uuid, uuid, text) to service_role;
grant execute on function public.expire_appointment_waitlist_offers() to service_role;

commit;

