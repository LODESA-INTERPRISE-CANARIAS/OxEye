-- 0002_tasks: tasks and calendar (milestone 2).
-- Multi-day events, companies (the part milestone 2 needs; milestone 3 adds
-- categories, contacts and offers), tasks and their finish-to-start
-- dependencies. Additive only: no existing column or row changes, so it
-- applies on top of a database already in use. Never edit once applied.

-- Last local day of a multi-day event; NULL = same day (or overnight).
ALTER TABLE events ADD COLUMN end_date date;
ALTER TABLE events ADD CONSTRAINT events_end_date_check
  CHECK (end_date IS NULL OR (local_date IS NOT NULL AND end_date > local_date));

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  phone text CHECK (phone IS NULL OR length(phone) <= 50),
  email text CHECK (email IS NULL OR length(email) <= 254),
  website text CHECK (website IS NULL OR length(website) <= 500),
  notes text CHECK (notes IS NULL OR length(notes) <= 5000),
  -- Contacts arrive in milestone 3; the foreign key is added then.
  main_contact_id uuid,
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
-- One company per name and organization, whatever the letter case.
CREATE UNIQUE INDEX companies_org_name_key ON companies (organization_id, lower(name));

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Optional: a task can stand alone. Deleting the event keeps its tasks.
  event_id uuid REFERENCES events (id) ON DELETE SET NULL,
  venue_id uuid REFERENCES venues (id),
  company_id uuid REFERENCES companies (id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('assembly', 'activity', 'dismantling', 'transport', 'delivery', 'other')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'confirmed', 'in_progress', 'done', 'delayed', 'cancelled')),
  local_date date,
  end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Atlantic/Canary'
    CHECK (length(timezone) BETWEEN 1 AND 64),
  -- NULL = not yet known. Never default to false: unknown is not light.
  heavy_load boolean,
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
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  -- A time is never stored without its day.
  CHECK ((starts_at IS NULL AND ends_at IS NULL) OR local_date IS NOT NULL),
  CHECK (end_date IS NULL OR (local_date IS NOT NULL AND end_date > local_date))
);
CREATE INDEX tasks_org_date_idx ON tasks (organization_id, local_date, starts_at);
CREATE INDEX tasks_event_idx ON tasks (event_id);
CREATE INDEX tasks_venue_idx ON tasks (venue_id);
CREATE INDEX tasks_company_idx ON tasks (company_id);

-- Finish-to-start: task_id cannot start before depends_on_id ends. Cycles are
-- rejected by the API (a CHECK cannot see the whole graph).
CREATE TABLE task_dependencies (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);
CREATE INDEX task_dependencies_depends_on_idx ON task_dependencies (depends_on_id);
