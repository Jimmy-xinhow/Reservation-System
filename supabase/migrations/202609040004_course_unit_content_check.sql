-- Quiz and assignment content is stored in course_assessments, so those unit
-- types do not require course_units.content_url or course_units.body.

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_name.conname
    from pg_constraint as constraint_name
    where constraint_name.conrelid = 'public.course_units'::regclass
      and constraint_name.contype = 'c'
      and pg_get_constraintdef(constraint_name.oid) ilike '%content_url is not null%'
      and pg_get_constraintdef(constraint_name.oid) ilike '%body is not null%'
  loop
    execute format('alter table public.course_units drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

alter table public.course_units
  add constraint course_units_content_check
  check (unit_type in ('quiz','assignment') or content_url is not null or body is not null);
