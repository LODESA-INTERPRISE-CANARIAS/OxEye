/**
 * What a note points at, and the one label of a note that may appear outside
 * the note itself (activity): its kind and what it points at, never its text
 * (`noteLabel` in shared/logistics/history.ts). Also the unlink used by the
 * writers that delete records notes can point at. Kept apart from
 * notes/service.ts so those writers can use it without a circular import.
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {noteLabel} from '../../../shared/logistics/history.ts';
import type {
  NoteKind,
  NoteRefType,
} from '../../../shared/logistics/contracts.ts';

/** One nullable column per record type a note can point at. */
export const NOTE_REF_COLUMN: Record<NoteRefType, string> = {
  task: 'task_id',
  venue: 'venue_id',
  company: 'company_id',
  contact: 'contact_id',
  offer: 'offer_id',
  warehouse: 'warehouse_id',
  resource: 'resource_id',
};

/** Table and label column of each record type a note can point at. */
export const NOTE_REF_TARGET: Record<
  NoteRefType,
  {table: string; label: string}
> = {
  task: {table: 'tasks', label: 'title'},
  venue: {table: 'venues', label: 'name'},
  company: {table: 'companies', label: 'name'},
  contact: {table: 'contacts', label: 'name'},
  offer: {table: 'offers', label: 'name'},
  warehouse: {table: 'warehouses', label: 'name'},
  resource: {table: 'resources', label: 'name'},
};

/** Order in which a row's reference columns are read. */
const REF_TYPES = Object.keys(NOTE_REF_COLUMN) as NoteRefType[];

/**
 * Joins giving a note of alias `n` its event name (`note_event_name`) and the
 * current name or title of what it points at (`note_ref_label`).
 */
export const NOTE_LABEL_JOINS = `
    LEFT JOIN events ref_e ON ref_e.id = n.event_id
    LEFT JOIN tasks ref_t ON ref_t.id = n.task_id
    LEFT JOIN venues ref_v ON ref_v.id = n.venue_id
    LEFT JOIN companies ref_c ON ref_c.id = n.company_id
    LEFT JOIN contacts ref_k ON ref_k.id = n.contact_id
    LEFT JOIN offers ref_o ON ref_o.id = n.offer_id
    LEFT JOIN warehouses ref_w ON ref_w.id = n.warehouse_id
    LEFT JOIN resources ref_r ON ref_r.id = n.resource_id`;

export const NOTE_LABEL_COLUMNS = `ref_e.name AS note_event_name,
    COALESCE(ref_t.title, ref_v.name, ref_c.name, ref_k.name, ref_o.name,
             ref_w.name, ref_r.name) AS note_ref_label,
    (ref_k.id IS NOT NULL) AS note_ref_is_contact`;

/** The reference columns of a note row, as selected with `n.*_id`. */
export interface NoteRefColumns {
  task_id: string | null;
  venue_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  offer_id: string | null;
  warehouse_id: string | null;
  resource_id: string | null;
}

/** The record a note row points at, if any. */
export function refOf(
  row: NoteRefColumns,
): {type: NoteRefType; id: string} | null {
  for (const type of REF_TYPES) {
    const id = row[NOTE_REF_COLUMN[type] as keyof NoteRefColumns];
    if (id) return {type, id};
  }
  return null;
}

/**
 * «Incidencia · Montaje del escenario»: kind and what it points at, never the
 * text, and never a person's name (`noteLabel` falls back to the event).
 */
export function labelOf(row: {
  kind: NoteKind;
  note_event_name: string | null;
  note_ref_label: string | null;
  note_ref_is_contact?: boolean | null;
}): string {
  return noteLabel({
    kind: row.kind,
    ref: row.note_ref_label
      ? {
          label: row.note_ref_label,
          type: row.note_ref_is_contact ? 'contact' : undefined,
        }
      : null,
    event: row.note_event_name ? {name: row.note_event_name} : null,
  });
}

/** Current labels of the given notes, by id, with what the activity log needs. */
export async function noteLabels(
  tx: Queryable,
  ids: readonly string[],
): Promise<
  {id: string; organization_id: string; is_demo: boolean; label: string}[]
> {
  if (ids.length === 0) return [];
  const rows = await tx.query<{
    id: string;
    organization_id: string;
    is_demo: boolean;
    kind: NoteKind;
    note_event_name: string | null;
    note_ref_label: string | null;
    note_ref_is_contact: boolean | null;
  }>(
    `SELECT n.id, n.organization_id, n.is_demo, n.kind, ${NOTE_LABEL_COLUMNS}
       FROM notes n ${NOTE_LABEL_JOINS}
      WHERE n.id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))
      ORDER BY n.id`,
    [JSON.stringify(ids)],
  );
  return rows.map(r => ({
    id: r.id,
    organization_id: r.organization_id,
    is_demo: r.is_demo,
    label: labelOf(r),
  }));
}

/**
 * Removes the link from every note that points at one of `ids` (as its event
 * or as its record), with a new version, author and time, and logs it
 * (`event` or `ref`), so a stale edit cannot restore the link silently. Run
 * it before deleting what the notes point at; the caller holds the catalogue
 * lock (note rows have one writer per organization).
 */
export async function unlinkNotes(
  tx: Queryable,
  args: {
    link: NoteRefType | 'event';
    ids: readonly string[];
    actorId: string;
    now: Date;
  },
): Promise<void> {
  if (args.ids.length === 0) return;
  const column =
    args.link === 'event' ? 'event_id' : NOTE_REF_COLUMN[args.link];
  const updated = await tx.query<{id: string}>(
    `UPDATE notes
        SET ${column} = NULL, version = version + 1,
            updated_by = $2, updated_at = $3::timestamptz
      WHERE ${column} IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))
      RETURNING id`,
    [JSON.stringify(args.ids), args.actorId, args.now.toISOString()],
  );
  for (const n of await noteLabels(
    tx,
    updated.map(u => u.id),
  )) {
    await appendActivity(tx, {
      organizationId: n.organization_id,
      userId: args.actorId,
      entityType: 'note',
      entityId: n.id,
      entityLabel: n.label,
      action: 'update',
      changedFields: [args.link === 'event' ? 'event' : 'ref'],
      at: args.now,
      isDemo: n.is_demo,
    });
  }
}
