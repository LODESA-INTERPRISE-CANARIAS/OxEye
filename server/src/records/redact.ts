/**
 * What a guest may not see. The «Invitado» login is shared, so it never
 * receives people's and companies' contact details, free-text observations,
 * prices, costs or conditions: those fields are sent as null and the record
 * carries `restricted: true`.
 *
 * Every row → record mapping of events, tasks, contacts, companies, offers,
 * warehouses, resources, notes, delay hypotheses, answers and accepted
 * conflicts (Revisión 1) goes through
 * `forViewer`, with the viewer as a required argument, so no route (lists,
 * single records, 409 `current`, DUPLICATE `current`) can skip it.
 *
 * M6: the list itself lives in `shared/logistics/redaction.ts`, so the
 * device cache applies the same one; it is re-exported here for existing
 * imports. A new free-text field is added there, not copied elsewhere.
 */
import type {
  Company,
  ConflictAcceptance,
  Contact,
  DelayHypothesis,
  LogisticsEvent,
  Note,
  NoteAnswer,
  Offer,
  Resource,
  Role,
  SessionUser,
  Task,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';
import {hasAccess} from '../organizations/service.ts';
import type {Membership} from '../organizations/service.ts';
import {
  WITHHELD_FROM_GUESTS,
  withholdFor,
  type WithheldKind,
} from '../../../shared/logistics/redaction.ts';

export {WITHHELD_FROM_GUESTS};

export interface Viewer {
  role: Role;
  /**
   * Safety audit: whether the viewer reads the directory (`directory.read`
   * in the organization), set by read routes with `viewerIn`. Omitted (a
   * session user passed as is, writers): every member role that writes also
   * reads the directory, so only the guest account is withheld.
   */
  directory?: boolean;
}

/** The viewer as the organization's permissions make it (read routes). */
export function viewerIn(user: SessionUser, membership: Membership): Viewer {
  return {
    role: user.role,
    directory: hasAccess(membership, user, 'directory.read'),
  };
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
  kind: 'answer',
  record: Full<NoteAnswer>,
  viewer: Viewer,
): NoteAnswer;
export function forViewer(
  kind: 'acceptance',
  record: Full<ConflictAcceptance>,
  viewer: Viewer,
): ConflictAcceptance;
export function forViewer(
  kind: WithheldKind,
  record: object,
  viewer: Viewer,
): object {
  return withholdFor(
    kind,
    record,
    viewer.role,
    viewer.directory ?? viewer.role !== 'guest',
  );
}
