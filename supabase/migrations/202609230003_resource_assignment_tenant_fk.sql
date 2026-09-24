begin;

-- Keep each assignment, service and resource inside the same tenant.
-- Stop before changing constraints when historical rows need reconciliation.
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.service_resource_assignments assignment
  left join public.services service on service.id = assignment.service_id
  left join public.service_resources resource on resource.id = assignment.resource_id
  where service.id is null or resource.id is null
    or service.clinic_id <> assignment.clinic_id
    or resource.clinic_id <> assignment.clinic_id;
  if mismatches <> 0 then
    raise exception 'resource assignment tenant mismatches: %', mismatches;
  end if;
end;
$$;

create unique index if not exists services_clinic_id_id_uidx
  on public.services (clinic_id, id);
create unique index if not exists service_resources_clinic_id_id_uidx
  on public.service_resources (clinic_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.service_resource_assignments'::regclass
      and conname = 'service_resource_assignments_clinic_service_fkey'
  ) then
    alter table public.service_resource_assignments
      add constraint service_resource_assignments_clinic_service_fkey
      foreign key (clinic_id, service_id)
      references public.services (clinic_id, id)
      on delete restrict
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.service_resource_assignments'::regclass
      and conname = 'service_resource_assignments_clinic_resource_fkey'
  ) then
    alter table public.service_resource_assignments
      add constraint service_resource_assignments_clinic_resource_fkey
      foreign key (clinic_id, resource_id)
      references public.service_resources (clinic_id, id)
      on delete restrict
      not valid;
  end if;
end;
$$;

alter table public.service_resource_assignments
  validate constraint service_resource_assignments_clinic_service_fkey;
alter table public.service_resource_assignments
  validate constraint service_resource_assignments_clinic_resource_fkey;

commit;
