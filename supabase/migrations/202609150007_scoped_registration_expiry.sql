begin;
create or replace function public.expire_registration_payments_for_clinic(p_clinic_id uuid)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare n integer; session_row record;
begin
 if p_clinic_id is null then raise exception 'clinic is required'; end if;
 with expired_orders as (
  update public.payment_orders po set status='expired',updated_at=now()
   from public.registrations r
   where po.registration_id=r.id and po.clinic_id=p_clinic_id and r.clinic_id=p_clinic_id
    and po.status='pending' and r.status='pending' and r.payment_status='pending'
    and r.expires_at is not null and r.expires_at<=now()
   returning po.id,po.clinic_id
 ) insert into public.payment_status_events(clinic_id,payment_order_id,from_status,to_status,source)
 select clinic_id,id,'pending','expired','registration_expiry' from expired_orders;
 update public.registrations set status='cancelled',payment_status='expired',expires_at=null
 where clinic_id=p_clinic_id and status='pending' and payment_status='pending' and expires_at is not null and expires_at<=now();
 get diagnostics n=row_count;
 for session_row in select distinct session_id from public.registrations
  where clinic_id=p_clinic_id and status='cancelled' and payment_status='expired' and updated_at>=now()-interval '2 minutes'
 loop
  perform public.promote_waitlist_for_session(p_clinic_id,session_row.session_id);
 end loop;
 return n;
end $$;
create or replace function public.expire_registration_payments()
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare brand record; n integer:=0;
begin
 for brand in select distinct clinic_id from public.registrations
 where (status='pending' and payment_status='pending' and expires_at is not null and expires_at<=now())
    or (status='cancelled' and payment_status='expired' and updated_at>=now()-interval '2 minutes')
 order by clinic_id
 loop
  n:=n+public.expire_registration_payments_for_clinic(brand.clinic_id);
 end loop;
 return n;
end $$;
revoke all on function public.expire_registration_payments_for_clinic(uuid) from public,anon,authenticated;
revoke all on function public.expire_registration_payments() from public,anon,authenticated;
grant execute on function public.expire_registration_payments_for_clinic(uuid) to service_role;
grant execute on function public.expire_registration_payments() to service_role;
commit;
