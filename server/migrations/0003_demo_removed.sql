-- 0003_demo_removed: remember that an organization removed its demo data, so
-- `db:seed` never brings the fictitious event and tasks back next to the real
-- plan. Additive only: one nullable column and a backfill of that column.
-- Never edit once applied.

-- When the organization removed its demo data (API or db:clear-demo);
-- NULL = never removed, the seed may create it.
ALTER TABLE organizations ADD COLUMN demo_removed_at timestamptz;

-- Backfill for databases already in use. The seed creates an organization and
-- its demo event in the same transaction, events cannot be deleted one by one
-- and a demo event is never promoted to real, so an organization without a
-- demo event has removed its demo. Use the logged removal time when there is
-- one (API path); db:clear-demo did not log it, so fall back to now().
UPDATE organizations o
   SET demo_removed_at = COALESCE(
         (SELECT max(a.at) FROM activity_log a
           WHERE a.organization_id = o.id
             AND a.entity_type = 'demo'
             AND a.action = 'delete'),
         now())
 WHERE NOT EXISTS (
         SELECT 1 FROM events e WHERE e.organization_id = o.id AND e.is_demo);
