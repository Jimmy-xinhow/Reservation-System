begin;

-- Inventory movement rows and their referenced items must belong to the same tenant.
-- Fail before changing constraints if historical rows need explicit reconciliation.
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.inventory_movements movement
  left join public.inventory_items item on item.id = movement.item_id
  where item.id is null or item.clinic_id <> movement.clinic_id;
  if mismatches <> 0 then
    raise exception 'inventory movement tenant mismatches: %', mismatches;
  end if;
end;
$$;

create unique index if not exists inventory_items_clinic_id_id_uidx
  on public.inventory_items (clinic_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_movements'::regclass
      and conname = 'inventory_movements_clinic_item_fkey'
  ) then
    alter table public.inventory_movements
      add constraint inventory_movements_clinic_item_fkey
      foreign key (clinic_id, item_id)
      references public.inventory_items (clinic_id, id)
      on delete restrict
      not valid;
  end if;
end;
$$;

alter table public.inventory_movements
  validate constraint inventory_movements_clinic_item_fkey;

commit;
