begin;

-- Aggregate every conversation in its own tenant. The invoker's RLS and an
-- explicit operator check both apply, including to direct RPC requests.
create or replace function public.list_chat_threads(p_clinic_id uuid)
returns table (
  line_user_id text,
  name text,
  last_body text,
  last_at timestamptz,
  last_sender text,
  unread bigint,
  blocked boolean
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with allowed as (
    select exists (
      select 1
      from public.clinic_members cm
      join public.clinics clinic on clinic.id = cm.clinic_id
      join public.clinic_settings settings on settings.clinic_id = cm.clinic_id
      where cm.clinic_id = p_clinic_id
        and cm.user_id = auth.uid()
        and clinic.active = true
        and settings.line_channel_enabled = true
        and (cm.access_type = 'brand_admin'
          or cm.permissions && array['brand.manage', 'operations.manage']::text[])
    ) as value
  ), latest as (
    select distinct on (message.line_user_id)
      message.line_user_id, message.body, message.created_at, message.sender
    from public.chat_messages message cross join allowed
    where allowed.value and message.clinic_id = p_clinic_id
    order by message.line_user_id, message.created_at desc, message.id desc
  ), unread_count as (
    select message.line_user_id, count(*) as total
    from public.chat_messages message cross join allowed
    where allowed.value and message.clinic_id = p_clinic_id
      and message.sender = 'patient' and message.read_by_staff = false
    group by message.line_user_id
  )
  select latest.line_user_id,
    patient.name,
    latest.body as last_body,
    latest.created_at as last_at,
    latest.sender as last_sender,
    coalesce(unread_count.total, 0)::bigint as unread,
    exists (
      select 1 from public.chat_blocks block
      where block.clinic_id = p_clinic_id and block.line_user_id = latest.line_user_id
    ) as blocked
  from latest
  left join unread_count on unread_count.line_user_id = latest.line_user_id
  left join lateral (
    select customer.name::text as name
    from public.patients customer
    where customer.clinic_id = p_clinic_id and customer.line_user_id = latest.line_user_id
    order by customer.created_at, customer.id
    limit 1
  ) patient on true
  order by latest.created_at desc, latest.line_user_id;
$$;

revoke all on function public.list_chat_threads(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_chat_threads(uuid) to authenticated;
notify pgrst, 'reload schema';

commit;
