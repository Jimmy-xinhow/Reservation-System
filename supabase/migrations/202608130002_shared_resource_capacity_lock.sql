-- Enforce shared resource capacity at the appointments table boundary.
-- Service-level advisory locks cannot protect two different services that use
-- the same room/equipment. Lock resource ids in a stable order so every write
-- path (provider, service-only, admin and reschedule) shares one atomic guard.
begin;

create or replace function public.enforce_appointment_resource_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  resource_row record;
begin
  if new.service_id is null or new.status not in ('booked', 'confirmed', 'done') then
    return new;
  end if;

  for resource_row in
    select assignment.resource_id
      from public.service_resource_assignments assignment
     where assignment.clinic_id = new.clinic_id
       and assignment.service_id = new.service_id
     order by assignment.resource_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'appointment-resource:' || new.clinic_id::text || ':' || resource_row.resource_id::text,
        0
      )
    );
  end loop;

  if not public.service_resources_available(
    new.clinic_id,
    new.service_id,
    new.start_at,
    new.end_at,
    new.id
  ) then
    raise exception 'service resource is unavailable';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_resource_capacity on public.appointments;
create trigger trg_appointments_resource_capacity
before insert or update of clinic_id, service_id, start_at, end_at, status
on public.appointments
for each row execute function public.enforce_appointment_resource_capacity();

revoke all on function public.enforce_appointment_resource_capacity() from public, anon, authenticated;

commit;
