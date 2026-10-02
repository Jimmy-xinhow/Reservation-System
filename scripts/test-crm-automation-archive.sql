-- Execute only against an isolated staging database. The nested block rolls
-- back its fixture via a caught, private SQLSTATE. The CLI accepts one statement.

do $$
declare
  fixture_clinic uuid := gen_random_uuid();
  fixture_patient uuid := gen_random_uuid();
  fixture_automation uuid := gen_random_uuid();
  delivery_id uuid;
  rejected_archived_active boolean := false;
  rejected_claim boolean := false;
  rejected_delete boolean := false;
  retained_count integer;
begin
  begin
  insert into public.clinics (id, name, slug, active)
  values (fixture_clinic, 'G303 CRM archive transaction fixture',
          'g303-crm-archive-' || replace(fixture_clinic::text, '-', ''), true);
  insert into public.patients (id, clinic_id, name, phone, active)
  values (fixture_patient, fixture_clinic, '合成顧客', '0900004303', true);
  insert into public.crm_automations
    (id, clinic_id, name, trigger_type, channel, body, active)
  values
    (fixture_automation, fixture_clinic, 'G303 合成規則', 'birthday', 'line', '合成訊息', true);

  delivery_id := public.claim_crm_delivery(
    fixture_clinic, fixture_automation, fixture_patient, 'g303:archive', 'line', null
  );
  if delivery_id is null then
    raise exception 'Initial delivery claim failed';
  end if;

  begin
    update public.crm_automations set archived_at = now() where id = fixture_automation;
  exception when check_violation then
    rejected_archived_active := true;
  end;
  if not rejected_archived_active then
    raise exception 'Archived automation remained active';
  end if;

  update public.crm_automations
  set active = false, archived_at = now()
  where id = fixture_automation;

  begin
    perform public.claim_crm_delivery(
      fixture_clinic, fixture_automation, fixture_patient, 'g303:after-archive', 'line', null
    );
  exception when raise_exception then
    rejected_claim := true;
  end;
  if not rejected_claim then
    raise exception 'Archived automation could claim a new delivery';
  end if;

  begin
    delete from public.crm_automations where id = fixture_automation;
  exception when foreign_key_violation then
    rejected_delete := true;
  end;
  if not rejected_delete then
    raise exception 'Automation deletion removed historical delivery';
  end if;

  select count(*) into retained_count
  from public.crm_delivery_logs
  where id = delivery_id and automation_id = fixture_automation and clinic_id = fixture_clinic;
  if retained_count <> 1 then
    raise exception 'Historical delivery was not retained';
  end if;
    raise exception using errcode = 'PT001', message = 'rollback archive fixture';
  exception when sqlstate 'PT001' then
    null;
  end;

  select count(*) into retained_count
  from public.clinics where name = 'G303 CRM archive transaction fixture';
  if retained_count <> 0 then
    raise exception 'Archive fixture did not roll back';
  end if;
  raise notice 'archive fixture passed: active guard, claim guard, FK guard, retained delivery, cleanup';
end;
$$;
