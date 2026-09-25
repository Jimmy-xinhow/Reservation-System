begin;
do $$
declare f record; definition text; matched integer:=0;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='promote_waitlist_for_session'
 loop
  matched:=matched+1;definition:=pg_get_functiondef(f.oid);
  if position('if s.end_at <= now() then return 0; end if;' in definition)=0 then
   if position('if not found then raise exception ''找不到場次''; end if;' in definition)=0 then raise exception 'Unexpected promotion function'; end if;
   definition:=replace(definition,'if not found then raise exception ''找不到場次''; end if;',
    'if not found then raise exception ''找不到場次''; end if; if s.end_at <= now() then return 0; end if;');
   execute definition;
  end if;
 end loop;
 if matched<>1 then raise exception 'Expected one promotion function'; end if;
end $$;
commit;
