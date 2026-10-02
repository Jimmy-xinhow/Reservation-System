begin;
create or replace function public.register_for_event_with_terms(
  p_clinic_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_ticket_type_id uuid,
  p_name text,
  p_phone text,
  p_email text default null,
  p_line_user_id text default null,
  p_marketing_opt_in boolean default false,
  p_answers jsonb default '{}'::jsonb,
  p_access_token text default null,
  p_discount_code text default null,
  p_membership_code text default null,
  p_form_id uuid default null,
  p_form_version integer default null,
  p_terms_version integer default null,
  p_terms_accepted_at timestamptz default null,
  p_patient_id uuid default null
)
returns table (registration_id uuid, registration_no text, registration_status text, payment_status text, amount integer, discount_amount integer, membership_applied boolean, checkin_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  registration_result record;
begin
  if p_patient_id is not null and not exists (
    select 1 from public.patients patient
     where patient.id = p_patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then
    raise exception 'patient is not valid for this brand';
  end if;

  select * into registration_result from public.register_for_event_with_benefits(
    p_clinic_id, p_event_id, p_session_id, p_ticket_type_id, p_name, p_phone, p_email, p_line_user_id,
    p_marketing_opt_in, p_answers, p_access_token, p_discount_code, p_membership_code, p_form_id, p_form_version
  );
  -- Validate the actual membership after the inner transaction locks/consumes it.
  -- Raising here rolls back the registration and ledger together.
  if registration_result.membership_applied and not exists (
    select 1 from public.registrations r
      join public.patient_memberships pm on pm.id=r.membership_id and pm.clinic_id=r.clinic_id
     where r.id=registration_result.registration_id and r.clinic_id=p_clinic_id
       and pm.patient_id=p_patient_id
  ) then
    raise exception 'membership does not belong to this patient';
  end if;
  update public.registrations registration
     set terms_version = p_terms_version,
         terms_accepted_at = p_terms_accepted_at,
         patient_id = p_patient_id
   where registration.id = registration_result.registration_id
     and registration.clinic_id = p_clinic_id;
  update public.discount_redemptions redemption
     set patient_id = p_patient_id
   where redemption.clinic_id = p_clinic_id
     and redemption.registration_id = registration_result.registration_id;
  return query select
    registration_result.registration_id,
    registration_result.registration_no,
    registration_result.registration_status,
    registration_result.payment_status,
    registration_result.amount,
    registration_result.discount_amount,
    registration_result.membership_applied,
    registration_result.checkin_token;
end;
$$;
commit;
