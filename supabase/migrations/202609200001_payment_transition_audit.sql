begin;

-- Only called after server-side gateway signature verification.
create or replace function transition_verified_payment(
  p_clinic_id uuid, p_order_id uuid, p_provider text,
  p_expected_status text, p_success boolean, p_amount integer,
  p_merchant_order_no text, p_event_key text, p_payload jsonb
) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_order payment_orders%rowtype;
  v_next text := case when p_success then 'paid' else 'failed' end;
begin
  select * into v_order from payment_orders
  where id = p_order_id and clinic_id = p_clinic_id and provider = p_provider
  for update;
  if not found then raise exception '找不到付款訂單'; end if;
  if p_success is null or p_amount is null or v_order.amount <> p_amount
     or nullif(p_event_key, '') is null or nullif(p_merchant_order_no, '') is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception '付款回呼欄位錯誤';
  end if;
  if v_order.merchant_order_no <> p_merchant_order_no
     and not coalesce(v_order.provider_payload -> '_merchant_order_history' @> jsonb_build_array(p_merchant_order_no), false) then
    raise exception '付款訂單編號不符';
  end if;
  if v_order.status is distinct from p_expected_status then return false; end if;
  if v_order.status <> 'pending' and not (
    v_order.status = 'expired' and p_success
    and (v_order.appointment_id is not null or v_order.registration_id is not null)
  ) then return false; end if;

  update payment_orders set status = v_next,
    provider_payload = coalesce(provider_payload, '{}'::jsonb) || jsonb_build_object(
      'last_merchant_order_no', p_merchant_order_no, 'last_event', p_payload),
    updated_at = now()
  where id = v_order.id and clinic_id = p_clinic_id;
  insert into payment_status_events
    (clinic_id, payment_order_id, from_status, to_status, source, provider_event_key)
  values (p_clinic_id, v_order.id, v_order.status, v_next, p_provider || '_webhook', p_event_key);
  return true;
end;
$$;

revoke all on function transition_verified_payment(uuid, uuid, text, text, boolean, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function transition_verified_payment(uuid, uuid, text, text, boolean, integer, text, text, jsonb) to service_role;

commit;
