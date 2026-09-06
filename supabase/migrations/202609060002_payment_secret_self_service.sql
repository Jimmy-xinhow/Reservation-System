-- Brand administrators can manage payment credentials without deployment access.
-- Secret values stay encrypted in Supabase Vault and are never granted to browser roles.
begin;

create extension if not exists supabase_vault with schema vault;

create table if not exists public.clinic_payment_secret_refs (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  hash_key_secret_id uuid not null,
  hash_iv_secret_id uuid not null,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

drop trigger if exists trg_clinic_payment_secret_refs_touch on public.clinic_payment_secret_refs;
create trigger trg_clinic_payment_secret_refs_touch
before update on public.clinic_payment_secret_refs
for each row execute function public.touch_updated_at();

alter table public.clinic_payment_secret_refs enable row level security;
revoke all on table public.clinic_payment_secret_refs from public, anon, authenticated;
grant select, insert, update on table public.clinic_payment_secret_refs to service_role;

create or replace function public.save_clinic_payment_configuration(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_merchant_id text,
  p_environment text,
  p_active boolean,
  p_hash_key text default null,
  p_hash_iv text default null
) returns timestamptz
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_hash_key text := nullif(btrim(p_hash_key), '');
  v_hash_iv text := nullif(btrim(p_hash_iv), '');
  v_hash_key_id uuid;
  v_hash_iv_id uuid;
  v_hash_key_name text := format('clinic.%s.payment.hash_key', p_clinic_id);
  v_hash_iv_name text := format('clinic.%s.payment.hash_iv', p_clinic_id);
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
    raise exception 'payment settings actor is not a brand administrator';
  end if;

  if p_provider not in ('ecpay', 'newebpay') then
    raise exception 'invalid payment provider';
  end if;
  if p_environment not in ('test', 'production') then
    raise exception 'invalid payment environment';
  end if;
  if nullif(btrim(p_merchant_id), '') is null then
    raise exception 'merchant id is required';
  end if;
  if (v_hash_key is null) <> (v_hash_iv is null) then
    raise exception 'hash key and hash iv must be updated together';
  end if;
  if v_hash_key is not null and (
    (p_provider = 'ecpay' and (length(v_hash_key) <> 16 or length(v_hash_iv) <> 16))
    or (p_provider = 'newebpay' and (length(v_hash_key) <> 32 or length(v_hash_iv) <> 16))
  ) then
    raise exception 'payment credential length is invalid';
  end if;

  insert into public.clinic_payment_settings (
    clinic_id,
    provider,
    merchant_id,
    environment,
    active,
    updated_at
  ) values (
    p_clinic_id,
    p_provider,
    btrim(p_merchant_id),
    p_environment,
    coalesce(p_active, false),
    v_saved_at
  )
  on conflict (clinic_id) do update
    set provider = excluded.provider,
        merchant_id = excluded.merchant_id,
        environment = excluded.environment,
        active = excluded.active,
        updated_at = excluded.updated_at;

  if v_hash_key is not null then
    select secret.id
      into v_hash_key_id
      from vault.secrets secret
     where secret.name = v_hash_key_name
     limit 1;
    if v_hash_key_id is null then
      v_hash_key_id := vault.create_secret(v_hash_key, v_hash_key_name, 'Payment HashKey for one clinic');
    else
      perform vault.update_secret(v_hash_key_id, v_hash_key, v_hash_key_name, 'Payment HashKey for one clinic');
    end if;

    select secret.id
      into v_hash_iv_id
      from vault.secrets secret
     where secret.name = v_hash_iv_name
     limit 1;
    if v_hash_iv_id is null then
      v_hash_iv_id := vault.create_secret(v_hash_iv, v_hash_iv_name, 'Payment HashIV for one clinic');
    else
      perform vault.update_secret(v_hash_iv_id, v_hash_iv, v_hash_iv_name, 'Payment HashIV for one clinic');
    end if;

    insert into public.clinic_payment_secret_refs (
      clinic_id,
      hash_key_secret_id,
      hash_iv_secret_id,
      configured_at,
      updated_at,
      updated_by
    ) values (
      p_clinic_id,
      v_hash_key_id,
      v_hash_iv_id,
      v_saved_at,
      v_saved_at,
      p_actor_user_id
    )
    on conflict (clinic_id) do update
      set hash_key_secret_id = excluded.hash_key_secret_id,
          hash_iv_secret_id = excluded.hash_iv_secret_id,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by;
  end if;

  return v_saved_at;
end;
$$;

create or replace function public.get_clinic_payment_secrets(p_clinic_id uuid)
returns table (hash_key text, hash_iv text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select hash_key_secret.decrypted_secret,
         hash_iv_secret.decrypted_secret
    from public.clinic_payment_secret_refs refs
    join vault.decrypted_secrets hash_key_secret on hash_key_secret.id = refs.hash_key_secret_id
    join vault.decrypted_secrets hash_iv_secret on hash_iv_secret.id = refs.hash_iv_secret_id
   where refs.clinic_id = p_clinic_id;
$$;

revoke all on function public.save_clinic_payment_configuration(uuid, uuid, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.save_clinic_payment_configuration(uuid, uuid, text, text, text, boolean, text, text) to service_role;
revoke all on function public.get_clinic_payment_secrets(uuid) from public, anon, authenticated;
grant execute on function public.get_clinic_payment_secrets(uuid) to service_role;

commit;
