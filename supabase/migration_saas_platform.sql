-- SaaS platform layer: the platform team manages brands, while each brand
-- remains isolated behind the existing clinic_id compatibility key.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated;

create table if not exists public.brand_entitlements (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  plan_code text not null default 'standard' check (plan_code in ('standard', 'professional', 'enterprise')),
  feature_flags jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_entitlements enable row level security;
revoke all on table public.brand_entitlements from public, anon, authenticated;

insert into public.brand_entitlements (clinic_id)
select id from public.clinics
on conflict (clinic_id) do nothing;

create or replace function public.seed_brand_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.brand_entitlements (clinic_id)
  values (new.id)
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_clinic_seed_entitlements on public.clinics;
create trigger trg_clinic_seed_entitlements
after insert on public.clinics
for each row execute function public.seed_brand_entitlements();

drop trigger if exists trg_platform_admins_touch on public.platform_admins;
create trigger trg_platform_admins_touch
before update on public.platform_admins
for each row execute function public.touch_updated_at();

drop trigger if exists trg_brand_entitlements_touch on public.brand_entitlements;
create trigger trg_brand_entitlements_touch
before update on public.brand_entitlements
for each row execute function public.touch_updated_at();

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
    select 1 from public.platform_admins
    where user_id = p_actor_user_id and active
  ) then
    raise exception 'platform admin access required';
  end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'invalid brand name'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$' then raise exception 'invalid brand slug'; end if;
  if not exists (select 1 from auth.users where id = p_owner_user_id) then
    raise exception 'owner user not found';
  end if;

  insert into public.clinics (name, slug, phone, address, active)
  values (v_name, v_slug, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''), true)
  returning id into v_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role)
  values (v_clinic_id, p_owner_user_id, 'owner')
  on conflict (clinic_id, user_id) do update set role = 'owner';

  return query select v_clinic_id, p_owner_user_id;
exception
  when unique_violation then
    raise exception 'brand slug already exists' using errcode = '23505';
end;
$$;

revoke all on function public.seed_brand_entitlements() from public, anon, authenticated;
grant execute on function public.seed_brand_entitlements() to service_role;
revoke all on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_brand_with_platform_admin(uuid, uuid, text, text, text, text) to service_role;

