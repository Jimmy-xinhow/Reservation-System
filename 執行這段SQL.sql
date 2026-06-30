-- ============================================================================
-- 修正:把後台 policy 從「呼叫 auth_clinic_ids() 函式」改成「直接 auth.uid() 子查詢」。
-- 理由:auth_clinic_ids() 當 RPC 會回 [087],但放在 policy 裡卻讀不到;
--      而 clinic_members 用 user_id = auth.uid() 的寫法在你的 DB 已證實可用。
--      所以改用同樣可用的 auth.uid() 直接比對,繞過那個只在 policy 內失效的函式。
-- 安全:仍是「只能存取自己診所」,沒有放寬。
-- 用法:整段貼到 Supabase → SQL Editor → Run。跑完回 /admin/diag 重新整理。
-- ============================================================================

drop policy if exists clinic_settings_member on clinic_settings;
create policy clinic_settings_member on clinic_settings for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists doctors_member on doctors;
create policy doctors_member on doctors for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists schedule_templates_member on schedule_templates;
create policy schedule_templates_member on schedule_templates for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists schedule_exceptions_member on schedule_exceptions;
create policy schedule_exceptions_member on schedule_exceptions for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists patients_member on patients;
create policy patients_member on patients for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists appointments_member on appointments;
create policy appointments_member on appointments for all to authenticated
  using (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (clinic_id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));

drop policy if exists clinics_member on clinics;
create policy clinics_member on clinics for all to authenticated
  using (id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()))
  with check (id in (select cm.clinic_id from clinic_members cm where cm.user_id = auth.uid()));
