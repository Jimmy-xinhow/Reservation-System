-- Visual membership cards and operator-recorded redemption channels.
begin;

alter table public.membership_plans
  add column if not exists card_image_url text,
  add column if not exists card_theme text not null default 'forest',
  add column if not exists card_accent text not null default '#176B57',
  add column if not exists redeem_channels text[] not null default array['appointment','registration']::text[],
  add column if not exists redemption_note text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'membership_plans_card_theme_check') then
    alter table public.membership_plans add constraint membership_plans_card_theme_check
      check (card_theme in ('forest','ink','clay','sand')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'membership_plans_redeem_channels_check') then
    alter table public.membership_plans add constraint membership_plans_redeem_channels_check
      check (redeem_channels <@ array['appointment','registration','product','course','offline']::text[] and cardinality(redeem_channels) > 0) not valid;
  end if;
end $$;

update public.membership_plans
set redeem_channels = case usage_scope
  when 'appointment' then array['appointment']::text[]
  when 'registration' then array['registration']::text[]
  else array['appointment','registration']::text[]
end
where redeem_channels = array['appointment','registration']::text[];

create or replace function public.redeem_patient_membership_credit(
  p_clinic_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_channel text,
  p_note text default null
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  membership_row record;
  next_credits integer;
begin
  if not exists (
    select 1 from public.clinic_members member
    where member.clinic_id = p_clinic_id and member.user_id = p_actor_user_id and member.role <> 'provider'
  ) then raise exception 'membership redemption actor is not allowed'; end if;
  if p_channel not in ('appointment','registration','product','course','offline') then raise exception 'invalid redemption channel'; end if;

  select membership.*, plan.redeem_channels into membership_row
  from public.patient_memberships membership
  join public.membership_plans plan on plan.id = membership.plan_id and plan.clinic_id = membership.clinic_id
  where membership.id = p_membership_id and membership.clinic_id = p_clinic_id
  for update of membership;
  if not found then raise exception 'membership not found'; end if;
  if membership_row.status <> 'active' or membership_row.credits_remaining < 1 then raise exception 'membership is not available'; end if;
  if membership_row.expires_at is not null and membership_row.expires_at <= now() then raise exception 'membership has expired'; end if;
  if not (p_channel = any(membership_row.redeem_channels)) then raise exception 'membership channel is not allowed'; end if;

  next_credits := membership_row.credits_remaining - 1;
  update public.patient_memberships
    set credits_remaining = next_credits,
        status = case when next_credits = 0 then 'exhausted' else status end,
        updated_at = now()
  where id = p_membership_id and clinic_id = p_clinic_id;
  insert into public.membership_ledger(clinic_id,membership_id,patient_id,kind,credits_delta,reference_type,idempotency_key,actor_id,note)
  values(p_clinic_id,p_membership_id,membership_row.patient_id,'consume',-1,p_channel,'manual:'||gen_random_uuid()::text,p_actor_user_id,nullif(btrim(p_note),''));
  return next_credits;
end;
$$;
revoke all on function public.redeem_patient_membership_credit(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.redeem_patient_membership_credit(uuid,uuid,uuid,text,text) to service_role;

commit;
