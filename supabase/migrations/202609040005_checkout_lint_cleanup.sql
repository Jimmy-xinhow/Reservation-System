-- Keep the checkout function warning-free without changing its behavior.
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
  v_order_id uuid; v_existing uuid; v_total integer := 0; v_paid integer := 0;
  v_appointment record; v_registration record; v_addon jsonb; v_addon_price integer; v_item_name text;
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
