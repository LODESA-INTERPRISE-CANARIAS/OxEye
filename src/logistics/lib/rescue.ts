/**
 * Rescue of an unsaved event form when the session expires mid-edit.
 *
 * One slot in `sessionStorage` (this tab only, gone when the tab closes): the
 * form values, who was typing and, for edits, the event copy the changes
 * apply to. After signing in again as the same person the form reopens with
 * those values; a different person never sees them. Full offline drafts and
 * the outbox arrive later with Dexie; this only bridges a re-login.
 */
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';

const RESCUE_KEY = 'oxeye.logistics.rescue.v1';

export interface RescuedForm<V = Record<string, unknown>> {
  userId: string;
  orgId: string | null;
  /** Event being edited, as it was when editing started; null when creating. */
  base: LogisticsEvent | null;
  values: V;
  savedAt: string;
}

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
    const parsed = JSON.parse(raw) as Partial<RescuedForm>;
    if (
      !parsed ||
      typeof parsed.userId !== 'string' ||
      !parsed.values ||
      typeof parsed.values !== 'object'
    ) {
      clearRescue();
      return null;
    }
    const base =
      parsed.base &&
      typeof parsed.base === 'object' &&
      typeof parsed.base.id === 'string' &&
      typeof parsed.base.version === 'number'
        ? parsed.base
        : null;
    return {
      userId: parsed.userId,
      orgId: typeof parsed.orgId === 'string' ? parsed.orgId : null,
      base,
      values: parsed.values,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
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
