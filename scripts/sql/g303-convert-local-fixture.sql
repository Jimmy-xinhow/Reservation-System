create extension if not exists pgcrypto;

create table public.payment_orders (
  id uuid primary key, clinic_id uuid not null, provider text not null,
  merchant_order_no text not null, amount integer not null, status text not null,
  provider_payload jsonb not null
);
create table public.payment_transactions (
  id uuid primary key, clinic_id uuid not null, payment_order_id uuid not null,
  event_key text not null, status text not null, provider_transaction_no text,
  payload jsonb not null
);
create table public.payment_webhook_events (
  id uuid primary key, clinic_id uuid, provider text not null,
  event_key text not null, payload jsonb not null
);
create table public.payment_status_events (
  id uuid primary key, clinic_id uuid not null,
  payment_order_id uuid not null, to_status text not null
);

insert into public.payment_orders values
('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
 'ecpay', 'G303-SYNTH-A', 100, 'paid',
 '{"last_event":{"TradeNo":"synthetic-a","CheckMacValue":"synthetic-signature-a","RtnCode":"1"},"other_key":"preserve-a"}'),
('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002',
 'newebpay', 'G303-SYNTH-B', 200, 'paid',
 '{"last_event":{"TradeNo":"synthetic-b","CheckCode":"synthetic-signature-b","Status":"SUCCESS"},"other_key":"preserve-b"}'),
('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001',
 'ecpay', 'G303-SYNTH-PENDING', 300, 'pending', '{"other_key":"untouched"}');

insert into public.payment_transactions values
('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011', 'synthetic-event-a', 'accepted', 'synthetic-tx-a',
 '{"TradeNo":"synthetic-a","CheckMacValue":"synthetic-signature-a","RtnCode":"1"}'),
('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000012', 'synthetic-event-b', 'accepted', 'synthetic-tx-b',
 '{"TradeNo":"synthetic-b","CheckCode":"synthetic-signature-b","Status":"SUCCESS"}');

insert into public.payment_webhook_events values
('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001',
 'ecpay', 'synthetic-event-a',
 '{"TradeNo":"synthetic-a","CheckMacValue":"synthetic-signature-a","RtnCode":"1"}'),
('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000002',
 'newebpay', 'synthetic-event-b',
 '{"TradeNo":"synthetic-b","CheckCode":"synthetic-signature-b","Status":"SUCCESS"}');

insert into public.payment_status_events values
('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011', 'paid'),
('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000012', 'paid');

create table public.g303_recovery_snapshot as
select o.id as order_id, o.provider_payload,
  t.id as transaction_id, t.payload as transaction_payload,
  w.id as webhook_id, w.payload as webhook_payload
from public.payment_orders o
join public.payment_transactions t on t.payment_order_id = o.id
join public.payment_webhook_events w
  on w.provider = o.provider and w.event_key = t.event_key;
