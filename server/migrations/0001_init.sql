-- 0001_init: Logistics Manager foundation (milestone 1).
-- Organizations, users and their memberships, sessions, venues, events and
-- the activity log. Forward-only: never edit this file once applied; add a
-- new migration instead.
--
-- Conventions
-- - UUID primary keys (gen_random_uuid, core since PostgreSQL 13).
-- - Instants are timestamptz (UTC); each event keeps its IANA time zone.
-- - Mutable records carry version (optimistic concurrency), created_by/at,
--   updated_by/at, source, verification and is_demo.
-- - Enumerations are text + CHECK, so adding a value is a small migration.

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  timezone text NOT NULL DEFAULT 'Atlantic/Canary'
    CHECK (length(timezone) BETWEEN 1 AND 64),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_name_key ON organizations (lower(name));

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('member', 'guest')),
  -- scrypt$N$r$p$salt$hash; NULL means the account cannot log in.
  password_hash text,
  is_active boolean NOT NULL DEFAULT true,
  -- Order on the login screen.
  sort_order integer NOT NULL DEFAULT 100,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_active OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX users_display_name_key ON users (lower(display_name));

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- Only the SHA-256 of the session token is stored; the token itself lives in
-- the client.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address text CHECK (address IS NULL OR length(address) <= 500),
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
-- One venue per name and organization, whatever the letter case.
CREATE UNIQUE INDEX venues_org_name_key ON venues (organization_id, lower(name));

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  venue_id uuid REFERENCES venues (id),
  -- Local calendar day in the event's time zone, kept even when the times
  -- are still unknown.
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Atlantic/Canary'
    CHECK (length(timezone) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'confirmed', 'delayed', 'cancelled')),
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
  CHECK ((starts_at IS NULL AND ends_at IS NULL) OR local_date IS NOT NULL)
);
CREATE INDEX events_org_starts_idx ON events (organization_id, starts_at);
CREATE INDEX events_venue_idx ON events (venue_id);

-- Append-only record of every write: who, what, which entity, when.
CREATE TABLE activity_log (
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z_]{1,40}$'),
  entity_id uuid NOT NULL,
  -- Human label of the entity at the time of the change.
  entity_label text NOT NULL CHECK (length(entity_label) <= 300),
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(changed_fields) = 'array'),
  at timestamptz NOT NULL DEFAULT now(),
  -- Rows about demo records go away with them.
  is_demo boolean NOT NULL DEFAULT false
);
CREATE INDEX activity_log_org_at_idx ON activity_log (organization_id, at DESC, seq DESC);
CREATE INDEX activity_log_entity_idx ON activity_log (entity_type, entity_id);
