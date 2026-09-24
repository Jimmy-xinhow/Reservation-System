begin;
-- A typed ticket row must be populated with all columns, not a partial projection.
do $$
declare f record; definition text; matched integer := 0;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='register_for_event_with_benefits'
 loop
  matched := matched + 1;
  definition := pg_get_functiondef(f.oid);
  if position('ticket public.event_ticket_types%rowtype;' in definition)=0 then raise exception 'Expected typed ticket row'; end if;
  if position('select price,capacity,membership_plan_id into ticket from event_ticket_types' in definition)=0 and position('select * into ticket from event_ticket_types' in definition)=0 then raise exception 'Unexpected ticket projection'; end if;
  definition := replace(definition,'select price,capacity,membership_plan_id into ticket from event_ticket_types','select * into ticket from event_ticket_types');
  execute definition;
 end loop;
 if matched<>1 then raise exception 'Expected one registration function'; end if;
end $$;
commit;
