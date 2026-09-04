-- Customer value accounts, subscriptions, safe customer merge and scheduled follow-ups.
begin;

alter table public.patients add column if not exists merged_into_patient_id uuid references public.patients(id) on delete restrict;
alter table public.patients add column if not exists merged_at timestamptz;
create index if not exists patients_merged_into_idx on public.patients (clinic_id, merged_into_patient_id) where merged_into_patient_id is not null;

create table if not exists public.customer_wallets (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict, balance integer not null default 0 check (balance >= 0),
  lifetime_credit integer not null default 0 check (lifetime_credit >= 0), lifetime_debit integer not null default 0 check (lifetime_debit >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (clinic_id, patient_id)
);
create table if not exists public.customer_wallet_ledger (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  wallet_id uuid not null references public.customer_wallets(id) on delete restrict, patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('top_up','purchase','refund','adjust','merge')), amount_delta integer not null check (amount_delta <> 0),
  balance_after integer not null check (balance_after >= 0), sales_order_id uuid references public.sales_orders(id) on delete restrict,
  idempotency_key text, note text, actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create unique index if not exists customer_wallet_ledger_idempotency_idx on public.customer_wallet_ledger (clinic_id, idempotency_key) where idempotency_key is not null;
create index if not exists customer_wallet_ledger_patient_idx on public.customer_wallet_ledger (clinic_id, patient_id, created_at desc);

create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict, points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_earned integer not null default 0 check (lifetime_earned >= 0), lifetime_redeemed integer not null default 0 check (lifetime_redeemed >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (clinic_id, patient_id)
);
create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  account_id uuid not null references public.loyalty_accounts(id) on delete restrict, patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('earn','redeem','expire','adjust','merge')), points_delta integer not null check (points_delta <> 0),
  balance_after integer not null check (balance_after >= 0), sales_order_id uuid references public.sales_orders(id) on delete restrict,
  idempotency_key text, note text, actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create unique index if not exists loyalty_ledger_idempotency_idx on public.loyalty_ledger (clinic_id, idempotency_key) where idempotency_key is not null;
create index if not exists loyalty_ledger_patient_idx on public.loyalty_ledger (clinic_id, patient_id, created_at desc);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null, description text, price integer not null default 0 check (price >= 0),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','quarterly','yearly')),
  included_credits integer not null default 0 check (included_credits >= 0), benefits jsonb not null default '[]'::jsonb,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(benefits) = 'array')
);
create index if not exists subscription_plans_clinic_idx on public.subscription_plans (clinic_id, active, created_at desc);
create table if not exists public.patient_subscriptions (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict, plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active','paused','past_due','cancelled')),
  started_at timestamptz not null default now(), current_period_start timestamptz not null default now(), current_period_end timestamptz not null,
  next_billing_at timestamptz, paused_at timestamptz, cancelled_at timestamptz, external_subscription_ref text, note text,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists patient_subscriptions_active_plan_idx on public.patient_subscriptions (clinic_id, patient_id, plan_id) where status in ('active','paused','past_due');
create index if not exists patient_subscriptions_due_idx on public.patient_subscriptions (clinic_id, status, next_billing_at);

create table if not exists public.scheduled_followups (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict, channel text not null check (channel in ('line','email','phone','manual')),
  purpose text not null default 'service' check (purpose in ('service','marketing')), subject text, body text not null,
  scheduled_for timestamptz not null, status text not null default 'pending' check (status in ('pending','processing','sent','completed','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0), last_error text, assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null, processed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists scheduled_followups_due_idx on public.scheduled_followups (clinic_id, status, scheduled_for);
create index if not exists scheduled_followups_patient_idx on public.scheduled_followups (clinic_id, patient_id, scheduled_for desc);

create table if not exists public.customer_merge_logs (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  source_patient_id uuid not null references public.patients(id) on delete restrict, target_patient_id uuid not null references public.patients(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null, snapshot jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check (source_patient_id <> target_patient_id)
);
create index if not exists customer_merge_logs_clinic_idx on public.customer_merge_logs (clinic_id, created_at desc);

do $$ declare tbl text; begin
  foreach tbl in array array['customer_wallets','customer_wallet_ledger','loyalty_accounts','loyalty_ledger','subscription_plans','patient_subscriptions','scheduled_followups','customer_merge_logs'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon, authenticated', tbl);
    execute format('grant select on table public.%I to authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member_read', tbl);
    execute format($policy$create policy %I on public.%I for select to authenticated using (
      exists (select 1 from public.clinic_members member where member.clinic_id = %I.clinic_id and member.user_id = auth.uid() and member.role <> 'provider')
    )$policy$, tbl || '_member_read', tbl, tbl);
  end loop;
end $$;

drop trigger if exists trg_customer_wallets_touch on public.customer_wallets;
create trigger trg_customer_wallets_touch before update on public.customer_wallets for each row execute function public.touch_updated_at();
drop trigger if exists trg_loyalty_accounts_touch on public.loyalty_accounts;
create trigger trg_loyalty_accounts_touch before update on public.loyalty_accounts for each row execute function public.touch_updated_at();
drop trigger if exists trg_subscription_plans_touch on public.subscription_plans;
create trigger trg_subscription_plans_touch before update on public.subscription_plans for each row execute function public.touch_updated_at();
drop trigger if exists trg_patient_subscriptions_touch on public.patient_subscriptions;
create trigger trg_patient_subscriptions_touch before update on public.patient_subscriptions for each row execute function public.touch_updated_at();
drop trigger if exists trg_scheduled_followups_touch on public.scheduled_followups;
create trigger trg_scheduled_followups_touch before update on public.scheduled_followups for each row execute function public.touch_updated_at();

create or replace function public.adjust_customer_wallet(
  p_clinic_id uuid, p_actor_user_id uuid, p_patient_id uuid, p_amount_delta integer, p_kind text,
  p_note text default null, p_sales_order_id uuid default null, p_idempotency_key text default null
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare wallet public.customer_wallets%rowtype; new_balance integer;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'wallet actor is not allowed'; end if;
  if p_amount_delta=0 or p_kind not in ('top_up','purchase','refund','adjust','merge') then raise exception 'invalid wallet movement'; end if;
  if not exists (select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id and patient.active) then raise exception 'wallet patient not found'; end if;
  if p_sales_order_id is not null and not exists (select 1 from public.sales_orders sales_order where sales_order.id=p_sales_order_id and sales_order.clinic_id=p_clinic_id and sales_order.patient_id=p_patient_id) then raise exception 'wallet sales order not found'; end if;
  if p_idempotency_key is not null and exists (select 1 from public.customer_wallet_ledger ledger where ledger.clinic_id=p_clinic_id and ledger.idempotency_key=p_idempotency_key) then select balance into new_balance from public.customer_wallets where clinic_id=p_clinic_id and patient_id=p_patient_id; return new_balance; end if;
  insert into public.customer_wallets (clinic_id,patient_id) values (p_clinic_id,p_patient_id) on conflict (clinic_id,patient_id) do nothing;
  select * into wallet from public.customer_wallets where clinic_id=p_clinic_id and patient_id=p_patient_id for update;
  new_balance:=wallet.balance+p_amount_delta; if new_balance<0 then raise exception 'insufficient wallet balance'; end if;
  update public.customer_wallets set balance=new_balance,lifetime_credit=lifetime_credit+greatest(p_amount_delta,0),lifetime_debit=lifetime_debit+greatest(-p_amount_delta,0) where id=wallet.id;
  insert into public.customer_wallet_ledger(clinic_id,wallet_id,patient_id,kind,amount_delta,balance_after,sales_order_id,idempotency_key,note,actor_id) values(p_clinic_id,wallet.id,p_patient_id,p_kind,p_amount_delta,new_balance,p_sales_order_id,nullif(btrim(p_idempotency_key),''),nullif(btrim(p_note),''),p_actor_user_id);
  return new_balance;
end; $$;
revoke all on function public.adjust_customer_wallet(uuid,uuid,uuid,integer,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.adjust_customer_wallet(uuid,uuid,uuid,integer,text,text,uuid,text) to service_role;

create or replace function public.adjust_loyalty_points(
  p_clinic_id uuid, p_actor_user_id uuid, p_patient_id uuid, p_points_delta integer, p_kind text,
  p_note text default null, p_sales_order_id uuid default null, p_idempotency_key text default null
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare account public.loyalty_accounts%rowtype; new_balance integer;
begin
  if not exists (select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'points actor is not allowed'; end if;
  if p_points_delta=0 or p_kind not in ('earn','redeem','expire','adjust','merge') then raise exception 'invalid points movement'; end if;
  if not exists (select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id and patient.active) then raise exception 'points patient not found'; end if;
  if p_sales_order_id is not null and not exists (select 1 from public.sales_orders sales_order where sales_order.id=p_sales_order_id and sales_order.clinic_id=p_clinic_id and sales_order.patient_id=p_patient_id) then raise exception 'points sales order not found'; end if;
  if p_idempotency_key is not null and exists (select 1 from public.loyalty_ledger ledger where ledger.clinic_id=p_clinic_id and ledger.idempotency_key=p_idempotency_key) then select points_balance into new_balance from public.loyalty_accounts where clinic_id=p_clinic_id and patient_id=p_patient_id; return new_balance; end if;
  insert into public.loyalty_accounts (clinic_id,patient_id) values (p_clinic_id,p_patient_id) on conflict (clinic_id,patient_id) do nothing;
  select * into account from public.loyalty_accounts where clinic_id=p_clinic_id and patient_id=p_patient_id for update;
  new_balance:=account.points_balance+p_points_delta; if new_balance<0 then raise exception 'insufficient points balance'; end if;
  update public.loyalty_accounts set points_balance=new_balance,lifetime_earned=lifetime_earned+greatest(p_points_delta,0),lifetime_redeemed=lifetime_redeemed+greatest(-p_points_delta,0) where id=account.id;
  insert into public.loyalty_ledger(clinic_id,account_id,patient_id,kind,points_delta,balance_after,sales_order_id,idempotency_key,note,actor_id) values(p_clinic_id,account.id,p_patient_id,p_kind,p_points_delta,new_balance,p_sales_order_id,nullif(btrim(p_idempotency_key),''),nullif(btrim(p_note),''),p_actor_user_id);
  return new_balance;
end; $$;
revoke all on function public.adjust_loyalty_points(uuid,uuid,uuid,integer,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.adjust_loyalty_points(uuid,uuid,uuid,integer,text,text,uuid,text) to service_role;

create or replace function public.create_patient_subscription(p_clinic_id uuid,p_actor_user_id uuid,p_patient_id uuid,p_plan_id uuid,p_note text default null) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare plan public.subscription_plans%rowtype; sub_id uuid; period_end timestamptz;
begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'subscription actor is not allowed';end if;
  if not exists(select 1 from public.patients patient where patient.id=p_patient_id and patient.clinic_id=p_clinic_id and patient.active) then raise exception 'subscription patient not found';end if;
  select * into plan from public.subscription_plans where id=p_plan_id and clinic_id=p_clinic_id and active; if not found then raise exception 'subscription plan not found';end if;
  period_end:=now()+case plan.billing_interval when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end;
  insert into public.patient_subscriptions(clinic_id,patient_id,plan_id,current_period_end,next_billing_at,note,created_by) values(p_clinic_id,p_patient_id,p_plan_id,period_end,period_end,nullif(btrim(p_note),''),p_actor_user_id) returning id into sub_id;return sub_id;
end; $$;
revoke all on function public.create_patient_subscription(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_patient_subscription(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.set_patient_subscription_status(p_clinic_id uuid,p_actor_user_id uuid,p_subscription_id uuid,p_status text) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare current_row public.patient_subscriptions%rowtype;
begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'subscription actor is not allowed';end if;
  if p_status not in ('active','paused','cancelled') then raise exception 'invalid subscription status';end if;
  select * into current_row from public.patient_subscriptions where id=p_subscription_id and clinic_id=p_clinic_id for update;if not found then raise exception 'subscription not found';end if;
  if current_row.status='cancelled' then raise exception 'cancelled subscription cannot be changed';end if;
  update public.patient_subscriptions set status=p_status,paused_at=case when p_status='paused' then now() else null end,cancelled_at=case when p_status='cancelled' then now() else null end,next_billing_at=case when p_status='active' then current_period_end when p_status='cancelled' then null else next_billing_at end where id=p_subscription_id;return p_status;
end; $$;
revoke all on function public.set_patient_subscription_status(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_patient_subscription_status(uuid,uuid,uuid,text) to service_role;

create or replace function public.merge_customers(p_clinic_id uuid,p_actor_user_id uuid,p_source_patient_id uuid,p_target_patient_id uuid) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare source_row public.patients%rowtype;target_row public.patients%rowtype;source_wallet integer:=0;source_points integer:=0;
begin
  if p_source_patient_id=p_target_patient_id then raise exception 'merge source and target must differ';end if;
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and (member.role in ('owner','admin') or 'brand.manage'=any(coalesce(member.permissions,'{}'::text[])))) then raise exception 'customer merge requires brand management';end if;
  perform 1 from public.patients patient where patient.clinic_id=p_clinic_id and patient.id in (p_source_patient_id,p_target_patient_id) order by patient.id for update;
  select * into source_row from public.patients where id=p_source_patient_id and clinic_id=p_clinic_id;select * into target_row from public.patients where id=p_target_patient_id and clinic_id=p_clinic_id;
  if source_row.id is null or target_row.id is null or not source_row.active or not target_row.active or source_row.merged_into_patient_id is not null then raise exception 'customer merge target is invalid';end if;
  if source_row.line_user_id is not null and target_row.line_user_id is not null and source_row.line_user_id<>target_row.line_user_id then raise exception 'customers are bound to different LINE accounts';end if;
  select balance into source_wallet from public.customer_wallets where clinic_id=p_clinic_id and patient_id=p_source_patient_id for update;source_wallet:=coalesce(source_wallet,0);
  if source_wallet>0 then perform public.adjust_customer_wallet(p_clinic_id,p_actor_user_id,p_target_patient_id,source_wallet,'merge','合併顧客轉入',null,'merge-wallet-in:'||p_source_patient_id::text||':'||p_target_patient_id::text);perform public.adjust_customer_wallet(p_clinic_id,p_actor_user_id,p_source_patient_id,-source_wallet,'merge','合併顧客轉出',null,'merge-wallet-out:'||p_source_patient_id::text||':'||p_target_patient_id::text);end if;
  select points_balance into source_points from public.loyalty_accounts where clinic_id=p_clinic_id and patient_id=p_source_patient_id for update;source_points:=coalesce(source_points,0);
  if source_points>0 then perform public.adjust_loyalty_points(p_clinic_id,p_actor_user_id,p_target_patient_id,source_points,'merge','合併顧客轉入',null,'merge-points-in:'||p_source_patient_id::text||':'||p_target_patient_id::text);perform public.adjust_loyalty_points(p_clinic_id,p_actor_user_id,p_source_patient_id,-source_points,'merge','合併顧客轉出',null,'merge-points-out:'||p_source_patient_id::text||':'||p_target_patient_id::text);end if;
  delete from public.crm_segment_members source_member where source_member.clinic_id=p_clinic_id and source_member.patient_id=p_source_patient_id and exists(select 1 from public.crm_segment_members target_member where target_member.segment_id=source_member.segment_id and target_member.patient_id=p_target_patient_id);
  update public.crm_segment_members set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  delete from public.crm_delivery_logs source_log where source_log.clinic_id=p_clinic_id and source_log.patient_id=p_source_patient_id and exists(select 1 from public.crm_delivery_logs target_log where target_log.automation_id=source_log.automation_id and target_log.patient_id=p_target_patient_id and target_log.trigger_key=source_log.trigger_key and target_log.channel=source_log.channel);
  update public.crm_delivery_logs set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_waitlist_entries source_wait set status='cancelled',updated_at=now() where source_wait.clinic_id=p_clinic_id and source_wait.patient_id=p_source_patient_id and source_wait.status in ('waiting','offered') and exists(select 1 from public.appointment_waitlist_entries target_wait where target_wait.clinic_id=p_clinic_id and target_wait.patient_id=p_target_patient_id and target_wait.target_key=source_wait.target_key and target_wait.status in ('waiting','offered'));
  update public.patient_subscriptions source_sub set status='cancelled',cancelled_at=now() where source_sub.clinic_id=p_clinic_id and source_sub.patient_id=p_source_patient_id and source_sub.status in ('active','paused','past_due') and exists(select 1 from public.patient_subscriptions target_sub where target_sub.clinic_id=p_clinic_id and target_sub.patient_id=p_target_patient_id and target_sub.plan_id=source_sub.plan_id and target_sub.status in ('active','paused','past_due'));
  update public.patient_records set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointments set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.crm_interactions set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.registrations set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.payment_orders set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.patient_memberships set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.membership_ledger set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.course_unit_progress set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.discount_redemptions set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.membership_notification_logs set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_waitlist_entries set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_waitlist_notification_logs set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.appointment_series set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.sales_orders set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.patient_subscriptions set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.scheduled_followups set patient_id=p_target_patient_id where clinic_id=p_clinic_id and patient_id=p_source_patient_id;
  update public.patients set email=coalesce(target_row.email,source_row.email),birthday=coalesce(target_row.birthday,source_row.birthday),gender=coalesce(target_row.gender,source_row.gender),line_user_id=coalesce(target_row.line_user_id,source_row.line_user_id),marketing_opt_in=target_row.marketing_opt_in or source_row.marketing_opt_in,tags=nullif(concat_ws(', ',nullif(target_row.tags,''),nullif(source_row.tags,'')),'') where id=p_target_patient_id;
  update public.patients set active=false,merged_into_patient_id=p_target_patient_id,merged_at=now() where id=p_source_patient_id;
  insert into public.customer_merge_logs(clinic_id,source_patient_id,target_patient_id,actor_id,snapshot) values(p_clinic_id,p_source_patient_id,p_target_patient_id,p_actor_user_id,jsonb_build_object('source_name',source_row.name,'source_phone',source_row.phone,'target_name',target_row.name,'target_phone',target_row.phone));
  return p_target_patient_id;
end; $$;
revoke all on function public.merge_customers(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.merge_customers(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.claim_due_scheduled_followups(p_limit integer default 50) returns setof public.scheduled_followups
language sql security definer set search_path=public,extensions as $$
  with due as (select id from public.scheduled_followups where status='pending' and channel in ('line','email') and scheduled_for<=now() order by scheduled_for for update skip locked limit greatest(1,least(p_limit,200)))
  update public.scheduled_followups followup set status='processing',attempt_count=followup.attempt_count+1,updated_at=now() from due where followup.id=due.id returning followup.*;
$$;
revoke all on function public.claim_due_scheduled_followups(integer) from public,anon,authenticated;
grant execute on function public.claim_due_scheduled_followups(integer) to service_role;

create or replace function public.finish_scheduled_followup(p_followup_id uuid,p_status text,p_error text default null) returns void
language plpgsql security definer set search_path=public,extensions as $$ begin
  if p_status not in ('sent','failed') then raise exception 'invalid follow-up result';end if;
  update public.scheduled_followups set status=p_status,last_error=case when p_status='failed' then left(p_error,1000) else null end,processed_at=case when p_status='sent' then now() else processed_at end where id=p_followup_id and status='processing';if not found then raise exception 'follow-up claim not found';end if;
end; $$;
revoke all on function public.finish_scheduled_followup(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_scheduled_followup(uuid,text,text) to service_role;

commit;
