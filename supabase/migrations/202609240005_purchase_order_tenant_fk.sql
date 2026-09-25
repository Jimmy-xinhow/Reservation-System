begin;

-- Fail closed if historical procurement references cross tenant boundaries.
do $$
declare mismatches bigint;
begin
  select count(*) into mismatches
  from public.purchase_orders purchase
  left join public.inventory_suppliers supplier on supplier.id = purchase.supplier_id
  where supplier.id is null or supplier.clinic_id <> purchase.clinic_id;
  if mismatches <> 0 then
    raise exception 'purchase order supplier tenant mismatches: %', mismatches;
  end if;

  select count(*) into mismatches
  from public.purchase_order_items line
  left join public.purchase_orders purchase on purchase.id = line.purchase_order_id
  left join public.inventory_items item on item.id = line.item_id
  where purchase.id is null or item.id is null
    or purchase.clinic_id <> line.clinic_id or item.clinic_id <> line.clinic_id;
  if mismatches <> 0 then
    raise exception 'purchase order item tenant mismatches: %', mismatches;
  end if;
end;
$$;

create unique index if not exists inventory_suppliers_clinic_id_id_uidx
  on public.inventory_suppliers (clinic_id, id);
create unique index if not exists purchase_orders_clinic_id_id_uidx
  on public.purchase_orders (clinic_id, id);
create unique index if not exists inventory_items_clinic_id_id_uidx
  on public.inventory_items (clinic_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_clinic_supplier_fkey') then
    alter table public.purchase_orders add constraint purchase_orders_clinic_supplier_fkey
      foreign key (clinic_id, supplier_id) references public.inventory_suppliers (clinic_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_order_items'::regclass and conname='purchase_order_items_clinic_order_fkey') then
    alter table public.purchase_order_items add constraint purchase_order_items_clinic_order_fkey
      foreign key (clinic_id, purchase_order_id) references public.purchase_orders (clinic_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_order_items'::regclass and conname='purchase_order_items_clinic_item_fkey') then
    alter table public.purchase_order_items add constraint purchase_order_items_clinic_item_fkey
      foreign key (clinic_id, item_id) references public.inventory_items (clinic_id, id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.purchase_orders validate constraint purchase_orders_clinic_supplier_fkey;
alter table public.purchase_order_items validate constraint purchase_order_items_clinic_order_fkey;
alter table public.purchase_order_items validate constraint purchase_order_items_clinic_item_fkey;

-- Serialize line insertion with ordering/receiving the purchase order.
create or replace function public.assert_purchase_order_item_draft()
returns trigger language plpgsql set search_path=public,extensions as $$
declare order_status text;
begin
  select status into order_status from public.purchase_orders
  where id=new.purchase_order_id and clinic_id=new.clinic_id for update;
  if order_status is distinct from 'draft' then
    raise exception 'purchase order is not a draft';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_purchase_order_item_draft on public.purchase_order_items;
create trigger trg_purchase_order_item_draft before insert on public.purchase_order_items
  for each row execute function public.assert_purchase_order_item_draft();

notify pgrst, 'reload schema';
commit;
