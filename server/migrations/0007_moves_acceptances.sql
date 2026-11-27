-- 0007_moves_acceptances: tasks and conflicts (Revisión 1 · E2).
-- Acronyms on the organization, venues and warehouses; optional daily opening
-- hours on venues and warehouses; accepted conflicts («Mantener ambas»); the
-- origin of a task move in the activity log. Additive only: new nullable
-- columns and a new table; no existing row changes. Never edit once applied.
--
-- Safety: an accepted conflict never hides a reminder (routes A/B/C, Carpa
-- Amarilla, subsoil): the API accepts only conflicts. A move changes task
-- times only; nothing here touches heavy_load or the declared subsoil mark.

-- ---------------------------------------------------------------- acronyms

-- As edited; NULL = not set (the UI proposes one). 1–12 characters without
-- spaces; the API also requires letters, digits or dots (`acronymProblem`).
ALTER TABLE organizations ADD COLUMN acronym text
  CHECK (acronym IS NULL OR (length(acronym) BETWEEN 1 AND 12 AND acronym !~ '\s'));
ALTER TABLE venues ADD COLUMN acronym text
  CHECK (acronym IS NULL OR (length(acronym) BETWEEN 1 AND 12 AND acronym !~ '\s'));
ALTER TABLE warehouses ADD COLUMN acronym text
  CHECK (acronym IS NULL OR (length(acronym) BETWEEN 1 AND 12 AND acronym !~ '\s'));

-- ---------------------------------------------------------------- opening hours

-- A daily window in the organization's time zone, local wall-clock times.
-- Both or neither (NULL = not known: nothing is limited); no overnight
-- windows.
ALTER TABLE venues ADD COLUMN opens_at time;
ALTER TABLE venues ADD COLUMN closes_at time;
ALTER TABLE venues ADD CONSTRAINT venues_opening_hours_check
  CHECK ((opens_at IS NULL) = (closes_at IS NULL)
         AND (opens_at IS NULL OR opens_at < closes_at));
ALTER TABLE warehouses ADD COLUMN opens_at time;
ALTER TABLE warehouses ADD COLUMN closes_at time;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_opening_hours_check
  CHECK ((opens_at IS NULL) = (closes_at IS NULL)
         AND (opens_at IS NULL OR opens_at < closes_at));

-- ---------------------------------------------------------------- accepted conflicts

-- «Mantener ambas»: a conflict warning the team decided to live with. It
-- applies while every task in `windows` keeps exactly that window (computed,
-- never stored); a withdrawal deletes the row (the activity log keeps who
-- accepted and who withdrew). Task ids live in the windows, without a foreign
-- key: an acceptance of a deleted task simply no longer applies.
CREATE TABLE conflict_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- `PlanWarning.key` of the accepted conflict.
  warning_key text NOT NULL CHECK (warning_key ~ '^[a-z_-]{1,40}(:[0-9a-f-]{36}){1,3}$'),
  -- [{taskId, startsAt, endsAt}, …] as the member saw them.
  windows jsonb NOT NULL
    CHECK (jsonb_typeof(windows) = 'array' AND jsonb_array_length(windows) BETWEEN 1 AND 10),
  -- The warning's title when accepted (built from names, never free text):
  -- the activity label, also when it is withdrawn later.
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 300),
  -- Withheld from guests.
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 280),
  accepted_by uuid NOT NULL REFERENCES users (id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  -- About demo tasks: removed with the demo data.
  is_demo boolean NOT NULL DEFAULT false
);
-- Newest first per organization.
CREATE INDEX conflict_acceptances_org_idx
  ON conflict_acceptances (organization_id, accepted_at DESC, id);

-- ---------------------------------------------------------------- moves in the history

-- Which confirmed move wrote a task update (calendar drag, a conflict exit,
-- «Deshacer»); NULL for every other entry.
ALTER TABLE activity_log ADD COLUMN move_origin text
  CHECK (move_origin IN ('conflict_delay', 'conflict_advance', 'calendar', 'undo'));
