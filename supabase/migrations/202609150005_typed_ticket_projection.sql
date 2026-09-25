begin;
-- A typed ticket row must be populated with all columns, not a partial projection.
do $$
declare
 f record;
 definition text;
 matched integer := 0;
 old_count integer;
 new_count integer;
 old_pattern text := $old$select[[:space:]]+price[[:space:]]*,[[:space:]]*capacity[[:space:]]*,[[:space:]]*membership_plan_id[[:space:]]+into[[:space:]]+ticket[[:space:]]+from[[:space:]]+(public[.])?event_ticket_types$old$;
 new_pattern text := $new$select[[:space:]]+\*[[:space:]]+into[[:space:]]+ticket[[:space:]]+from[[:space:]]+(public[.])?event_ticket_types$new$;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='register_for_event_with_benefits'
 loop
  matched := matched + 1;
  definition := pg_get_functiondef(f.oid);
  if position('ticket public.event_ticket_types%rowtype;' in definition)=0 then raise exception 'Expected typed ticket row'; end if;
  select count(*) into old_count from regexp_matches(definition,old_pattern,'g');
  select count(*) into new_count from regexp_matches(definition,new_pattern,'g');
  if old_count=1 and new_count=0 then
   definition := regexp_replace(definition,old_pattern,'select * into ticket from public.event_ticket_types');
   execute definition;
  elsif old_count<>0 or new_count<>1 then
   raise exception 'Unexpected ticket projection: old %, new %',old_count,new_count;
  end if;
 end loop;
 if matched<>1 then raise exception 'Expected one registration function'; end if;
end $$;
commit;
