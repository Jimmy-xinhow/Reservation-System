-- Industry operation packs: beauty procurement, fitness freezes, course assessments and digital consent.
begin;

alter table public.inventory_movements drop constraint if exists inventory_movements_kind_check;
alter table public.inventory_movements add constraint inventory_movements_kind_check check (kind in ('stock_in','use','sale','waste','stocktake'));
alter table public.beauty_commission_rules add column if not exists calculation_type text not null default 'fixed';
alter table public.beauty_commission_rules add column if not exists rate_percent numeric(5,2) not null default 0;
alter table public.beauty_commission_rules drop constraint if exists beauty_commission_rules_calculation_type_check;
alter table public.beauty_commission_rules add constraint beauty_commission_rules_calculation_type_check check (calculation_type in ('fixed','percent'));
alter table public.beauty_commission_rules drop constraint if exists beauty_commission_rules_rate_percent_check;
alter table public.beauty_commission_rules add constraint beauty_commission_rules_rate_percent_check check (rate_percent between 0 and 100);

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null, contact_name text, phone text, email text, note text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists inventory_suppliers_clinic_idx on public.inventory_suppliers (clinic_id, active, name);
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  order_no text not null default ('PO-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))),
  status text not null default 'draft' check (status in ('draft','ordered','received','cancelled')),
  expected_at date, note text, ordered_at timestamptz, received_at timestamptz, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (clinic_id, order_no)
);
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict, item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(12,2) not null check (quantity > 0), unit_cost integer not null default 0 check (unit_cost >= 0), received_quantity numeric(12,2) not null default 0 check (received_quantity >= 0),
  created_at timestamptz not null default now(), unique (purchase_order_id,item_id)
);
create index if not exists purchase_orders_clinic_idx on public.purchase_orders (clinic_id,status,created_at desc);
create table if not exists public.inventory_stocktakes (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  stocktake_no text not null default ('ST-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))),
  status text not null default 'draft' check (status in ('draft','completed','cancelled')), note text,
  created_by uuid references auth.users(id) on delete set null, completed_at timestamptz, created_at timestamptz not null default now(), unique (clinic_id,stocktake_no)
);
create table if not exists public.inventory_stocktake_items (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  stocktake_id uuid not null references public.inventory_stocktakes(id) on delete restrict, item_id uuid not null references public.inventory_items(id) on delete restrict,
  system_quantity numeric(12,2) not null check (system_quantity >= 0), actual_quantity numeric(12,2) not null check (actual_quantity >= 0), variance numeric(12,2) not null,
  created_at timestamptz not null default now(), unique (stocktake_id,item_id)
);
create index if not exists inventory_stocktakes_clinic_idx on public.inventory_stocktakes (clinic_id,status,created_at desc);

create table if not exists public.subscription_freezes (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  subscription_id uuid not null references public.patient_subscriptions(id) on delete restrict, patient_id uuid not null references public.patients(id) on delete restrict,
  starts_on date not null, ends_on date not null, freeze_days integer not null check (freeze_days between 1 and 90),
  status text not null default 'scheduled' check (status in ('scheduled','active','completed','cancelled')), reason text,
  paused_subscription boolean not null default false,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_on >= starts_on)
);
create index if not exists subscription_freezes_subscription_idx on public.subscription_freezes (clinic_id,subscription_id,starts_on desc);

alter table public.course_units drop constraint if exists course_units_unit_type_check;
alter table public.course_units add constraint course_units_unit_type_check check (unit_type in ('video','link','download','text','quiz','assignment'));
alter table public.course_units add column if not exists release_mode text not null default 'immediate';
alter table public.course_units add column if not exists release_days integer not null default 0;
alter table public.course_units drop constraint if exists course_units_release_mode_check;
alter table public.course_units add constraint course_units_release_mode_check check (release_mode in ('immediate','days_after_registration','after_previous'));
alter table public.course_units drop constraint if exists course_units_release_days_check;
alter table public.course_units add constraint course_units_release_days_check check (release_days between 0 and 3650);
create table if not exists public.course_assessments (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict, unit_id uuid not null unique references public.course_units(id) on delete restrict,
  kind text not null check (kind in ('quiz','assignment')), prompt text not null, options jsonb not null default '[]'::jsonb,
  correct_option integer, passing_score integer not null default 100 check (passing_score between 0 and 100), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(options)='array'), check ((kind='quiz' and jsonb_array_length(options)>=2 and correct_option>=0) or (kind='assignment' and jsonb_array_length(options)=0 and correct_option is null))
);
create table if not exists public.course_assessment_submissions (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  assessment_id uuid not null references public.course_assessments(id) on delete restrict, unit_id uuid not null references public.course_units(id) on delete restrict,
  registration_id uuid not null references public.registrations(id) on delete restrict, patient_id uuid not null references public.patients(id) on delete restrict,
  answer jsonb not null default '{}'::jsonb, submission_text text, score integer check (score is null or score between 0 and 100),
  status text not null default 'submitted' check (status in ('submitted','passed','revision')), feedback text,
  reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, submitted_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (registration_id,unit_id)
);
create index if not exists course_assessment_submissions_review_idx on public.course_assessment_submissions (clinic_id,status,submitted_at desc);
create table if not exists public.course_certificates (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict, registration_id uuid not null unique references public.registrations(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  certificate_no text not null default ('CERT-' || to_char(now(),'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  issued_at timestamptz not null default now(), created_at timestamptz not null default now(), unique (clinic_id,certificate_no)
);
create index if not exists course_certificates_patient_idx on public.course_certificates (clinic_id,patient_id,issued_at desc);

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null, kind text not null check (kind in ('consent','waiver','intake')), version integer not null default 1 check (version > 0),
  body text not null, active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.customer_document_requests (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict, template_id uuid not null references public.document_templates(id) on delete restrict,
  token_hash text not null unique, content_snapshot text not null, template_version integer not null,
  status text not null default 'pending' check (status in ('pending','signed','expired','cancelled')), expires_at timestamptz not null,
  signer_name text, signed_at timestamptz, signature_text text, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists customer_document_requests_patient_idx on public.customer_document_requests (clinic_id,patient_id,created_at desc);

do $$ declare tbl text; begin
  foreach tbl in array array['inventory_suppliers','purchase_orders','purchase_order_items','inventory_stocktakes','inventory_stocktake_items','subscription_freezes','course_assessments','course_assessment_submissions','course_certificates','document_templates','customer_document_requests'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on table public.%I from public, anon, authenticated',tbl);
    execute format('grant select on table public.%I to authenticated',tbl);
    execute format('grant all on table public.%I to service_role',tbl);
    execute format('drop policy if exists %I on public.%I',tbl||'_member_read',tbl);
    execute format($p$create policy %I on public.%I for select to authenticated using(exists(select 1 from public.clinic_members member where member.clinic_id=%I.clinic_id and member.user_id=auth.uid() and member.role<>'provider'))$p$,tbl||'_member_read',tbl,tbl);
  end loop;
end $$;
do $$ declare tbl text; begin foreach tbl in array array['inventory_suppliers','purchase_orders','inventory_stocktakes','subscription_freezes','course_assessments','course_assessment_submissions','document_templates','customer_document_requests'] loop execute format('drop trigger if exists %I on public.%I','trg_'||tbl||'_touch',tbl);execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()','trg_'||tbl||'_touch',tbl);end loop;end $$;

create or replace function public.receive_purchase_order(p_clinic_id uuid,p_actor_user_id uuid,p_purchase_order_id uuid) returns integer
language plpgsql security definer set search_path=public,extensions as $$ declare purchase public.purchase_orders%rowtype;line record;line_count integer:=0;begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'purchase actor is not allowed';end if;
  select * into purchase from public.purchase_orders where id=p_purchase_order_id and clinic_id=p_clinic_id for update;if not found or purchase.status not in('draft','ordered') then raise exception 'purchase order cannot be received';end if;
  for line in select * from public.purchase_order_items where purchase_order_id=p_purchase_order_id and clinic_id=p_clinic_id for update loop perform public.record_inventory_movement(p_clinic_id,line.item_id,'stock_in',line.quantity,'採購單 '||purchase.order_no,p_actor_user_id);update public.purchase_order_items set received_quantity=line.quantity where id=line.id;line_count:=line_count+1;end loop;
  if line_count=0 then raise exception 'purchase order has no items';end if;update public.purchase_orders set status='received',received_at=now(),ordered_at=coalesce(ordered_at,now()) where id=p_purchase_order_id;return line_count;
end;$$;
revoke all on function public.receive_purchase_order(uuid,uuid,uuid) from public,anon,authenticated;grant execute on function public.receive_purchase_order(uuid,uuid,uuid) to service_role;

create or replace function public.finalize_inventory_stocktake(p_clinic_id uuid,p_actor_user_id uuid,p_note text,p_counts jsonb) returns uuid
language plpgsql security definer set search_path=public,extensions as $$ declare stocktake_id uuid;entry jsonb;item public.inventory_items%rowtype;actual numeric;difference numeric;begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'stocktake actor is not allowed';end if;
  if jsonb_typeof(p_counts)<>'array' or jsonb_array_length(p_counts)=0 then raise exception 'stocktake counts are required';end if;
  insert into public.inventory_stocktakes(clinic_id,status,note,created_by,completed_at) values(p_clinic_id,'completed',nullif(btrim(p_note),''),p_actor_user_id,now()) returning id into stocktake_id;
  for entry in select value from jsonb_array_elements(p_counts) loop actual:=(entry->>'actual_quantity')::numeric;if actual<0 then raise exception 'invalid stocktake quantity';end if;select * into item from public.inventory_items where id=(entry->>'item_id')::uuid and clinic_id=p_clinic_id and active for update;if not found then raise exception 'stocktake item not found';end if;difference:=actual-item.stock_on_hand;insert into public.inventory_stocktake_items(clinic_id,stocktake_id,item_id,system_quantity,actual_quantity,variance) values(p_clinic_id,stocktake_id,item.id,item.stock_on_hand,actual,difference);if difference<>0 then update public.inventory_items set stock_on_hand=actual where id=item.id;insert into public.inventory_movements(clinic_id,item_id,kind,quantity,stock_after,note,actor_id) values(p_clinic_id,item.id,'stocktake',abs(difference),actual,'盤點調整',p_actor_user_id);end if;end loop;return stocktake_id;
end;$$;
revoke all on function public.finalize_inventory_stocktake(uuid,uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.finalize_inventory_stocktake(uuid,uuid,text,jsonb) to service_role;

create or replace function public.freeze_patient_subscription(p_clinic_id uuid,p_actor_user_id uuid,p_subscription_id uuid,p_starts_on date,p_ends_on date,p_reason text) returns uuid
language plpgsql security definer set search_path=public,extensions as $$ declare sub public.patient_subscriptions%rowtype;freeze_id uuid;days integer;state text;today_taipei date;begin
  if not exists(select 1 from public.clinic_members member where member.clinic_id=p_clinic_id and member.user_id=p_actor_user_id and member.role<>'provider') then raise exception 'freeze actor is not allowed';end if;
  days:=p_ends_on-p_starts_on+1;if days<1 or days>90 then raise exception 'freeze period must be 1 to 90 days';end if;select * into sub from public.patient_subscriptions where id=p_subscription_id and clinic_id=p_clinic_id and status in('active','paused') for update;if not found then raise exception 'subscription cannot be frozen';end if;
  if exists(select 1 from public.subscription_freezes f where f.subscription_id=p_subscription_id and f.status in('scheduled','active') and daterange(f.starts_on,f.ends_on,'[]')&&daterange(p_starts_on,p_ends_on,'[]')) then raise exception 'freeze period overlaps';end if;
  today_taipei:=(now() at time zone 'Asia/Taipei')::date;if p_ends_on<today_taipei then raise exception 'freeze period cannot be in the past';end if;
  state:=case when today_taipei between p_starts_on and p_ends_on then 'active' else 'scheduled' end;insert into public.subscription_freezes(clinic_id,subscription_id,patient_id,starts_on,ends_on,freeze_days,status,reason,paused_subscription,created_by) values(p_clinic_id,p_subscription_id,sub.patient_id,p_starts_on,p_ends_on,days,state,nullif(btrim(p_reason),''),state='active' and sub.status='active',p_actor_user_id) returning id into freeze_id;
  update public.patient_subscriptions set current_period_end=current_period_end+make_interval(days=>days),next_billing_at=case when next_billing_at is null then null else next_billing_at+make_interval(days=>days) end,status=case when state='active' and sub.status='active' then 'paused' else status end,paused_at=case when state='active' and sub.status='active' then now() else paused_at end where id=p_subscription_id;return freeze_id;
end;$$;
revoke all on function public.freeze_patient_subscription(uuid,uuid,uuid,date,date,text) from public,anon,authenticated;grant execute on function public.freeze_patient_subscription(uuid,uuid,uuid,date,date,text) to service_role;

create or replace function public.sync_subscription_freezes() returns integer
language plpgsql security definer set search_path=public,extensions as $$ declare changed integer:=0;row_count integer;today_taipei date:=(now() at time zone 'Asia/Taipei')::date;begin
  update public.subscription_freezes f set status='active',paused_subscription=(select subscription.status='active' from public.patient_subscriptions subscription where subscription.id=f.subscription_id) where f.status='scheduled' and f.starts_on<=today_taipei and f.ends_on>=today_taipei;get diagnostics row_count=row_count;changed:=changed+row_count;
  update public.patient_subscriptions subscription set status='paused',paused_at=coalesce(subscription.paused_at,now()) where subscription.status='active' and exists(select 1 from public.subscription_freezes f where f.subscription_id=subscription.id and f.status='active' and f.paused_subscription);
  update public.subscription_freezes set status='completed' where status in('scheduled','active') and ends_on<today_taipei;get diagnostics row_count=row_count;changed:=changed+row_count;
  update public.patient_subscriptions subscription set status='active',paused_at=null where subscription.status='paused' and not exists(select 1 from public.subscription_freezes f where f.subscription_id=subscription.id and f.status='active' and f.paused_subscription) and exists(select 1 from public.subscription_freezes f where f.subscription_id=subscription.id and f.status='completed' and f.paused_subscription);
  return changed;
end;$$;
revoke all on function public.sync_subscription_freezes() from public,anon,authenticated;grant execute on function public.sync_subscription_freezes() to service_role;

create or replace function public.issue_course_certificate_if_complete(p_clinic_id uuid,p_registration_id uuid) returns text
language plpgsql security definer set search_path=public,extensions as $$ declare registration public.registrations%rowtype;required_count integer;completed_count integer;certificate text;begin
  select * into registration from public.registrations where id=p_registration_id and clinic_id=p_clinic_id and status in('confirmed','attended');if not found then return null;end if;
  select count(*) into required_count from public.course_units where clinic_id=p_clinic_id and event_id=registration.event_id and active;
  select count(*) into completed_count from public.course_unit_progress where clinic_id=p_clinic_id and event_id=registration.event_id and registration_id=p_registration_id;
  if required_count=0 or completed_count<required_count then return null;end if;
  insert into public.course_certificates(clinic_id,event_id,registration_id,patient_id) values(p_clinic_id,registration.event_id,p_registration_id,registration.patient_id) on conflict(registration_id) do nothing;
  select certificate_no into certificate from public.course_certificates where registration_id=p_registration_id;return certificate;
end;$$;
revoke all on function public.issue_course_certificate_if_complete(uuid,uuid) from public,anon,authenticated;grant execute on function public.issue_course_certificate_if_complete(uuid,uuid) to service_role;

commit;
