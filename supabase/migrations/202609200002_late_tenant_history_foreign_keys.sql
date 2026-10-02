begin;
-- Later-created tables missed the earlier tenant-history foreign-key hardening.
-- Preserve the existing FK definition except for its delete action.
do $$
declare fk record; matched integer := 0;
begin
  for fk in
    select c.conname, c.confdeltype, c.conrelid::regclass as relation, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and c.confrelid = 'public.clinics'::regclass
      and n.nspname = 'public'
      and t.relname in ('admin_product_events','appointment_series','channel_test_runs','clinic_activation_metrics',
        'data_import_jobs','feature_interest_signals','handoff_tasks','service_addons','trial_brand_observations')
  loop
    matched := matched + 1;
    if fk.confdeltype = 'c' then
      execute format('alter table %s drop constraint %I', fk.relation, fk.conname);
      execute format('alter table %s add constraint %I %s', fk.relation, fk.conname,
        replace(fk.definition, 'ON DELETE CASCADE', 'ON DELETE RESTRICT'));
    elsif fk.confdeltype <> 'r' then
      raise exception 'Unexpected tenant foreign-key delete action on %', fk.relation;
    end if;
  end loop;
  if matched <> 9 then raise exception 'Expected nine tenant-history foreign keys, found %', matched; end if;
end;
$$;
commit;
