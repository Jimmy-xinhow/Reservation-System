-- Keep the appointment deposit state constraint aligned with the existing
-- fail_appointment_payment lifecycle used by provider failures and expiry.
alter table public.appointments
  drop constraint if exists appointments_deposit_status_check;

alter table public.appointments
  add constraint appointments_deposit_status_check
  check (deposit_status in ('none', 'pending', 'paid', 'failed', 'waived', 'refunded'));
