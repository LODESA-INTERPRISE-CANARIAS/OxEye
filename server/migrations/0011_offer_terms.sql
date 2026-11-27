-- 0011_offer_terms: offers with validity, quote requests and supplier
-- proposals (Revisión 1 · E6–E7). Additive: new tables only, keyed by offer,
-- company, event and task ids; no existing table or row changes. Never edit
-- once applied.
--
-- - offer_versions: the terms of each offer, one version per approval
--   (seasonal rates, supplements, minimums, conditions, the acceptance
--   deadline, service months and commitment, all before tax), never edited;
--   a new version supersedes the previous one. An offer recorded before E6
--   has no version until it is renegotiated (its catalogue data is then kept
--   as version 1).
-- - quote_requests / quote_request_links: a need sent to companies, one
--   personal link each. Only the SHA-256 of a link's token is stored.
-- - proposals: what a company sent (or a member recorded by hand), pending
--   until an administrator approves or rejects it.
-- - offer_settings: per organization, the renewal notice and the open
--   «presentar oferta» link (off by default; only its hash is stored).
-- - offer_renewals: the «Generada por Ox Eye» mark of a renegotiation task
--   and its assignee; at most one per offer version.

-- ---------------------------------------------------------------- settings

CREATE TABLE offer_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  renewal_notice_days integer NOT NULL DEFAULT 30
    CHECK (renewal_notice_days IN (15, 30, 60, 90)),
  open_link_hash text UNIQUE CHECK (open_link_hash ~ '^[0-9a-f]{64}$'),
  open_link_created_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_settings_open_link_check
    CHECK ((open_link_hash IS NULL) = (open_link_created_at IS NULL))
);

-- ---------------------------------------------------------------- quote requests

CREATE TABLE quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  unit_label text CHECK (unit_label IS NULL OR length(unit_label) BETWEEN 1 AND 40),
  days integer NOT NULL CHECK (days BETWEEN 1 AND 366),
  hours_per_day numeric(4, 2)
    CHECK (hours_per_day IS NULL OR (hours_per_day > 0 AND hours_per_day <= 24)),
  date_from date,
  date_to date,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  event_id uuid REFERENCES events (id) ON DELETE SET NULL,
  offer_id uuid REFERENCES offers (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES users (id),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT quote_requests_dates_check
    CHECK (date_to IS NULL OR (date_from IS NOT NULL AND date_to >= date_from)),
  CONSTRAINT quote_requests_closed_check
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX quote_requests_org_idx ON quote_requests (organization_id, created_at DESC);

CREATE TABLE quote_request_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES quote_requests (id) ON DELETE CASCADE,
  -- NULL once the company is deleted; its name stays.
  company_id uuid REFERENCES companies (id) ON DELETE SET NULL,
  company_name text NOT NULL CHECK (length(btrim(company_name)) BETWEEN 1 AND 200),
  -- SHA-256 of the token; renewing the link replaces it.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'answered', 'approved', 'rejected', 'declined', 'revoked')),
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  answered_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR length(decline_reason) <= 280),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_request_links_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX quote_request_links_request_idx ON quote_request_links (request_id);
CREATE UNIQUE INDEX quote_request_links_company_key
  ON quote_request_links (request_id, company_id) WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------- proposals

CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  via text NOT NULL CHECK (via IN ('link', 'open', 'manual')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected')),
  request_id uuid REFERENCES quote_requests (id) ON DELETE SET NULL,
  -- One proposal per personal link.
  link_id uuid UNIQUE REFERENCES quote_request_links (id) ON DELETE SET NULL,
  -- The offer it renegotiates, if any.
  offer_id uuid REFERENCES offers (id) ON DELETE SET NULL,
  company_name text NOT NULL CHECK (length(btrim(company_name)) BETWEEN 1 AND 200),
  -- Validated at the API boundary (ProposalContent).
  content jsonb NOT NULL
    CHECK (jsonb_typeof(content) = 'object' AND length(content::text) <= 65536),
  origin text CHECK (origin IS NULL OR length(btrim(origin)) BETWEEN 1 AND 200),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  reject_reason text
    CHECK (reject_reason IS NULL OR length(btrim(reject_reason)) BETWEEN 3 AND 280),
  result jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(result) = 'array'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT proposals_manual_check CHECK ((via = 'manual') = (created_by IS NOT NULL)),
  CONSTRAINT proposals_decided_check
    CHECK ((state = 'pending') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT proposals_reason_check CHECK ((state = 'rejected') = (reject_reason IS NOT NULL))
);
CREATE INDEX proposals_org_idx ON proposals (organization_id, received_at DESC);

-- ---------------------------------------------------------------- offer versions

CREATE TABLE offer_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number >= 1),
  -- Validated at the API boundary (OfferTerms).
  terms jsonb NOT NULL
    CHECK (jsonb_typeof(terms) = 'object' AND length(terms::text) <= 65536),
  -- A copy of terms.acceptUntil, for renewals and listings.
  accept_until date,
  change_note text CHECK (change_note IS NULL OR length(change_note) <= 280),
  proposal_id uuid REFERENCES proposals (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users (id),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (offer_id, number)
);
-- One version in force per offer.
CREATE UNIQUE INDEX offer_versions_current_key
  ON offer_versions (offer_id) WHERE superseded_at IS NULL;
CREATE INDEX offer_versions_org_idx
  ON offer_versions (organization_id, accept_until) WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------- renewals

CREATE TABLE offer_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- At most one renegotiation task per version (generation is idempotent).
  offer_version_id uuid NOT NULL UNIQUE REFERENCES offer_versions (id) ON DELETE CASCADE,
  -- NULL once somebody deleted the task: it is not generated again.
  task_id uuid UNIQUE REFERENCES tasks (id) ON DELETE SET NULL,
  accept_until date NOT NULL,
  notice_days integer NOT NULL CHECK (notice_days IN (15, 30, 60, 90)),
  assignee_id uuid REFERENCES users (id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by_version_id uuid REFERENCES offer_versions (id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz
);
CREATE INDEX offer_renewals_org_idx ON offer_renewals (organization_id, accept_until);
