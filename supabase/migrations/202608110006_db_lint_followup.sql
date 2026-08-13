-- Follow up the staging DB lint findings without rewriting an applied migration.
begin;

alter table public.clinics
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_clinics_touch on public.clinics;
create trigger trg_clinics_touch
before update on public.clinics
for each row execute function public.touch_updated_at();

create or replace function public.record_line_richmenu_publication(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_line_rich_menu_id text,
  p_kind text default 'published',
  p_image_sha256 text default null,
  p_image_width integer default null,
  p_image_height integer default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_kind not in ('published', 'rolled_back') then raise exception 'invalid publication kind'; end if;
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  if nullif(btrim(coalesce(p_line_rich_menu_id, '')), '') is null then raise exception 'LINE Rich Menu ID is required'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || p_clinic_id::text));
  if not exists (select 1 from public.line_richmenu_versions version where version.id = p_version_id and version.clinic_id = p_clinic_id) then
    raise exception 'Rich Menu version not found';
  end if;
  update public.line_richmenu_versions
     set status = 'archived', updated_at = now()
   where clinic_id = p_clinic_id and status = 'published' and id <> p_version_id;
  update public.line_richmenu_versions
     set status = 'published', line_rich_menu_id = btrim(p_line_rich_menu_id),
         image_sha256 = coalesce(p_image_sha256, image_sha256),
         image_width = coalesce(p_image_width, image_width),
         image_height = coalesce(p_image_height, image_height),
         validation_errors = '[]'::jsonb, published_at = now(), updated_at = now()
   where id = p_version_id and clinic_id = p_clinic_id;
  insert into public.line_richmenu (clinic_id, published_id, published_version_id, draft_version_id, updated_at)
  values (p_clinic_id, btrim(p_line_rich_menu_id), p_version_id, p_version_id, now())
  on conflict (clinic_id) do update set
    published_id = excluded.published_id,
    published_version_id = excluded.published_version_id,
    draft_version_id = excluded.draft_version_id,
    updated_at = now();
  insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, line_rich_menu_id)
  values (p_clinic_id, p_version_id, p_kind, p_actor_user_id, btrim(p_line_rich_menu_id));
end;
$$;

create or replace function public.finish_line_richmenu_schedule(
  p_schedule_id uuid,
  p_action text,
  p_success boolean,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  schedule_row public.line_richmenu_schedules%rowtype;
  current_version_id uuid;
  restore_line_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_action not in ('activate', 'expire') then raise exception 'invalid Rich Menu schedule action'; end if;

  select * into schedule_row from public.line_richmenu_schedules schedule
   where schedule.id = p_schedule_id for update;
  if not found then raise exception 'Rich Menu schedule not found'; end if;
  if (p_action = 'activate' and schedule_row.status <> 'activating')
     or (p_action = 'expire' and schedule_row.status <> 'expiring') then
    raise exception 'Rich Menu schedule is not claimed for this action';
  end if;

  if not p_success then
    update public.line_richmenu_schedules schedule
       set status = case
         when schedule.attempt_count >= 5 then 'failed'
         when p_action = 'activate' then 'scheduled'
         else 'active'
       end,
       claimed_at = null,
       last_error = left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
       updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, error, metadata)
    values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_failed',
      left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
      jsonb_build_object('schedule_id', schedule_row.id, 'action', p_action, 'attempt', schedule_row.attempt_count)
    );
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || schedule_row.clinic_id::text));
  select menu.published_version_id
    into current_version_id
    from public.line_richmenu menu
   where menu.clinic_id = schedule_row.clinic_id for update;

  if p_action = 'activate' then
    update public.line_richmenu_versions version
       set status = 'archived', updated_at = now()
     where version.clinic_id = schedule_row.clinic_id
       and version.status = 'published'
       and version.id <> schedule_row.version_id;
    update public.line_richmenu_versions version
       set status = 'published', published_at = now(), updated_at = now()
     where version.id = schedule_row.version_id and version.clinic_id = schedule_row.clinic_id;
    insert into public.line_richmenu (clinic_id, published_id, published_version_id, draft_version_id, updated_at)
    select schedule_row.clinic_id, version.line_rich_menu_id, version.id, version.id, now()
      from public.line_richmenu_versions version
     where version.id = schedule_row.version_id
    on conflict (clinic_id) do update set
      published_id = excluded.published_id,
      published_version_id = excluded.published_version_id,
      draft_version_id = excluded.draft_version_id,
      updated_at = now();
    update public.line_richmenu_schedules schedule
       set status = 'active', previous_version_id = coalesce(schedule.previous_version_id, current_version_id),
           activated_at = now(), claimed_at = null, last_error = null, updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, line_rich_menu_id, metadata)
    select schedule_row.clinic_id, schedule_row.version_id, 'scheduled_published',
           version.line_rich_menu_id, jsonb_build_object('schedule_id', schedule_row.id)
      from public.line_richmenu_versions version where version.id = schedule_row.version_id;
  else
    if current_version_id is distinct from schedule_row.version_id then
      update public.line_richmenu_schedules schedule
         set status = 'completed', completed_at = now(), claimed_at = null,
             last_error = 'manual publication superseded this schedule', updated_at = now()
       where schedule.id = p_schedule_id;
      return;
    end if;

    update public.line_richmenu_versions version
       set status = 'archived', updated_at = now()
     where version.id = schedule_row.version_id and version.clinic_id = schedule_row.clinic_id;
    select version.line_rich_menu_id into restore_line_id
      from public.line_richmenu_versions version
     where version.id = schedule_row.previous_version_id
       and version.clinic_id = schedule_row.clinic_id;
    if schedule_row.previous_version_id is not null and restore_line_id is not null then
      update public.line_richmenu_versions version
         set status = 'published', published_at = now(), updated_at = now()
       where version.id = schedule_row.previous_version_id and version.clinic_id = schedule_row.clinic_id;
    end if;
    update public.line_richmenu menu
       set published_id = restore_line_id,
           published_version_id = case when restore_line_id is null then null else schedule_row.previous_version_id end,
           updated_at = now()
     where menu.clinic_id = schedule_row.clinic_id;
    update public.line_richmenu_schedules schedule
       set status = 'completed', completed_at = now(), claimed_at = null,
           last_error = null, updated_at = now()
     where schedule.id = p_schedule_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, line_rich_menu_id, metadata)
    values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_completed',
      restore_line_id, jsonb_build_object('schedule_id', schedule_row.id, 'restored_version_id', schedule_row.previous_version_id)
    );
  end if;
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
      elsif candidate.service_id is null then
        select * into booking from public.book_number(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, null
        );
        v_appointment_id := booking.appointment_id;
      else
        select * into booking from public.book_number_for_service(
          candidate.clinic_id, candidate.doctor_id, candidate.patient_id, candidate.template_id,
          candidate.requested_date, candidate.visit_type, candidate.is_self_pay, candidate.service_id
        );
        v_appointment_id := booking.appointment_id;
      end if;
    exception when others then
      v_error := sqlerrm;
    end;

    if v_appointment_id is null then
      insert into public.appointment_waitlist_events (clinic_id, waitlist_id, target_key, kind, from_status, to_status, error)
      values (candidate.clinic_id, candidate.id, candidate.target_key, 'promotion_failed', candidate.status, candidate.status, v_error);
      if v_error like '%憿遛%' or v_error like '%capacity%' or v_error like '%resource is unavailable%' then
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

revoke all on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.offer_next_appointment_waitlist(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) to service_role;
grant execute on function public.offer_next_appointment_waitlist(uuid, text, integer) to service_role;

commit;
