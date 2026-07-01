-- ============================================================================
-- Email 提醒改為後台可自行設定(金鑰存 DB,僅 server 端讀取)。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

alter table clinic_settings add column if not exists email_enabled boolean not null default false;
alter table clinic_settings add column if not exists resend_api_key text;
alter table clinic_settings add column if not exists email_from text;

select clinic_id, email_enabled, email_from,
       case when resend_api_key is null or resend_api_key = '' then '(未設定)' else '(已設定)' end as key_state
from clinic_settings
where clinic_id = '087f6757-d1b6-4c4f-a82d-8bb5bc7c4733';
