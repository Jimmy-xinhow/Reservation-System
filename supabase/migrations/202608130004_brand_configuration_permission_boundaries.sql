-- Align configuration writes with the explicit brand permission model.
-- Operational staff may read schedule context for daily work, but only a
-- brand administrator or an employee with brand.manage may change it.
begin;

drop policy if exists doctors_nonprovider_manage on public.doctors;
drop policy if exists doctors_brand_manage on public.doctors;
create policy doctors_brand_manage on public.doctors for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = doctors.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = doctors.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
);

drop policy if exists schedule_templates_nonprovider_manage on public.schedule_templates;
drop policy if exists schedule_templates_brand_manage on public.schedule_templates;
create policy schedule_templates_brand_manage on public.schedule_templates for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_templates.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_templates.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
  and (schedule_templates.doctor_id is not null or schedule_templates.service_id is not null)
  and (
    schedule_templates.doctor_id is null
    or exists (
      select 1 from public.doctors doctor
       where doctor.id = schedule_templates.doctor_id
         and doctor.clinic_id = schedule_templates.clinic_id
         and doctor.active
    )
  )
  and (
    schedule_templates.service_id is null
    or exists (
      select 1 from public.services service
       where service.id = schedule_templates.service_id
         and service.clinic_id = schedule_templates.clinic_id
         and service.active
    )
  )
);

drop policy if exists schedule_exceptions_nonprovider_manage on public.schedule_exceptions;
drop policy if exists schedule_exceptions_brand_manage on public.schedule_exceptions;
create policy schedule_exceptions_brand_manage on public.schedule_exceptions for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_exceptions.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = schedule_exceptions.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
  and (schedule_exceptions.doctor_id is not null or schedule_exceptions.service_id is not null)
  and (
    schedule_exceptions.doctor_id is null
    or exists (
      select 1 from public.doctors doctor
       where doctor.id = schedule_exceptions.doctor_id
         and doctor.clinic_id = schedule_exceptions.clinic_id
         and doctor.active
    )
  )
  and (
    schedule_exceptions.service_id is null
    or exists (
      select 1 from public.services service
       where service.id = schedule_exceptions.service_id
         and service.clinic_id = schedule_exceptions.clinic_id
         and service.active
    )
  )
);

drop policy if exists services_manage on public.services;
drop policy if exists services_brand_manage on public.services;
create policy services_brand_manage on public.services for all to authenticated
using (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = services.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
)
with check (
  exists (
    select 1 from public.clinic_members member
     where member.clinic_id = services.clinic_id
       and member.user_id = auth.uid()
       and (member.access_type = 'brand_admin' or 'brand.manage' = any(member.permissions))
  )
);

commit;

