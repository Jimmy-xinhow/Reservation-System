-- Two-level administration model:
-- - system administrators own the SaaS/platform scope;
-- - brand administrators own one or more brand scopes;
-- - employees receive explicit permissions without becoming administrators.
-- Legacy role values remain as a compatibility implementation for existing RLS.
begin;

alter table public.platform_admins add column if not exists access_type text;
alter table public.platform_admins add column if not exists permissions text[];

update public.platform_admins
set access_type = coalesce(access_type, 'system_admin'),
    permissions = coalesce(permissions, '{}'::text[]);

alter table public.platform_admins alter column access_type set default 'employee';
alter table public.platform_admins alter column access_type set not null;
alter table public.platform_admins alter column permissions set default '{}'::text[];
alter table public.platform_admins alter column permissions set not null;

alter table public.platform_admins drop constraint if exists platform_admins_access_type_check;
alter table public.platform_admins add constraint platform_admins_access_type_check
  check (access_type in ('system_admin', 'employee'));
alter table public.platform_admins drop constraint if exists platform_admins_permissions_check;
alter table public.platform_admins add constraint platform_admins_permissions_check
  check (permissions <@ array[
    'platform.overview', 'brands.manage', 'entitlements.manage', 'operations.view',
    'reports.view', 'audit.view', 'settings.view'
  ]::text[]);

alter table public.clinic_members add column if not exists access_type text;
alter table public.clinic_members add column if not exists permissions text[];

update public.clinic_members
set access_type = coalesce(access_type, case when role in ('owner', 'admin') then 'brand_admin' else 'employee' end),
    permissions = coalesce(
      permissions,
      case
        when role in ('owner', 'admin') then array['brand.manage', 'operations.manage']::text[]
        when role = 'provider' then array['provider.assigned']::text[]
        else array['operations.manage']::text[]
      end
    );

alter table public.clinic_members alter column access_type set default 'employee';
alter table public.clinic_members alter column access_type set not null;
alter table public.clinic_members alter column permissions set default '{}'::text[];
alter table public.clinic_members alter column permissions set not null;

alter table public.clinic_members drop constraint if exists clinic_members_access_type_check;
alter table public.clinic_members add constraint clinic_members_access_type_check
  check (access_type in ('brand_admin', 'employee'));
alter table public.clinic_members drop constraint if exists clinic_members_permissions_check;
alter table public.clinic_members add constraint clinic_members_permissions_check
  check (permissions <@ array['brand.manage', 'operations.manage', 'provider.assigned']::text[]);

create or replace function public.create_brand_with_owner(
  p_actor_user_id uuid,
  p_source_clinic_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
) returns table (clinic_id uuid, clinic_name text, clinic_slug text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.clinic_members member
     where member.clinic_id = p_source_clinic_id
       and member.user_id = p_actor_user_id
       and member.access_type = 'brand_admin'
  ) then
    raise exception '無權限建立品牌';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception '品牌名稱格式錯誤'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception '品牌短網址格式錯誤'; end if;

  insert into public.clinics (name, slug, phone, address)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
  returning id into v_id;

  insert into public.clinic_settings (clinic_id) values (v_id)
  on conflict on constraint clinic_settings_pkey do nothing;
  insert into public.clinic_members (clinic_id, user_id, role, access_type, permissions)
  values (v_id, p_actor_user_id, 'owner', 'brand_admin', array['brand.manage', 'operations.manage']::text[]);

  return query select v_id, v_name, v_slug;
exception
  when unique_violation then raise exception '品牌短網址已存在' using errcode = '23505';
end;
$$;

create or replace function public.create_brand_with_platform_admin(
  p_actor_user_id uuid,
  p_owner_user_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_address text default null
)
returns table (clinic_id uuid, owner_user_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clinic_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.platform_admins platform_member
     where platform_member.user_id = p_actor_user_id
       and platform_member.active
       and (
         platform_member.access_type = 'system_admin'
         or 'brands.manage' = any(platform_member.permissions)
       )
  ) then
    raise exception 'system brand management permission required';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'invalid brand name'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception 'invalid brand slug'; end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = p_owner_user_id) then raise exception 'brand administrator user not found'; end if;

  insert into public.clinics (name, slug, phone, address, active)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''), true)
  returning id into v_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role, access_type, permissions)
  values (v_clinic_id, p_owner_user_id, 'owner', 'brand_admin', array['brand.manage', 'operations.manage']::text[])
  on conflict on constraint clinic_members_pkey do update
    set role = 'owner',
        access_type = 'brand_admin',
        permissions = array['brand.manage', 'operations.manage']::text[];

  return query select v_clinic_id, p_owner_user_id;
exception
  when unique_violation then raise exception 'brand slug already exists' using errcode = '23505';
end;
$$;

revoke all on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_brand_with_owner(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) to service_role;

commit;
