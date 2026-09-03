-- Optional beauty operations module. Tenant behavior is controlled by clinic_settings.
alter table public.clinic_settings add column if not exists beauty_operations_enabled boolean not null default false;

alter table public.patient_records add column if not exists record_type text not null default 'general';
alter table public.patient_records add column if not exists appointment_id uuid references public.appointments(id) on delete restrict;
alter table public.patient_records add column if not exists treatment_name text;
alter table public.patient_records add column if not exists assessment text;
alter table public.patient_records add column if not exists aftercare text;
alter table public.patient_records add column if not exists private_photo_paths text[] not null default '{}';
alter table public.patient_records add column if not exists photo_consent boolean not null default false;
alter table public.patient_records add column if not exists recorded_by uuid references auth.users(id) on delete set null;
alter table public.patient_records add column if not exists updated_at timestamptz not null default now();
alter table public.patient_records drop constraint if exists patient_records_record_type_check;
alter table public.patient_records add constraint patient_records_record_type_check check (record_type in ('general','beauty_treatment'));
create index if not exists patient_records_appointment_idx on public.patient_records (clinic_id, appointment_id, created_at desc);
drop trigger if exists trg_patient_records_touch on public.patient_records;
create trigger trg_patient_records_touch before update on public.patient_records for each row execute function public.touch_updated_at();

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  sku text,
  name text not null,
  unit text not null default '件',
  stock_on_hand numeric(12,2) not null default 0 check (stock_on_hand >= 0),
  reorder_level numeric(12,2) not null default 0 check (reorder_level >= 0),
  retail_price integer not null default 0 check (retail_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, sku)
);
create index if not exists inventory_items_clinic_idx on public.inventory_items (clinic_id, active, name);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  kind text not null check (kind in ('stock_in','use','sale','waste')),
  quantity numeric(12,2) not null check (quantity > 0),
  stock_after numeric(12,2) not null check (stock_after >= 0),
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements (clinic_id, item_id, created_at desc);

create table if not exists public.beauty_commission_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  service_id uuid references public.services(id) on delete restrict,
  amount_per_service integer not null default 0 check (amount_per_service >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists beauty_commission_rules_general_idx on public.beauty_commission_rules (clinic_id, doctor_id) where service_id is null;
create unique index if not exists beauty_commission_rules_service_idx on public.beauty_commission_rules (clinic_id, doctor_id, service_id) where service_id is not null;

drop trigger if exists trg_inventory_items_touch on public.inventory_items;
create trigger trg_inventory_items_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
drop trigger if exists trg_beauty_commission_rules_touch on public.beauty_commission_rules;
create trigger trg_beauty_commission_rules_touch before update on public.beauty_commission_rules for each row execute function public.touch_updated_at();

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.beauty_commission_rules enable row level security;
revoke all on table public.inventory_items from public, anon;
revoke all on table public.inventory_movements from public, anon;
revoke all on table public.beauty_commission_rules from public, anon;

do $$
declare tbl text;
begin
  foreach tbl in array array['inventory_items','inventory_movements','beauty_commission_rules'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format($policy$
      create policy %I on public.%I for all to authenticated
      using (clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
      with check (clinic_id in (select cm.clinic_id from public.clinic_members cm where cm.user_id = auth.uid()) and exists (select 1 from public.clinic_members cm where cm.clinic_id = %I.clinic_id and cm.user_id = auth.uid() and cm.role <> 'provider'))
    $policy$, tbl || '_member', tbl, tbl, tbl);
  end loop;
end $$;

create or replace function public.record_inventory_movement(
  p_clinic_id uuid, p_item_id uuid, p_kind text, p_quantity numeric, p_note text, p_actor_user_id uuid
) returns numeric
language plpgsql security definer set search_path = public, extensions
as $$
declare item_row record; new_stock numeric;
begin
  if p_kind not in ('stock_in','use','sale','waste') or p_quantity <= 0 then raise exception 'invalid inventory movement'; end if;
  if not exists (select 1 from clinic_members where clinic_id=p_clinic_id and user_id=p_actor_user_id and role <> 'provider') then raise exception 'inventory actor is not allowed'; end if;
  select * into item_row from inventory_items where id=p_item_id and clinic_id=p_clinic_id and active for update;
  if not found then raise exception 'inventory item not found'; end if;
  new_stock := item_row.stock_on_hand + case when p_kind='stock_in' then p_quantity else -p_quantity end;
  if new_stock < 0 then raise exception 'insufficient inventory'; end if;
  update inventory_items set stock_on_hand=new_stock, updated_at=now() where id=p_item_id;
  insert into inventory_movements (clinic_id,item_id,kind,quantity,stock_after,note,actor_id)
    values (p_clinic_id,p_item_id,p_kind,p_quantity,new_stock,nullif(btrim(p_note),''),p_actor_user_id);
  return new_stock;
end; $$;
revoke all on function public.record_inventory_movement(uuid,uuid,text,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.record_inventory_movement(uuid,uuid,text,numeric,text,uuid) to service_role;
