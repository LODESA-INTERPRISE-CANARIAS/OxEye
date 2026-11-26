/**
 * Pilot seed: the organization, the five pilot users and one fictitious demo
 * event with its demo tasks. Idempotent: running it again creates only what is missing and keeps
 * existing passwords unless `resetPasswords` is set. Passwords are generated
 * here and returned once; they are never stored in clear or committed.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {generatePassword, hashPassword} from '../auth/password.ts';
import {deleteUserSessions} from '../auth/sessions.ts';
import {findOrCreateCompany} from '../companies/service.ts';
import {findOrCreateVenue} from '../venues/service.ts';
import {slotToInstants} from '../../../shared/logistics/time.ts';
import type {
  DataSource,
  Organization,
  Role,
  TaskKind,
  TaskStatus,
} from '../../../shared/logistics/contracts.ts';

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

export const DEMO_COMPANY = 'Escenarios Demo';

export interface DemoTask {
  /** Local key to wire dependencies; not stored. */
  key: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  venueName: string | null;
  companyName: string | null;
  startTime: string;
  endTime: string;
  heavyLoad: boolean | null;
  dependsOn: string[];
  source: DataSource | null;
  notes: string | null;
}

/**
 * The demo event's day (2 Dec 2026, Canary time), built to show every kind of
 * calendar warning: a deliberate venue overlap (lighting during the stage
 * assembly), heavy loads (subsoil reminder), a delivery whose load is still
 * unknown, and a transport while the event is on (routes A/B/C reminder).
 * Listed so that predecessors come first.
 */
export const DEMO_TASKS: DemoTask[] = [
  {
    key: 'fences',
    title: 'Entrega de vallas',
    kind: 'delivery',
    status: 'confirmed',
    venueName: DEMO_EVENT.venueName,
    companyName: null,
    startTime: '08:00',
    endTime: '08:45',
    heavyLoad: null,
    dependsOn: [],
    source: 'reported',
    notes:
      'Dato ficticio. Peso de las bases de las vallas pendiente de verificar.',
  },
  {
    key: 'stage',
    title: 'Montaje del escenario',
    kind: 'assembly',
    status: 'planned',
    venueName: DEMO_EVENT.venueName,
    companyName: DEMO_COMPANY,
    startTime: '09:00',
    endTime: '12:00',
    heavyLoad: true,
    dependsOn: ['fences'],
    source: null,
    notes: null,
  },
  {
    key: 'generator',
    title: 'Traslado del generador',
    kind: 'transport',
    status: 'planned',
    venueName: 'Almacén municipal',
    companyName: null,
    startTime: '10:00',
    endTime: '10:45',
    heavyLoad: true,
    dependsOn: [],
    source: null,
    notes: 'Dato ficticio. Del almacén a la plaza con el evento ya en marcha.',
  },
  {
    key: 'lights',
    title: 'Instalación de iluminación',
    kind: 'assembly',
    status: 'planned',
    venueName: DEMO_EVENT.venueName,
    companyName: null,
    startTime: '11:00',
    endTime: '12:00',
    heavyLoad: false,
    dependsOn: [],
    source: null,
    notes:
      'Dato ficticio. Coincide a propósito con el montaje del escenario para mostrar el aviso de solape.',
  },
  {
    key: 'sound',
    title: 'Prueba de sonido',
    kind: 'activity',
    status: 'planned',
    venueName: DEMO_EVENT.venueName,
    companyName: DEMO_COMPANY,
    startTime: '12:00',
    endTime: '13:00',
    heavyLoad: false,
    dependsOn: ['stage'],
    source: null,
    notes: null,
  },
  {
    key: 'dismantle',
    title: 'Desmontaje del escenario',
    kind: 'dismantling',
    status: 'planned',
    venueName: DEMO_EVENT.venueName,
    companyName: DEMO_COMPANY,
    startTime: '14:00',
    endTime: '16:00',
    heavyLoad: true,
    dependsOn: ['sound'],
    source: null,
    notes: null,
  },
];

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
  /** Demo tasks created in this run (0 when they already existed). */
  demoTasksCreated: number;
  /**
   * When the organization removed its demo data (ISO instant); the seed then
   * leaves the demo alone. Null when the demo was never removed.
   */
  demoRemovedAt: string | null;
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

    // Once the team removed the demo (API or db:clear-demo), it never comes
    // back, whatever else this run does (e.g. --reset-passwords).
    const demoRemovedAt =
      (
        await tx.query<{demo_removed_at: unknown}>(
          'SELECT demo_removed_at FROM organizations WHERE id = $1',
          [org.id],
        )
      )[0]?.demo_removed_at ?? null;
    if (demoRemovedAt !== null) {
      return {
        organization: org,
        organizationCreated,
        users,
        demoEventCreated: false,
        demoTasksCreated: 0,
        demoRemovedAt: toIso(demoRemovedAt),
      };
    }

    const hasDemo = await tx.query(
      'SELECT 1 FROM events WHERE organization_id = $1 AND is_demo LIMIT 1',
      [org.id],
    );
    let demoEventCreated = false;
    let demoEventId: string | null =
      (
        await tx.query<{id: string}>(
          `SELECT id FROM events
            WHERE organization_id = $1 AND is_demo AND lower(name) = lower($2)
            ORDER BY created_at, id LIMIT 1`,
          [org.id, DEMO_EVENT.name],
        )
      )[0]?.id ?? null;
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
      demoEventId = event.id;
    }

    // Added in milestone 2: databases seeded before get the demo tasks on the
    // next run, as long as the demo event is still there. Only once: if the
    // demo tasks were ever created (their activity survives until the demo
    // is removed), deleting them one by one does not bring them back.
    const hasDemoTasks = await tx.query(
      `SELECT 1 FROM tasks WHERE organization_id = $1 AND is_demo
       UNION ALL
       SELECT 1 FROM activity_log
        WHERE organization_id = $1 AND entity_type = 'task' AND is_demo
       LIMIT 1`,
      [org.id],
    );
    let demoTasksCreated = 0;
    if (demoEventId && hasDemoTasks.length === 0) {
      demoTasksCreated = await seedDemoTasks(tx, {
        organization: org,
        eventId: demoEventId,
        actorId: systemId,
        now,
      });
    }

    return {
      organization: org,
      organizationCreated,
      users,
      demoEventCreated,
      demoTasksCreated,
      demoRemovedAt: null,
    };
  });
}

/**
 * Creates the demo tasks of the demo event (fictitious, `is_demo`), each with
 * its activity row, and returns how many were created.
 */
async function seedDemoTasks(
  tx: Queryable,
  args: {
    organization: Organization;
    eventId: string;
    actorId: string;
    now: Date;
  },
): Promise<number> {
  const {organization: org, actorId, now} = args;
  const idByKey = new Map<string, string>();
  for (const t of DEMO_TASKS) {
    const venue = t.venueName
      ? await findOrCreateVenue(tx, {
          organizationId: org.id,
          name: t.venueName,
          actorId,
          now,
          isDemo: true,
        })
      : null;
    const company = t.companyName
      ? await findOrCreateCompany(tx, {
          organizationId: org.id,
          name: t.companyName,
          actorId,
          now,
          isDemo: true,
        })
      : null;
    const {startsAt, endsAt} = slotToInstants(
      DEMO_EVENT.date,
      t.startTime,
      t.endTime,
      org.timezone,
    );
    const id = (
      (
        await tx.query<{id: string}>(
          `INSERT INTO tasks
             (organization_id, event_id, venue_id, company_id, title, kind, status,
              local_date, starts_at, ends_at, timezone, heavy_load, notes, source,
              verification, is_demo, created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::timestamptz,
                   $10::timestamptz, $11, $12, $13, $14, 'draft', true,
                   $15, $16::timestamptz, $15, $16::timestamptz)
           RETURNING id`,
          [
            org.id,
            args.eventId,
            venue?.id ?? null,
            company?.id ?? null,
            t.title,
            t.kind,
            t.status,
            DEMO_EVENT.date,
            startsAt,
            endsAt,
            org.timezone,
            t.heavyLoad,
            t.notes,
            t.source,
            actorId,
            now.toISOString(),
          ],
        )
      )[0] as {id: string}
    ).id;
    idByKey.set(t.key, id);
    for (const dep of t.dependsOn) {
      await tx.query(
        'INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1, $2)',
        [id, idByKey.get(dep)],
      );
    }
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actorId,
      entityType: 'task',
      entityId: id,
      entityLabel: t.title,
      action: 'create',
      at: now,
      isDemo: true,
    });
  }
  return DEMO_TASKS.length;
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
