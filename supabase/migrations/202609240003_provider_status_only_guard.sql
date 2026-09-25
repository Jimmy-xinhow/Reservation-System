-- A provider may complete an assigned appointment, but may not edit any other
-- field while doing so. Compare the whole row so new columns are protected.
create or replace function public.prevent_provider_appointment_writes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if exists (
    select 1 from public.clinic_members member
    where member.clinic_id = old.clinic_id
      and member.user_id = auth.uid()
      and member.role = 'provider'
  ) then
    if not exists (
      select 1 from public.doctor_assignments assignment
      where assignment.clinic_id = old.clinic_id
        and assignment.doctor_id = old.doctor_id
        and assignment.user_id = auth.uid()
        and assignment.active
    ) then
      raise exception '服務提供者未被指派此醫師';
    end if;
    if (to_jsonb(new) - array['status', 'updated_at']::text[])
       is distinct from (to_jsonb(old) - array['status', 'updated_at']::text[])
       or new.status not in ('done', 'no_show')
       or old.status not in ('booked', 'confirmed') then
      raise exception '服務提供者只能將已指派預約標記為完成或未到';
    end if;
  end if;
  return new;
end;
$$;
