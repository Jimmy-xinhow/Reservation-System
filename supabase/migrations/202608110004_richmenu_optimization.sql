-- Rich Menu second-batch product capabilities: aliases, scheduled display windows,
-- privacy-safe insight linkage, explicit cloning, and auditable schedule execution.
begin;

alter table public.line_richmenu_versions
  add column if not exists source_version_id uuid;

create unique index if not exists line_richmenu_versions_clinic_id_id_uidx
  on public.line_richmenu_versions (clinic_id, id);

do $$
begin
  alter table public.line_richmenu_versions
    add constraint line_richmenu_versions_source_tenant_fkey
    foreign key (clinic_id, source_version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict;
exception when duplicate_object then null;
end $$;

create index if not exists line_richmenu_versions_source_idx
  on public.line_richmenu_versions (clinic_id, source_version_id)
  where source_version_id is not null;

create table if not exists public.line_richmenu_aliases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  channel_destination text not null,
  alias_id text not null,
  label text not null,
  version_id uuid not null,
  line_rich_menu_id text not null,
  status text not null default 'ready'
    check (status in ('ready', 'error', 'removed')),
  last_error text,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, alias_id),
  foreign key (clinic_id, version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict,
  check (alias_id ~ '^[a-z0-9_-]{1,32}$'),
  check (length(btrim(label)) between 1 and 40)
);

create index if not exists line_richmenu_aliases_version_idx
  on public.line_richmenu_aliases (clinic_id, version_id)
  where status <> 'removed';
create unique index if not exists line_richmenu_aliases_channel_alias_uidx
  on public.line_richmenu_aliases (channel_destination, alias_id)
  where status <> 'removed';

create table if not exists public.line_richmenu_schedules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  version_id uuid not null,
  previous_version_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'activating', 'active', 'expiring', 'completed', 'cancelled', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict,
  foreign key (clinic_id, previous_version_id)
    references public.line_richmenu_versions (clinic_id, id) on delete restrict,
  check (ends_at > starts_at)
);

create index if not exists line_richmenu_schedules_due_idx
  on public.line_richmenu_schedules (status, starts_at, ends_at)
  where status in ('scheduled', 'activating', 'active', 'expiring');
create index if not exists line_richmenu_schedules_clinic_idx
  on public.line_richmenu_schedules (clinic_id, starts_at desc);

drop trigger if exists trg_line_richmenu_aliases_touch on public.line_richmenu_aliases;
create trigger trg_line_richmenu_aliases_touch before update on public.line_richmenu_aliases
for each row execute function public.touch_updated_at();
drop trigger if exists trg_line_richmenu_schedules_touch on public.line_richmenu_schedules;
create trigger trg_line_richmenu_schedules_touch before update on public.line_richmenu_schedules
for each row execute function public.touch_updated_at();

alter table public.line_richmenu_aliases enable row level security;
alter table public.line_richmenu_schedules enable row level security;
revoke all on table public.line_richmenu_aliases from public, anon, authenticated;
revoke all on table public.line_richmenu_schedules from public, anon, authenticated;
grant select on table public.line_richmenu_aliases to authenticated;
grant select on table public.line_richmenu_schedules to authenticated;

drop policy if exists line_richmenu_aliases_admin on public.line_richmenu_aliases;
create policy line_richmenu_aliases_admin on public.line_richmenu_aliases
for select to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_aliases.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

drop policy if exists line_richmenu_schedules_admin on public.line_richmenu_schedules;
create policy line_richmenu_schedules_admin on public.line_richmenu_schedules
for select to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_schedules.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

alter table public.line_richmenu_publication_events
  drop constraint if exists line_richmenu_publication_events_kind_check;
alter table public.line_richmenu_publication_events
  add constraint line_richmenu_publication_events_kind_check check (kind in (
    'validated', 'validation_failed', 'published', 'publish_failed', 'rolled_back', 'unpublished',
    'scheduled', 'scheduled_published', 'schedule_failed', 'schedule_completed'
  ));

create or replace function public.clone_line_richmenu_version(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_source_version_id uuid,
  p_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  source_version public.line_richmenu_versions%rowtype;
  v_id uuid;
  v_version integer;
  v_name text;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;

  select * into source_version
    from public.line_richmenu_versions version
   where version.id = p_source_version_id
     and version.clinic_id = p_clinic_id;
  if not found then raise exception 'Rich Menu source version not found'; end if;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), source_version.name || ' 複本');
  if length(v_name) > 120 then raise exception 'rich menu version name is invalid'; end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-version:' || p_clinic_id::text));
  select coalesce(max(version.version_no), 0) + 1 into v_version
    from public.line_richmenu_versions version where version.clinic_id = p_clinic_id;

  insert into public.line_richmenu_versions (
    clinic_id, version_no, name, template_key, layout, chat_bar_text, slots,
    status, validation_errors, created_by, source_version_id
  ) values (
    p_clinic_id, v_version, v_name, source_version.template_key, source_version.layout,
    source_version.chat_bar_text, source_version.slots, 'draft', '[]'::jsonb,
    p_actor_user_id, source_version.id
  ) returning id into v_id;

  insert into public.line_richmenu (clinic_id) values (p_clinic_id)
  on conflict (clinic_id) do nothing;
  update public.line_richmenu
     set draft_version_id = v_id, updated_at = now()
   where clinic_id = p_clinic_id;
  return v_id;
end;
$$;

create or replace function public.create_line_richmenu_schedule(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  if p_starts_at <= now() then raise exception 'schedule start must be in the future'; end if;
  if p_ends_at <= p_starts_at then raise exception 'schedule end must be after start'; end if;
  if not exists (
    select 1 from public.line_richmenu_versions version
     where version.id = p_version_id
       and version.clinic_id = p_clinic_id
       and version.line_rich_menu_id is not null
  ) then raise exception 'scheduled version must already exist on LINE'; end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-schedule:' || p_clinic_id::text));
  if exists (
    select 1 from public.line_richmenu_schedules schedule
     where schedule.clinic_id = p_clinic_id
       and schedule.status in ('scheduled', 'activating', 'active', 'expiring')
       and tstzrange(schedule.starts_at, schedule.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'Rich Menu display schedule overlaps an existing schedule'; end if;

  insert into public.line_richmenu_schedules (
    clinic_id, version_id, starts_at, ends_at, created_by
  ) values (
    p_clinic_id, p_version_id, p_starts_at, p_ends_at, p_actor_user_id
  ) returning id into v_id;
  insert into public.line_richmenu_publication_events (
    clinic_id, version_id, kind, actor_id, metadata
  ) values (
    p_clinic_id, p_version_id, 'scheduled', p_actor_user_id,
    jsonb_build_object('schedule_id', v_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at)
  );
  return v_id;
end;
$$;

create or replace function public.cancel_line_richmenu_schedule(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_schedule_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  update public.line_richmenu_schedules schedule
     set status = 'cancelled', completed_at = now(), claimed_at = null,
         last_error = 'cancelled by operator', updated_at = now()
   where schedule.id = p_schedule_id
     and schedule.clinic_id = p_clinic_id
     and schedule.status = 'scheduled';
  if not found then raise exception 'only a pending Rich Menu schedule can be cancelled'; end if;
end;
$$;

create or replace function public.claim_due_line_richmenu_schedules(p_limit integer default 10)
returns table (
  schedule_id uuid,
  clinic_id uuid,
  action text,
  version_id uuid,
  line_rich_menu_id text,
  restore_version_id uuid,
  restore_line_rich_menu_id text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare candidate record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;

  update public.line_richmenu_schedules schedule
     set status = case when schedule.status = 'activating' then 'scheduled' else 'active' end,
         claimed_at = null,
         last_error = coalesce(schedule.last_error, 'stale claim recovered'),
         updated_at = now()
   where schedule.status in ('activating', 'expiring')
     and schedule.claimed_at < now() - interval '10 minutes'
     and schedule.attempt_count < 5;

  update public.line_richmenu_schedules schedule
     set status = 'failed', claimed_at = null,
         last_error = coalesce(schedule.last_error, 'retry limit reached'), updated_at = now()
   where schedule.status in ('activating', 'expiring')
     and schedule.claimed_at < now() - interval '10 minutes'
     and schedule.attempt_count >= 5;

  with expired_windows as (
    update public.line_richmenu_schedules schedule
       set status = 'failed', completed_at = now(), claimed_at = null,
           last_error = 'display window ended before activation', updated_at = now()
     where schedule.status = 'scheduled'
       and schedule.ends_at <= now()
     returning schedule.id, schedule.clinic_id, schedule.version_id
  )
  insert into public.line_richmenu_publication_events (
    clinic_id, version_id, kind, error, metadata
  )
  select expired.clinic_id, expired.version_id, 'schedule_failed',
         'display window ended before activation', jsonb_build_object('schedule_id', expired.id, 'action', 'activate')
    from expired_windows expired;

  for candidate in
    select schedule.id, schedule.clinic_id, schedule.version_id, schedule.previous_version_id,
           schedule.status, schedule.starts_at, schedule.ends_at, schedule.attempt_count,
           version.line_rich_menu_id,
           previous.line_rich_menu_id as previous_line_rich_menu_id,
           menu.published_version_id
      from public.line_richmenu_schedules schedule
      join public.line_richmenu_versions version
        on version.id = schedule.version_id and version.clinic_id = schedule.clinic_id
      left join public.line_richmenu_versions previous
        on previous.id = schedule.previous_version_id and previous.clinic_id = schedule.clinic_id
      left join public.line_richmenu menu on menu.clinic_id = schedule.clinic_id
     where schedule.attempt_count < 5
       and ((schedule.status = 'scheduled' and schedule.starts_at <= now())
         or (schedule.status = 'active' and schedule.ends_at <= now()))
     order by case when schedule.status = 'active' then schedule.ends_at else schedule.starts_at end,
              schedule.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update of schedule skip locked
  loop
    if candidate.status = 'active' and candidate.published_version_id is distinct from candidate.version_id then
      update public.line_richmenu_schedules schedule
         set status = 'completed', completed_at = now(),
             last_error = 'manual publication superseded this schedule', updated_at = now()
       where schedule.id = candidate.id;
      continue;
    end if;

    update public.line_richmenu_schedules schedule
       set status = case when candidate.status = 'scheduled' then 'activating' else 'expiring' end,
           claimed_at = now(), attempt_count = schedule.attempt_count + 1,
           last_error = null, updated_at = now()
     where schedule.id = candidate.id;

    schedule_id := candidate.id;
    clinic_id := candidate.clinic_id;
    action := case when candidate.status = 'scheduled' then 'activate' else 'expire' end;
    version_id := candidate.version_id;
    line_rich_menu_id := candidate.line_rich_menu_id;
    restore_version_id := candidate.previous_version_id;
    restore_line_rich_menu_id := candidate.previous_line_rich_menu_id;
    attempt_count := candidate.attempt_count + 1;
    return next;
  end loop;
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
  current_line_id text;
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
    insert into public.line_richmenu_publication_events (
      clinic_id, version_id, kind, error, metadata
    ) values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_failed',
      left(coalesce(p_error, 'Rich Menu schedule failed'), 1000),
      jsonb_build_object('schedule_id', schedule_row.id, 'action', p_action, 'attempt', schedule_row.attempt_count)
    );
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || schedule_row.clinic_id::text));
  select menu.published_version_id, menu.published_id
    into current_version_id, current_line_id
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
    insert into public.line_richmenu_publication_events (
      clinic_id, version_id, kind, line_rich_menu_id, metadata
    ) select schedule_row.clinic_id, schedule_row.version_id, 'scheduled_published',
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
    insert into public.line_richmenu_publication_events (
      clinic_id, version_id, kind, line_rich_menu_id, metadata
    ) values (
      schedule_row.clinic_id, schedule_row.version_id, 'schedule_completed',
      restore_line_id, jsonb_build_object('schedule_id', schedule_row.id, 'restored_version_id', schedule_row.previous_version_id)
    );
  end if;
end;
$$;

revoke all on function public.clone_line_richmenu_version(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_line_richmenu_schedule(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_line_richmenu_schedule(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_due_line_richmenu_schedules(integer) from public, anon, authenticated;
revoke all on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.clone_line_richmenu_version(uuid, uuid, uuid, text) to service_role;
grant execute on function public.create_line_richmenu_schedule(uuid, uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.cancel_line_richmenu_schedule(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_due_line_richmenu_schedules(integer) to service_role;
grant execute on function public.finish_line_richmenu_schedule(uuid, text, boolean, text) to service_role;

commit;
