begin;

-- NULL credits identifies historical orders whose original terms are unknown.
-- NULL valid_days on a captured order means no expiry, never a live-plan fallback.
alter table public.payment_orders
  add column if not exists membership_credits_snapshot integer
    check (membership_credits_snapshot is null or membership_credits_snapshot > 0),
  add column if not exists membership_valid_days_snapshot integer
    check (membership_valid_days_snapshot is null or membership_valid_days_snapshot > 0);

create or replace function public.capture_membership_purchase_terms()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare plan_row record;
begin
  if TG_OP = 'UPDATE' then
    if new.membership_credits_snapshot is distinct from old.membership_credits_snapshot
      or new.membership_valid_days_snapshot is distinct from old.membership_valid_days_snapshot then
      raise exception 'membership purchase snapshot is immutable';
    end if;
    if old.membership_credits_snapshot is not null and
      (new.clinic_id is distinct from old.clinic_id
       or new.membership_plan_id is distinct from old.membership_plan_id
       or new.patient_id is distinct from old.patient_id
       or new.amount is distinct from old.amount) then
      raise exception 'membership purchase subject and amount are immutable';
    end if;
    return new;
  end if;
  if new.membership_plan_id is null then
    new.membership_credits_snapshot := null;
    new.membership_valid_days_snapshot := null;
    return new;
  end if;
  select plan.credits_total, plan.valid_days into plan_row
    from public.membership_plans plan
   where plan.id = new.membership_plan_id and plan.clinic_id = new.clinic_id and plan.active
   for share;
  if not found then raise exception 'membership plan not found or inactive'; end if;
  new.membership_credits_snapshot := plan_row.credits_total;
  new.membership_valid_days_snapshot := plan_row.valid_days;
  return new;
end;
$$;
revoke all on function public.capture_membership_purchase_terms() from public, anon, authenticated;
drop trigger if exists payment_orders_membership_purchase_terms on public.payment_orders;
create trigger payment_orders_membership_purchase_terms
before insert or update on public.payment_orders
for each row execute function public.capture_membership_purchase_terms();

create or replace function public.grant_paid_membership_from_order(
  p_clinic_id uuid,
  p_payment_order_id uuid
)
returns table (membership_id uuid, membership_code text, expires_at timestamptz, credits_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_row record;
  existing record;
  v_id uuid;
  v_code text;
  v_expires timestamptz;
begin
  select payment_order.id, payment_order.status, payment_order.clinic_id, payment_order.patient_id, payment_order.membership_plan_id, payment_order.membership_credits_snapshot, payment_order.membership_valid_days_snapshot
    into order_row
    from public.payment_orders payment_order
   where payment_order.id = p_payment_order_id and payment_order.clinic_id = p_clinic_id
   for update;
  if not found or order_row.membership_plan_id is null or order_row.patient_id is null then
    raise exception 'membership payment order not found';
  end if;
  if order_row.status <> 'paid' then raise exception 'membership payment is not paid'; end if;
  select membership.id, membership.membership_code, membership.expires_at, membership.credits_remaining
    into existing
    from public.patient_memberships membership
   where membership.payment_order_id = p_payment_order_id;
  if found then
    return query select existing.id, existing.membership_code, existing.expires_at, existing.credits_remaining;
    return;
  end if;
  if order_row.membership_credits_snapshot is null then
    raise exception 'membership purchase snapshot missing; manual review required';
  end if;
  if not exists (
    select 1 from public.patients patient
     where patient.id = order_row.patient_id and patient.clinic_id = p_clinic_id and patient.active
  ) then raise exception 'patient not found'; end if;
  if order_row.membership_valid_days_snapshot is not null then
    v_expires := now() + (order_row.membership_valid_days_snapshot || ' days')::interval;
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    exit when not exists (
      select 1 from public.patient_memberships membership
       where membership.clinic_id = p_clinic_id and membership.membership_code = v_code
    );
  end loop;
  insert into public.patient_memberships
    (clinic_id, patient_id, plan_id, payment_order_id, membership_code, credits_total, credits_remaining, starts_at, expires_at, source, note)
  values
    (p_clinic_id, order_row.patient_id, order_row.membership_plan_id, p_payment_order_id, v_code, order_row.membership_credits_snapshot, order_row.membership_credits_snapshot, now(), v_expires, 'purchase', 'membership payment purchase')
  returning id into v_id;
  insert into public.membership_ledger
    (clinic_id, membership_id, patient_id, kind, credits_delta, reference_type, reference_id, note)
  values
    (p_clinic_id, v_id, order_row.patient_id, 'grant', order_row.membership_credits_snapshot, 'payment_order', p_payment_order_id, 'membership payment purchase');
  return query select v_id, v_code, v_expires, order_row.membership_credits_snapshot;
end;
$$;

commit;
