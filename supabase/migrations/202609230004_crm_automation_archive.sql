begin;

-- Keep the rule row behind every historical delivery. Archiving stops future
-- runs without deleting the audit trail; existing rows start unarchived.
alter table public.crm_automations add column if not exists archived_at timestamptz;
alter table public.crm_automations drop constraint if exists crm_automations_archived_inactive_check;
alter table public.crm_automations
  add constraint crm_automations_archived_inactive_check
  check (archived_at is null or active = false) not valid;
alter table public.crm_automations validate constraint crm_automations_archived_inactive_check;

alter table public.crm_delivery_logs drop constraint if exists crm_delivery_logs_automation_id_fkey;
alter table public.crm_delivery_logs
  add constraint crm_delivery_logs_automation_id_fkey
  foreign key (automation_id) references public.crm_automations(id)
  on delete restrict not valid;
alter table public.crm_delivery_logs validate constraint crm_delivery_logs_automation_id_fkey;

create or replace function public.claim_crm_delivery(
  p_clinic_id uuid, p_automation_id uuid, p_patient_id uuid,
  p_trigger_key text, p_channel text, p_appointment_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.crm_automations
    where id = p_automation_id and clinic_id = p_clinic_id
      and active and archived_at is null
  ) or not exists (
    select 1 from public.patients
    where id = p_patient_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'CRM 資料不屬於指定租戶或規則已停用';
  end if;
  insert into public.crm_delivery_logs(
    clinic_id, automation_id, patient_id, appointment_id, trigger_key, channel
  ) values (
    p_clinic_id, p_automation_id, p_patient_id, p_appointment_id, p_trigger_key, p_channel
  ) on conflict (automation_id, patient_id, trigger_key, channel) do update
    set status = 'pending', error = null,
        attempt_count = crm_delivery_logs.attempt_count + 1,
        attempted_at = now()
    where crm_delivery_logs.status = 'failed'
      and crm_delivery_logs.attempted_at < now() - interval '10 minutes'
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.claim_crm_delivery(uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_crm_delivery(uuid, uuid, uuid, text, text, uuid)
  to service_role;

commit;
