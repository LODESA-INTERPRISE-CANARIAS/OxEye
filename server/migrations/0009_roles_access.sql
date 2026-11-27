-- 0009_roles_access: personal access and roles (Revisión 1 · E4).
-- Login names, profiles, provisional passwords, roles per membership,
-- support sessions, single-use account links and a security log. Additive:
-- new columns (with a default or NULL) and new tables; no existing value is
-- lost. Never edit once applied.
--
-- Backfills, all reversible by hand and none destructive:
-- - the login name of every existing account is its display name;
-- - every existing password is provisional (they were shared on paper);
-- - every existing `member` keeps editing the plan (role `team`) until an
--   administrator or the pilot seed sets its roles.
--
-- Safety: no password, token or hash is ever written in clear; account
-- links keep only the SHA-256 of their token; the security log holds no
-- password, token, hash or e-mail address.

-- ---------------------------------------------------------------- users

ALTER TABLE users ADD COLUMN username text;
UPDATE users SET username = btrim(display_name);
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
-- Never changes once set; compared without letter case.
ALTER TABLE users ADD CONSTRAINT users_username_format_check
  CHECK (length(username) BETWEEN 1 AND 80 AND username = btrim(username));
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

ALTER TABLE users ADD COLUMN bio text
  CHECK (bio IS NULL OR length(btrim(bio)) BETWEEN 1 AND 280);
-- Key of an accent colour offered by the app; NULL = the palette's own.
ALTER TABLE users ADD COLUMN accent text
  CHECK (accent IS NULL OR accent ~ '^[a-z][a-z0-9-]{0,31}$');
-- Set by someone else (seed, administrator): sensitive permissions are
-- withheld until its owner replaces it.
ALTER TABLE users ADD COLUMN password_provisional boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN welcomed_at timestamptz;
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
-- Only a verified address is stored here; one waiting for verification
-- lives in its account link.
ALTER TABLE users ADD COLUMN recovery_email text
  CHECK (recovery_email IS NULL
         OR (length(recovery_email) BETWEEN 3 AND 254
             AND recovery_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
ALTER TABLE users ADD COLUMN recovery_email_verified_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_recovery_email_verified_check
  CHECK ((recovery_email IS NULL) = (recovery_email_verified_at IS NULL));

-- ---------------------------------------------------------------- roles

-- Roles add up (`admin`, `developer`, `team`); the permissions they give
-- live in shared/logistics/permissions.ts. The shared guest account keeps
-- no roles: it only reads.
ALTER TABLE organization_members ADD COLUMN roles text[] NOT NULL DEFAULT '{}'
  CHECK (roles <@ ARRAY['admin', 'developer', 'team']::text[]);
-- Who set the roles last and when; NULL = never set by a person (the
-- pilot seed then applies its defaults once).
ALTER TABLE organization_members ADD COLUMN roles_set_at timestamptz;
ALTER TABLE organization_members ADD COLUMN roles_set_by uuid REFERENCES users (id);
UPDATE organization_members m
   SET roles = ARRAY['team']::text[]
  FROM users u
 WHERE u.id = m.user_id AND u.role = 'member';

-- ---------------------------------------------------------------- sessions

-- `support`: an administrator acting on someone's account for a few minutes,
-- with a reason; `view_as_guest`: an administrator seeing what the guest
-- account sees (the session belongs to the guest account). Both have a fixed
-- end (no sliding) and record who opened them.
ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'normal'
  CHECK (kind IN ('normal', 'support', 'view_as_guest'));
-- Short label from the user agent («Chrome · Windows»), never the full string.
ALTER TABLE sessions ADD COLUMN device text
  CHECK (device IS NULL OR length(device) BETWEEN 1 AND 60);
ALTER TABLE sessions ADD COLUMN opened_by uuid REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN reason text
  CHECK (reason IS NULL OR length(reason) BETWEEN 10 AND 280);
ALTER TABLE sessions ADD CONSTRAINT sessions_opened_by_check
  CHECK ((kind = 'normal') = (opened_by IS NULL)
         AND (kind = 'support') = (reason IS NOT NULL));
CREATE INDEX sessions_opened_by_idx ON sessions (opened_by)
  WHERE opened_by IS NOT NULL;

-- ---------------------------------------------------------------- account links

-- Single-use links: password reset and e-mail verification. Only the SHA-256
-- of the token is kept; `used_at` marks it spent.
CREATE TABLE account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- The address waiting for verification (email_verify only).
  email text CHECK (email IS NULL
                    OR (length(email) BETWEEN 3 AND 254
                        AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  -- The administrator who asked for a reset link, if any.
  created_by uuid REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'email_verify') = (email IS NOT NULL))
);
CREATE INDEX account_tokens_user_idx ON account_tokens (user_id, purpose);

-- ---------------------------------------------------------------- security log

-- Who did what to an account. `detail` holds only the reason of a support
-- session; never a password, token, hash or e-mail address.
CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind ~ '^[a-z_]{1,40}$'),
  detail text CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 280),
  device text CHECK (device IS NULL OR length(device) BETWEEN 1 AND 60),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user_idx ON security_events (user_id, at DESC, id);
CREATE INDEX security_events_at_idx ON security_events (at DESC, id);

-- ---------------------------------------------------------------- profile photo

-- At most one profile photo per account.
CREATE UNIQUE INDEX media_user_photo_key ON media (owner_id)
  WHERE owner_type = 'user';
