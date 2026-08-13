-- Second-stage booking growth: consent snapshots, service add-ons and recurring bookings.
begin;

alter table public.clinic_settings add column if not exists recurring_booking_enabled boolean not null default false;
alter table public.clinic_settings add column if not exists max_recurring_occurrences integer not null default 8;
alter table public.clinic_settings drop constraint if exists clinic_settings_recurring_occurrences_check;
alter table public.clinic_settings add constraint clinic_settings_recurring_occurrences_check
  check (max_recurring_occurrences between 2 and 12);

create table if not exists public.service_addons (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 0 check (duration_minutes between 0 and 480),
  price integer not null default 0 check (price between 0 and 1000000),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(name) between 1 and 120),
  check (description is null or length(description) <= 500)
);
create index if not exists service_addons_service_idx on public.service_addons (clinic_id, service_id, active, sort_order, created_at);

create table if not exists public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  recurrence_rule text not null default 'weekly' check (recurrence_rule = 'weekly'),
  occurrence_count integer not null check (occurrence_count between 2 and 12),
  interval_weeks integer not null default 1 check (interval_weeks between 1 and 4),
  created_at timestamptz not null default now()
);
create index if not exists appointment_series_clinic_idx on public.appointment_series (clinic_id, created_at desc);

alter table public.appointments add column if not exists series_id uuid references public.appointment_series(id) on delete set null;
alter table public.appointments add column if not exists series_sequence integer;
alter table public.appointments add column if not exists booking_form_snapshot jsonb not null default '[]'::jsonb;
alter table public.appointments add column if not exists addons_snapshot jsonb not null default '[]'::jsonb;
alter table public.appointments add column if not exists addons_amount integer not null default 0;
alter table public.appointments drop constraint if exists appointments_booking_form_snapshot_check;
alter table public.appointments add constraint appointments_booking_form_snapshot_check check (jsonb_typeof(booking_form_snapshot) = 'array');
alter table public.appointments drop constraint if exists appointments_addons_snapshot_check;
alter table public.appointments add constraint appointments_addons_snapshot_check check (jsonb_typeof(addons_snapshot) = 'array');
alter table public.appointments drop constraint if exists appointments_addons_amount_check;
alter table public.appointments add constraint appointments_addons_amount_check check (addons_amount >= 0);
alter table public.appointments drop constraint if exists appointments_series_sequence_check;
alter table public.appointments add constraint appointments_series_sequence_check check ((series_id is null and series_sequence is null) or (series_id is not null and series_sequence > 0));
create index if not exists appointments_series_idx on public.appointments (clinic_id, series_id, series_sequence) where series_id is not null;

alter table public.service_addons enable row level security;
alter table public.appointment_series enable row level security;
revoke all on table public.service_addons from public, anon;
revoke all on table public.appointment_series from public, anon;

drop policy if exists service_addons_brand_manage on public.service_addons;
create policy service_addons_brand_manage on public.service_addons for all to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = service_addons.clinic_id and member.user_id = auth.uid() and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))))
with check (
  exists (select 1 from public.clinic_members member where member.clinic_id = service_addons.clinic_id and member.user_id = auth.uid() and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions)))
  and exists (select 1 from public.services service where service.id = service_addons.service_id and service.clinic_id = service_addons.clinic_id)
);
drop policy if exists appointment_series_member_read on public.appointment_series;
create policy appointment_series_member_read on public.appointment_series for select to authenticated
using (exists (select 1 from public.clinic_members member where member.clinic_id = appointment_series.clinic_id and member.user_id = auth.uid()));

drop trigger if exists trg_service_addons_touch on public.service_addons;
create trigger trg_service_addons_touch before update on public.service_addons
for each row execute function public.touch_updated_at();

create or replace function public.apply_appointment_addons(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_service_id uuid,
  p_addon_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ids uuid[] := array(select distinct id from unnest(coalesce(p_addon_ids, '{}'::uuid[])) as id order by id);
  v_count integer;
  v_minutes integer;
  v_amount integer;
  v_snapshot jsonb;
  v_appt record;
  v_settings record;
  v_segment record;
  v_date date;
  v_time time;
  v_new_end timestamptz;
  v_used integer;
begin
  select count(*), coalesce(sum(duration_minutes), 0), coalesce(sum(price), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration_minutes', duration_minutes, 'price', price) order by sort_order, created_at), '[]'::jsonb)
    into v_count, v_minutes, v_amount, v_snapshot
    from public.service_addons
   where clinic_id = p_clinic_id and service_id = p_service_id and active and id = any(v_ids);
  if v_count <> cardinality(v_ids) then raise exception 'one or more add-ons are invalid'; end if;
  select * into v_appt from public.appointments where id = p_appointment_id and clinic_id = p_clinic_id and service_id = p_service_id for update;
  if not found then raise exception 'appointment not found'; end if;
  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  if v_settings.booking_mode = 'time' and v_minutes > 0 then
    v_date := (v_appt.start_at at time zone 'Asia/Taipei')::date;
    v_time := (v_appt.start_at at time zone 'Asia/Taipei')::time;
    select segment.end_time, segment.capacity into v_segment
      from (
        select template.end_time, template.capacity
          from public.schedule_templates template
         where template.clinic_id = p_clinic_id and template.active
           and template.weekday = extract(dow from v_date)
           and v_time >= template.start_time and v_time < template.end_time
           and ((v_appt.doctor_id is not null and template.doctor_id = v_appt.doctor_id and (template.service_id is null or template.service_id = p_service_id))
             or (v_appt.doctor_id is null and template.doctor_id is null and template.service_id = p_service_id))
           and not exists (select 1 from public.schedule_exceptions closed where closed.clinic_id = p_clinic_id and closed.date = v_date and closed.is_closed and closed.start_time is null and ((v_appt.doctor_id is not null and closed.doctor_id = v_appt.doctor_id and (closed.service_id is null or closed.service_id = p_service_id)) or (v_appt.doctor_id is null and closed.doctor_id is null and closed.service_id = p_service_id)))
        union all
        select exception.end_time, coalesce(exception.capacity, 1)
          from public.schedule_exceptions exception
         where exception.clinic_id = p_clinic_id and exception.date = v_date and not exception.is_closed
           and v_time >= exception.start_time and v_time < exception.end_time
           and ((v_appt.doctor_id is not null and exception.doctor_id = v_appt.doctor_id and (exception.service_id is null or exception.service_id = p_service_id))
             or (v_appt.doctor_id is null and exception.doctor_id is null and exception.service_id = p_service_id))
      ) segment
      limit 1;
    if not found then raise exception 'appointment schedule segment not found'; end if;
    v_new_end := v_appt.end_at + (v_minutes || ' minutes')::interval;
    if v_new_end > ((v_date + v_segment.end_time) at time zone 'Asia/Taipei') then raise exception 'add-on duration exceeds schedule'; end if;
    perform pg_advisory_xact_lock(hashtextextended('appointment-options:' || p_clinic_id::text || ':' || coalesce(v_appt.doctor_id::text, p_service_id::text) || ':' || v_date::text, 0));
    select count(*) into v_used from public.appointments appointment
     where appointment.id <> p_appointment_id and appointment.clinic_id = p_clinic_id
       and appointment.status in ('booked', 'confirmed', 'done')
       and appointment.start_at < v_new_end and appointment.end_at > v_appt.start_at
       and ((v_appt.doctor_id is not null and appointment.doctor_id = v_appt.doctor_id)
         or (v_appt.doctor_id is null and appointment.doctor_id is null and appointment.service_id = p_service_id));
    if v_used >= v_segment.capacity then raise exception 'add-on duration slot is full'; end if;
    if not public.service_resources_available(p_clinic_id, p_service_id, v_appt.start_at, v_new_end, p_appointment_id) then raise exception 'service resource is unavailable'; end if;
    update public.appointments set end_at = v_new_end, addons_snapshot = v_snapshot, addons_amount = v_amount where id = p_appointment_id;
  else
    update public.appointments set addons_snapshot = v_snapshot, addons_amount = v_amount where id = p_appointment_id;
  end if;
end;
$$;

create or replace function public.book_time_slot_with_options(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid, p_start_at timestamptz,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb, p_booking_form_snapshot jsonb default '[]'::jsonb,
  p_addon_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if jsonb_typeof(coalesce(p_booking_answers, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_booking_form_snapshot, '[]'::jsonb)) <> 'array' then raise exception 'invalid booking form data'; end if;
  if p_doctor_id is null then
    if nullif(btrim(p_membership_code), '') is null then
      v_id := public.book_service_slot(p_clinic_id, p_service_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_booking_answers);
    else
      v_id := public.book_service_slot_with_membership(p_clinic_id, p_service_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers);
    end if;
  else
    if nullif(btrim(p_membership_code), '') is null then
      v_id := public.book_time_slot_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_service_id);
    else
      v_id := public.book_time_slot_with_membership_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_start_at, p_visit_type, p_is_self_pay, p_membership_code, p_service_id);
    end if;
    update public.appointments set booking_answers = coalesce(p_booking_answers, '{}'::jsonb) where id = v_id and clinic_id = p_clinic_id;
  end if;
  perform public.apply_appointment_addons(p_clinic_id, v_id, p_service_id, p_addon_ids);
  update public.appointments set booking_form_snapshot = coalesce(p_booking_form_snapshot, '[]'::jsonb) where id = v_id and clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.book_number_with_options(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid, p_template_id uuid, p_date date,
  p_visit_type text default 'return', p_is_self_pay boolean default false, p_membership_code text default null,
  p_booking_answers jsonb default '{}'::jsonb, p_booking_form_snapshot jsonb default '[]'::jsonb,
  p_addon_ids uuid[] default '{}'::uuid[]
)
returns table (appointment_id uuid, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_row record;
begin
  if jsonb_typeof(coalesce(p_booking_answers, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_booking_form_snapshot, '[]'::jsonb)) <> 'array' then raise exception 'invalid booking form data'; end if;
  if p_doctor_id is null then
    if nullif(btrim(p_membership_code), '') is null then
      select row.appointment_id, row.queue_number into v_row from public.book_service_session(p_clinic_id, p_service_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_booking_answers) row;
    else
      select row.appointment_id, row.queue_number into v_row from public.book_service_session_with_membership(p_clinic_id, p_service_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers) row;
    end if;
  else
    if nullif(btrim(p_membership_code), '') is null then
      select row.appointment_id, row.queue_number into v_row from public.book_number_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_service_id) row;
    else
      select row.appointment_id, row.queue_number into v_row from public.book_number_with_membership_for_service(p_clinic_id, p_doctor_id, p_patient_id, p_template_id, p_date, p_visit_type, p_is_self_pay, p_membership_code, p_service_id) row;
    end if;
    update public.appointments set booking_answers = coalesce(p_booking_answers, '{}'::jsonb) where id = v_row.appointment_id and clinic_id = p_clinic_id;
  end if;
  perform public.apply_appointment_addons(p_clinic_id, v_row.appointment_id, p_service_id, p_addon_ids);
  update public.appointments set booking_form_snapshot = coalesce(p_booking_form_snapshot, '[]'::jsonb) where id = v_row.appointment_id and clinic_id = p_clinic_id;
  return query select v_row.appointment_id::uuid, v_row.queue_number::integer;
end;
$$;

create or replace function public.book_recurring_appointments(
  p_clinic_id uuid, p_service_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_start_at timestamptz, p_template_id uuid, p_date date,
  p_visit_type text, p_is_self_pay boolean, p_membership_code text,
  p_booking_answers jsonb, p_booking_form_snapshot jsonb, p_addon_ids uuid[],
  p_occurrence_count integer, p_interval_weeks integer default 1
)
returns table (appointment_id uuid, occurrence_number integer, queue_number integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings record;
  v_series_id uuid;
  v_index integer;
  v_id uuid;
  v_queue integer;
  v_row record;
begin
  select * into v_settings from public.clinic_settings where clinic_id = p_clinic_id;
  if not found or not coalesce(v_settings.recurring_booking_enabled, false) then raise exception 'recurring booking is disabled'; end if;
  if coalesce(v_settings.deposit_enabled, false) then raise exception 'recurring booking is unavailable while deposit is enabled'; end if;
  if p_occurrence_count < 2 or p_occurrence_count > least(12, coalesce(v_settings.max_recurring_occurrences, 8)) then raise exception 'invalid recurring occurrence count'; end if;
  if p_interval_weeks < 1 or p_interval_weeks > 4 then raise exception 'invalid recurring interval'; end if;
  insert into public.appointment_series (clinic_id, patient_id, service_id, occurrence_count, interval_weeks)
  values (p_clinic_id, p_patient_id, p_service_id, p_occurrence_count, p_interval_weeks)
  returning id into v_series_id;
  for v_index in 1..p_occurrence_count loop
    v_queue := null;
    if v_settings.booking_mode = 'time' then
      if p_start_at is null then raise exception 'recurring time booking requires start time'; end if;
      v_id := public.book_time_slot_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_start_at + ((v_index - 1) * p_interval_weeks || ' weeks')::interval, p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids);
    else
      if p_template_id is null or p_date is null then raise exception 'recurring session booking requires template and date'; end if;
      select row.appointment_id, row.queue_number into v_row from public.book_number_with_options(p_clinic_id, p_service_id, p_doctor_id, p_patient_id, p_template_id, p_date + ((v_index - 1) * p_interval_weeks * 7), p_visit_type, p_is_self_pay, p_membership_code, p_booking_answers, p_booking_form_snapshot, p_addon_ids) row;
      v_id := v_row.appointment_id; v_queue := v_row.queue_number;
    end if;
    update public.appointments set series_id = v_series_id, series_sequence = v_index where id = v_id and clinic_id = p_clinic_id;
    appointment_id := v_id; occurrence_number := v_index; queue_number := v_queue;
    return next;
  end loop;
end;
$$;

revoke all on function public.apply_appointment_addons(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.book_time_slot_with_options(uuid, uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.book_number_with_options(uuid, uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.apply_appointment_addons(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function public.book_time_slot_with_options(uuid, uuid, uuid, uuid, timestamptz, text, boolean, text, jsonb, jsonb, uuid[]) to service_role;
grant execute on function public.book_number_with_options(uuid, uuid, uuid, uuid, uuid, date, text, boolean, text, jsonb, jsonb, uuid[]) to service_role;
grant execute on function public.book_recurring_appointments(uuid, uuid, uuid, uuid, timestamptz, uuid, date, text, boolean, text, jsonb, jsonb, uuid[], integer, integer) to service_role;

commit;
