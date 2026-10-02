begin;
create or replace function public.reconcile_registration_payment(p_clinic_id uuid,p_registration_id uuid,p_success boolean)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare r public.registrations%rowtype; next_status text; released boolean:=false;
begin
 if p_success is null then raise exception 'payment result is required'; end if;
 select * into r from public.registrations where clinic_id=p_clinic_id and id=p_registration_id for update;
 if not found then raise exception 'registration not found'; end if;
 if not p_success and r.payment_status='paid' then return r.id; end if;
 next_status:=r.status;
 if r.status in ('pending','confirmed') then
  if not p_success or (r.payment_status<>'paid' and r.expires_at is not null and r.expires_at<=now()) then
   next_status:='cancelled'; released:=true;
  elsif p_success then next_status:='confirmed'; end if;
 end if;
 update public.registrations set status=next_status,
  payment_status=case when p_success then 'paid' else 'failed' end,expires_at=null
 where clinic_id=p_clinic_id and id=r.id;
 if next_status='cancelled' then
  perform public.release_registration_benefits(p_clinic_id,r.id);
 elsif p_success and next_status='confirmed' then
  perform public.apply_registration_benefits(p_clinic_id,r.id);
 end if;
 if released then perform public.promote_waitlist_for_session(p_clinic_id,r.session_id); end if;
 return r.id;
end $$;
revoke all on function public.reconcile_registration_payment(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_registration_payment(uuid,uuid,boolean) to service_role;
commit;
