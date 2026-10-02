-- Preserve Resend's accepted email ID for exact appointment notification reconciliation.
-- Apply before deploying Web code that writes provider_message_id.
begin;

alter table public.appointment_notification_logs
  add column if not exists provider_message_id text;

commit;
