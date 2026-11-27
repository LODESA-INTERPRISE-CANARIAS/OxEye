-- 0010_money: taxes and event budgets (Revisión 1 · E5).
-- A tax per company and, optionally, per offer (IGIC, IVA, another one by
-- name, none, or «sin saber»), each with its percentage and «por verificar»
-- until somebody confirms it; one budget per event and its expenses, with a
-- copy of the offer an expense came from. Additive only: new nullable
-- columns and new tables. Existing companies and offers get no tax (NULL =
-- nobody said; no percentage is invented) and keep `vat_included` exactly as
-- it was. Never edit once applied.
--
-- Amounts are euros before tax with two decimals (like offer prices); NULL
-- is unknown, never 0. Budget data is only served to members with the
-- `budget.read` permission; amounts never reach the activity log.

-- ---------------------------------------------------------------- taxes

-- One shape for companies, offers and expenses:
-- - regime NULL: no tax recorded (every other column NULL too);
-- - `other` carries a name; no other regime does;
-- - `none` is 0 %; `unknown` has no rate; the rest may have one or not yet;
-- - a recorded tax is `to_verify` or `validated`.

ALTER TABLE companies ADD COLUMN tax_regime text
  CHECK (tax_regime IN ('igic', 'iva', 'other', 'none', 'unknown'));
ALTER TABLE companies ADD COLUMN tax_name text
  CHECK (tax_name IS NULL OR length(btrim(tax_name)) BETWEEN 1 AND 40);
ALTER TABLE companies ADD COLUMN tax_rate numeric(5, 2)
  CHECK (tax_rate IS NULL OR tax_rate BETWEEN 0 AND 100);
ALTER TABLE companies ADD COLUMN tax_verification text
  CHECK (tax_verification IN ('to_verify', 'validated'));
ALTER TABLE companies ADD CONSTRAINT companies_tax_check CHECK (
  (tax_regime IS NULL AND tax_name IS NULL AND tax_rate IS NULL
   AND tax_verification IS NULL)
  OR (tax_regime IS NOT NULL AND tax_verification IS NOT NULL
      AND (tax_regime = 'other') = (tax_name IS NOT NULL)
      AND (tax_regime <> 'none' OR tax_rate = 0)
      AND (tax_regime <> 'unknown' OR tax_rate IS NULL)));

-- An offer's own tax; NULL = it inherits its company's.
ALTER TABLE offers ADD COLUMN tax_regime text
  CHECK (tax_regime IN ('igic', 'iva', 'other', 'none', 'unknown'));
ALTER TABLE offers ADD COLUMN tax_name text
  CHECK (tax_name IS NULL OR length(btrim(tax_name)) BETWEEN 1 AND 40);
ALTER TABLE offers ADD COLUMN tax_rate numeric(5, 2)
  CHECK (tax_rate IS NULL OR tax_rate BETWEEN 0 AND 100);
ALTER TABLE offers ADD COLUMN tax_verification text
  CHECK (tax_verification IN ('to_verify', 'validated'));
ALTER TABLE offers ADD CONSTRAINT offers_tax_check CHECK (
  (tax_regime IS NULL AND tax_name IS NULL AND tax_rate IS NULL
   AND tax_verification IS NULL)
  OR (tax_regime IS NOT NULL AND tax_verification IS NOT NULL
      AND (tax_regime = 'other') = (tax_name IS NOT NULL)
      AND (tax_regime <> 'none' OR tax_rate = 0)
      AND (tax_regime <> 'unknown' OR tax_rate IS NULL)));

-- ---------------------------------------------------------------- budgets

-- One row per event once somebody sets its budget (taxes included). An event
-- without a row has no budget yet (the API answers version 0).
CREATE TABLE event_budgets (
  event_id uuid PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  amount numeric(12, 2) CHECK (amount IS NULL OR amount BETWEEN 0 AND 10000000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_budgets_org_idx ON event_budgets (organization_id);

-- ---------------------------------------------------------------- expenses

-- What an event expects to pay (planned) or has agreed (confirmed). Not
-- accounting: no invoices, no payments. Deleted with its event. A company
-- delete keeps the expense: the API unlinks it first (company_id NULL, the
-- name kept in company_name, new version). `offer_snapshot` is a copy of the
-- offer it came from, written once and never updated.
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  concept text NOT NULL CHECK (length(btrim(concept)) BETWEEN 1 AND 200),
  company_id uuid REFERENCES companies (id),
  company_name text
    CHECK (company_name IS NULL OR length(btrim(company_name)) BETWEEN 1 AND 200),
  amount numeric(12, 2) CHECK (amount IS NULL OR amount BETWEEN 0 AND 10000000),
  tax_regime text
    CHECK (tax_regime IN ('igic', 'iva', 'other', 'none', 'unknown')),
  tax_name text
    CHECK (tax_name IS NULL OR length(btrim(tax_name)) BETWEEN 1 AND 40),
  tax_rate numeric(5, 2) CHECK (tax_rate IS NULL OR tax_rate BETWEEN 0 AND 100),
  tax_verification text CHECK (tax_verification IN ('to_verify', 'validated')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'confirmed')),
  offer_snapshot jsonb
    CHECK (offer_snapshot IS NULL OR jsonb_typeof(offer_snapshot) = 'object'),
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
  -- A linked company always has its name copied (kept if it is deleted).
  CHECK (company_id IS NULL OR company_name IS NOT NULL),
  CONSTRAINT expenses_tax_check CHECK (
    (tax_regime IS NULL AND tax_name IS NULL AND tax_rate IS NULL
     AND tax_verification IS NULL)
    OR (tax_regime IS NOT NULL AND tax_verification IS NOT NULL
        AND (tax_regime = 'other') = (tax_name IS NOT NULL)
        AND (tax_regime <> 'none' OR tax_rate = 0)
        AND (tax_regime <> 'unknown' OR tax_rate IS NULL)))
);
CREATE INDEX expenses_event_idx ON expenses (event_id, created_at, id);
CREATE INDEX expenses_org_idx ON expenses (organization_id);
CREATE INDEX expenses_company_idx ON expenses (company_id);
