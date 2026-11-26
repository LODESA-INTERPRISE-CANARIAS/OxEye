/**
 * Event rules as pure functions: which fields an edit really changed. The
 * slot rules (local date and times → stored instants, multi-day included)
 * live in `records/slot.ts` and are re-exported here. No database, no HTTP.
 *
 * Status: any status may change to any other (a cancelled event can be
 * reopened if it was cancelled by mistake); the activity log keeps the trail.
 */
import {changedFields} from '../records/slot.ts';
import type {
  EventStatus,
  DataSource,
  IsoInstant,
  LocalDate,
  Verification,
} from '../../../shared/logistics/contracts.ts';

export {
  END_DATE_NOT_AFTER,
  END_DATE_WITHOUT_DATE,
  resolveSlot,
  storedToLocal,
  TIME_WITHOUT_DATE,
  touchesSlot,
} from '../records/slot.ts';
export type {
  LocalSlot,
  SlotInput,
  SlotResult,
  StoredSlot,
} from '../records/slot.ts';

/** The editable state of an event, in comparable form. */
export interface EventState {
  name: string;
  venueId: string | null;
  localDate: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  status: EventStatus;
  notes: string | null;
  source: DataSource | null;
  verification: Verification;
}

/** Contract field names, in a stable order, for the activity log. */
const FIELD_NAMES: readonly (readonly [keyof EventState, string])[] = [
  ['name', 'name'],
  ['venueId', 'venue'],
  ['localDate', 'date'],
  ['endDate', 'endDate'],
  ['startsAt', 'startsAt'],
  ['endsAt', 'endsAt'],
  ['status', 'status'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

export function changedEventFields(
  before: EventState,
  after: EventState,
): string[] {
  return changedFields(before, after, FIELD_NAMES);
}
