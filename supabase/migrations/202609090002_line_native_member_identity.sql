-- Native LINE member identity: a signed webhook can bind the current LINE user
-- without forcing a LIFF/web page or inventing phone/birthday data.
begin;

create table if not exists public.line_customer_identities (
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  line_user_id text not null,
  patient_id uuid references public.patients(id) on delete set null,
  display_name text,
  picture_url text,
  profile_completed boolean not null default false,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, line_user_id),
  constraint line_customer_identities_user_length check (length(line_user_id) between 1 and 160),
  constraint line_customer_identities_name_length check (display_name is null or length(display_name) <= 100),
  constraint line_customer_identities_picture_length check (picture_url is null or length(picture_url) <= 2048)
);

create index if not exists line_customer_identities_patient_idx
  on public.line_customer_identities (clinic_id, patient_id)
  where patient_id is not null;

drop trigger if exists trg_line_customer_identities_touch on public.line_customer_identities;
create trigger trg_line_customer_identities_touch
before update on public.line_customer_identities
for each row execute function public.touch_updated_at();

alter table public.line_customer_identities enable row level security;
revoke all on table public.line_customer_identities from public, anon, authenticated;
grant select, insert, update, delete on table public.line_customer_identities to service_role;

-- Keep the official Account Link recovery flow, but also mark the native LINE
-- identity as complete after an existing patient record is recovered.
create or replace function public.complete_line_account_link(
  p_clinic_id uuid,
  p_nonce text,
  p_line_user_id text
) returns table (patient_id uuid, patient_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nonce_hash text;
  v_link public.line_account_link_nonces%rowtype;
  v_line_user_id text := nullif(btrim(coalesce(p_line_user_id, '')), '');
  v_patient public.patients%rowtype;
begin
  if p_clinic_id is null or nullif(btrim(coalesce(p_nonce, '')), '') is null or v_line_user_id is null then
    raise exception 'invalid account link request';
  end if;
  if length(p_nonce) > 256 or length(v_line_user_id) > 160 then
    raise exception 'account link value is too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('line-identity:' || p_clinic_id::text || ':' || v_line_user_id));
  v_nonce_hash := encode(digest(p_nonce, 'sha256'), 'hex');
  select * into v_link
    from public.line_account_link_nonces
   where clinic_id = p_clinic_id
     and nonce_hash = v_nonce_hash
     and used_at is null
     and expires_at > now()
   for update;
  if not found then raise exception 'account link nonce is invalid or expired'; end if;

  select * into v_patient
    from public.patients
   where id = v_link.patient_id and clinic_id = p_clinic_id and active
   for update;
  if not found then raise exception 'account link patient is unavailable'; end if;
  if v_patient.line_user_id is not null and v_patient.line_user_id <> v_line_user_id then
    raise exception 'patient is already linked to another LINE account';
  end if;

  update public.patients
     set line_user_id = v_line_user_id
   where id = v_patient.id and clinic_id = p_clinic_id;
  insert into public.line_customer_identities
    (clinic_id, line_user_id, patient_id, display_name, profile_completed, active, last_seen_at)
  values
    (p_clinic_id, v_line_user_id, v_patient.id, v_patient.name, true, true, now())
  on conflict (clinic_id, line_user_id) do update
    set patient_id = excluded.patient_id,
        display_name = coalesce(public.line_customer_identities.display_name, excluded.display_name),
        profile_completed = true,
        active = true,
        last_seen_at = now();
  update public.line_account_link_nonces
     set used_at = now()
   where id = v_link.id;

  return query select v_patient.id, v_patient.name;
end;
$$;

revoke all on function public.complete_line_account_link(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_line_account_link(uuid, text, text) to service_role;

commit;
