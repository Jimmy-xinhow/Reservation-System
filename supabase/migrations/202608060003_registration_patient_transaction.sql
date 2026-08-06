-- Transactional registration-to-customer link used by the unified customer portal.
-- The additional argument creates a distinct overload and keeps the legacy RPC
-- signature available for existing integrations.
begin;

create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid, p_event_id uuid, p_session_id uuid, p_ticket_type_id uuid, p_name text, p_phone text,
  p_email text default null, p_line_user_id text default null, p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb, p_access_token text default null, p_discount_code text default null,
  p_membership_code text default null, p_form_id uuid default null, p_form_version integer default null,
  p_terms_version integer default null, p_terms_accepted_at timestamptz default null, p_patient_id uuid default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  if p_patient_id is not null and not exists (
    select 1 from public.patients
     where id = p_patient_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'patient is not valid for this brand';
  end if;

  select * into r from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  update public.registrations
     set terms_version = p_terms_version,
         terms_accepted_at = p_terms_accepted_at,
         patient_id = p_patient_id
   where id = r.registration_id and clinic_id = p_clinic_id;
  update public.discount_redemptions
     set patient_id = p_patient_id
   where clinic_id = p_clinic_id and registration_id = r.registration_id;
  return query select r.registration_id, r.registration_no, r.registration_status, r.payment_status, r.amount, r.discount_amount, r.membership_applied, r.checkin_token;
end;
$$;

revoke all on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.register_for_event_with_terms(uuid, uuid, uuid, uuid, text, text, text, text, boolean, jsonb, text, text, text, uuid, integer, integer, timestamptz, uuid) to service_role;

commit;
