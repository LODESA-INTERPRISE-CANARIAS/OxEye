/**
 * What a guest may not see. The «Invitado» login is shared, so it never
 * receives people's and companies' contact details, free-text observations,
 * prices, costs or conditions: those fields are sent as null and the record
 * carries `restricted: true`.
 *
 * Every row → record mapping of contacts, companies and offers goes through
 * `forViewer`, with the viewer as a required argument, so no route (lists,
 * single records, 409 `current`, DUPLICATE `current`) can skip it.
 */
import type {
  Company,
  Contact,
  Offer,
  Role,
} from '../../../shared/logistics/contracts.ts';

export interface Viewer {
  role: Role;
}

/** Fields withheld from guests, per record type. */
export const WITHHELD_FROM_GUESTS = {
  contact: ['phone', 'email', 'description', 'notes'],
  company: ['phone', 'email', 'notes'],
  offer: [
    'price',
    'transportCost',
    'assemblyCost',
    'maintenanceCost',
    'conditions',
  ],
} as const satisfies {
  contact: readonly (keyof Contact)[];
  company: readonly (keyof Company)[];
  offer: readonly (keyof Offer)[];
};

type Withheld = typeof WITHHELD_FROM_GUESTS;

/** The record as stored, before deciding what this viewer may see. */
type Full<T> = Omit<T, 'restricted'>;

export function forViewer(
  kind: 'contact',
  record: Full<Contact>,
  viewer: Viewer,
): Contact;
export function forViewer(
  kind: 'company',
  record: Full<Company>,
  viewer: Viewer,
): Company;
export function forViewer(
  kind: 'offer',
  record: Full<Offer>,
  viewer: Viewer,
): Offer;
export function forViewer(
  kind: keyof Withheld,
  record: object,
  viewer: Viewer,
): object {
  if (viewer.role !== 'guest') return {...record, restricted: false};
  const out: Record<string, unknown> = {...record, restricted: true};
  for (const key of WITHHELD_FROM_GUESTS[kind]) out[key] = null;
  return out;
}
