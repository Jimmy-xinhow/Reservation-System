-- 報名同意行銷與 CRM 顧客同步；可重跑，需在既有 schema／報名領域完成後執行。
create or replace function create_or_get_public_patient_with_marketing_opt_in(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_birthday date default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false
) returns table (patient_id uuid, reused boolean)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  matched record;
begin
  select * into matched
    from public.create_or_get_public_patient(p_clinic_id, p_name, p_phone, p_birthday, p_line_user_id);
  if coalesce(p_marketing_opt_in, false) and matched.patient_id is not null then
    update public.patients
       set marketing_opt_in = true
     where id = matched.patient_id
       and clinic_id = p_clinic_id;
  end if;
  return query select matched.patient_id, matched.reused;
end;
$$;

revoke all on function create_or_get_public_patient_with_marketing_opt_in(uuid, text, text, date, text, boolean) from public, anon, authenticated;
grant execute on function create_or_get_public_patient_with_marketing_opt_in(uuid, text, text, date, text, boolean) to service_role;
