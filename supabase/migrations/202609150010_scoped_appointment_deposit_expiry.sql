begin;
create or replace function expire_pending_appointment_deposits_for_clinic(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a record;
  order_row record;
  n integer := 0;
begin
  if p_clinic_id is null then raise exception 'clinic is required'; end if;
  for a in
    select id, clinic_id
      from appointments
     where clinic_id = p_clinic_id and deposit_status = 'pending'
       and deposit_expires_at is not null
       and deposit_expires_at <= now()
       and status in ('booked', 'confirmed')
     for update skip locked
  loop
    perform fail_appointment_payment(a.clinic_id, a.id, 'appointment deposit expired');
    for order_row in
      update payment_orders
         set status = 'expired', updated_at = now()
       where appointment_id = a.id and clinic_id = a.clinic_id and status = 'pending'
       returning id
    loop
      insert into payment_status_events (clinic_id, payment_order_id, from_status, to_status, source)
        values (a.clinic_id, order_row.id, 'pending', 'expired', 'appointment_deposit_expiry');
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;


create or replace function public.expire_pending_appointment_deposits()
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare brand record; n integer:=0;
begin
 for brand in select distinct clinic_id from public.appointments
 where deposit_status='pending' and deposit_expires_at<=now() and status in ('booked','confirmed')
 order by clinic_id
 loop
  n:=n+public.expire_pending_appointment_deposits_for_clinic(brand.clinic_id);
 end loop;
 return n;
end $$;
revoke all on function public.expire_pending_appointment_deposits_for_clinic(uuid) from public,anon,authenticated;
grant execute on function public.expire_pending_appointment_deposits_for_clinic(uuid) to service_role;
revoke all on function public.expire_pending_appointment_deposits() from public,anon,authenticated;
grant execute on function public.expire_pending_appointment_deposits() to service_role;
commit;
