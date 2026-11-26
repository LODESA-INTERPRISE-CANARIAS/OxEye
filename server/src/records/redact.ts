/**
 * What a guest may not see. The «Invitado» login is shared, so it never
 * receives people's and companies' contact details, free-text observations,
 * prices, costs or conditions: those fields are sent as null and the record
 * carries `restricted: true`.
 *
 * Every row → record mapping of events, tasks, contacts, companies, offers,
 * warehouses, resources, notes and delay hypotheses goes through
 * `forViewer`, with the viewer as a required argument, so no route (lists,
 * single records, 409 `current`, DUPLICATE `current`) can skip it.
 *
 * M6: the list itself lives in `shared/logistics/redaction.ts`, so the
 * device cache applies the same one; it is re-exported here for existing
 * imports. A new free-text field is added there, not copied elsewhere.
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
} from '../../../shared/logistics/contracts.ts';
import {
  WITHHELD_FROM_GUESTS,
  withholdFor,
  type WithheldKind,
} from '../../../shared/logistics/redaction.ts';

export {WITHHELD_FROM_GUESTS};

export interface Viewer {
  role: Role;
}

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
  kind: 'hypothesis',
  record: Full<DelayHypothesis>,
  viewer: Viewer,
): DelayHypothesis;
export function forViewer(
  kind: WithheldKind,
  record: object,
  viewer: Viewer,
): object {
  return withholdFor(kind, record, viewer.role);
}
