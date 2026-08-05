-- v4 role matrix hardening
-- Run after migration_crm_lite.sql, migration_registration_payments.sql,
-- migration_v3_hardening.sql and migration_memberships_coupons.sql.
-- This migration is idempotent and narrows authenticated access without
-- changing service_role RPC permissions.

do $$
declare
  tbl text;
  policy_name text;
begin
  foreach tbl in array array[
    'clinics', 'clinic_settings', 'doctors', 'schedule_templates', 'schedule_exceptions',
    'patients', 'appointments', 'services', 'serving_numbers', 'patient_records',
    'line_auto_replies', 'line_messages', 'line_richmenu', 'reminder_logs',
    'chat_messages', 'chat_blocks',
    'crm_segments', 'crm_segment_members', 'crm_interactions', 'crm_automations', 'crm_delivery_logs',
    'clinic_domains', 'events', 'event_sessions', 'event_ticket_types', 'registration_forms',
    'registration_form_fields', 'registrations', 'registration_answers', 'waitlist_entries', 'checkins',
    'payment_orders', 'payment_transactions', 'payment_webhook_events', 'clinic_payment_settings',
    'appointment_status_events', 'appointment_notification_logs', 'registration_status_events', 'registration_notification_logs',
    'payment_status_events', 'membership_plans', 'patient_memberships', 'membership_ledger',
    'discount_codes', 'discount_redemptions'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', tbl);
    foreach policy_name in array array[
      tbl || '_member', tbl || '_read', tbl || '_manage', tbl || '_insert',
      tbl || '_provider_read', tbl || '_nonprovider_manage', tbl || '_provider_status_update',
      case when tbl = 'serving_numbers' then 'serving_member' else null end,
      case when tbl = 'line_auto_replies' then 'line_replies_member' else null end
    ] loop
      if policy_name is not null then
        execute format('drop policy if exists %I on public.%I', policy_name, tbl);
      end if;
    end loop;
  end loop;
end $$;

-- Base tenant tables: every member may read the brand context, but only
-- owner/admin may change it.
create policy clinics_read on clinics for select to authenticated
  using (id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
create policy clinics_manage on clinics for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = clinics.id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = clinics.id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

create policy clinic_settings_read on clinic_settings for select to authenticated
  using (
    clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and exists (
      select 1 from clinic_members cm
      where cm.clinic_id = clinic_settings.clinic_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner','admin','frontdesk','staff')
    )
  );
create policy clinic_settings_manage on clinic_settings for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = clinic_settings.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = clinic_settings.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

-- Provider-scoped operational tables.
create policy doctors_provider_read on doctors for select to authenticated
  using (
    doctors.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = doctors.clinic_id and da.doctor_id = doctors.id and da.user_id = auth.uid() and da.active)
    )
  );
create policy doctors_nonprovider_manage on doctors for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = doctors.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

create policy schedule_templates_provider_read on schedule_templates for select to authenticated
  using (
    schedule_templates.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_templates.clinic_id and da.doctor_id = schedule_templates.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy schedule_templates_nonprovider_manage on schedule_templates for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = schedule_templates.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = schedule_templates.doctor_id and d.clinic_id = schedule_templates.clinic_id and d.active)
  );

create policy schedule_exceptions_provider_read on schedule_exceptions for select to authenticated
  using (
    schedule_exceptions.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = schedule_exceptions.clinic_id and da.doctor_id = schedule_exceptions.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy schedule_exceptions_nonprovider_manage on schedule_exceptions for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = schedule_exceptions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = schedule_exceptions.doctor_id and d.clinic_id = schedule_exceptions.clinic_id and d.active)
  );

create policy patients_provider_read on patients for select to authenticated
  using (
    patients.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a
        join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patients.clinic_id and a.patient_id = patients.id and da.user_id = auth.uid() and da.active
      )
    )
  );
create policy patients_nonprovider_manage on patients for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = patients.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')));

create policy appointments_provider_read on appointments for select to authenticated
  using (
    appointments.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy appointments_nonprovider_manage on appointments for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = appointments.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = appointments.doctor_id and d.clinic_id = appointments.clinic_id and d.active)
    and exists (select 1 from patients p where p.id = appointments.patient_id and p.clinic_id = appointments.clinic_id)
    and (appointments.service_id is null or exists (select 1 from services s where s.id = appointments.service_id and s.clinic_id = appointments.clinic_id and s.active))
    and (appointments.template_id is null or exists (
      select 1 from schedule_templates t
       where t.id = appointments.template_id and t.clinic_id = appointments.clinic_id and t.doctor_id = appointments.doctor_id
      union all
      select 1 from schedule_exceptions e
       where e.id = appointments.template_id and e.clinic_id = appointments.clinic_id and e.doctor_id = appointments.doctor_id
    ))
  );
create policy appointments_provider_status_update on appointments for update to authenticated
  using (exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active))
  with check (
    appointments.status in ('done', 'no_show')
    and exists (select 1 from doctor_assignments da where da.clinic_id = appointments.clinic_id and da.doctor_id = appointments.doctor_id and da.user_id = auth.uid() and da.active)
  );

create policy services_read on services for select to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
create policy services_manage on services for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = services.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (exists (select 1 from clinic_members cm where cm.clinic_id = services.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

create policy serving_numbers_provider_read on serving_numbers for select to authenticated
  using (
    serving_numbers.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (select 1 from doctor_assignments da where da.clinic_id = serving_numbers.clinic_id and da.doctor_id = serving_numbers.doctor_id and da.user_id = auth.uid() and da.active)
    )
  );
create policy serving_numbers_nonprovider_manage on serving_numbers for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = serving_numbers.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from doctors d where d.id = serving_numbers.doctor_id and d.clinic_id = serving_numbers.clinic_id and d.active)
  );

create policy patient_records_provider_read on patient_records for select to authenticated
  using (
    patient_records.clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid())
    and (
      exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider')
      or exists (
        select 1 from appointments a
        join doctor_assignments da on da.clinic_id = a.clinic_id and da.doctor_id = a.doctor_id
        where a.clinic_id = patient_records.clinic_id and a.patient_id = patient_records.patient_id and da.user_id = auth.uid() and da.active
      )
    )
  );
create policy patient_records_nonprovider_manage on patient_records for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = patient_records.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from patients p where p.id = patient_records.patient_id and p.clinic_id = patient_records.clinic_id)
  );

-- Admin-only configuration and integration data.
do $$
declare tbl text;
begin
  foreach tbl in array array['line_auto_replies','line_messages','line_richmenu','clinic_domains','clinic_payment_settings'] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
    $policy$, tbl || '_read', tbl, tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
      with check (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
    $policy$, tbl || '_manage', tbl, tbl, tbl);
  end loop;
end $$;

-- Non-provider readers may inspect operational records. Writes are performed
-- by the protected server actions or service_role RPCs.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'reminder_logs','registrations','registration_answers','waitlist_entries','checkins',
    'payment_orders','payment_transactions','payment_webhook_events','patient_memberships',
    'membership_ledger','discount_redemptions','appointment_status_events','appointment_notification_logs','registration_status_events',
    'registration_notification_logs','payment_status_events','crm_delivery_logs'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
    $policy$, tbl || '_read', tbl, tbl, tbl);
  end loop;
end $$;

-- Event and form definitions, membership plans, CRM definitions: all
-- non-providers may read; only owner/admin may create or change them.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'events','event_sessions','event_ticket_types','registration_forms','registration_form_fields',
    'membership_plans','discount_codes','crm_segments','crm_segment_members','crm_automations'
  ] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
    $policy$, tbl || '_read', tbl, tbl, tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
      with check (exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
    $policy$, tbl || '_manage', tbl, tbl, tbl);
  end loop;
end $$;

-- Child-record tenant integrity: authenticated writes may not attach a record
-- to a parent object from another brand, even when the supplied clinic_id is valid.
drop policy if exists line_auto_replies_manage on line_auto_replies;
create policy line_auto_replies_manage on line_auto_replies for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = line_auto_replies.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = line_auto_replies.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and (line_auto_replies.message_id is null or exists (select 1 from line_messages m where m.id = line_auto_replies.message_id and m.clinic_id = line_auto_replies.clinic_id))
  );

drop policy if exists event_sessions_manage on event_sessions;
create policy event_sessions_manage on event_sessions for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = event_sessions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = event_sessions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from events e where e.id = event_sessions.event_id and e.clinic_id = event_sessions.clinic_id)
  );

drop policy if exists event_ticket_types_manage on event_ticket_types;
create policy event_ticket_types_manage on event_ticket_types for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = event_ticket_types.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = event_ticket_types.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from events e where e.id = event_ticket_types.event_id and e.clinic_id = event_ticket_types.clinic_id)
    and (event_ticket_types.membership_plan_id is null or exists (select 1 from membership_plans mp where mp.id = event_ticket_types.membership_plan_id and mp.clinic_id = event_ticket_types.clinic_id))
  );

drop policy if exists registration_forms_manage on registration_forms;
create policy registration_forms_manage on registration_forms for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = registration_forms.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = registration_forms.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from events e where e.id = registration_forms.event_id and e.clinic_id = registration_forms.clinic_id)
  );

drop policy if exists registration_form_fields_manage on registration_form_fields;
create policy registration_form_fields_manage on registration_form_fields for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = registration_form_fields.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = registration_form_fields.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from registration_forms f where f.id = registration_form_fields.form_id and f.clinic_id = registration_form_fields.clinic_id)
  );

drop policy if exists membership_plans_manage on membership_plans;
create policy membership_plans_manage on membership_plans for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = membership_plans.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = membership_plans.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and (membership_plans.service_id is null or exists (select 1 from services s where s.id = membership_plans.service_id and s.clinic_id = membership_plans.clinic_id))
  );

drop policy if exists crm_segment_members_manage on crm_segment_members;
create policy crm_segment_members_manage on crm_segment_members for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = crm_segment_members.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = crm_segment_members.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and exists (select 1 from crm_segments s where s.id = crm_segment_members.segment_id and s.clinic_id = crm_segment_members.clinic_id)
    and exists (select 1 from patients p where p.id = crm_segment_members.patient_id and p.clinic_id = crm_segment_members.clinic_id)
  );

drop policy if exists crm_automations_manage on crm_automations;
create policy crm_automations_manage on crm_automations for all to authenticated
  using (exists (select 1 from clinic_members cm where cm.clinic_id = crm_automations.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (
    exists (select 1 from clinic_members cm where cm.clinic_id = crm_automations.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin'))
    and (crm_automations.segment_id is null or exists (select 1 from crm_segments s where s.id = crm_automations.segment_id and s.clinic_id = crm_automations.clinic_id))
  );

-- CRM timeline notes can be appended by operational staff; no authenticated
-- role may rewrite or delete the timeline or delivery audit.
create policy crm_interactions_read on crm_interactions for select to authenticated
  using (
    clinic_id in (select cm0.clinic_id from clinic_members cm0 where cm0.user_id = auth.uid())
    and exists (select 1 from clinic_members cm where cm.clinic_id = crm_interactions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
  );
create policy crm_interactions_insert on crm_interactions for insert to authenticated
  with check (
    clinic_id in (select cm0.clinic_id from clinic_members cm0 where cm0.user_id = auth.uid())
    and exists (select 1 from clinic_members cm where cm.clinic_id = crm_interactions.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
    and exists (select 1 from public.patients p where p.id = crm_interactions.patient_id and p.clinic_id = crm_interactions.clinic_id)
    and (crm_interactions.appointment_id is null or exists (select 1 from public.appointments a where a.id = crm_interactions.appointment_id and a.clinic_id = crm_interactions.clinic_id and a.patient_id = crm_interactions.patient_id))
  );

-- Customer-service chat is operational data and is unavailable to providers.
do $$
declare tbl text;
begin
  foreach tbl in array array['chat_messages','chat_blocks'] loop
    if to_regclass(format('public.%I', tbl)) is null then continue; end if;
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
      with check (
        %I.clinic_id in (select cm0.clinic_id from public.clinic_members cm0 where cm0.user_id = auth.uid())
        and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role in ('owner','admin','frontdesk','staff'))
      )
    $policy$, tbl || '_manage', tbl, tbl, tbl, tbl, tbl);
  end loop;
end $$;
