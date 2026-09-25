begin;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_data_import_jobs_safe_errors'
      and tgrelid = 'public.data_import_jobs'::regclass
      and not tgisinternal
  ) then raise exception 'safe import trigger missing'; end if;
  if has_function_privilege('anon', 'public.sanitize_data_import_error_summary()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.sanitize_data_import_error_summary()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.sanitize_data_import_error_summary()', 'EXECUTE')
  then raise exception 'safe import trigger function privileges wrong'; end if;
end;
$$;

create temporary table import_error_fixture(error_summary jsonb not null);
create trigger import_error_fixture_safe
before insert or update of error_summary on import_error_fixture
for each row execute function public.sanitize_data_import_error_summary();

insert into import_error_fixture(error_summary) values (
  '[{"row":1,"reason":"duplicate key Authorization=Bearer SYNTHETIC_SECRET"},{"row":2,"reason":"invalid phone"}]'::jsonb
);

do $$
declare v_result jsonb;
begin
  select error_summary into v_result from import_error_fixture limit 1;
  if v_result #>> '{0,reason}' <> 'import row failed'
    or v_result #>> '{1,reason}' <> 'invalid phone'
    or v_result::text like '%SYNTHETIC_SECRET%'
  then raise exception 'raw import error was retained'; end if;
end;
$$;

update import_error_fixture
set error_summary = (
  select jsonb_agg(jsonb_build_object('row', ord, 'reason', 'unknown Authorization=Bearer SYNTHETIC_SECRET'))
  from generate_series(1, 105) ord
);

do $$
declare v_result jsonb;
begin
  select error_summary into v_result from import_error_fixture limit 1;
  if jsonb_array_length(v_result) <> 100 or v_result::text like '%SYNTHETIC_SECRET%'
  then raise exception 'error summary cap or redaction failed'; end if;
end;
$$;

rollback;
