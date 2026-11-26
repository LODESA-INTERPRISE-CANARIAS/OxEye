import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import {validationError} from '../errors.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {parseWith, uuid} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  changesSince,
  HISTORY_ENTITY_TYPES,
  listActivity,
  parseCursor,
} from './service.ts';
import type {ActivityRange} from './service.ts';
import {
  ACTIVITY_RANGE_MAX,
  ACTIVITY_RANGE_MAX_DAYS,
  CHANGES_OVERLAP_SECONDS,
} from '../../../shared/logistics/rules.ts';
import type {
  ActivityEntry,
  ChangesResponse,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

const BOTH_OR_NEITHER =
  'Para ver el historial de un registro indica su tipo y su identificador.';
const RANGE_BOTH =
  'Para ver un periodo indica su inicio y su final (instantes ISO 8601).';
const RANGE_WITH_ENTITY =
  'Un periodo no se puede combinar con el historial de un registro: pide uno u otro.';
const RANGE_ORDER = 'El final del periodo debe ser posterior a su inicio.';
const RANGE_TOO_LONG = `El periodo puede abarcar como máximo ${ACTIVITY_RANGE_MAX_DAYS} días.`;
const INSTANT_INVALID =
  'Instante no válido: usa ISO 8601 con zona horaria (2026-12-02T00:00:00.000Z).';
const DAY_MS = 24 * 60 * 60 * 1000;

const instant = z
  .string({error: INSTANT_INVALID})
  .refine(
    v =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
        v,
      ) && !Number.isNaN(Date.parse(v)),
    {error: INSTANT_INVALID},
  )
  .transform(v => new Date(v));

function limitField(max: number, fallback: number) {
  const message = `Indica un número entero entre 1 y ${max}.`;
  return z.coerce
    .number({error: message})
    .int({error: message})
    .min(1, {error: message})
    .max(max, {error: message})
    .default(fallback);
}

const querySchema = z.object({
  entityType: z
    .enum(HISTORY_ENTITY_TYPES, {error: 'Tipo de registro no válido.'})
    .optional(),
  entityId: uuid.optional(),
  from: instant.optional(),
  to: instant.optional(),
});

/** Without a range: 20 by default, at most 100 (unchanged since M1). */
const recentLimit = z.object({
  limit: limitField(ACTIVITY_MAX_LIMIT, ACTIVITY_DEFAULT_LIMIT),
});
/** With a range (one day close): default and maximum ACTIVITY_RANGE_MAX. */
const rangeLimit = z.object({
  limit: limitField(ACTIVITY_RANGE_MAX, ACTIVITY_RANGE_MAX),
});

/** The `from`/`to` window, or null; 400 with Spanish field messages otherwise. */
function resolveRange(
  from: Date | undefined,
  to: Date | undefined,
  withEntity: boolean,
): ActivityRange | null {
  if (from === undefined && to === undefined) return null;
  if (from === undefined) throw validationError({from: RANGE_BOTH});
  if (to === undefined) throw validationError({to: RANGE_BOTH});
  if (withEntity) throw validationError({from: RANGE_WITH_ENTITY});
  if (from.getTime() >= to.getTime()) throw validationError({to: RANGE_ORDER});
  if (to.getTime() - from.getTime() > ACTIVITY_RANGE_MAX_DAYS * DAY_MS) {
    throw validationError({to: RANGE_TOO_LONG});
  }
  return {from, to};
}

export function registerActivityRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  // Recent activity of the organization, the history of one record
  // (`entityType` and `entityId` together) or a time range (`from` and `to`,
  // M6: the day close). Labels are names, never free text, so guests read it
  // too.
  api.get('/organizations/:orgId/activity', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const {entityType, entityId, from, to} = parseWith(querySchema, {
      entityType: c.req.query('entityType') || undefined,
      entityId: c.req.query('entityId') || undefined,
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
    });
    if ((entityType === undefined) !== (entityId === undefined)) {
      throw validationError({
        [entityType === undefined ? 'entityType' : 'entityId']: BOTH_OR_NEITHER,
      });
    }
    const entity =
      entityType && entityId
        ? {type: entityType, id: entityId.toLowerCase()}
        : null;
    const range = resolveRange(from, to, entity !== null);
    const {limit} = parseWith(range ? rangeLimit : recentLimit, {
      limit: c.req.query('limit') || undefined,
    });
    const body: ListResponse<ActivityEntry> = {
      items: await listActivity(deps.db, org.id, limit, entity, range),
    };
    return c.json(body);
  });

  // M6 cheap refresh: which record types changed since the device's cursor.
  // Types only, so guests read it too.
  api.get('/organizations/:orgId/changes', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const body: ChangesResponse = await changesSince(
      deps.db,
      org.id,
      parseCursor(c.req.query('since')),
      deps.now(),
      CHANGES_OVERLAP_SECONDS,
    );
    return c.json(body);
  });
}
