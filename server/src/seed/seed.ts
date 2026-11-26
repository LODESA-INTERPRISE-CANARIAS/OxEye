/**
 * Pilot seed: the organization, the five pilot users and one fictitious demo
 * event. Idempotent: running it again creates only what is missing and keeps
 * existing passwords unless `resetPasswords` is set. Passwords are generated
 * here and returned once; they are never stored in clear or committed.
 */
import type {Db, Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {generatePassword, hashPassword} from '../auth/password.ts';
import {deleteUserSessions} from '../auth/sessions.ts';
import {findOrCreateVenue} from '../venues/service.ts';
import {slotToInstants} from '../../../shared/logistics/time.ts';
import type {Organization, Role} from '../../../shared/logistics/contracts.ts';

export const PILOT_ORGANIZATION = {
  name: 'Ayuntamiento de San Cristóbal de La Laguna',
  timezone: 'Atlantic/Canary',
};

export const PILOT_USERS: {displayName: string; role: Role}[] = [
  {displayName: 'Elvis', role: 'member'},
  {displayName: 'Dailos', role: 'member'},
  {displayName: 'Yeray', role: 'member'},
  {displayName: 'Equipo', role: 'member'},
  {displayName: 'Invitado', role: 'guest'},
];

/** Author of seeded demo records; cannot log in and is not listed. */
export const SYSTEM_USER = 'Sistema';

export const DEMO_EVENT = {
  name: 'Navidad en la Plaza del Cristo',
  venueName: 'Plaza del Cristo',
  date: '2026-12-02',
  startTime: '09:00',
  endTime: '14:00',
  notes:
    'Evento ficticio de demostración. Elimínalo con «Borrar datos de demostración» antes de la jornada real.',
};

export interface SeededUser {
  displayName: string;
  role: Role;
  /** Set only when the password was created or reset in this run. */
  password: string | null;
  created: boolean;
}

export interface SeedResult {
  organization: Organization;
  organizationCreated: boolean;
  users: SeededUser[];
  demoEventCreated: boolean;
}

export interface SeedOptions {
  resetPasswords?: boolean;
  now?: Date;
  /** Password source; tests pass a deterministic one. */
  passwordFor?: (displayName: string) => string;
}

export async function seed(
  db: Db,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const now = options.now ?? new Date();
  const passwordFor = options.passwordFor ?? (() => generatePassword());

  // Hash outside the transaction: scrypt is slow on purpose.
  const existing = new Set(
    (
      await db.query<{name: string}>(
        'SELECT lower(display_name) AS name FROM users',
      )
    ).map(r => r.name),
  );
  const passwords = new Map<string, {clear: string; hash: string}>();
  for (const u of PILOT_USERS) {
    if (options.resetPasswords || !existing.has(u.displayName.toLowerCase())) {
      const clear = passwordFor(u.displayName);
      passwords.set(u.displayName, {clear, hash: await hashPassword(clear)});
    }
  }

  return db.transaction(async tx => {
    let organizationCreated = false;
    let org = (
      await tx.query<Organization>(
        'SELECT id, name, timezone FROM organizations WHERE lower(name) = lower($1)',
        [PILOT_ORGANIZATION.name],
      )
    )[0];
    if (!org) {
      org = (
        await tx.query<Organization>(
          `INSERT INTO organizations (name, timezone, created_at, updated_at)
           VALUES ($1, $2, $3::timestamptz, $3::timestamptz)
           RETURNING id, name, timezone`,
          [
            PILOT_ORGANIZATION.name,
            PILOT_ORGANIZATION.timezone,
            now.toISOString(),
          ],
        )
      )[0] as Organization;
      organizationCreated = true;
    }

    const users: SeededUser[] = [];
    for (const [index, u] of PILOT_USERS.entries()) {
      const pw = passwords.get(u.displayName);
      const found = (
        await tx.query<{id: string}>(
          'SELECT id FROM users WHERE lower(display_name) = lower($1)',
          [u.displayName],
        )
      )[0];
      let userId: string;
      let created = false;
      if (!found) {
        if (!pw) throw new Error(`Missing password for ${u.displayName}`);
        userId = (
          (
            await tx.query<{id: string}>(
              `INSERT INTO users (display_name, role, password_hash, sort_order, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)
               RETURNING id`,
              [
                u.displayName,
                u.role,
                pw.hash,
                (index + 1) * 10,
                now.toISOString(),
              ],
            )
          )[0] as {id: string}
        ).id;
        created = true;
      } else {
        userId = found.id;
        if (pw) {
          await tx.query(
            `UPDATE users SET password_hash = $2, is_active = true,
                    version = version + 1, updated_at = $3::timestamptz
              WHERE id = $1`,
            [userId, pw.hash, now.toISOString()],
          );
          // A new password closes the sessions opened with the old one.
          await deleteUserSessions(tx, userId);
        }
      }
      await tx.query(
        `INSERT INTO organization_members (organization_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [org.id, userId],
      );
      users.push({
        displayName: u.displayName,
        role: u.role,
        password: pw?.clear ?? null,
        created,
      });
    }

    const systemId = await ensureSystemUser(tx, now);

    const hasDemo = await tx.query(
      'SELECT 1 FROM events WHERE organization_id = $1 AND is_demo LIMIT 1',
      [org.id],
    );
    let demoEventCreated = false;
    if (hasDemo.length === 0) {
      const venue = await findOrCreateVenue(tx, {
        organizationId: org.id,
        name: DEMO_EVENT.venueName,
        actorId: systemId,
        now,
        isDemo: true,
      });
      const {startsAt, endsAt} = slotToInstants(
        DEMO_EVENT.date,
        DEMO_EVENT.startTime,
        DEMO_EVENT.endTime,
        org.timezone,
      );
      const event = (
        await tx.query<{id: string}>(
          `INSERT INTO events
             (organization_id, name, venue_id, local_date, starts_at, ends_at, timezone,
              status, notes, verification, is_demo,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4::date, $5::timestamptz, $6::timestamptz, $7,
                   'planned', $8, 'draft', true, $9, $10::timestamptz, $9, $10::timestamptz)
           RETURNING id`,
          [
            org.id,
            DEMO_EVENT.name,
            venue.id,
            DEMO_EVENT.date,
            startsAt,
            endsAt,
            org.timezone,
            DEMO_EVENT.notes,
            systemId,
            now.toISOString(),
          ],
        )
      )[0] as {id: string};
      await appendActivity(tx, {
        organizationId: org.id,
        userId: systemId,
        entityType: 'event',
        entityId: event.id,
        entityLabel: DEMO_EVENT.name,
        action: 'create',
        at: now,
        isDemo: true,
      });
      demoEventCreated = true;
    }

    return {organization: org, organizationCreated, users, demoEventCreated};
  });
}

async function ensureSystemUser(tx: Queryable, now: Date): Promise<string> {
  const found = (
    await tx.query<{id: string}>(
      'SELECT id FROM users WHERE lower(display_name) = lower($1)',
      [SYSTEM_USER],
    )
  )[0];
  if (found) return found.id;
  return (
    (
      await tx.query<{id: string}>(
        `INSERT INTO users (display_name, role, password_hash, is_active, sort_order, created_at, updated_at)
         VALUES ($1, 'guest', NULL, false, 1000, $2::timestamptz, $2::timestamptz)
         RETURNING id`,
        [SYSTEM_USER, now.toISOString()],
      )
    )[0] as {id: string}
  ).id;
}
