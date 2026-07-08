-- ============================================================================
-- 後台帳號角色權限(admin 管理員 / staff 櫃檯)。
-- 在 Supabase → SQL Editor 跑一次即可。
-- ============================================================================

-- 1) 加 role 欄位(預設 staff)
alter table clinic_members add column if not exists role text not null default 'staff';
do $$ begin
  alter table clinic_members add constraint clinic_members_role_check check (role in ('admin','staff'));
exception when duplicate_object then null; end $$;

-- 2) 既有成員一律先設為 admin,避免升級後所有人被降級鎖在門外。
--    之後再由管理員於「使用者管理」頁把櫃檯帳號調成 staff。
update clinic_members set role = 'admin';

select 'clinic_members.role ready' as status;
