begin;

-- Brand reports need only order summaries. Raw provider callbacks and their
-- signatures stay on the server-side service role, even for brand admins.
revoke all on table public.payment_orders,
  public.payment_transactions,
  public.payment_webhook_events
  from public, anon, authenticated;

grant select (id, clinic_id, merchant_order_no, created_at, status, amount)
  on public.payment_orders to authenticated;

grant all on table public.payment_orders,
  public.payment_transactions,
  public.payment_webhook_events
  to service_role;

notify pgrst, 'reload schema';
commit;
