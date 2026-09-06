-- Older databases may still carry a clinic_members role constraint that rejects
-- `owner`, while the current brand-creation functions intentionally write it.
begin;

alter table public.clinic_members
  drop constraint if exists clinic_members_role_check;

alter table public.clinic_members
  add constraint clinic_members_role_check
  check (role in ('owner', 'admin', 'frontdesk', 'provider', 'staff'));

commit;
