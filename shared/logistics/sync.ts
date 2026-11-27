/**
 * Synchronisation rules shared by the device (M6): which lists to reload
 * after `GET …/changes`, what the sync chip says, and how a replayed write
 * that failed is treated. Pure: no timers, no storage, no network.
 *
 * Honesty rule: the chip never says «Sincronizado» while anything saved on
 * this device has not been accepted by the server.
 */
import type {ApiErrorCode, ChangesResponse} from './contracts.ts';

/** The lists the device keeps (one request each on a full reload). */
export type SyncList =
  | 'events'
  | 'venues'
  | 'tasks'
  | 'companies'
  | 'categories'
  | 'contacts'
  | 'offers'
  | 'warehouses'
  | 'resources'
  | 'notes'
  | 'hypotheses'
  /** Revisión 1 · E2: `GET …/conflict-acceptances`. */
  | 'acceptances'
  | 'activity';

export const SYNC_LISTS: readonly SyncList[] = [
  'events',
  'venues',
  'tasks',
  'companies',
  'categories',
  'contacts',
  'offers',
  'warehouses',
  'resources',
  'notes',
  'hypotheses',
  'acceptances',
  'activity',
];

/** How often the device asks `…/changes` while open and online. */
export const POLL_MS = 60_000;
/** Safety net: a full reload this often, and on every reconnect. */
export const FULL_REFRESH_MS = 10 * 60_000;

/**
 * A write of one type can change records of other lists (counts, embedded
 * names, unlinks, computed `taskIds`, cleared subsoil marks). Each activity
 * `entityType` reloads its own list plus the lists it can touch.
 */
const TOUCHES: Readonly<Record<string, readonly SyncList[]>> = {
  event: ['events', 'venues', 'tasks', 'contacts', 'notes'],
  task: ['tasks', 'resources', 'hypotheses', 'notes', 'venues', 'companies'],
  venue: ['venues', 'events', 'tasks'],
  company: ['companies', 'contacts', 'offers', 'tasks', 'resources', 'notes'],
  contact: ['contacts', 'companies', 'tasks', 'notes'],
  offer: ['offers', 'companies', 'resources', 'notes'],
  category: ['categories', 'companies', 'offers', 'resources'],
  warehouse: ['warehouses', 'resources', 'notes'],
  resource: ['resources', 'tasks', 'warehouses', 'companies', 'notes'],
  // E3: an answer is logged as an update of its note (`changedFields`
  // ['answer']), an image as an update of its resource (['media']).
  note: ['notes'],
  hypothesis: ['hypotheses', 'tasks'],
  // E2: the organization's acronym lives in the session (`GET /me`), not in a
  // list: the device refreshes `/me` when `types` includes `organization`.
  organization: [],
  conflict_acceptance: ['acceptances'],
  // E5: budget data is never a stored list; the open budget views reload
  // when `budgetMayHaveChanged` says so.
  budget: [],
  expense: [],
};

/**
 * E5: `…/changes` types after which an open budget view (an event's budget,
 * the organization's overview) reloads: its own types, plus events (names)
 * and companies (names, deletions unlink expenses).
 */
const BUDGET_TOUCHED_BY = new Set(['budget', 'expense', 'event', 'company']);

export function budgetMayHaveChanged(changes: ChangesResponse): boolean {
  return changes.full || changes.types.some(t => BUDGET_TOUCHED_BY.has(t));
}

/**
 * Lists to reload after a `…/changes` answer: every list on `full` or on a
 * type this version does not know (e.g. `demo`); nothing when nothing
 * changed; otherwise the touched lists plus the activity feed.
 */
export function listsToReload(changes: ChangesResponse): Set<SyncList> {
  if (changes.full) return new Set(SYNC_LISTS);
  const out = new Set<SyncList>();
  for (const type of changes.types) {
    const touched = TOUCHES[type];
    if (!touched) return new Set(SYNC_LISTS);
    for (const list of touched) out.add(list);
  }
  if (changes.types.length) out.add('activity');
  return out;
}

// ---------------------------------------------------------------- the chip

export type SyncState =
  /** Online, the server answers, nothing waiting. */
  | 'synced'
  /** Sending queued changes now (or about to). */
  | 'syncing'
  /** The device has no network. */
  | 'offline'
  /** The network is there but the server does not answer. */
  | 'local_only'
  /** Something queued needs a person: a conflict or a rejected change. */
  | 'attention';

export interface SyncInput {
  browserOnline: boolean;
  serverReachable: boolean;
  /** Queued changes still to send (pending or sending). */
  pending: number;
  /** Queued changes that need a person (conflict or rejected). */
  needsReview: number;
  /** A replay is in progress. */
  syncing: boolean;
}

export interface SyncStatus {
  state: SyncState;
  /** Short chip text. */
  label: string;
  /** One plain sentence for the tooltip / accessible name. */
  detail: string;
}

/** «1 cambio pendiente», «3 cambios pendientes». */
export function changesLabel(n: number, adjective = ''): string {
  const noun = n === 1 ? 'cambio' : 'cambios';
  const adj = adjective ? ` ${n === 1 ? adjective : `${adjective}s`}` : '';
  return `${n} ${noun}${adj}`;
}

export function syncStatus(input: SyncInput): SyncStatus {
  const {browserOnline, serverReachable, pending, needsReview, syncing} = input;
  const waiting = pending + needsReview;
  if (!browserOnline) {
    return {
      state: 'offline',
      label: waiting
        ? `Sin conexión · ${changesLabel(waiting, 'pendiente')}`
        : 'Sin conexión',
      detail: waiting
        ? 'Lo guardado está solo en este dispositivo. Se enviará al volver la conexión.'
        : 'El dispositivo no tiene conexión. Lo que guardes se quedará aquí y se enviará al volver.',
    };
  }
  if (!serverReachable) {
    return {
      state: 'local_only',
      label: waiting
        ? `Solo en este dispositivo · ${changesLabel(waiting)}`
        : 'Solo en este dispositivo',
      detail:
        'El servidor no responde. Lo que guardes se queda en este dispositivo hasta que vuelva.',
    };
  }
  if (needsReview) {
    return {
      state: 'attention',
      label: `${changesLabel(needsReview)} por revisar`,
      detail:
        'No se han enviado: otra persona cambió lo mismo o el servidor los rechazó. Nada se ha sobrescrito.',
    };
  }
  if (syncing || pending) {
    return {
      state: 'syncing',
      label: pending ? `Sincronizando · ${pending}` : 'Sincronizando…',
      detail: pending
        ? `Enviando ${changesLabel(pending)} guardados en este dispositivo.`
        : 'Comprobando si hay cambios.',
    };
  }
  return {
    state: 'synced',
    label: 'Sincronizado',
    detail: 'Todo lo que has guardado está en el servidor.',
  };
}

// ---------------------------------------------------------------- replay

/**
 * What to do with a queued write the server did not accept:
 * - `retry`: keep it pending and try again later (no network, server busy);
 * - `conflict`: someone changed the record (409 VERSION_CONFLICT) or the name
 *   exists (409 DUPLICATE); a person resolves it with the merge;
 * - `rejected`: the server refused the content (400, 403, 404); a person
 *   fixes or discards it;
 * - `paused`: the session ended; wait for the same user to sign in again.
 */
export type ReplayOutcome = 'retry' | 'conflict' | 'rejected' | 'paused';

/** Server faults are retried this many times before asking a person. */
export const MAX_INTERNAL_RETRIES = 3;

export function replayOutcome(
  code: ApiErrorCode | 'UNAVAILABLE' | 'NOT_CONFIGURED' | string,
  attempts: number,
): ReplayOutcome {
  switch (code) {
    case 'UNAVAILABLE':
    case 'RATE_LIMITED':
      return 'retry';
    case 'INTERNAL':
      return attempts < MAX_INTERNAL_RETRIES ? 'retry' : 'rejected';
    case 'VERSION_CONFLICT':
    case 'DUPLICATE':
      return 'conflict';
    case 'UNAUTHENTICATED':
      return 'paused';
    default:
      return 'rejected';
  }
}

const RETRY_STEPS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/** Wait before the next attempt (attempts already made ≥ 1). */
export function retryDelayMs(attempts: number, retryAfterSeconds?: number) {
  const step = RETRY_STEPS_MS[Math.min(Math.max(attempts, 1), 5) - 1];
  return retryAfterSeconds ? Math.max(step, retryAfterSeconds * 1000) : step;
}
