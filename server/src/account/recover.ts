/**
 * Recovering an account from the machine that runs the server
 * (`npm --prefix server run cuenta:recuperar -- <usuario>`): the guaranteed
 * way back in while recovery e-mail is not available, above all for the
 * developer account, which nobody else can reset from the app.
 *
 * Only that account changes: a new provisional password (returned once,
 * stored only as its hash), its sessions end, its pending reset links are
 * dropped, and a developer account gets its fixed roles back. Logged in its
 * security history as a provisional password set «desde el servidor», with
 * no actor and no secret.
 */
import type {Db} from '../db/db.ts';
import {generatePassword, hashPassword} from '../auth/password.ts';
import {setPassword} from '../auth/service.ts';
import {deleteUserSessions} from '../auth/sessions.ts';
import {parseRoles} from '../organizations/service.ts';
import {logSecurity} from './security.ts';
import {
  isSharedAccount,
  normalizeRoles,
} from '../../../shared/logistics/permissions.ts';
import type {Role} from '../../../shared/logistics/contracts.ts';

/** Shown in the account's security history (`detail`). */
export const RECOVERED_ON_SERVER = 'Recuperada desde el servidor';

export class RecoverError extends Error {}

export interface RecoverResult {
  username: string;
  password: string;
  /** False for shared accounts (Equipo, Invitado): they cannot change it. */
  provisional: boolean;
  developer: boolean;
}

export async function recoverAccount(
  db: Db,
  username: string,
  now: Date,
): Promise<RecoverResult> {
  const name = username.trim();
  if (!name) {
    throw new RecoverError(
      'Indica el usuario: npm --prefix server run cuenta:recuperar -- <usuario>',
    );
  }
  const [user] = await db.query<{
    id: string;
    username: string;
    role: string;
    is_active: boolean;
  }>(
    `SELECT id, username, role, is_active FROM users
      WHERE lower(username) = lower($1)`,
    [name],
  );
  if (!user || !user.is_active) {
    throw new RecoverError(
      `No hay ninguna cuenta activa con el usuario «${name}». No se ha cambiado nada.`,
    );
  }
  const password = generatePassword();
  const hash = await hashPassword(password);
  // A shared account (Equipo, Invitado) cannot change its password: this is
  // its password, never provisional (as in «Usuarios»).
  const memberships = await db.query<{roles: unknown}>(
    'SELECT roles FROM organization_members WHERE user_id = $1',
    [user.id],
  );
  const provisional = !isSharedAccount(
    user.role as Role,
    memberships.map(m => normalizeRoles(parseRoles(m.roles))),
  );
  const developer = await db.transaction(async tx => {
    await setPassword(tx, user.id, hash, provisional, now);
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [user.id],
    );
    await deleteUserSessions(tx, user.id);
    // A developer account always has administration too.
    const fixed = await tx.query<{organization_id: string}>(
      `UPDATE organization_members
          SET roles = ARRAY(SELECT r FROM unnest(ARRAY['admin', 'developer', 'team']::text[]) AS r
                             WHERE r = 'admin' OR r = ANY(roles))
        WHERE user_id = $1 AND 'developer' = ANY(roles)
        RETURNING organization_id`,
      [user.id],
    );
    await logSecurity(tx, {
      userId: user.id,
      kind: 'password_provisional_set',
      detail: RECOVERED_ON_SERVER,
      at: now,
    });
    return fixed.length > 0;
  });
  return {username: user.username, password, provisional, developer};
}
