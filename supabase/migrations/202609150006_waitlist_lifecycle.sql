begin;

create or replace function public.sync_cancelled_registration_waitlist()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
  update public.waitlist_entries set status='cancelled'
   where clinic_id=new.clinic_id and registration_id=new.id and status in ('waiting','offered');
 end if;
 return new;
end $$;
revoke all on function public.sync_cancelled_registration_waitlist() from public,anon,authenticated;
drop trigger if exists trg_sync_cancelled_registration_waitlist on public.registrations;
create trigger trg_sync_cancelled_registration_waitlist after update of status on public.registrations
for each row execute function public.sync_cancelled_registration_waitlist();

create or replace function public.promote_waitlist_after_appointment_cancel()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare target record;
begin
 if old.status in ('booked','confirmed','done') and new.status='cancelled' then
  -- Shared providers/resources can free capacity for another service or overlapping start.
  -- Each target still enters the existing atomic booking RPC before retaining a seat.
  for target in select target_key,min(created_at) as first_joined
   from public.appointment_waitlist_entries
   where clinic_id=old.clinic_id and requested_date=(old.start_at at time zone 'Asia/Taipei')::date
     and status='waiting'
   group by target_key order by first_joined,target_key
  loop
   begin
    perform public.offer_next_appointment_waitlist(old.clinic_id,target.target_key,15);
   exception when others then
    insert into public.appointment_waitlist_events(clinic_id,target_key,kind,from_status,to_status,appointment_id,error)
    values(old.clinic_id,target.target_key,'promotion_failed',old.status,new.status,old.id,sqlerrm);
   end;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.promote_waitlist_after_appointment_cancel() from public,anon,authenticated;

-- Preserve the quoted ticket amount while waiting; promotion decides payment state.
do $$
declare
 f record;
 definition text;
 matched integer:=0;
 old_count integer;
 new_count integer;
 old_pattern text:=$old$v_status[[:space:]]*:=[[:space:]]*'waitlisted';[[:space:]]*v_payment_status[[:space:]]*:=[[:space:]]*'not_required';$old$;
 new_pattern text:=$new$v_status[[:space:]]*:=[[:space:]]*'waitlisted';[[:space:]]*v_amount[[:space:]]*:=[[:space:]]*v_original;[[:space:]]*v_payment_status[[:space:]]*:=[[:space:]]*'not_required';$new$;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='register_for_event_with_benefits'
 loop
  matched:=matched+1; definition:=pg_get_functiondef(f.oid);
  select count(*) into old_count from regexp_matches(definition,old_pattern,'g');
  select count(*) into new_count from regexp_matches(definition,new_pattern,'g');
  if old_count=1 and new_count=0 then
   definition:=regexp_replace(definition,old_pattern,
    $replacement$v_status := 'waitlisted'; v_amount := v_original; v_payment_status := 'not_required';$replacement$);
   execute definition;
  elsif old_count<>0 or new_count<>1 then
   raise exception 'Unexpected waitlist amount definition: old %, new %',old_count,new_count;
  end if;
 end loop;
 if matched<>1 then raise exception 'Expected one registration function'; end if;
end $$;
commit;
