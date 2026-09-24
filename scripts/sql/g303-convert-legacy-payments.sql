-- One-off data conversion. Run only after an encrypted recovery snapshot is
-- freshly verified against these two production transactions. No schema change.
-- psql must use ON_ERROR_STOP=1; any failed guard aborts the transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Block concurrent payment writes while the complete population is checked.
lock table public.payment_orders, public.payment_transactions,
  public.payment_webhook_events, public.payment_status_events
  in share row exclusive mode;

create temporary table g303_payment_candidates on commit drop as
select
  o.id as order_id,
  t.id as transaction_id,
  w.id as webhook_id,
  o.provider_payload - 'last_event' as other_order_payload,
  jsonb_build_object(
    'receipt_version', 1,
    'provider', o.provider,
    'merchant_order_no', o.merchant_order_no,
    'provider_transaction_no', t.provider_transaction_no,
    'event_key', t.event_key,
    'success', true,
    'amount', o.amount,
    -- Fingerprint of the persisted PostgreSQL JSONB text, never raw HTTP bytes.
    'payload_sha256', encode(digest(t.payload::text, 'sha256'), 'hex')
  ) as receipt
from public.payment_transactions t
join public.payment_orders o on o.id = t.payment_order_id
join public.payment_webhook_events w
  on w.provider = o.provider and w.event_key = t.event_key
where jsonb_typeof(t.payload) = 'object'
  and t.payload <> '{}'::jsonb
  and t.payload -> 'receipt_version' is distinct from '1'::jsonb
  and jsonb_typeof(w.payload) = 'object'
  and w.payload = t.payload
  and o.provider_payload -> 'last_event' = t.payload
  and o.clinic_id = t.clinic_id
  and w.clinic_id = t.clinic_id
  and o.status = 'paid'
  and t.status = 'accepted'
  and o.provider in ('ecpay', 'newebpay')
  and o.amount > 0
  and exists (
    select 1 from public.payment_status_events e
    where e.clinic_id = o.clinic_id
      and e.payment_order_id = o.id
      and e.to_status = 'paid'
  );

do $$
declare
  v_count integer;
  v_affected integer;
begin
  select count(*) into v_count from g303_payment_candidates;
  if v_count <> 2
    or (select count(*) from public.payment_transactions
      where jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb
        and payload -> 'receipt_version' is distinct from '1'::jsonb) <> 2
    or (select count(*) from public.payment_webhook_events
      where jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb
        and payload -> 'receipt_version' is distinct from '1'::jsonb) <> 2
    or (select count(*) from public.payment_orders
      where jsonb_typeof(provider_payload -> 'last_event') = 'object'
        and provider_payload -> 'last_event' <> '{}'::jsonb
        and provider_payload -> 'last_event' -> 'receipt_version' is distinct from '1'::jsonb) <> 2
    or (select count(distinct order_id) from g303_payment_candidates) <> 2
    or (select count(distinct webhook_id) from g303_payment_candidates) <> 2
  then
    raise exception 'G3-03 legacy payment population drift; nothing was converted';
  end if;

  update public.payment_transactions t
  set payload = c.receipt
  from g303_payment_candidates c
  where t.id = c.transaction_id;
  get diagnostics v_affected = row_count;
  if v_affected <> 2 then raise exception 'G3-03 transaction update mismatch'; end if;

  update public.payment_webhook_events w
  set payload = c.receipt
  from g303_payment_candidates c
  where w.id = c.webhook_id;
  get diagnostics v_affected = row_count;
  if v_affected <> 2 then raise exception 'G3-03 webhook update mismatch'; end if;

  update public.payment_orders o
  set provider_payload = jsonb_set(o.provider_payload, '{last_event}', c.receipt, true)
  from g303_payment_candidates c
  where o.id = c.order_id;
  get diagnostics v_affected = row_count;
  if v_affected <> 2 then raise exception 'G3-03 order update mismatch'; end if;

  select count(*) into v_count
  from g303_payment_candidates c
  join public.payment_orders o on o.id = c.order_id
  join public.payment_transactions t on t.id = c.transaction_id
  join public.payment_webhook_events w on w.id = c.webhook_id
  where t.payload = c.receipt and w.payload = c.receipt
    and o.provider_payload -> 'last_event' = c.receipt
    and o.provider_payload - 'last_event' = c.other_order_payload
    and (select count(*) from jsonb_object_keys(c.receipt)) = 8
    and o.status = 'paid' and t.status = 'accepted'
    and exists (
      select 1 from public.payment_status_events e
      where e.clinic_id = o.clinic_id
        and e.payment_order_id = o.id
        and e.to_status = 'paid'
    );
  if v_count <> 2 then raise exception 'G3-03 payment conversion verification failed'; end if;

  if (select count(*) from public.payment_transactions
      where jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb
        and payload -> 'receipt_version' is distinct from '1'::jsonb) <> 0
    or (select count(*) from public.payment_webhook_events
      where jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb
        and payload -> 'receipt_version' is distinct from '1'::jsonb) <> 0
    or (select count(*) from public.payment_orders
      where jsonb_typeof(provider_payload -> 'last_event') = 'object'
        and provider_payload -> 'last_event' <> '{}'::jsonb
        and provider_payload -> 'last_event' -> 'receipt_version' is distinct from '1'::jsonb) <> 0
  then
    raise exception 'G3-03 legacy payload remained; conversion rolled back';
  end if;
end $$;

commit;
