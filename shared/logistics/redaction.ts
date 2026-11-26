/**
 * What a guest may not see (M6: moved here from `server/src/records/redact.ts`
 * so the server and the device cache apply one list).
 *
 * The «Invitado» login is shared, so it never receives people's and
 * companies' contact details, free-text observations, prices, costs or
 * conditions: the server sends those fields as null and the record carries
 * `restricted: true`. The device cache (M6) applies the same list again
 * before storing anything a guest received, so a server bug can never leave
 * a withheld value on a shared device.
 *
 * A new free-text field is added here, with a marker in
 * `server/tests/redaction.test.ts` and in the E2E mock's mirror.
 */
import type {
  Company,
  Contact,
  DelayHypothesis,
  LogisticsEvent,
  Note,
  Offer,
  Resource,
  Role,
  Task,
  Warehouse,
} from './contracts.ts';

/** Fields withheld from guests, per record type. */
export const WITHHELD_FROM_GUESTS = {
  event: ['notes'],
  task: ['notes'],
  contact: ['phone', 'email', 'description', 'notes'],
  company: ['phone', 'email', 'notes'],
  offer: [
    'price',
    'transportCost',
    'assemblyCost',
    'maintenanceCost',
    'conditions',
  ],
  warehouse: ['address', 'notes'],
  resource: ['location', 'notes'],
  note: ['text'],
  hypothesis: ['note'],
} as const satisfies {
  event: readonly (keyof LogisticsEvent)[];
  task: readonly (keyof Task)[];
  contact: readonly (keyof Contact)[];
  company: readonly (keyof Company)[];
  offer: readonly (keyof Offer)[];
  warehouse: readonly (keyof Warehouse)[];
  resource: readonly (keyof Resource)[];
  note: readonly (keyof Note)[];
  hypothesis: readonly (keyof DelayHypothesis)[];
};

export type WithheldKind = keyof typeof WITHHELD_FROM_GUESTS;

/**
 * The record as this role may hold it: unchanged (with `restricted: false`)
 * for members, withheld fields set to null and `restricted: true` for
 * guests. Pure; never mutates `record`.
 */
export function withholdFor<T extends object>(
  kind: WithheldKind,
  record: T,
  role: Role,
): T & {restricted: boolean} {
  if (role !== 'guest') return {...record, restricted: false};
  const out: Record<string, unknown> = {...record, restricted: true};
  for (const key of WITHHELD_FROM_GUESTS[kind]) out[key] = null;
  return out as T & {restricted: boolean};
}
