begin;

do $$
declare
  brand_a uuid;
  brand_b uuid;
  service_a uuid;
  service_b uuid;
  resource_a uuid;
  resource_b uuid;
begin
  insert into public.clinics (name, slug, active)
    values ('G303 Resource FK A', 'qa-g303-resource-fk-a-' || substr(gen_random_uuid()::text, 1, 8), true)
    returning id into brand_a;
  insert into public.clinics (name, slug, active)
    values ('G303 Resource FK B', 'qa-g303-resource-fk-b-' || substr(gen_random_uuid()::text, 1, 8), true)
    returning id into brand_b;

  insert into public.services (clinic_id, name)
    values (brand_a, 'G303 Resource FK service A') returning id into service_a;
  insert into public.services (clinic_id, name)
    values (brand_b, 'G303 Resource FK service B') returning id into service_b;
  insert into public.service_resources (clinic_id, name)
    values (brand_a, 'G303 Resource FK resource A') returning id into resource_a;
  insert into public.service_resources (clinic_id, name)
    values (brand_b, 'G303 Resource FK resource B') returning id into resource_b;

  insert into public.service_resource_assignments (clinic_id, service_id, resource_id)
    values (brand_a, service_a, resource_a);

  begin
    insert into public.service_resource_assignments (clinic_id, service_id, resource_id)
      values (brand_a, service_b, resource_a);
    raise exception 'cross-brand service assignment was accepted';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.service_resource_assignments (clinic_id, service_id, resource_id)
      values (brand_a, service_a, resource_b);
    raise exception 'cross-brand resource assignment was accepted';
  exception when foreign_key_violation then
    null;
  end;

  if (select count(*) from public.service_resource_assignments where clinic_id = brand_a) <> 1 then
    raise exception 'same-brand assignment missing or cross-brand assignment persisted';
  end if;
end;
$$;

rollback;
