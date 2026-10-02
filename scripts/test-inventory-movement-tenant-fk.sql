begin;

do $$
declare
  brand_a uuid;
  brand_b uuid;
  item_a uuid;
  item_b uuid;
begin
  insert into public.clinics (name, slug, active)
    values ('G303 FK A', 'qa-g303-fk-a-' || substr(gen_random_uuid()::text, 1, 8), true)
    returning id into brand_a;
  insert into public.clinics (name, slug, active)
    values ('G303 FK B', 'qa-g303-fk-b-' || substr(gen_random_uuid()::text, 1, 8), true)
    returning id into brand_b;
  insert into public.inventory_items (clinic_id, name, stock_on_hand)
    values (brand_a, 'G303 FK same brand', 0)
    returning id into item_a;
  insert into public.inventory_items (clinic_id, name, stock_on_hand)
    values (brand_b, 'G303 FK other brand', 0)
    returning id into item_b;

  insert into public.inventory_movements (clinic_id, item_id, kind, quantity, stock_after)
    values (brand_a, item_a, 'stock_in', 1, 1);

  begin
    insert into public.inventory_movements (clinic_id, item_id, kind, quantity, stock_after)
      values (brand_a, item_b, 'stock_in', 1, 1);
    raise exception 'cross-brand inventory movement was accepted';
  exception when foreign_key_violation then
    null;
  end;

  if (select count(*) from public.inventory_movements where clinic_id = brand_a) <> 1 then
    raise exception 'same-brand movement missing or cross-brand movement persisted';
  end if;
end;
$$;

rollback;
