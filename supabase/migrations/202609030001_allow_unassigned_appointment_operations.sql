-- Allow brand operators to update valid provider-optional/resource-only bookings.
-- These appointments intentionally keep doctor_id NULL; the existing policy
-- required an active doctor on every update and made status buttons fail.
drop policy if exists appointments_nonprovider_manage on public.appointments;

create policy appointments_nonprovider_manage on public.appointments for all to authenticated
  using (exists (
    select 1 from public.clinic_members cm
     where cm.clinic_id = appointments.clinic_id
       and cm.user_id = auth.uid()
       and cm.role in ('owner','admin','frontdesk','staff')
  ))
  with check (
    exists (
      select 1 from public.clinic_members cm
       where cm.clinic_id = appointments.clinic_id
         and cm.user_id = auth.uid()
         and cm.role in ('owner','admin','frontdesk','staff')
    )
    and (
      (appointments.doctor_id is not null and exists (
        select 1 from public.doctors d
         where d.id = appointments.doctor_id
           and d.clinic_id = appointments.clinic_id
           and d.active
      ))
      or (
        appointments.doctor_id is null
        and appointments.service_id is not null
        and exists (
          select 1 from public.services s
           where s.id = appointments.service_id
             and s.clinic_id = appointments.clinic_id
             and s.active
             and s.booking_target in ('provider_optional', 'resource_only')
        )
      )
    )
    and exists (
      select 1 from public.patients p
       where p.id = appointments.patient_id
         and p.clinic_id = appointments.clinic_id
    )
    and (appointments.service_id is null or exists (
      select 1 from public.services s
       where s.id = appointments.service_id
         and s.clinic_id = appointments.clinic_id
         and s.active
    ))
    and (appointments.template_id is null or exists (
      select 1 from public.schedule_templates t
       where t.id = appointments.template_id
         and t.clinic_id = appointments.clinic_id
         and (
           t.doctor_id = appointments.doctor_id
           or (appointments.doctor_id is null and t.doctor_id is null and t.service_id = appointments.service_id)
         )
      union all
      select 1 from public.schedule_exceptions e
       where e.id = appointments.template_id
         and e.clinic_id = appointments.clinic_id
         and (
           e.doctor_id = appointments.doctor_id
           or (appointments.doctor_id is null and e.doctor_id is null)
         )
    ))
  );
