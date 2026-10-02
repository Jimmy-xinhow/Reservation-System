-- Legacy role remains an RLS compatibility input. Prevent a member whose
-- permission is provider-only from retaining a staff/admin role (or vice versa).
-- Existing rows in staging and production were read-only audited before rollout.
alter table public.clinic_members
  drop constraint if exists clinic_members_role_permission_consistency_check;

alter table public.clinic_members
  add constraint clinic_members_role_permission_consistency_check
  check (
    (
      access_type = 'brand_admin'
      and role in ('owner', 'admin')
      and permissions @> array['brand.manage', 'operations.manage']::text[]
    )
    or (
      access_type = 'employee'
      and permissions <> '{}'::text[]
      and (
        (role = 'admin' and 'brand.manage' = any(permissions))
        or (
          role in ('staff', 'frontdesk')
          and 'operations.manage' = any(permissions)
          and not ('brand.manage' = any(permissions))
        )
        or (
          role = 'provider'
          and 'provider.assigned' = any(permissions)
          and not ('brand.manage' = any(permissions))
          and not ('operations.manage' = any(permissions))
        )
      )
    )
  );
