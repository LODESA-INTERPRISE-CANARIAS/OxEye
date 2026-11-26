-- 0005_inventories: inventories, quick capture and history (milestone 4).
-- Warehouses (name and address, no map geometry), inventory resources (owned
-- material or a contracted service, with what was observed: quantity, unit,
-- dimensions, condition, availability), the resources a task uses, and
-- operational notes (note, incident, decision, open question, idea) linked to
-- an event and/or one record. Built-in resource categories for every
-- organization. Additive only: new tables and category rows; no existing
-- column or row changes. Never edit once applied.
--
-- Safety: quantity, unit (even «kg») and dimensions are descriptive only.
-- Nothing here computes a load per area or answers tasks.heavy_load; that
-- question belongs to the simulator's X-ray check. A warehouse has no
-- geometry, so it cannot be placed on emergency routes A/B/C.

-- ---------------------------------------------------------------- resource categories

-- The built-in resource categories, in display order. The same list lives in
-- shared/logistics/rules.ts (BUILT_IN_RESOURCE_CATEGORIES), which the seed uses
-- for organizations created later; a server test pins this copy to it. A
-- custom resource category that already has one of these names stays as it is.
INSERT INTO categories (organization_id, scope, name, built_in, position)
SELECT o.id, 'resource', b.name, true, b.position
  FROM organizations o
 CROSS JOIN (VALUES
   (1, 'Carpas'),
   (2, 'Vallas'),
   (3, 'Mesas'),
   (4, 'Sillas y bancos'),
   (5, 'Escenarios y tarimas'),
   (6, 'Vehículos'),
   (7, 'Generadores y electricidad'),
   (8, 'Sonido e iluminación'),
   (9, 'Señalización'),
   (10, 'Otros materiales')
 ) AS b (position, name)
ON CONFLICT (organization_id, scope, (lower(name))) DO NOTHING;

-- ---------------------------------------------------------------- warehouses

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- Withheld from guests (free text about where municipal material is kept).
  address text CHECK (address IS NULL OR length(address) <= 300),
  notes text CHECK (notes IS NULL OR length(notes) <= 5000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text CHECK (source IN ('observed', 'reported', 'document')),
  verification text NOT NULL DEFAULT 'draft'
    CHECK (verification IN ('draft', 'to_verify', 'validated')),
  is_demo boolean NOT NULL DEFAULT false
);
-- One warehouse per name and organization, whatever the letter case.
CREATE UNIQUE INDEX warehouses_org_name_key
  ON warehouses (organization_id, lower(name));

-- ---------------------------------------------------------------- resources

-- The API unlinks resources (with a new version) before deleting a warehouse,
-- company or offer, so those references have no ON DELETE action: a delete
-- that forgot to unlink fails instead of losing a link silently.
CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Two items may share a name (two lots of fences): no unique index.
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- owned = physical item of the organization; contracted = from a company.
  ownership text NOT NULL DEFAULT 'owned'
    CHECK (ownership IN ('owned', 'contracted')),
  -- Scope `resource` (the API checks the scope and the organization).
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses (id),
  company_id uuid REFERENCES companies (id),
  offer_id uuid REFERENCES offers (id),
  -- NULL = not counted yet, never 0.
  quantity numeric(12, 2)
    CHECK (quantity IS NULL OR quantity BETWEEN 0 AND 1000000),
  unit text NOT NULL DEFAULT 'unidades'
    CHECK (length(btrim(unit)) BETWEEN 1 AND 30),
  dimensions text CHECK (dimensions IS NULL OR length(dimensions) <= 120),
  condition text NOT NULL DEFAULT 'unknown'
    CHECK (condition IN ('good', 'fair', 'damaged', 'unknown')),
  availability text NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('available', 'in_use', 'maintenance', 'unknown')),
  -- Where inside the warehouse; withheld from guests.
  location text CHECK (location IS NULL OR length(location) <= 200),
  -- «Aún por evaluar»: quantity and condition not assessed yet.
  to_assess boolean NOT NULL DEFAULT false,
  notes text CHECK (notes IS NULL OR length(notes) <= 5000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text CHECK (source IN ('observed', 'reported', 'document')),
  verification text NOT NULL DEFAULT 'draft'
    CHECK (verification IN ('draft', 'to_verify', 'validated')),
  is_demo boolean NOT NULL DEFAULT false,
  -- Company and offer belong to contracted resources only.
  CONSTRAINT resources_owned_without_company_check
    CHECK (ownership = 'contracted' OR (company_id IS NULL AND offer_id IS NULL))
);
CREATE INDEX resources_org_name_idx ON resources (organization_id, lower(name));
CREATE INDEX resources_category_idx ON resources (category_id);
CREATE INDEX resources_warehouse_idx ON resources (warehouse_id);
CREATE INDEX resources_company_idx ON resources (company_id);
CREATE INDEX resources_offer_idx ON resources (offer_id);

-- The resources a task uses (no quantity per assignment: reservations by
-- time slot are an idea for later). Both sides go with their record; the API
-- bumps the other side's version first.
CREATE TABLE task_resources (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, resource_id)
);
CREATE INDEX task_resources_resource_idx ON task_resources (resource_id);

-- ---------------------------------------------------------------- notes

-- Operational notes. An incident here is a logistics incident (a late truck,
-- a broken fence): Punto Violeta cases and data about attended people are
-- never recorded in this tool. The text is withheld from guests, never
-- searched and never quoted in labels (activity, links).
--
-- A note points at its event and/or at most one record, one nullable column
-- per record type, so the database keeps referential integrity. No ON DELETE
-- action: the API unlinks notes (with a new version) before deleting what
-- they point at.
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('note', 'incident', 'decision', 'open_question', 'feature_idea')),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  event_id uuid REFERENCES events (id),
  task_id uuid REFERENCES tasks (id),
  venue_id uuid REFERENCES venues (id),
  company_id uuid REFERENCES companies (id),
  contact_id uuid REFERENCES contacts (id),
  offer_id uuid REFERENCES offers (id),
  warehouse_id uuid REFERENCES warehouses (id),
  resource_id uuid REFERENCES resources (id),
  -- Incidents and open questions: resolved / answered.
  resolved boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text CHECK (source IN ('observed', 'reported', 'document')),
  verification text NOT NULL DEFAULT 'draft'
    CHECK (verification IN ('draft', 'to_verify', 'validated')),
  is_demo boolean NOT NULL DEFAULT false,
  CONSTRAINT notes_one_ref_check CHECK (
    num_nonnulls(task_id, venue_id, company_id, contact_id, offer_id,
                 warehouse_id, resource_id) <= 1
  )
);
-- Newest first per organization.
CREATE INDEX notes_org_created_idx ON notes (organization_id, created_at DESC, id);
-- Unlinking on delete looks notes up by what they point at.
CREATE INDEX notes_event_idx ON notes (event_id);
CREATE INDEX notes_task_idx ON notes (task_id);
CREATE INDEX notes_venue_idx ON notes (venue_id);
CREATE INDEX notes_company_idx ON notes (company_id);
CREATE INDEX notes_contact_idx ON notes (contact_id);
CREATE INDEX notes_offer_idx ON notes (offer_id);
CREATE INDEX notes_warehouse_idx ON notes (warehouse_id);
CREATE INDEX notes_resource_idx ON notes (resource_id);
