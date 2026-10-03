-- Keep the failed delivery audit while allowing an operator to close an obsolete
-- pending-payment notice without claiming that the provider delivered it.
begin;

alter table public.appointment_notification_logs
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_resolution text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_notification_logs'::regclass
      and conname = 'appointment_notification_review_complete'
  ) then
    alter table public.appointment_notification_logs
      add constraint appointment_notification_review_complete check (
        (reviewed_at is null and reviewed_by is null and review_resolution is null)
        or (reviewed_at is not null and reviewed_by is not null and review_resolution is not null
          and review_resolution = 'obsolete_no_resend'
          and status = 'failed' and kind = 'pending'
          and sent_at is null and provider_message_id is null)
      );
  end if;
end $$;

create index if not exists appointment_notification_logs_review_queue_idx
  on public.appointment_notification_logs (status, updated_at)
  where reviewed_at is null;

commit;
