-- A fully paid checkout order must unlock its source registration in the same transaction.
create or replace function public.record_sales_payment(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_order_id uuid,
  p_method text,
  p_amount integer,
  p_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_payment_id uuid;
  v_new_paid integer;
begin
  if not exists (
    select 1
      from public.clinic_members member
     where member.clinic_id = p_clinic_id
       and member.user_id = p_actor_user_id
       and member.role <> 'provider'
  ) then
    raise exception 'checkout actor is not allowed';
  end if;
  if p_method not in ('cash', 'card', 'transfer', 'online', 'other') or p_amount <= 0 then
    raise exception 'invalid payment';
  end if;

  select *
    into v_order
    from public.sales_orders
   where id = p_order_id
     and clinic_id = p_clinic_id
   for update;
  if not found or v_order.status in ('paid', 'void') then
    raise exception 'sales order cannot receive payment';
  end if;
  if p_amount > v_order.total_amount - v_order.paid_amount then
    raise exception 'payment exceeds outstanding amount';
  end if;
  if v_order.registration_id is not null and not exists (
    select 1
      from public.registrations registration
     where registration.id = v_order.registration_id
       and registration.clinic_id = p_clinic_id
       and registration.status in ('pending', 'confirmed', 'attended')
  ) then
    raise exception 'registration is not eligible for checkout payment';
  end if;

  insert into public.sales_payments (clinic_id, order_id, method, amount, reference, actor_id)
    values (p_clinic_id, p_order_id, p_method, p_amount, nullif(btrim(p_reference), ''), p_actor_user_id)
    returning id into v_payment_id;

  v_new_paid := v_order.paid_amount + p_amount;
  update public.sales_orders
     set paid_amount = v_new_paid,
         status = case when v_new_paid = total_amount then 'paid' else 'partially_paid' end,
         completed_at = case when v_new_paid = total_amount then now() else null end
   where id = p_order_id
     and clinic_id = p_clinic_id;

  if v_new_paid = v_order.total_amount and v_order.registration_id is not null then
    update public.registrations
       set payment_status = 'paid',
           status = case when status = 'pending' then 'confirmed' else status end
     where id = v_order.registration_id
       and clinic_id = p_clinic_id
       and status in ('pending', 'confirmed', 'attended');
  end if;

  return v_payment_id;
end;
$$;

revoke all on function public.record_sales_payment(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_sales_payment(uuid, uuid, uuid, text, integer, text) to service_role;

-- Repair already-settled checkout orders created before the transactional synchronization.
update public.registrations registration
   set payment_status = 'paid',
       status = case when registration.status = 'pending' then 'confirmed' else registration.status end
  from public.sales_orders sales_order
 where sales_order.clinic_id = registration.clinic_id
   and sales_order.registration_id = registration.id
   and sales_order.status = 'paid'
   and registration.status in ('pending', 'confirmed', 'attended')
   and registration.payment_status <> 'paid';
