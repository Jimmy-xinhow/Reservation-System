-- ============================================================================
-- 系統內真人客服聊天(不經 LINE 對話框、不吃推播額度)。
-- 一則 = 病患或櫃檯的一句話,以 line_user_id 為對話串。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  line_user_id text not null,                          -- 對話對象(經 LIFF ID token 驗證)
  sender text not null check (sender in ('patient','staff')),
  body text not null,
  read_by_staff boolean not null default false,        -- 病患訊息是否已被櫃檯讀取
  read_by_patient boolean not null default false,      -- 櫃檯訊息是否已被病患讀取
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on chat_messages (clinic_id, line_user_id, created_at);

alter table chat_messages enable row level security;
-- 只有登入的本診所櫃檯能存取;anon 一律沒有 policy(病患端只透過本專案 API + service role)。
drop policy if exists chat_messages_member on chat_messages;
create policy chat_messages_member on chat_messages for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

select 'chat_messages ready' as status;
