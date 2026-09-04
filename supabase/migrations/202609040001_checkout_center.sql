-- Unified checkout center for appointments, registrations, packages and products.
begin;

alter table public.services add column if not exists price integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_price_check') then
    alter table public.services add constraint services_price_check check (price between 0 and 1000000) not valid;
  end if;
end;
$$;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  order_no text not null default ('SO-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  appointment_id uuid references public.appointments(id) on delete restrict,
  registration_id uuid references public.registrations(id) on delete restrict,
  patient_id uuid references public.patients(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'paid', 'void')),
  subtotal integer not null default 0 check (subtotal >= 0),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  total_amount integer not null default 0 check (total_amount >= 0),
  paid_amount integer not null default 0 check (paid_amount >= 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, order_no),
  check (not (appointment_id is not null and registration_id is not null)),
  check (discount_amount <= subtotal),
  check (total_amount = subtotal - discount_amount),
  check (paid_amount <= total_amount)
);
create unique index if not exists sales_orders_appointment_active_idx on public.sales_orders (appointment_id) where appointment_id is not null and status <> 'void';
create unique index if not exists sales_orders_registration_active_idx on public.sales_orders (registration_id) where registration_id is not null and status <> 'void';
create index if not exists sales_orders_clinic_created_idx on public.sales_orders (clinic_id, created_at desc);
create index if not exists sales_orders_patient_idx on public.sales_orders (clinic_id, patient_id, created_at desc);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  order_id uuid not null references public.sales_orders(id) on delete restrict,
  kind text not null check (kind in ('service', 'product', 'package', 'custom')),
  reference_id uuid,
  name text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  line_total integer not null check (line_total >= 0),
  created_at timestamptz not null default now()
);
create index if not exists sales_order_items_order_idx on public.sales_order_items (clinic_id, order_id, created_at);

create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  order_id uuid not null references public.sales_orders(id) on delete restrict,
  method text not null check (method in ('cash', 'card', 'transfer', 'online', 'other')),
  amount integer not null check (amount > 0),
  reference text,
  received_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sales_payments_order_idx on public.sales_payments (clinic_id, order_id, received_at desc);

drop trigger if exists trg_sales_orders_touch on public.sales_orders;
create trigger trg_sales_orders_touch before update on public.sales_orders for each row execute function public.touch_updated_at();

alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.sales_payments enable row level security;
revoke all on table public.sales_orders from public, anon, authenticated;
revoke all on table public.sales_order_items from public, anon, authenticated;
revoke all on table public.sales_payments from public, anon, authenticated;
grant select on table public.sales_orders, public.sales_order_items, public.sales_payments to authenticated;
grant all on table public.sales_orders, public.sales_order_items, public.sales_payments to service_role;

drop policy if exists sales_orders_member_read on public.sales_orders;
create policy sales_orders_member_read on public.sales_orders for select to authenticated using (
  exists (select 1 from public.clinic_members member where member.clinic_id = sales_orders.clinic_id and member.user_id = auth.uid() and member.role <> 'provider')
);
drop policy if exists sales_order_items_member_read on public.sales_order_items;
create policy sales_order_items_member_read on public.sales_order_items for select to authenticated using (
  exists (select 1 from public.clinic_members member where member.clinic_id = sales_order_items.clinic_id and member.user_id = auth.uid() and member.role <> 'provider')
);
drop policy if exists sales_payments_member_read on public.sales_payments;
create policy sales_payments_member_read on public.sales_payments for select to authenticated using (
  exists (select 1 from public.clinic_members member where member.clinic_id = sales_payments.clinic_id and member.user_id = auth.uid() and member.role <> 'provider')
);

create or replace function public.recalculate_sales_order(p_clinic_id uuid, p_order_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_subtotal integer; v_discount integer; v_paid integer;
begin
  select coalesce(sum(line_total), 0) into v_subtotal from public.sales_order_items where clinic_id = p_clinic_id and order_id = p_order_id;
  select discount_amount, paid_amount into v_discount, v_paid from public.sales_orders where id = p_order_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'sales order not found'; end if;
  if v_discount > v_subtotal then raise exception 'discount exceeds subtotal'; end if;
  if v_paid > v_subtotal - v_discount then raise exception 'paid amount exceeds order total'; end if;
  update public.sales_orders
     set subtotal = v_subtotal,
         total_amount = v_subtotal - v_discount,
         status = case when v_subtotal - v_discount = 0 then 'open' when v_paid = 0 then 'open' when v_paid < v_subtotal - v_discount then 'partially_paid' else 'paid' end,
         completed_at = case when v_subtotal - v_discount > 0 and v_paid = v_subtotal - v_discount then coalesce(completed_at, now()) else null end
   where id = p_order_id and clinic_id = p_clinic_id;
end;
$$;
revoke all on function public.recalculate_sales_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.recalculate_sales_order(uuid, uuid) to service_role;

create or replace function public.create_sales_order(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_appointment_id uuid default null,
  p_registration_id uuid default null,
  p_patient_id uuid default null,
  p_discount_amount integer default 0,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_order_id uuid; v_existing uuid; v_subtotal integer := 0; v_total integer := 0; v_paid integer := 0;
  v_appointment record; v_registration record; v_service record; v_addon jsonb; v_addon_price integer; v_item_name text;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role <> 'provider') then raise exception 'checkout actor is not allowed'; end if;
  if p_appointment_id is not null and p_registration_id is not null then raise exception 'checkout source must be unique'; end if;
  if p_appointment_id is null and p_registration_id is null and p_patient_id is null then raise exception 'checkout customer is required'; end if;
  if p_discount_amount < 0 then raise exception 'invalid discount'; end if;

  if p_appointment_id is not null then
    select id into v_existing from public.sales_orders where clinic_id = p_clinic_id and appointment_id = p_appointment_id and status <> 'void' limit 1;
    if v_existing is not null then return v_existing; end if;
    select appointment.*, service.name as service_name, coalesce(service.price, 0) as service_price
      into v_appointment
      from public.appointments appointment
      left join public.services service on service.id = appointment.service_id and service.clinic_id = appointment.clinic_id
     where appointment.id = p_appointment_id and appointment.clinic_id = p_clinic_id
     for update of appointment;
    if not found or v_appointment.status in ('cancelled', 'no_show') then raise exception 'appointment is not eligible for checkout'; end if;
    insert into public.sales_orders (clinic_id, appointment_id, patient_id, discount_amount, note, created_by)
      values (p_clinic_id, p_appointment_id, v_appointment.patient_id, p_discount_amount, nullif(btrim(p_note), ''), p_actor_user_id) returning id into v_order_id;
    insert into public.sales_order_items (clinic_id, order_id, kind, reference_id, name, quantity, unit_price, line_total)
      values (p_clinic_id, v_order_id, 'service', v_appointment.service_id, coalesce(v_appointment.service_name, '預約服務'), 1, v_appointment.service_price, v_appointment.service_price);
    if jsonb_typeof(coalesce(v_appointment.addons_snapshot, '[]'::jsonb)) = 'array' then
      for v_addon in select value from jsonb_array_elements(coalesce(v_appointment.addons_snapshot, '[]'::jsonb)) loop
        v_addon_price := case when coalesce(v_addon->>'price', '') ~ '^\d+$' then (v_addon->>'price')::integer else 0 end;
        insert into public.sales_order_items (clinic_id, order_id, kind, reference_id, name, quantity, unit_price, line_total)
          values (p_clinic_id, v_order_id, 'service', case when coalesce(v_addon->>'id', '') ~ '^[0-9a-fA-F-]{36}$' then (v_addon->>'id')::uuid else null end, coalesce(nullif(v_addon->>'name', ''), '加購服務'), 1, v_addon_price, v_addon_price);
      end loop;
    end if;
    perform public.recalculate_sales_order(p_clinic_id, v_order_id);
    select total_amount into v_total from public.sales_orders where id = v_order_id;
    if v_appointment.deposit_status = 'paid' and v_appointment.deposit_amount > 0 and v_total > 0 then
      v_paid := least(v_appointment.deposit_amount, v_total);
      insert into public.sales_payments (clinic_id, order_id, method, amount, reference, actor_id) values (p_clinic_id, v_order_id, 'online', v_paid, '預約訂金', p_actor_user_id);
      update public.sales_orders set paid_amount = v_paid where id = v_order_id;
      perform public.recalculate_sales_order(p_clinic_id, v_order_id);
    end if;
  elsif p_registration_id is not null then
    select id into v_existing from public.sales_orders where clinic_id = p_clinic_id and registration_id = p_registration_id and status <> 'void' limit 1;
    if v_existing is not null then return v_existing; end if;
    select registration.*, event.title as event_title, ticket.name as ticket_name
      into v_registration
      from public.registrations registration
      join public.events event on event.id = registration.event_id and event.clinic_id = registration.clinic_id
      left join public.event_ticket_types ticket on ticket.id = registration.ticket_type_id and ticket.clinic_id = registration.clinic_id
     where registration.id = p_registration_id and registration.clinic_id = p_clinic_id
     for update of registration;
    if not found or v_registration.status in ('cancelled', 'waitlisted', 'no_show') then raise exception 'registration is not eligible for checkout'; end if;
    insert into public.sales_orders (clinic_id, registration_id, patient_id, discount_amount, note, created_by)
      values (p_clinic_id, p_registration_id, v_registration.patient_id, p_discount_amount, nullif(btrim(p_note), ''), p_actor_user_id) returning id into v_order_id;
    v_item_name := v_registration.event_title || coalesce(' · ' || nullif(v_registration.ticket_name, ''), '');
    insert into public.sales_order_items (clinic_id, order_id, kind, reference_id, name, quantity, unit_price, line_total)
      values (p_clinic_id, v_order_id, 'service', v_registration.event_id, v_item_name, 1, v_registration.amount, v_registration.amount);
    perform public.recalculate_sales_order(p_clinic_id, v_order_id);
    select total_amount into v_total from public.sales_orders where id = v_order_id;
    if v_registration.payment_status = 'paid' and v_total > 0 then
      insert into public.sales_payments (clinic_id, order_id, method, amount, reference, actor_id) values (p_clinic_id, v_order_id, 'online', v_total, '活動線上付款', p_actor_user_id);
      update public.sales_orders set paid_amount = v_total where id = v_order_id;
      perform public.recalculate_sales_order(p_clinic_id, v_order_id);
    end if;
  else
    if not exists (select 1 from public.patients patient where patient.id = p_patient_id and patient.clinic_id = p_clinic_id) then raise exception 'checkout customer not found'; end if;
    insert into public.sales_orders (clinic_id, patient_id, discount_amount, note, created_by)
      values (p_clinic_id, p_patient_id, p_discount_amount, nullif(btrim(p_note), ''), p_actor_user_id) returning id into v_order_id;
  end if;
  return v_order_id;
end;
$$;
revoke all on function public.create_sales_order(uuid, uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.create_sales_order(uuid, uuid, uuid, uuid, uuid, integer, text) to service_role;

create or replace function public.add_sales_order_item(
  p_clinic_id uuid, p_actor_user_id uuid, p_order_id uuid, p_kind text, p_reference_id uuid,
  p_name text, p_quantity numeric, p_unit_price integer
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_order record; v_item record; v_line_id uuid; v_name text; v_price integer;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role <> 'provider') then raise exception 'checkout actor is not allowed'; end if;
  if p_kind not in ('service', 'product', 'package', 'custom') or p_quantity <= 0 then raise exception 'invalid sales item'; end if;
  select * into v_order from public.sales_orders where id = p_order_id and clinic_id = p_clinic_id for update;
  if not found or v_order.status in ('paid', 'void') then raise exception 'sales order cannot be changed'; end if;
  if p_kind = 'product' then
    select name, retail_price into v_item from public.inventory_items where id = p_reference_id and clinic_id = p_clinic_id and active for update;
    if not found then raise exception 'inventory item not found'; end if;
    v_name := v_item.name; v_price := v_item.retail_price;
    perform public.record_inventory_movement(p_clinic_id, p_reference_id, 'sale', p_quantity, '銷售單 ' || v_order.order_no, p_actor_user_id);
  elsif p_kind = 'service' then
    select name, price into v_item from public.services where id = p_reference_id and clinic_id = p_clinic_id and active;
    if not found then raise exception 'service not found'; end if;
    v_name := v_item.name; v_price := v_item.price;
  elsif p_kind = 'package' then
    select name, price into v_item from public.membership_plans where id = p_reference_id and clinic_id = p_clinic_id and active;
    if not found then raise exception 'membership plan not found'; end if;
    v_name := v_item.name; v_price := v_item.price;
  else
    v_name := nullif(btrim(p_name), ''); v_price := p_unit_price;
    if v_name is null or v_price < 0 then raise exception 'custom sales item is invalid'; end if;
  end if;
  insert into public.sales_order_items (clinic_id, order_id, kind, reference_id, name, quantity, unit_price, line_total)
    values (p_clinic_id, p_order_id, p_kind, p_reference_id, v_name, p_quantity, v_price, round(p_quantity * v_price)::integer) returning id into v_line_id;
  perform public.recalculate_sales_order(p_clinic_id, p_order_id);
  return v_line_id;
end;
$$;
revoke all on function public.add_sales_order_item(uuid, uuid, uuid, text, uuid, text, numeric, integer) from public, anon, authenticated;
grant execute on function public.add_sales_order_item(uuid, uuid, uuid, text, uuid, text, numeric, integer) to service_role;

create or replace function public.record_sales_payment(
  p_clinic_id uuid, p_actor_user_id uuid, p_order_id uuid, p_method text, p_amount integer, p_reference text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_order record; v_payment_id uuid; v_new_paid integer;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role <> 'provider') then raise exception 'checkout actor is not allowed'; end if;
  if p_method not in ('cash', 'card', 'transfer', 'online', 'other') or p_amount <= 0 then raise exception 'invalid payment'; end if;
  select * into v_order from public.sales_orders where id = p_order_id and clinic_id = p_clinic_id for update;
  if not found or v_order.status in ('paid', 'void') then raise exception 'sales order cannot receive payment'; end if;
  if p_amount > v_order.total_amount - v_order.paid_amount then raise exception 'payment exceeds outstanding amount'; end if;
  insert into public.sales_payments (clinic_id, order_id, method, amount, reference, actor_id)
    values (p_clinic_id, p_order_id, p_method, p_amount, nullif(btrim(p_reference), ''), p_actor_user_id) returning id into v_payment_id;
  v_new_paid := v_order.paid_amount + p_amount;
  update public.sales_orders
     set paid_amount = v_new_paid,
         status = case when v_new_paid = total_amount then 'paid' else 'partially_paid' end,
         completed_at = case when v_new_paid = total_amount then now() else null end
   where id = p_order_id and clinic_id = p_clinic_id;
  return v_payment_id;
end;
$$;
revoke all on function public.record_sales_payment(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_sales_payment(uuid, uuid, uuid, text, integer, text) to service_role;

commit;
