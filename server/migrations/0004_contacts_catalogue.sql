-- 0004_contacts_catalogue: contacts and catalogue (milestone 3).
-- Categories (built-in service categories for every organization), the full
-- «Empresas y entidades» record (kind, categories, main contact), contacts and
-- their events, the contact of a task, supplier offers and each user's recent
-- searches. Additive only: new tables and columns, plus clearing
-- companies.main_contact_id (no contact could exist before this migration, so
-- any value there points at nothing). Never edit once applied.

-- ---------------------------------------------------------------- categories

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- service = companies and offers; resource = inventory (milestone 4).
  scope text NOT NULL CHECK (scope IN ('service', 'resource')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- Built-ins cannot be deleted and keep their display order in position.
  built_in boolean NOT NULL DEFAULT false,
  position integer CHECK (position IS NULL OR position >= 1),
  -- NULL only for built-ins created by a migration or the seed.
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (built_in = (position IS NOT NULL)),
  CHECK (built_in OR created_by IS NOT NULL)
);
-- One category per name, scope and organization, whatever the letter case.
CREATE UNIQUE INDEX categories_org_scope_name_key
  ON categories (organization_id, scope, lower(name));

-- The built-in service categories, in display order. The same list lives in
-- shared/logistics/rules.ts (BUILT_IN_SERVICE_CATEGORIES), which the seed uses
-- for organizations created later; a server test pins this copy to it.
INSERT INTO categories (organization_id, scope, name, built_in, position)
SELECT o.id, 'service', b.name, true, b.position
  FROM organizations o
 CROSS JOIN (VALUES
   (1, 'Montaje'),
   (2, 'Estructuras'),
   (3, 'Carpas'),
   (4, 'Vallas'),
   (5, 'Transporte'),
   (6, 'Catering'),
   (7, 'Publicidad'),
   (8, 'Personal'),
   (9, 'Seguridad'),
   (10, 'Sonido'),
   (11, 'Iluminación'),
   (12, 'Audiovisuales'),
   (13, 'Limpieza'),
   (14, 'Ocio'),
   (15, 'Otros servicios')
 ) AS b (position, name);

-- ---------------------------------------------------------------- companies and entities

-- Not every counterpart is a supplier: municipal departments, associations…
ALTER TABLE companies ADD COLUMN kind text NOT NULL DEFAULT 'supplier'
  CHECK (kind IN ('supplier', 'public_body', 'association', 'other'));

CREATE TABLE company_categories (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, category_id)
);
CREATE INDEX company_categories_category_idx ON company_categories (category_id);

-- ---------------------------------------------------------------- contacts

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The API unlinks contacts (with a new version) before deleting a company.
  company_id uuid REFERENCES companies (id),
  -- Two people may share a name: no unique index.
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  role text CHECK (role IS NULL OR length(role) <= 120),
  phone text CHECK (phone IS NULL OR length(phone) <= 50),
  email text CHECK (email IS NULL OR length(email) <= 254),
  description text CHECK (description IS NULL OR length(description) <= 5000),
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
CREATE INDEX contacts_org_name_idx ON contacts (organization_id, lower(name));
CREATE INDEX contacts_company_idx ON contacts (company_id);

CREATE TABLE contact_events (
  contact_id uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, event_id)
);
CREATE INDEX contact_events_event_idx ON contact_events (event_id);

-- The main contact of a company (the API keeps it one of the company's own
-- contacts). Nothing could point at a contact before this migration.
UPDATE companies SET main_contact_id = NULL WHERE main_contact_id IS NOT NULL;
ALTER TABLE companies ADD CONSTRAINT companies_main_contact_fk
  FOREIGN KEY (main_contact_id) REFERENCES contacts (id) ON DELETE SET NULL;
CREATE INDEX companies_main_contact_idx ON companies (main_contact_id);

-- The person to call about a task.
ALTER TABLE tasks ADD COLUMN contact_id uuid
  REFERENCES contacts (id) ON DELETE SET NULL;
CREATE INDEX tasks_contact_idx ON tasks (contact_id);

-- ---------------------------------------------------------------- offers

-- Amounts are euros; NULL = unknown, never 0. Costs stay apart (no total).
-- A billing unit never derives a load per square metre.
CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  price numeric(12, 2) CHECK (price IS NULL OR price BETWEEN 0 AND 10000000),
  unit text NOT NULL DEFAULT 'unit'
    CHECK (unit IN ('unit', 'metre', 'hour', 'day', 'km', 'pack', 'custom')),
  custom_unit text CHECK (custom_unit IS NULL OR length(custom_unit) <= 60),
  transport_cost numeric(12, 2)
    CHECK (transport_cost IS NULL OR transport_cost BETWEEN 0 AND 10000000),
  assembly_cost numeric(12, 2)
    CHECK (assembly_cost IS NULL OR assembly_cost BETWEEN 0 AND 10000000),
  maintenance_cost numeric(12, 2)
    CHECK (maintenance_cost IS NULL OR maintenance_cost BETWEEN 0 AND 10000000),
  conditions text CHECK (conditions IS NULL OR length(conditions) <= 5000),
  -- NULL = not known, never assumed.
  vat_included boolean,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text CHECK (source IN ('observed', 'reported', 'document')),
  verification text NOT NULL DEFAULT 'draft'
    CHECK (verification IN ('draft', 'to_verify', 'validated')),
  is_demo boolean NOT NULL DEFAULT false,
  -- The wording of a unit exists only for a custom unit.
  CHECK (custom_unit IS NULL OR unit = 'custom')
);
CREATE INDEX offers_org_idx ON offers (organization_id);
CREATE INDEX offers_company_idx ON offers (company_id);
CREATE INDEX offers_category_idx ON offers (category_id);

-- ---------------------------------------------------------------- recent searches

-- Each user's last searches per organization (the API keeps five). Not
-- logged in the activity: they are personal, not shared logistics data.
CREATE SEQUENCE recent_searches_seq;
CREATE TABLE recent_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  query text NOT NULL CHECK (length(btrim(query)) BETWEEN 1 AND 100),
  -- Accent- and case-insensitive form (shared normalize()); one row per form.
  normalized text NOT NULL CHECK (length(normalized) BETWEEN 1 AND 200),
  searched_at timestamptz NOT NULL DEFAULT now(),
  -- Recency order, renewed when the same search is repeated.
  seq bigint NOT NULL DEFAULT nextval('recent_searches_seq')
);
ALTER SEQUENCE recent_searches_seq OWNED BY recent_searches.seq;
CREATE UNIQUE INDEX recent_searches_user_query_key
  ON recent_searches (user_id, organization_id, normalized);
CREATE INDEX recent_searches_user_seq_idx
  ON recent_searches (user_id, organization_id, seq DESC);
