-- 0013_developer_fixed_roles: a developer account always has administration
-- too, and the database refuses a membership that breaks it. Additive: the
-- backfill only adds `admin` where `developer` is present; nothing is
-- removed. Never edit once applied.

UPDATE organization_members
   SET roles = ARRAY(
         SELECT r FROM unnest(ARRAY['admin', 'developer', 'team']::text[]) AS r
          WHERE r = 'admin' OR r = ANY(roles))
 WHERE 'developer' = ANY(roles) AND NOT 'admin' = ANY(roles);

ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_developer_admin_check
  CHECK (NOT 'developer' = ANY(roles) OR 'admin' = ANY(roles));
