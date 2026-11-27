/**
 * Pilot seed: the organization with its built-in categories, the six pilot
 * users (with their roles, E4) and one fictitious demo event with its demo tasks, companies,
 * contacts, offers, warehouse, resources and notes. Idempotent: running it
 * again creates only what is missing and keeps
 * existing passwords unless `resetPasswords` is set. Passwords are generated
 * here and returned once; they are never stored in clear or committed.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {generatePassword, hashPassword} from '../auth/password.ts';
import {deleteUserSessions} from '../auth/sessions.ts';
import {ensureBuiltInCategories} from '../categories/service.ts';
import {findOrCreateCompany} from '../companies/service.ts';
import {labelOf} from '../notes/refs.ts';
import {findOrCreateByName} from '../records/find-or-create.ts';
import {lockCatalogue, lockGraph} from '../records/locks.ts';
import {hasDemoBudget, seedDemoBudget} from './demo-budget.ts';
import {
  ORGANIZATION_COLUMNS,
  parseRoles,
  toOrgRecord,
} from '../organizations/service.ts';
import type {OrgRecord} from '../organizations/service.ts';
import {normalizeRoles} from '../../../shared/logistics/permissions.ts';
import {findOrCreateVenue} from '../venues/service.ts';
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  BUILT_IN_SERVICE_CATEGORIES,
} from '../../../shared/logistics/rules.ts';
import {slotToInstants} from '../../../shared/logistics/time.ts';
import type {
  CompanyKind,
  DataSource,
  NoteKind,
  OrgRole,
  PriceUnit,
  ResourceAvailability,
  ResourceCondition,
  ResourceOwnership,
  Role,
  TaskKind,
  TaskStatus,
} from '../../../shared/logistics/contracts.ts';

export const PILOT_ORGANIZATION = {
  name: 'Ayuntamiento de San Cristóbal de La Laguna',
  timezone: 'Atlantic/Canary',
};

/**
 * Pilot accounts. The username is the login name and never changes; the
 * display name of an existing account is never touched (people edit it in
 * their profile). Roles are applied once per membership (E4): after that
 * only an administrator changes them. Fabián (E4) is listed last so the
 * order of the existing accounts stays as it was.
 */
export const PILOT_USERS: {
  username: string;
  displayName: string;
  role: Role;
  roles: OrgRole[];
}[] = [
  {username: 'Elvis', displayName: 'Elvis', role: 'member', roles: ['admin']},
  {username: 'Dailos', displayName: 'Dailos', role: 'member', roles: ['admin']},
  {username: 'Yeray', displayName: 'Yeray', role: 'member', roles: ['admin']},
  {username: 'Equipo', displayName: 'Equipo', role: 'member', roles: ['team']},
  {username: 'Invitado', displayName: 'Invitado', role: 'guest', roles: []},
  {
    username: 'Fabián',
    displayName: 'Fabián',
    role: 'member',
    roles: ['admin', 'developer'],
  },
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

export interface DemoCompany {
  name: string;
  kind: CompanyKind;
  /** Built-in service categories, by name. */
  categories: (typeof BUILT_IN_SERVICE_CATEGORIES)[number][];
}

/**
 * Fictitious counterparts of the demo (milestone 3): no real company, body
 * or association. A supplier, a public body and an association, so the list
 * «Empresas y entidades» shows its kinds.
 */
export const DEMO_COMPANIES: DemoCompany[] = [
  {
    name: DEMO_COMPANY,
    kind: 'supplier',
    categories: ['Montaje', 'Estructuras', 'Carpas', 'Sonido'],
  },
  {name: 'Concejalía Demo', kind: 'public_body', categories: ['Vallas']},
  {name: 'Asociación Vecinal Demo', kind: 'association', categories: ['Ocio']},
];

export interface DemoContact {
  name: string;
  role: string;
  companyName: string;
  /** Never-assigned numbers (+34 000 000 00X) and example.com addresses only. */
  phone: string | null;
  email: string | null;
  /** Main contact of its company. */
  main: boolean;
  /** Linked to the demo event. */
  onEvent: boolean;
  /** Title of the demo task that names this person as its contact. */
  taskTitle: string | null;
}

/** Obviously fictitious people (safety condition: no real personal data). */
export const DEMO_CONTACTS: DemoContact[] = [
  {
    name: 'Ana Demo',
    role: 'Jefa de montaje',
    companyName: DEMO_COMPANY,
    phone: '+34 000 000 001',
    email: 'ana.demo@example.com',
    main: true,
    onEvent: false,
    taskTitle: 'Montaje del escenario',
  },
  {
    name: 'Luis Demo',
    role: 'Técnico de servicios',
    companyName: 'Concejalía Demo',
    phone: '+34 000 000 002',
    email: 'luis.demo@example.com',
    main: false,
    onEvent: false,
    taskTitle: null,
  },
  {
    name: 'Marta Demo',
    role: 'Coordinación de voluntariado',
    companyName: 'Asociación Vecinal Demo',
    phone: '+34 000 000 003',
    // Still unknown: shows «Pendiente de verificar».
    email: null,
    main: false,
    onEvent: true,
    taskTitle: null,
  },
];

export interface DemoOffer {
  name: string;
  companyName: string;
  category: (typeof BUILT_IN_SERVICE_CATEGORIES)[number];
  price: number | null;
  unit: PriceUnit;
  customUnit: string | null;
  transportCost: number | null;
  assemblyCost: number | null;
  maintenanceCost: number | null;
  vatIncluded: boolean | null;
  conditions: string | null;
}

/**
 * Demo offers covering what the catalogue must show honestly: a known price
 * per day, an unknown price, a custom unit whose wording is still unknown,
 * transport unknown with assembly known, and unknown VAT. Billing units only:
 * nothing here is a weight or answers a heavy-load question.
 */
export const DEMO_OFFERS: DemoOffer[] = [
  {
    name: 'Escenario modular 8 × 6 m',
    companyName: DEMO_COMPANY,
    category: 'Estructuras',
    price: 450,
    unit: 'day',
    customUnit: null,
    transportCost: 120,
    assemblyCost: 300,
    maintenanceCost: null,
    vatIncluded: false,
    conditions: 'Dato ficticio. Mínimo dos días de alquiler.',
  },
  {
    name: 'Equipo de sonido para plaza',
    companyName: DEMO_COMPANY,
    category: 'Sonido',
    price: null,
    unit: 'day',
    customUnit: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    vatIncluded: null,
    conditions: null,
  },
  {
    name: 'Carpa 5 × 5 m',
    companyName: DEMO_COMPANY,
    category: 'Carpas',
    price: 180,
    unit: 'custom',
    customUnit: null,
    transportCost: null,
    assemblyCost: 60,
    maintenanceCost: null,
    vatIncluded: true,
    conditions:
      'Dato ficticio. Falta confirmar si el precio es por carpa o por jornada.',
  },
  {
    // Free is a known price (0), not an unknown one.
    name: 'Préstamo de vallas peatonales',
    companyName: 'Concejalía Demo',
    category: 'Vallas',
    price: 0,
    unit: 'unit',
    customUnit: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    vatIncluded: null,
    conditions: 'Dato ficticio. Se pide con una semana de antelación.',
  },
  {
    name: 'Taller infantil de manualidades',
    companyName: 'Asociación Vecinal Demo',
    category: 'Ocio',
    price: 40,
    unit: 'hour',
    customUnit: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    vatIncluded: true,
    conditions: 'Dato ficticio.',
  },
];

/** Fictitious warehouse of the demo (milestone 4): no real address. */
export const DEMO_WAREHOUSE = {
  name: 'Almacén Demo',
  address: 'Calle Ficticia Demo, 1 (dirección de demostración)',
  notes: 'Almacén ficticio de demostración.',
};

export interface DemoResource {
  name: string;
  ownership: ResourceOwnership;
  /** Built-in resource category, by name. */
  category: (typeof BUILT_IN_RESOURCE_CATEGORIES)[number];
  /** In the demo warehouse (owned material). */
  inWarehouse: boolean;
  /** Contracted only: the demo supplier that provides it. */
  companyName: string | null;
  quantity: number | null;
  unit: string;
  dimensions: string | null;
  condition: ResourceCondition;
  availability: ResourceAvailability;
  location: string | null;
  toAssess: boolean;
  /** Titles of the demo tasks that use it. */
  taskTitles: string[];
}

/**
 * Demo inventory (milestone 4): owned material in the demo warehouse, one item
 * still to be assessed, a single van used by two demo tasks at the same time
 * (so the plan shows a resource conflict) and a service contracted from the
 * demo supplier. Descriptive figures only: no «kg» unit, nothing that could
 * read as a load or answer a heavy-load question.
 */
export const DEMO_RESOURCES: DemoResource[] = [
  {
    name: 'Carpa 3×6 Demo',
    ownership: 'owned',
    category: 'Carpas',
    inWarehouse: true,
    companyName: null,
    quantity: 4,
    unit: 'unidades',
    dimensions: '3 × 6 m',
    condition: 'good',
    availability: 'available',
    location: 'Nave Demo, estantería 1',
    toAssess: false,
    taskTitles: [],
  },
  {
    name: 'Vallas Demo',
    ownership: 'owned',
    category: 'Vallas',
    inWarehouse: true,
    companyName: null,
    quantity: 200,
    unit: 'unidades',
    dimensions: null,
    condition: 'unknown',
    availability: 'unknown',
    location: null,
    toAssess: true,
    taskTitles: [],
  },
  {
    // The two tasks overlap (10:00–10:45 inside 09:00–12:00) and there is
    // only one van: the plan shows a resource conflict.
    name: 'Furgoneta Demo',
    ownership: 'owned',
    category: 'Vehículos',
    inWarehouse: true,
    companyName: null,
    quantity: 1,
    unit: 'unidades',
    dimensions: null,
    condition: 'good',
    availability: 'available',
    location: null,
    toAssess: false,
    taskTitles: ['Traslado del generador', 'Montaje del escenario'],
  },
  {
    name: 'Aseos portátiles Demo',
    ownership: 'contracted',
    category: 'Otros materiales',
    inWarehouse: false,
    companyName: DEMO_COMPANY,
    quantity: 2,
    unit: 'unidades',
    dimensions: null,
    condition: 'unknown',
    availability: 'unknown',
    location: null,
    toAssess: false,
    taskTitles: [],
  },
];

export interface DemoNote {
  kind: NoteKind;
  text: string;
  /** Title of the demo task it points at; null = the demo event only. */
  taskTitle: string | null;
  resolved: boolean;
}

/** One incident, one decision and one open question; fictitious text only. */
export const DEMO_NOTES: DemoNote[] = [
  {
    kind: 'incident',
    text: 'Dato ficticio. Faltan diez vallas en la entrega; el proveedor las trae mañana a primera hora.',
    taskTitle: 'Entrega de vallas',
    resolved: false,
  },
  {
    kind: 'decision',
    text: 'Dato ficticio. Se montan las carpas antes de la prueba de sonido.',
    taskTitle: null,
    resolved: false,
  },
  {
    kind: 'open_question',
    text: 'Dato ficticio. ¿Hace falta una segunda toma eléctrica para el escenario?',
    taskTitle: 'Montaje del escenario',
    resolved: false,
  },
];

export interface SeededUser {
  username: string;
  displayName: string;
  role: Role;
  /** Roles in the pilot organization after this run. */
  roles: OrgRole[];
  /** Set only when the password was created or reset in this run. */
  password: string | null;
  created: boolean;
}

export interface SeedResult {
  organization: OrgRecord;
  organizationCreated: boolean;
  users: SeededUser[];
  demoEventCreated: boolean;
  /** Demo tasks created in this run (0 when they already existed). */
  demoTasksCreated: number;
  /** Demo contacts and offers created in this run (0 when they already existed). */
  demoContactsCreated: number;
  demoOffersCreated: number;
  /** Demo resources and notes created in this run (0 when they already existed). */
  demoResourcesCreated: number;
  demoNotesCreated: number;
  /** Revisión 1 · E5: demo expenses created in this run (with the demo budget). */
  demoExpensesCreated: number;
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
        'SELECT lower(username) AS name FROM users',
      )
    ).map(r => r.name),
  );
  const passwords = new Map<string, {clear: string; hash: string}>();
  for (const u of PILOT_USERS) {
    if (options.resetPasswords || !existing.has(u.username.toLowerCase())) {
      const clear = passwordFor(u.displayName);
      passwords.set(u.username, {clear, hash: await hashPassword(clear)});
    }
  }

  return db.transaction(async tx => {
    let organizationCreated = false;
    let org = (
      await tx.query<OrgRecord>(
        `SELECT ${ORGANIZATION_COLUMNS} FROM organizations o
          WHERE lower(o.name) = lower($1)`,
        [PILOT_ORGANIZATION.name],
      )
    )[0];
    if (!org) {
      org = (
        await tx.query<OrgRecord>(
          `INSERT INTO organizations AS o (name, timezone, created_at, updated_at)
           VALUES ($1, $2, $3::timestamptz, $3::timestamptz)
           RETURNING ${ORGANIZATION_COLUMNS}`,
          [
            PILOT_ORGANIZATION.name,
            PILOT_ORGANIZATION.timezone,
            now.toISOString(),
          ],
        )
      )[0] as OrgRecord;
      organizationCreated = true;
    }
    org = toOrgRecord(org);

    const users: SeededUser[] = [];
    for (const [index, u] of PILOT_USERS.entries()) {
      const pw = passwords.get(u.username);
      const found = (
        await tx.query<{id: string; display_name: string}>(
          'SELECT id, display_name FROM users WHERE lower(username) = lower($1)',
          [u.username],
        )
      )[0];
      let userId: string;
      let displayName = u.displayName;
      let created = false;
      if (!found) {
        if (!pw) throw new Error(`Missing password for ${u.username}`);
        userId = (
          (
            await tx.query<{id: string}>(
              `INSERT INTO users (username, display_name, role, password_hash,
                                  password_provisional, sort_order, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz)
               RETURNING id`,
              [
                u.username,
                u.displayName,
                u.role,
                pw.hash,
                // Printed once for someone else to hand over: provisional
                // (never for the guest account, which cannot change it).
                u.role !== 'guest',
                (index + 1) * 10,
                now.toISOString(),
              ],
            )
          )[0] as {id: string}
        ).id;
        created = true;
      } else {
        userId = found.id;
        displayName = found.display_name;
        if (pw) {
          await tx.query(
            `UPDATE users SET password_hash = $2, is_active = true,
                    password_provisional = $4,
                    version = version + 1, updated_at = $3::timestamptz
              WHERE id = $1`,
            [userId, pw.hash, now.toISOString(), u.role !== 'guest'],
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
      // Pilot roles once per membership; afterwards only an administrator
      // changes them (roles_set_at records it).
      const membership = (
        await tx.query<{roles: unknown}>(
          `UPDATE organization_members
              SET roles = CASE WHEN roles_set_at IS NULL
                               THEN ARRAY(SELECT jsonb_array_elements_text($3::jsonb))
                               ELSE roles END,
                  roles_set_at = COALESCE(roles_set_at, $4::timestamptz)
            WHERE organization_id = $1 AND user_id = $2
            RETURNING roles`,
          [org.id, userId, JSON.stringify(u.roles), now.toISOString()],
        )
      )[0];
      users.push({
        username: u.username,
        displayName,
        role: u.role,
        roles: normalizeRoles(parseRoles(membership?.roles)),
        password: pw?.clear ?? null,
        created,
      });
    }

    const systemId = await ensureSystemUser(tx, now);
    // Same lock order as the API, so the seed can run next to it.
    await lockGraph(tx, org.id);
    await lockCatalogue(tx, org.id);
    // Every organization has the built-in categories, demo or not.
    await ensureBuiltInCategories(tx, org.id);

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
        demoContactsCreated: 0,
        demoOffersCreated: 0,
        demoResourcesCreated: 0,
        demoNotesCreated: 0,
        demoExpensesCreated: 0,
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

    // Added in milestone 3, in the same way: once, while the demo event is
    // there, also on a database seeded before.
    const hasDemoCatalogue = await tx.query(
      `SELECT 1 FROM contacts WHERE organization_id = $1 AND is_demo
       UNION ALL
       SELECT 1 FROM offers WHERE organization_id = $1 AND is_demo
       UNION ALL
       SELECT 1 FROM activity_log
        WHERE organization_id = $1 AND entity_type IN ('contact', 'offer') AND is_demo
       LIMIT 1`,
      [org.id],
    );
    let catalogue = {contacts: 0, offers: 0};
    if (demoEventId && hasDemoCatalogue.length === 0) {
      catalogue = await seedDemoCatalogue(tx, {
        organization: org,
        eventId: demoEventId,
        actorId: systemId,
        now,
        tasksJustCreated: demoTasksCreated > 0,
      });
    }

    // Added in milestone 4, in the same way: once, while the demo event is
    // there, also on a database seeded in milestone 3.
    const hasDemoInventory = await tx.query(
      `SELECT 1 FROM warehouses WHERE organization_id = $1 AND is_demo
       UNION ALL
       SELECT 1 FROM resources WHERE organization_id = $1 AND is_demo
       UNION ALL
       SELECT 1 FROM notes WHERE organization_id = $1 AND is_demo
       UNION ALL
       SELECT 1 FROM activity_log
        WHERE organization_id = $1
          AND entity_type IN ('warehouse', 'resource', 'note') AND is_demo
       LIMIT 1`,
      [org.id],
    );
    let inventory = {resources: 0, notes: 0};
    if (demoEventId && hasDemoInventory.length === 0) {
      inventory = await seedDemoInventory(tx, {
        organization: org,
        eventId: demoEventId,
        actorId: systemId,
        now,
        tasksJustCreated: demoTasksCreated > 0,
      });
    }

    // Revisión 1 · E5, in the same way: the demo budget and expenses, once,
    // while the demo event is there.
    let demoExpensesCreated = 0;
    if (demoEventId && !(await hasDemoBudget(tx, org.id))) {
      demoExpensesCreated = await seedDemoBudget(tx, {
        organizationId: org.id,
        eventId: demoEventId,
        eventName: DEMO_EVENT.name,
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
      demoContactsCreated: catalogue.contacts,
      demoOffersCreated: catalogue.offers,
      demoResourcesCreated: inventory.resources,
      demoNotesCreated: inventory.notes,
      demoExpensesCreated,
      demoRemovedAt: null,
    };
  });
}

/**
 * Creates the demo warehouse, resources and notes, each with its activity
 * row, and links the demo van to two overlapping demo tasks. A demo task that
 * existed before this run gets a new version and an activity entry; a demo
 * task deleted by the team is simply skipped. A company or warehouse with a
 * demo name that is now real is used but left untouched.
 */
async function seedDemoInventory(
  tx: Queryable,
  args: {
    organization: OrgRecord;
    eventId: string;
    actorId: string;
    now: Date;
    /** The demo tasks were created in this run (no version bump needed). */
    tasksJustCreated: boolean;
  },
): Promise<{resources: number; notes: number}> {
  const {organization: org, actorId, now} = args;
  const at = now.toISOString();
  const log = (
    entityType: string,
    entityId: string,
    entityLabel: string,
    action: 'create' | 'update',
    changedFields?: string[],
  ) =>
    appendActivity(tx, {
      organizationId: org.id,
      userId: actorId,
      entityType,
      entityId,
      entityLabel,
      action,
      changedFields,
      at: now,
      isDemo: true,
    });

  const categoryId = new Map(
    (
      await tx.query<{id: string; name: string}>(
        `SELECT id, name FROM categories
          WHERE organization_id = $1 AND scope = 'resource' AND built_in`,
        [org.id],
      )
    ).map(c => [c.name, c.id]),
  );
  const taskId = new Map(
    (
      await tx.query<{id: string; title: string}>(
        `SELECT DISTINCT ON (title) id, title FROM tasks
          WHERE organization_id = $1 AND is_demo
          ORDER BY title, created_at, id`,
        [org.id],
      )
    ).map(t => [t.title, t.id]),
  );

  // Find-or-create logs the creation; it reuses a warehouse of that name.
  const warehouse = await findOrCreateByName(tx, 'warehouses', {
    organizationId: org.id,
    name: DEMO_WAREHOUSE.name,
    actorId,
    now,
    isDemo: true,
  });
  if (warehouse.isDemo) {
    await tx.query(
      `UPDATE warehouses SET address = $2, notes = $3
        WHERE id = $1 AND address IS NULL AND notes IS NULL`,
      [warehouse.id, DEMO_WAREHOUSE.address, DEMO_WAREHOUSE.notes],
    );
  }

  const linkedTasks = new Set<string>();
  for (const r of DEMO_RESOURCES) {
    const company = r.companyName
      ? await findOrCreateCompany(tx, {
          organizationId: org.id,
          name: r.companyName,
          actorId,
          now,
          isDemo: true,
        })
      : null;
    const id = (
      (
        await tx.query<{id: string}>(
          `INSERT INTO resources
             (organization_id, name, ownership, category_id, warehouse_id,
              company_id, quantity, unit, dimensions, condition, availability,
              location, to_assess, notes, verification, is_demo,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12,
                   $13, $14, 'draft', true, $15, $16::timestamptz, $15,
                   $16::timestamptz)
           RETURNING id`,
          [
            org.id,
            r.name,
            r.ownership,
            categoryId.get(r.category) ?? null,
            r.inWarehouse ? warehouse.id : null,
            company?.id ?? null,
            r.quantity,
            r.unit,
            r.dimensions,
            r.condition,
            r.availability,
            r.location,
            r.toAssess,
            'Recurso ficticio de demostración.',
            actorId,
            at,
          ],
        )
      )[0] as {id: string}
    ).id;
    await log('resource', id, r.name, 'create');
    for (const title of r.taskTitles) {
      const task = taskId.get(title);
      if (!task) continue;
      await tx.query(
        'INSERT INTO task_resources (task_id, resource_id) VALUES ($1, $2)',
        [task, id],
      );
      linkedTasks.add(task);
    }
  }
  // Demo tasks that existed before this run changed: new version, logged.
  if (!args.tasksJustCreated) {
    for (const [title, id] of [...taskId].sort(([, a], [, b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      if (!linkedTasks.has(id)) continue;
      await tx.query(
        `UPDATE tasks
            SET version = version + 1, updated_by = $2, updated_at = $3::timestamptz
          WHERE id = $1`,
        [id, actorId, at],
      );
      await log('task', id, title, 'update', ['resourceIds']);
    }
  }

  const eventName =
    (
      await tx.query<{name: string}>('SELECT name FROM events WHERE id = $1', [
        args.eventId,
      ])
    )[0]?.name ?? null;
  for (const n of DEMO_NOTES) {
    const task = n.taskTitle ? (taskId.get(n.taskTitle) ?? null) : null;
    const id = (
      (
        await tx.query<{id: string}>(
          `INSERT INTO notes
             (organization_id, kind, text, event_id, task_id, resolved,
              verification, is_demo, created_by, created_at, updated_by,
              updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft', true, $7, $8::timestamptz,
                   $7, $8::timestamptz)
           RETURNING id`,
          [org.id, n.kind, n.text, args.eventId, task, n.resolved, actorId, at],
        )
      )[0] as {id: string}
    ).id;
    // Labelled by kind and what it points at, never by its text.
    await log(
      'note',
      id,
      labelOf({
        kind: n.kind,
        note_event_name: eventName,
        note_ref_label: task ? n.taskTitle : null,
      }),
      'create',
    );
  }
  return {resources: DEMO_RESOURCES.length, notes: DEMO_NOTES.length};
}

/**
 * Creates the demo tasks of the demo event (fictitious, `is_demo`), each with
 * its activity row, and returns how many were created.
 */
async function seedDemoTasks(
  tx: Queryable,
  args: {
    organization: OrgRecord;
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

/**
 * Creates the demo companies (or completes the existing demo company), the
 * demo contacts and the demo offers, each with its activity row: Ana Demo is
 * the main contact of the demo company and the contact of the stage
 * assembly, Marta Demo is linked to the demo event. A company with a demo
 * name that is now real is used but left untouched.
 */
async function seedDemoCatalogue(
  tx: Queryable,
  args: {
    organization: OrgRecord;
    eventId: string;
    actorId: string;
    now: Date;
    /** The demo tasks were created in this run (no version bump needed). */
    tasksJustCreated: boolean;
  },
): Promise<{contacts: number; offers: number}> {
  const {organization: org, actorId, now} = args;
  const at = now.toISOString();
  const log = (
    entityType: string,
    entityId: string,
    entityLabel: string,
    action: 'create' | 'update',
    changedFields?: string[],
  ) =>
    appendActivity(tx, {
      organizationId: org.id,
      userId: actorId,
      entityType,
      entityId,
      entityLabel,
      action,
      changedFields,
      at: now,
      isDemo: true,
    });

  const categoryId = new Map(
    (
      await tx.query<{id: string; name: string}>(
        `SELECT id, name FROM categories
          WHERE organization_id = $1 AND scope = 'service' AND built_in`,
        [org.id],
      )
    ).map(c => [c.name, c.id]),
  );

  const companies = new Map<
    string,
    {id: string; isDemo: boolean; existed: boolean}
  >();
  for (const c of DEMO_COMPANIES) {
    const existed =
      (
        await tx.query(
          'SELECT 1 FROM companies WHERE organization_id = $1 AND lower(name) = lower($2)',
          [org.id, c.name],
        )
      ).length > 0;
    const ref = await findOrCreateCompany(tx, {
      organizationId: org.id,
      name: c.name,
      actorId,
      now,
      isDemo: true,
    });
    companies.set(c.name, {id: ref.id, isDemo: ref.isDemo, existed});
    if (!ref.isDemo) continue;
    await tx.query('UPDATE companies SET kind = $2 WHERE id = $1', [
      ref.id,
      c.kind,
    ]);
    await tx.query(
      `INSERT INTO company_categories (company_id, category_id)
       SELECT $1::uuid, value::uuid FROM jsonb_array_elements_text($2::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        ref.id,
        JSON.stringify(
          c.categories.flatMap(name => categoryId.get(name) ?? []),
        ),
      ],
    );
  }

  const withMainContact = new Set<string>();
  for (const p of DEMO_CONTACTS) {
    const company = companies.get(p.companyName);
    const id = (
      (
        await tx.query<{id: string}>(
          `INSERT INTO contacts
             (organization_id, company_id, name, role, phone, email, notes,
              verification, is_demo, created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', true,
                   $8, $9::timestamptz, $8, $9::timestamptz)
           RETURNING id`,
          [
            org.id,
            company?.id ?? null,
            p.name,
            p.role,
            p.phone,
            p.email,
            'Persona ficticia de demostración.',
            actorId,
            at,
          ],
        )
      )[0] as {id: string}
    ).id;
    await log('contact', id, p.name, 'create');
    if (p.onEvent) {
      await tx.query(
        'INSERT INTO contact_events (contact_id, event_id) VALUES ($1, $2)',
        [id, args.eventId],
      );
    }
    if (p.main && company?.isDemo) {
      const set = await tx.query(
        `UPDATE companies SET main_contact_id = $2
          WHERE id = $1 AND main_contact_id IS NULL RETURNING id`,
        [company.id, id],
      );
      if (set.length > 0) withMainContact.add(company.id);
    }
    if (p.taskTitle) {
      const tasks = await tx.query<{id: string; title: string}>(
        `UPDATE tasks
            SET contact_id = $3,
                version = version + $4::int, updated_by = $5,
                updated_at = $6::timestamptz
          WHERE organization_id = $1 AND is_demo AND title = $2
            AND contact_id IS NULL
          RETURNING id, title`,
        [org.id, p.taskTitle, id, args.tasksJustCreated ? 0 : 1, actorId, at],
      );
      if (!args.tasksJustCreated) {
        for (const t of tasks) {
          await log('task', t.id, t.title, 'update', ['contact']);
        }
      }
    }
  }

  // A demo company that existed before this run changed: new version, logged.
  // (When the demo tasks were created in this run, so was the demo company.)
  for (const c of DEMO_COMPANIES) {
    const company = companies.get(c.name);
    if (!company?.isDemo || !company.existed || args.tasksJustCreated) continue;
    const changed = [
      ...(c.kind !== 'supplier' ? ['kind'] : []),
      'categoryIds',
      ...(withMainContact.has(company.id) ? ['mainContactId'] : []),
    ];
    await tx.query(
      `UPDATE companies
          SET version = version + 1, updated_by = $2, updated_at = $3::timestamptz
        WHERE id = $1`,
      [company.id, actorId, at],
    );
    await log('company', company.id, c.name, 'update', changed);
  }

  for (const o of DEMO_OFFERS) {
    const company = companies.get(o.companyName);
    if (!company) continue;
    const id = (
      (
        await tx.query<{id: string}>(
          `INSERT INTO offers
             (organization_id, company_id, category_id, name, price, unit,
              custom_unit, transport_cost, assembly_cost, maintenance_cost,
              conditions, vat_included, verification, is_demo,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::numeric,
                   $9::numeric, $10::numeric, $11, $12, 'draft', true,
                   $13, $14::timestamptz, $13, $14::timestamptz)
           RETURNING id`,
          [
            org.id,
            company.id,
            categoryId.get(o.category) ?? null,
            o.name,
            o.price,
            o.unit,
            o.customUnit,
            o.transportCost,
            o.assemblyCost,
            o.maintenanceCost,
            o.conditions,
            o.vatIncluded,
            actorId,
            at,
          ],
        )
      )[0] as {id: string}
    ).id;
    await log('offer', id, o.name, 'create');
  }
  return {contacts: DEMO_CONTACTS.length, offers: DEMO_OFFERS.length};
}

/**
 * The «Sistema» author (inactive, cannot log in). E6 renegotiation tasks are
 * written by it; the UI shows them as «Generada por OxEye» (OfferRenewal).
 */
export async function ensureSystemUser(
  tx: Queryable,
  now: Date,
): Promise<string> {
  const found = (
    await tx.query<{id: string}>(
      'SELECT id FROM users WHERE lower(username) = lower($1)',
      [SYSTEM_USER],
    )
  )[0];
  if (found) return found.id;
  return (
    (
      await tx.query<{id: string}>(
        `INSERT INTO users (username, display_name, role, password_hash, is_active, sort_order, created_at, updated_at)
         VALUES ($1, $1, 'guest', NULL, false, 1000, $2::timestamptz, $2::timestamptz)
         RETURNING id`,
        [SYSTEM_USER, now.toISOString()],
      )
    )[0] as {id: string}
  ).id;
}
