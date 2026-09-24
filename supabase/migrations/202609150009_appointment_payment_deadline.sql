begin;
-- Preserve the payment outcome without reviving cancelled or expired reservations.
create or replace function public.confirm_appointment_payment(p_clinic_id uuid, p_appointment_id uuid)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare a public.appointments%rowtype;
begin
 select * into a from public.appointments
 where clinic_id=p_clinic_id and id=p_appointment_id for update;
 if not found then raise exception 'appointment not found'; end if;
 if a.deposit_status='paid' then return a.id; end if;
 if a.status in ('booked','confirmed') and a.deposit_expires_at is not null
    and a.deposit_expires_at<=now() then
  perform public.fail_appointment_payment(p_clinic_id,a.id,'payment received after deposit deadline');
  a.status:='cancelled';
 end if;
 update public.appointments set deposit_status='paid',deposit_expires_at=null,
  status=case when a.status in ('booked','confirmed') then 'confirmed' else a.status end
 where clinic_id=p_clinic_id and id=a.id;
 return a.id;
end $$;
revoke all on function public.confirm_appointment_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_appointment_payment(uuid,uuid) to service_role;
commit;
