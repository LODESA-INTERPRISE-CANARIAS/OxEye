/**
 * What a guest may not see. The «Invitado» login is shared, so it never
 * receives people's and companies' contact details, free-text observations,
 * prices, costs or conditions: those fields are sent as null and the record
 * carries `restricted: true`.
 *
 * Every row → record mapping of events, tasks, contacts, companies, offers,
 * warehouses, resources and notes goes through `forViewer`, with the viewer
 * as a required argument, so no route (lists, single records, 409 `current`,
 * DUPLICATE `current`) can skip it. A new free-text field is added here, not
 * copied elsewhere.
 */
import type {
  Company,
  Contact,
  LogisticsEvent,
  Note,
  Offer,
  Resource,
  Role,
  Task,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';

export interface Viewer {
  role: Role;
}

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
} as const satisfies {
  event: readonly (keyof LogisticsEvent)[];
  task: readonly (keyof Task)[];
  contact: readonly (keyof Contact)[];
  company: readonly (keyof Company)[];
  offer: readonly (keyof Offer)[];
  warehouse: readonly (keyof Warehouse)[];
  resource: readonly (keyof Resource)[];
  note: readonly (keyof Note)[];
};

type Withheld = typeof WITHHELD_FROM_GUESTS;

/** The record as stored, before deciding what this viewer may see. */
type Full<T> = Omit<T, 'restricted'>;

export function forViewer(
  kind: 'event',
  record: Full<LogisticsEvent>,
  viewer: Viewer,
): LogisticsEvent;
export function forViewer(
  kind: 'task',
  record: Full<Task>,
  viewer: Viewer,
): Task;
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
  kind: 'warehouse',
  record: Full<Warehouse>,
  viewer: Viewer,
): Warehouse;
export function forViewer(
  kind: 'resource',
  record: Full<Resource>,
  viewer: Viewer,
): Resource;
export function forViewer(
  kind: 'note',
  record: Full<Note>,
  viewer: Viewer,
): Note;
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
