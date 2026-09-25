begin;

create or replace function public.sanitize_data_import_error_summary()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_item jsonb;
  v_row_text text;
  v_row integer;
  v_reason text;
  v_safe jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(new.error_summary) is distinct from 'array' then
    new.error_summary := '[]'::jsonb;
    return new;
  end if;

  -- Counts remain in failed_rows; retain the first 100 actionable row reasons.
  for v_item in
    select item from jsonb_array_elements(new.error_summary) with ordinality as errors(item, position)
    where position <= 100
  loop
    v_row_text := case when jsonb_typeof(v_item) = 'object' then v_item ->> 'row' else null end;
    v_row := case when v_row_text ~ '^[0-9]{1,3}$' then least(v_row_text::integer, 500) else 0 end;
    v_reason := case when jsonb_typeof(v_item) = 'object' then v_item ->> 'reason' else null end;
    if v_reason not in (
      'row must be an object', 'invalid name', 'invalid phone',
      'phone patient limit reached', 'service already exists',
      'patient not found', 'membership plan not found', 'credits must be positive',
      'import row failed', 'import job failed'
    ) or v_reason is null then
      v_reason := case when v_row = 0 then 'import job failed' else 'import row failed' end;
    end if;
    v_safe := v_safe || jsonb_build_array(jsonb_build_object('row', v_row, 'reason', v_reason));
  end loop;
  new.error_summary := v_safe;
  return new;
end;
$$;

revoke all on function public.sanitize_data_import_error_summary() from public, anon, authenticated;
grant execute on function public.sanitize_data_import_error_summary() to service_role;

drop trigger if exists trg_data_import_jobs_safe_errors on public.data_import_jobs;
create trigger trg_data_import_jobs_safe_errors
before insert or update of error_summary on public.data_import_jobs
for each row execute function public.sanitize_data_import_error_summary();

commit;
