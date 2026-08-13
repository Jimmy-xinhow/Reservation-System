-- Break the provider patients <-> appointments RLS recursion while preserving
-- assignment-scoped access. The explicit caller check prevents using the helper
-- to probe another authenticated user's assignments.
begin;

create or replace function public.provider_has_patient_assignment(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_user_id = auth.uid()
    and exists (
      select 1
        from public.appointments appointment
        join public.doctor_assignments assignment
          on assignment.clinic_id = appointment.clinic_id
         and assignment.doctor_id = appointment.doctor_id
       where appointment.clinic_id = p_clinic_id
         and appointment.patient_id = p_patient_id
         and assignment.user_id = p_user_id
         and assignment.active
    );
$$;

revoke all on function public.provider_has_patient_assignment(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.provider_has_patient_assignment(uuid, uuid, uuid)
  to authenticated, service_role;

drop policy if exists patients_provider_read on public.patients;
create policy patients_provider_read on public.patients for select to authenticated
  using (
    patients.clinic_id in (
      select member.clinic_id
        from public.clinic_members member
       where member.user_id = auth.uid()
    )
    and (
      exists (
        select 1
          from public.clinic_members member
         where member.clinic_id = patients.clinic_id
           and member.user_id = auth.uid()
           and member.role <> 'provider'
      )
      or public.provider_has_patient_assignment(patients.clinic_id, patients.id, auth.uid())
    )
  );

drop policy if exists patient_records_provider_read on public.patient_records;
create policy patient_records_provider_read on public.patient_records for select to authenticated
  using (
    patient_records.clinic_id in (
      select member.clinic_id
        from public.clinic_members member
       where member.user_id = auth.uid()
    )
    and (
      exists (
        select 1
          from public.clinic_members member
         where member.clinic_id = patient_records.clinic_id
           and member.user_id = auth.uid()
           and member.role <> 'provider'
      )
      or public.provider_has_patient_assignment(
        patient_records.clinic_id,
        patient_records.patient_id,
        auth.uid()
      )
    )
  );

commit;

