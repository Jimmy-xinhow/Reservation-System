begin;
-- Keep provider and resource bookings on the same customer/day lock.
-- Initialize optional ticket fields even when no ticket type is selected.
do $$
declare f record; definition text; matched integer := 0;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('book_service_slot','book_service_session','register_for_event_with_benefits')
  loop
    matched := matched + 1;
    definition := pg_get_functiondef(f.oid);
    if f.proname = 'register_for_event_with_benefits' then
      if position('ticket record;' in definition)=0 and position('ticket public.event_ticket_types%rowtype;' in definition)=0 then raise exception 'Unexpected registration function definition'; end if;
      definition := replace(definition, 'ticket record;', 'ticket public.event_ticket_types%rowtype;');
    else
      if position('hashtext(''customer:'' ' in definition)=0 and position('hashtext(''patient:'' ' in definition)=0 then raise exception 'Unexpected booking function definition'; end if;
      definition := replace(definition, 'hashtext(''customer:'' ', 'hashtext(''patient:'' ');
    end if;
    execute definition;
  end loop;
  if matched <> 3 then raise exception 'Expected three transaction functions'; end if;
end $$;
commit;
