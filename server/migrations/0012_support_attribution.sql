-- 0012_support_attribution: who really made a change during a support
-- session (Revisión 1 · safety audit). A support session is an administrator
-- acting on someone else's account; until now its writes were signed only as
-- the account's owner. Each signed write now also keeps the administrator
-- behind the session, so the history reads «Dailos (soporte: Elvis)».
--
-- Additive only: new nullable columns. Existing rows get NULL (a normal
-- session, or unknown for writes made before this migration). Never edit once
-- applied.

-- Every activity row: the administrator behind the session that wrote it.
ALTER TABLE activity_log ADD COLUMN support_by uuid REFERENCES users (id);

-- «Mantener ambas» signed during a support session.
ALTER TABLE conflict_acceptances ADD COLUMN support_by uuid REFERENCES users (id);

-- An approval or rejection of a received proposal decided during a support
-- session (set together with `decided_by`).
ALTER TABLE proposals ADD COLUMN decided_support_by uuid REFERENCES users (id);
ALTER TABLE proposals ADD CONSTRAINT proposals_decided_support_check
  CHECK (decided_support_by IS NULL OR decided_by IS NOT NULL);
