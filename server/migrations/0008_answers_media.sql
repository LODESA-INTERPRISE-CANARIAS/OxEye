-- 0008_answers_media: answers to open questions and images (Revisión 1 · E3).
-- Who resolved a note and when; answers kept as an append-only chain; images
-- stored in PostgreSQL (so backups include them). Additive only: new
-- nullable columns and new tables; no existing row changes. Never edit once
-- applied.
--
-- Safety: an answer is free text like the note itself: withheld from guests,
-- never searched, never quoted in a label. Notes and answers never hold
-- Punto Violeta cases or data about attended people. Images are of material;
-- nothing here derives a load or a measurement from them.

-- ---------------------------------------------------------------- resolution

-- Who marked a note resolved / answered and when; both or neither. Existing
-- resolved notes keep NULL (not known who), never an invented author.
ALTER TABLE notes ADD COLUMN resolved_by uuid REFERENCES users (id);
ALTER TABLE notes ADD COLUMN resolved_at timestamptz;
ALTER TABLE notes ADD CONSTRAINT notes_resolved_by_check
  CHECK ((resolved_by IS NULL) = (resolved_at IS NULL)
         AND (resolved_by IS NULL OR resolved));

-- ---------------------------------------------------------------- answers

-- Answers are never edited, only replaced: each new answer names the one it
-- replaces, so the chain of a note is linear and its current answer is the
-- one nothing replaces. They go with their note.
CREATE TABLE note_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  -- Withheld from guests.
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  answered_by uuid NOT NULL REFERENCES users (id),
  answered_at timestamptz NOT NULL DEFAULT now(),
  replaces_id uuid,
  CONSTRAINT note_answers_note_id_key UNIQUE (note_id, id),
  -- The replaced answer belongs to the same note.
  CONSTRAINT note_answers_replaces_fkey FOREIGN KEY (note_id, replaces_id)
    REFERENCES note_answers (note_id, id) ON DELETE CASCADE,
  CONSTRAINT note_answers_replaces_check CHECK (replaces_id IS NULL OR replaces_id <> id)
);
-- One first answer per note, and each answer replaced at most once.
CREATE UNIQUE INDEX note_answers_first_key ON note_answers (note_id)
  WHERE replaces_id IS NULL;
CREATE UNIQUE INDEX note_answers_replaces_key ON note_answers (replaces_id)
  WHERE replaces_id IS NOT NULL;
CREATE INDEX note_answers_note_idx ON note_answers (note_id, answered_at DESC, id);

-- ---------------------------------------------------------------- images

-- One image of one record (a resource today; profile photos later). The
-- owner is polymorphic, so there is no foreign key to it: every delete path
-- of an owner deletes its media first (resources, demo removal).
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('resource', 'user')),
  owner_id uuid NOT NULL,
  content_type text NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  -- At most 600 KB (MEDIA_MAX_BYTES); always the length of `data`.
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 614400),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  is_main boolean NOT NULL DEFAULT false,
  data bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_demo boolean NOT NULL DEFAULT false,
  CONSTRAINT media_data_length_check CHECK (octet_length(data) = bytes)
);
-- At most one main image per record.
CREATE UNIQUE INDEX media_main_key ON media (owner_type, owner_id) WHERE is_main;
CREATE INDEX media_owner_idx ON media (owner_type, owner_id, created_at, id);
