-- ============================================================================
-- LINE 訊息素材(文字/圖文卡/多頁)+ 綁關鍵字回覆 + 圖片儲存 bucket。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

-- 訊息素材
create table if not exists line_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  kind text not null default 'text' check (kind in ('text','card','carousel')),
  data jsonb not null default '{}',
  created_at timestamptz default now()
);
alter table line_messages enable row level security;
drop policy if exists line_messages_member on line_messages;
create policy line_messages_member on line_messages for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

-- 回覆規則:新增 action=message + message_id
alter table line_auto_replies drop constraint if exists line_auto_replies_action_check;
alter table line_auto_replies
  add constraint line_auto_replies_action_check check (action in ('text','booking','query','progress','message'));
alter table line_auto_replies add column if not exists message_id uuid references line_messages(id) on delete set null;

-- 圖片儲存:公開 bucket(上傳走 service role,讀取公開)
insert into storage.buckets (id, name, public) values ('line-media','line-media', true)
on conflict (id) do nothing;

select 'line_messages + bucket ready' as status;
