-- ============================================================================
-- 客服黑名單:封鎖惡意騷擾的 LINE 帳號(以 line_user_id 為單位)。
-- 被封鎖者送出的客服訊息一律靜默丟棄(不存、不回)。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

create table if not exists chat_blocks (
  clinic_id uuid not null references clinics(id) on delete cascade,
  line_user_id text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (clinic_id, line_user_id)
);

alter table chat_blocks enable row level security;
drop policy if exists chat_blocks_member on chat_blocks;
create policy chat_blocks_member on chat_blocks for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

select 'chat_blocks ready' as status;
