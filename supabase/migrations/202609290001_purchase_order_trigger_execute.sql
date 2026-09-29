begin;

-- Trigger execution is controlled by the table write path. The trigger
-- function must not be callable as a public PostgREST RPC.
revoke all on function public.assert_purchase_order_item_draft()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
