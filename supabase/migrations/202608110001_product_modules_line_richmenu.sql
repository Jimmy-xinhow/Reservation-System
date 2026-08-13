-- Product restructure M2: standard module activation, per-brand LINE metadata,
-- and a versioned Rich Menu lifecycle. Secrets remain server-environment only.
begin;

alter table public.clinic_settings
  add column if not exists events_enabled boolean not null default false,
  add column if not exists memberships_enabled boolean not null default false,
  add column if not exists crm_automation_enabled boolean not null default false,
  add column if not exists line_channel_enabled boolean not null default false;

-- Preserve existing brands: infer usage from current public switches and data.
update public.clinic_settings settings
set events_enabled = settings.events_enabled
  or settings.public_registration_enabled
  or exists (select 1 from public.events event where event.clinic_id = settings.clinic_id),
    memberships_enabled = settings.memberships_enabled
  or exists (select 1 from public.membership_plans plan where plan.clinic_id = settings.clinic_id)
  or exists (select 1 from public.patient_memberships membership where membership.clinic_id = settings.clinic_id),
    crm_automation_enabled = settings.crm_automation_enabled
  or exists (select 1 from public.crm_segments segment where segment.clinic_id = settings.clinic_id)
  or exists (select 1 from public.crm_automations automation where automation.clinic_id = settings.clinic_id),
    line_channel_enabled = settings.line_channel_enabled
  or exists (
    select 1 from public.clinics clinic
     where clinic.id = settings.clinic_id
       and (clinic.line_destination is not null or clinic.line_basic_id is not null)
  );

-- A new brand can configure events before publishing them.
alter table public.clinic_settings alter column public_registration_enabled set default false;

create table if not exists public.clinic_line_channels (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  connection_mode text not null default 'shared'
    check (connection_mode in ('shared', 'brand')),
  provider_id text,
  messaging_channel_id text,
  login_channel_id text,
  liff_id text,
  liff_endpoint_path text not null default '/book',
  verification_status text not null default 'unconfigured'
    check (verification_status in ('unconfigured', 'pending', 'ready', 'error')),
  verification_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (liff_endpoint_path like '/%')
);

insert into public.clinic_line_channels (clinic_id, verification_status)
select settings.clinic_id,
       case when settings.line_channel_enabled then 'pending' else 'unconfigured' end
  from public.clinic_settings settings
on conflict (clinic_id) do nothing;

create table if not exists public.line_richmenu_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  name text not null default '未命名版本',
  template_key text not null default 'custom'
    check (template_key in ('booking', 'events', 'mixed', 'custom')),
  layout text not null
    check (layout in ('full-3', 'full-6', 'compact-2', 'compact-3')),
  chat_bar_text text not null default '選單',
  slots jsonb not null default '[]'::jsonb,
  image_storage_path text,
  image_content_type text,
  image_sha256 text,
  image_width integer,
  image_height integer,
  status text not null default 'draft'
    check (status in ('draft', 'validating', 'ready', 'publishing', 'published', 'failed', 'archived')),
  line_rich_menu_id text,
  validation_errors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, version_no),
  check (jsonb_typeof(slots) = 'array'),
  check (jsonb_typeof(validation_errors) = 'array'),
  check (image_width is null or image_width > 0),
  check (image_height is null or image_height > 0)
);

create unique index if not exists line_richmenu_versions_one_published_idx
  on public.line_richmenu_versions (clinic_id)
  where status = 'published';
create index if not exists line_richmenu_versions_history_idx
  on public.line_richmenu_versions (clinic_id, version_no desc);

alter table public.line_richmenu
  add column if not exists draft_version_id uuid,
  add column if not exists published_version_id uuid;

do $$
begin
  alter table public.line_richmenu
    add constraint line_richmenu_draft_version_fkey
    foreign key (draft_version_id) references public.line_richmenu_versions(id) on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.line_richmenu
    add constraint line_richmenu_published_version_fkey
    foreign key (published_version_id) references public.line_richmenu_versions(id) on delete restrict;
exception when duplicate_object then null;
end $$;

insert into public.line_richmenu_versions (
  clinic_id,
  version_no,
  name,
  template_key,
  layout,
  chat_bar_text,
  slots,
  status,
  line_rich_menu_id,
  published_at,
  created_at,
  updated_at
)
select menu.clinic_id,
       1,
       '既有 Rich Menu',
       'custom',
       menu.layout,
       menu.chat_bar_text,
       coalesce(menu.slots, '[]'::jsonb),
       case when menu.published_id is null then 'draft' else 'published' end,
       menu.published_id,
       case when menu.published_id is null then null else coalesce(menu.updated_at, now()) end,
       coalesce(menu.updated_at, now()),
       coalesce(menu.updated_at, now())
  from public.line_richmenu menu
 where not exists (
   select 1
     from public.line_richmenu_versions version
    where version.clinic_id = menu.clinic_id
 )
on conflict (clinic_id, version_no) do nothing;

update public.line_richmenu menu
   set draft_version_id = coalesce(menu.draft_version_id, version.id),
       published_version_id = case
         when menu.published_id is null then menu.published_version_id
         else coalesce(menu.published_version_id, version.id)
       end
  from public.line_richmenu_versions version
 where version.clinic_id = menu.clinic_id
   and version.version_no = 1;

create table if not exists public.line_richmenu_publication_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  version_id uuid not null references public.line_richmenu_versions(id) on delete restrict,
  kind text not null
    check (kind in ('validated', 'validation_failed', 'published', 'publish_failed', 'rolled_back', 'unpublished')),
  actor_id uuid references auth.users(id) on delete set null,
  line_rich_menu_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index if not exists line_richmenu_publication_events_history_idx
  on public.line_richmenu_publication_events (clinic_id, created_at desc);

drop trigger if exists trg_clinic_line_channels_touch on public.clinic_line_channels;
create trigger trg_clinic_line_channels_touch before update on public.clinic_line_channels
for each row execute function public.touch_updated_at();
drop trigger if exists trg_line_richmenu_versions_touch on public.line_richmenu_versions;
create trigger trg_line_richmenu_versions_touch before update on public.line_richmenu_versions
for each row execute function public.touch_updated_at();

alter table public.clinic_line_channels enable row level security;
alter table public.line_richmenu_versions enable row level security;
alter table public.line_richmenu_publication_events enable row level security;
revoke all on table public.clinic_line_channels from public, anon;
revoke all on table public.line_richmenu_versions from public, anon;
revoke all on table public.line_richmenu_publication_events from public, anon;

drop policy if exists clinic_line_channels_admin on public.clinic_line_channels;
create policy clinic_line_channels_admin on public.clinic_line_channels
for all to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = clinic_line_channels.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
))
with check (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = clinic_line_channels.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

drop policy if exists line_richmenu_versions_admin on public.line_richmenu_versions;
create policy line_richmenu_versions_admin on public.line_richmenu_versions
for all to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_versions.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
))
with check (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_versions.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

drop policy if exists line_richmenu_publication_events_admin on public.line_richmenu_publication_events;
create policy line_richmenu_publication_events_admin on public.line_richmenu_publication_events
for all to authenticated
using (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_publication_events.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
))
with check (exists (
  select 1 from public.clinic_members member
   where member.clinic_id = line_richmenu_publication_events.clinic_id
     and member.user_id = auth.uid()
     and member.role in ('owner', 'admin')
));

create or replace function public.create_line_richmenu_version(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_template_key text,
  p_layout text,
  p_chat_bar_text text,
  p_slots jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_version integer;
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  if p_layout not in ('full-3', 'full-6', 'compact-2', 'compact-3') then
    raise exception 'invalid rich menu layout';
  end if;
  if p_template_key not in ('booking', 'events', 'mixed', 'custom') then
    raise exception 'invalid rich menu template';
  end if;
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'rich menu slots must be an array';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'rich menu version name is invalid';
  end if;
  if length(btrim(coalesce(p_chat_bar_text, ''))) not between 1 and 14 then
    raise exception 'rich menu chat bar text is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('richmenu-version:' || p_clinic_id::text));
  select coalesce(max(version_no), 0) + 1 into v_version
    from public.line_richmenu_versions where clinic_id = p_clinic_id;
  insert into public.line_richmenu_versions (
    clinic_id, version_no, name, template_key, layout, chat_bar_text, slots, created_by
  ) values (
    p_clinic_id, v_version, btrim(p_name), p_template_key, p_layout,
    btrim(p_chat_bar_text), coalesce(p_slots, '[]'::jsonb), p_actor_user_id
  ) returning id into v_id;
  insert into public.line_richmenu (clinic_id) values (p_clinic_id)
  on conflict (clinic_id) do nothing;
  update public.line_richmenu
     set draft_version_id = v_id, updated_at = now()
   where clinic_id = p_clinic_id;
  return v_id;
end;
$$;

revoke all on function public.create_line_richmenu_version(uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_line_richmenu_version(uuid, uuid, text, text, text, text, jsonb)
 to service_role;


create or replace function public.update_clinic_line_channel(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_enabled boolean,
  p_connection_mode text,
  p_destination text default null,
  p_login_channel_id text default null,
  p_liff_id text default null,
  p_liff_endpoint_path text default '/book'
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_destination text := nullif(btrim(coalesce(p_destination, '')), '');
  v_login_channel_id text := nullif(btrim(coalesce(p_login_channel_id, '')), '');
  v_liff_id text := nullif(btrim(coalesce(p_liff_id, '')), '');
  v_endpoint_path text := btrim(coalesce(p_liff_endpoint_path, '/book'));
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception 'actor identity mismatch';
  end if;
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id
       and member.role in ('owner', 'admin')
  ) then raise exception 'brand admin access required'; end if;
  if p_connection_mode not in ('shared', 'brand') then raise exception 'invalid LINE connection mode'; end if;
  if v_destination is not null and v_destination !~ '^U[A-Za-z0-9_-]{8,100}$' then raise exception 'invalid LINE destination'; end if;
  if v_login_channel_id is not null and v_login_channel_id !~ '^[0-9]{6,30}$' then raise exception 'invalid LINE Login Channel ID'; end if;
  if v_liff_id is not null and v_liff_id !~ '^[0-9]{6,30}-[A-Za-z0-9_-]{4,100}$' then raise exception 'invalid LIFF ID'; end if;
  if v_endpoint_path !~ '^/[^\\]*$' or length(v_endpoint_path) > 200 then raise exception 'invalid LIFF endpoint path'; end if;
  if p_enabled and p_connection_mode = 'brand' and (v_destination is null or v_login_channel_id is null or v_liff_id is null) then
    raise exception 'brand LINE channel metadata is incomplete';
  end if;

  update public.clinics set line_destination = v_destination, updated_at = now() where id = p_clinic_id and active;
  if not found then raise exception 'brand not found'; end if;
  update public.clinic_settings set line_channel_enabled = p_enabled, updated_at = now() where clinic_id = p_clinic_id;
  if not found then raise exception 'brand settings not found'; end if;
  insert into public.clinic_line_channels (
    clinic_id, connection_mode, login_channel_id, liff_id, liff_endpoint_path,
    verification_status, verification_error, last_verified_at
  ) values (
    p_clinic_id, p_connection_mode, v_login_channel_id, v_liff_id, v_endpoint_path,
    case when p_enabled then 'pending' else 'unconfigured' end, null, null
  )
  on conflict (clinic_id) do update set
    connection_mode = excluded.connection_mode,
    login_channel_id = excluded.login_channel_id,
    liff_id = excluded.liff_id,
    liff_endpoint_path = excluded.liff_endpoint_path,
    verification_status = excluded.verification_status,
    verification_error = null,
    last_verified_at = null,
    updated_at = now();
end;
$$;
revoke all on function public.update_clinic_line_channel(uuid, uuid, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.update_clinic_line_channel(uuid, uuid, boolean, text, text, text, text, text) to authenticated, service_role;


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
declare target record;
begin
  if p_kind not in ('published', 'rolled_back') then raise exception 'invalid publication kind'; end if;
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  if nullif(btrim(coalesce(p_line_rich_menu_id, '')), '') is null then raise exception 'LINE Rich Menu ID is required'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || p_clinic_id::text));
  select id, status into target from public.line_richmenu_versions where id = p_version_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'Rich Menu version not found'; end if;
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

create or replace function public.record_line_richmenu_publish_failure(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_error text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  update public.line_richmenu_versions
     set status = 'failed', validation_errors = jsonb_build_array(left(coalesce(p_error, 'publish failed'), 1000)), updated_at = now()
   where id = p_version_id and clinic_id = p_clinic_id and status <> 'published';
  if not found then raise exception 'Rich Menu version not found or already published'; end if;
  insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, error)
  values (p_clinic_id, p_version_id, 'publish_failed', p_actor_user_id, left(coalesce(p_error, 'publish failed'), 1000));
end;
$$;

create or replace function public.record_line_richmenu_unpublished(
  p_clinic_id uuid,
  p_actor_user_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare current_version uuid; current_line_id text;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role in ('owner', 'admin'))
    then raise exception 'brand admin access required'; end if;
  perform pg_advisory_xact_lock(hashtext('richmenu-publication:' || p_clinic_id::text));
  select published_version_id, published_id into current_version, current_line_id
    from public.line_richmenu where clinic_id = p_clinic_id for update;
  if current_version is not null then
    update public.line_richmenu_versions set status = 'archived', updated_at = now()
     where id = current_version and clinic_id = p_clinic_id;
    insert into public.line_richmenu_publication_events (clinic_id, version_id, kind, actor_id, line_rich_menu_id)
    values (p_clinic_id, current_version, 'unpublished', p_actor_user_id, current_line_id);
  end if;
  update public.line_richmenu set published_id = null, published_version_id = null, updated_at = now()
   where clinic_id = p_clinic_id;
end;
$$;

revoke all on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_line_richmenu_publish_failure(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_line_richmenu_unpublished(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_line_richmenu_publication(uuid, uuid, uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.record_line_richmenu_publish_failure(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_line_richmenu_unpublished(uuid, uuid) to service_role;

commit;
