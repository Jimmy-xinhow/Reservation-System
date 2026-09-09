-- Keep the account-link nonce hash callable under a restricted search_path.
begin;

create or replace function public.complete_line_account_link(
  p_clinic_id uuid,
  p_nonce text,
  p_line_user_id text
) returns table (patient_id uuid, patient_name text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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
  v_nonce_hash := encode(extensions.digest(p_nonce, 'sha256'), 'hex');
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
