begin;

create or replace function public.get_platform_usage_summary()
returns table (
  id uuid,
  name text,
  slug text,
  active boolean,
  created_at timestamptz,
  members bigint,
  services bigint,
  appointments bigint,
  registrations bigint,
  patients bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    clinic.id,
    clinic.name,
    clinic.slug,
    clinic.active,
    clinic.created_at,
    coalesce(member_count.total, 0)::bigint as members,
    coalesce(service_count.total, 0)::bigint as services,
    coalesce(appointment_count.total, 0)::bigint as appointments,
    coalesce(registration_count.total, 0)::bigint as registrations,
    coalesce(patient_count.total, 0)::bigint as patients
  from public.clinics clinic
  left join (
    select clinic_id, count(*) as total from public.clinic_members group by clinic_id
  ) member_count on member_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.services where active group by clinic_id
  ) service_count on service_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.appointments group by clinic_id
  ) appointment_count on appointment_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.registrations group by clinic_id
  ) registration_count on registration_count.clinic_id = clinic.id
  left join (
    select clinic_id, count(*) as total from public.patients group by clinic_id
  ) patient_count on patient_count.clinic_id = clinic.id
  order by clinic.created_at desc;
$$;

revoke all on function public.get_platform_usage_summary() from public, anon, authenticated;
grant execute on function public.get_platform_usage_summary() to service_role;

commit;
