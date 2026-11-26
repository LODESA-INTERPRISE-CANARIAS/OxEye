-- 0006_followup: day follow-up and delay hypotheses (milestone 5).
-- The declared mark «Subsuelo revisado en el simulador» on tasks, and stored
-- «¿Y si…?» delay hypotheses. Additive only: new nullable columns and a new
-- table; no existing row changes. Never edit once applied.
--
-- Safety: the subsoil mark is declared by a member after running the
-- simulator's X-ray check. Nothing here infers it, computes a load or quotes
-- a threshold, and nothing sets it by default. A hypothesis only ever moves
-- task times when a member applies it; it never touches heavy_load.

-- ---------------------------------------------------------------- subsoil mark

-- Who declared the review and when; both or neither. The API clears it when
-- the task's venue, heavy load or resources change.
ALTER TABLE tasks ADD COLUMN subsoil_reviewed_by uuid REFERENCES users (id);
ALTER TABLE tasks ADD COLUMN subsoil_reviewed_at timestamptz;
ALTER TABLE tasks ADD CONSTRAINT tasks_subsoil_review_check
  CHECK ((subsoil_reviewed_by IS NULL) = (subsoil_reviewed_at IS NULL));

-- ---------------------------------------------------------------- hypotheses

-- A stored delay scenario. Open ones can be discarded; applied ones stay as a
-- record of the decision. task_id has no ON DELETE action: deleting a task
-- deletes its open hypotheses and unlinks the applied ones first, so a delete
-- path that forgot to do so fails instead of losing them silently.
CREATE TABLE hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks (id),
  -- The task's title when it was saved: a label, kept if the task goes.
  task_title text NOT NULL CHECK (length(btrim(task_title)) BETWEEN 1 AND 200),
  delay_minutes integer NOT NULL CHECK (delay_minutes BETWEEN 1 AND 1440),
  -- shift: the task starts later; extend: it ends later («se alarga»).
  mode text NOT NULL DEFAULT 'shift' CHECK (mode IN ('shift', 'extend')),
  estimated boolean NOT NULL DEFAULT false,
  -- Withheld from guests.
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid REFERENCES users (id),
  applied_at timestamptz,
  -- About a demo task: removed with the demo data.
  is_demo boolean NOT NULL DEFAULT false,
  CONSTRAINT hypotheses_applied_check
    CHECK ((applied_by IS NULL) = (applied_at IS NULL))
);
-- Newest first per organization.
CREATE INDEX hypotheses_org_created_idx
  ON hypotheses (organization_id, created_at DESC, id);
-- Deleting a task looks its hypotheses up.
CREATE INDEX hypotheses_task_idx ON hypotheses (task_id);
