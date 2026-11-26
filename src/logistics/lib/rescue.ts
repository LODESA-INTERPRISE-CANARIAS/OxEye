/**
 * Rescue of an unsaved form (event, task, contact, company, offer) when the
 * session expires mid-edit.
 *
 * One slot in `sessionStorage` (this tab only, gone when the tab closes): the
 * form values, who was typing and, for edits, the record copy the changes
 * apply to. After signing in again as the same person the form reopens with
 * those values; a different person never sees them. Full offline drafts and
 * the outbox arrive later with Dexie; this only bridges a re-login.
 */
import type {
  Company,
  Contact,
  LogisticsEvent,
  Note,
  Offer,
  Resource,
  Task,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';

const RESCUE_KEY = 'oxeye.logistics.rescue.v1';

interface RescueBase<V> {
  userId: string;
  orgId: string | null;
  values: V;
  savedAt: string;
}

export type RescuedForm<V = Record<string, unknown>> =
  | (RescueBase<V> & {
      /** Absent in rescues saved before tasks existed. */
      entity: 'event';
      /** Event being edited, as it was when editing started; null when creating. */
      base: LogisticsEvent | null;
    })
  | (RescueBase<V> & {entity: 'task'; base: Task | null})
  | (RescueBase<V> & {entity: 'contact'; base: Contact | null})
  | (RescueBase<V> & {entity: 'company'; base: Company | null})
  | (RescueBase<V> & {entity: 'offer'; base: Offer | null})
  | (RescueBase<V> & {entity: 'warehouse'; base: Warehouse | null})
  | (RescueBase<V> & {entity: 'resource'; base: Resource | null})
  | (RescueBase<V> & {entity: 'note'; base: Note | null});

/** Records whose forms use `forms/useRecordForm.ts`. */
type DirectoryEntity =
  'contact' | 'company' | 'offer' | 'warehouse' | 'resource' | 'note';
const DIRECTORY: readonly string[] = [
  'contact',
  'company',
  'offer',
  'warehouse',
  'resource',
  'note',
];

export function saveRescue(rescue: RescuedForm<unknown>): void {
  try {
    sessionStorage.setItem(RESCUE_KEY, JSON.stringify(rescue));
  } catch {
    // Storage unavailable or full: nothing else we can do without a session.
  }
}

export function readRescue(): RescuedForm | null {
  try {
    const raw = sessionStorage.getItem(RESCUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RescuedForm> | null;
    if (
      !parsed ||
      typeof parsed.userId !== 'string' ||
      !parsed.values ||
      typeof parsed.values !== 'object'
    ) {
      clearRescue();
      return null;
    }
    const validBase =
      parsed.base &&
      typeof parsed.base === 'object' &&
      typeof parsed.base.id === 'string' &&
      typeof parsed.base.version === 'number';
    const common = {
      userId: parsed.userId,
      orgId: typeof parsed.orgId === 'string' ? parsed.orgId : null,
      values: parsed.values,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    };
    if (parsed.entity === 'task') {
      return {
        ...common,
        entity: 'task',
        base: validBase ? (parsed.base as Task) : null,
      };
    }
    if (
      typeof parsed.entity === 'string' &&
      DIRECTORY.includes(parsed.entity)
    ) {
      return {
        ...common,
        entity: parsed.entity as DirectoryEntity,
        base: validBase ? parsed.base : null,
      } as RescuedForm;
    }
    return {
      ...common,
      entity: 'event',
      base: validBase ? (parsed.base as LogisticsEvent) : null,
    };
  } catch {
    return null;
  }
}

export function clearRescue(): void {
  try {
    sessionStorage.removeItem(RESCUE_KEY);
  } catch {
    // Ignore: nothing was stored.
  }
}
