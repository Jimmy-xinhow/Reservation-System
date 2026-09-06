-- Brand administrators can manage LINE and Email credentials without deployment access.
-- Secret values stay encrypted in Supabase Vault and are never granted to browser roles.
begin;

create extension if not exists supabase_vault with schema vault;

create table if not exists public.clinic_line_secret_refs (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  access_token_secret_id uuid not null,
  channel_secret_secret_id uuid not null,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_clinic_line_secret_refs_touch on public.clinic_line_secret_refs;
create trigger trg_clinic_line_secret_refs_touch
before update on public.clinic_line_secret_refs
for each row execute function public.touch_updated_at();

alter table public.clinic_line_secret_refs enable row level security;
revoke all on table public.clinic_line_secret_refs from public, anon, authenticated;
grant select, insert, update on table public.clinic_line_secret_refs to service_role;

create table if not exists public.clinic_email_secret_refs (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  api_key_secret_id uuid not null,
  from_address text not null,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint clinic_email_secret_refs_from_length check (length(from_address) between 3 and 320)
);

drop trigger if exists trg_clinic_email_secret_refs_touch on public.clinic_email_secret_refs;
create trigger trg_clinic_email_secret_refs_touch
before update on public.clinic_email_secret_refs
for each row execute function public.touch_updated_at();

alter table public.clinic_email_secret_refs enable row level security;
revoke all on table public.clinic_email_secret_refs from public, anon, authenticated;
grant select, insert, update on table public.clinic_email_secret_refs to service_role;

create or replace function public.save_clinic_line_credentials(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_access_token text default null,
  p_channel_secret text default null
) returns timestamptz
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_access_token text := nullif(btrim(p_access_token), '');
  v_channel_secret text := nullif(btrim(p_channel_secret), '');
  v_destination text;
  v_access_token_id uuid;
  v_channel_secret_id uuid;
  v_access_token_name text := format('clinic.%s.line.access_token', p_clinic_id);
  v_channel_secret_name text := format('clinic.%s.line.channel_secret', p_clinic_id);
  v_saved_at timestamptz := now();
begin
  if not exists (
    select 1
      from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and (
         member.access_type = 'brand_admin'
         or (member.access_type is null and member.role in ('owner', 'admin'))
       )
  ) then
    raise exception 'LINE credentials actor is not a brand administrator';
  end if;

  select clinic.line_destination
    into v_destination
    from public.clinics clinic
    join public.clinic_line_channels channel on channel.clinic_id = clinic.id
   where clinic.id = p_clinic_id
     and clinic.active
     and channel.connection_mode = 'brand';
  if v_destination is null or v_destination !~ '^U[A-Za-z0-9_-]{8,100}$' then
    raise exception 'brand LINE mode and a valid destination must be saved before credentials';
  end if;

  select refs.access_token_secret_id, refs.channel_secret_secret_id
    into v_access_token_id, v_channel_secret_id
    from public.clinic_line_secret_refs refs
   where refs.clinic_id = p_clinic_id;

  if v_access_token_id is null and (v_access_token is null or v_channel_secret is null) then
    raise exception 'first LINE credential setup requires both access token and channel secret';
  end if;
  if v_access_token is not null and (
    length(v_access_token) < 20
    or length(v_access_token) > 4096
    or v_access_token ~ '[[:space:]]'
  ) then
    raise exception 'LINE access token format is invalid';
  end if;
  if v_channel_secret is not null and v_channel_secret !~ '^[A-Za-z0-9]{32}$' then
    raise exception 'LINE channel secret format is invalid';
  end if;

  if v_access_token is not null then
    if v_access_token_id is null then
      select secret.id
        into v_access_token_id
        from vault.secrets secret
       where secret.name = v_access_token_name
       limit 1;
    end if;
    if v_access_token_id is null then
      v_access_token_id := vault.create_secret(v_access_token, v_access_token_name, 'LINE access token for one clinic');
    else
      perform vault.update_secret(v_access_token_id, v_access_token, v_access_token_name, 'LINE access token for one clinic');
    end if;
  end if;

  if v_channel_secret is not null then
    if v_channel_secret_id is null then
      select secret.id
        into v_channel_secret_id
        from vault.secrets secret
       where secret.name = v_channel_secret_name
       limit 1;
    end if;
    if v_channel_secret_id is null then
      v_channel_secret_id := vault.create_secret(v_channel_secret, v_channel_secret_name, 'LINE channel secret for one clinic');
    else
      perform vault.update_secret(v_channel_secret_id, v_channel_secret, v_channel_secret_name, 'LINE channel secret for one clinic');
    end if;
  end if;

  insert into public.clinic_line_secret_refs (
    clinic_id,
    access_token_secret_id,
    channel_secret_secret_id,
    configured_at,
    updated_at,
    updated_by
  ) values (
    p_clinic_id,
    v_access_token_id,
    v_channel_secret_id,
    v_saved_at,
    v_saved_at,
    p_actor_user_id
  )
  on conflict (clinic_id) do update
    set access_token_secret_id = excluded.access_token_secret_id,
        channel_secret_secret_id = excluded.channel_secret_secret_id,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return v_saved_at;
end;
$$;

create or replace function public.get_clinic_line_secrets_by_destination(p_destination text)
returns table (clinic_id uuid, access_token text, channel_secret text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select refs.clinic_id,
         access_token_secret.decrypted_secret,
         channel_secret_secret.decrypted_secret
    from public.clinics clinic
    join public.clinic_line_secret_refs refs on refs.clinic_id = clinic.id
    join vault.decrypted_secrets access_token_secret on access_token_secret.id = refs.access_token_secret_id
    join vault.decrypted_secrets channel_secret_secret on channel_secret_secret.id = refs.channel_secret_secret_id
   where clinic.line_destination = nullif(btrim(p_destination), '')
     and clinic.active;
$$;

create or replace function public.save_clinic_email_configuration(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_enabled boolean,
  p_api_key text default null,
  p_from_address text default null
) returns timestamptz
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_api_key text := nullif(btrim(p_api_key), '');
  v_from_address text := nullif(btrim(p_from_address), '');
  v_api_key_id uuid;
  v_existing_from_address text;
  v_api_key_name text := format('clinic.%s.email.resend_api_key', p_clinic_id);
  v_saved_at timestamptz := now();
begin
  if not exists (
    select 1
      from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and (
         member.access_type = 'brand_admin'
         or (member.access_type is null and member.role in ('owner', 'admin'))
       )
  ) then
    raise exception 'Email settings actor is not a brand administrator';
  end if;

  select refs.api_key_secret_id, refs.from_address
    into v_api_key_id, v_existing_from_address
    from public.clinic_email_secret_refs refs
   where refs.clinic_id = p_clinic_id;

  if v_api_key is not null and v_api_key !~ '^re_[A-Za-z0-9_-]{8,250}$' then
    raise exception 'Resend API key format is invalid';
  end if;
  if v_from_address is not null and (
    length(v_from_address) > 320
    or position(chr(10) in v_from_address) > 0
    or position(chr(13) in v_from_address) > 0
    or v_from_address !~* '^[^<>]*<?[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}>?$'
  ) then
    raise exception 'Email sender format is invalid';
  end if;
  if v_api_key_id is null and (v_api_key is null or v_from_address is null) then
    if v_api_key is not null or v_from_address is not null then
      raise exception 'first Email setup requires both API key and sender';
    end if;
  end if;

  update public.clinic_settings
     set email_enabled = coalesce(p_enabled, false),
         updated_at = v_saved_at
   where clinic_id = p_clinic_id;
  if not found then
    raise exception 'clinic settings not found';
  end if;

  if v_api_key is null and v_from_address is null then
    return v_saved_at;
  end if;

  if v_api_key is not null then
    if v_api_key_id is null then
      select secret.id
        into v_api_key_id
        from vault.secrets secret
       where secret.name = v_api_key_name
       limit 1;
    end if;
    if v_api_key_id is null then
      v_api_key_id := vault.create_secret(v_api_key, v_api_key_name, 'Resend API key for one clinic');
    else
      perform vault.update_secret(v_api_key_id, v_api_key, v_api_key_name, 'Resend API key for one clinic');
    end if;
  end if;

  insert into public.clinic_email_secret_refs (
    clinic_id,
    api_key_secret_id,
    from_address,
    configured_at,
    updated_at,
    updated_by
  ) values (
    p_clinic_id,
    v_api_key_id,
    coalesce(v_from_address, v_existing_from_address),
    v_saved_at,
    v_saved_at,
    p_actor_user_id
  )
  on conflict (clinic_id) do update
    set api_key_secret_id = excluded.api_key_secret_id,
        from_address = excluded.from_address,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return v_saved_at;
end;
$$;

create or replace function public.get_clinic_email_configuration(p_clinic_id uuid)
returns table (api_key text, from_address text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select api_key_secret.decrypted_secret,
         refs.from_address
    from public.clinic_email_secret_refs refs
    join vault.decrypted_secrets api_key_secret on api_key_secret.id = refs.api_key_secret_id
   where refs.clinic_id = p_clinic_id;
$$;

revoke all on function public.save_clinic_line_credentials(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_clinic_line_credentials(uuid, uuid, text, text) to service_role;
revoke all on function public.get_clinic_line_secrets_by_destination(text) from public, anon, authenticated;
grant execute on function public.get_clinic_line_secrets_by_destination(text) to service_role;
revoke all on function public.save_clinic_email_configuration(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.save_clinic_email_configuration(uuid, uuid, boolean, text, text) to service_role;
revoke all on function public.get_clinic_email_configuration(uuid) from public, anon, authenticated;
grant execute on function public.get_clinic_email_configuration(uuid) to service_role;

commit;
