/**
 * Operational notes: a note, a logistics incident, a decision, an open
 * question or an idea for the tool, linked to an event and/or one record.
 * Kind and text are required. Every write holds the organization's catalogue
 * lock (notes point at catalogue records and tasks, whose deletes unlink
 * them) and appends to the activity log in the same transaction.
 *
 * Safety: an incident here is a logistics incident; Punto Violeta cases and
 * data about attended people are never recorded in this tool. The text is
 * withheld from guests (records/redact.ts), never searched and never quoted
 * in a label: the activity names a note by its kind and what it points at
 * (`noteLabel`).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {
  CURRENT_ANSWER_COLUMNS,
  CURRENT_ANSWER_JOIN,
  currentAnswerOf,
  SELECT_ANSWER,
  toAnswer,
} from './answers.ts';
import type {AnswerRow, CurrentAnswerColumns} from './answers.ts';
import {appendActivity} from '../activity/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {createOnce, findReplay, fresh} from '../records/device-id.ts';
import type {Created, DeviceCreate} from '../records/device-id.ts';
import {lockCatalogue} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {changedFields} from '../records/slot.ts';
import {
  labelOf,
  NOTE_LABEL_COLUMNS,
  NOTE_LABEL_JOINS,
  NOTE_REF_COLUMN,
  NOTE_REF_TARGET,
  refOf,
} from './refs.ts';
import type {NoteRefColumns} from './refs.ts';
import type {
  AnswerBody,
  CreateNoteBody,
  NoteBody,
  UpdateNoteBody,
} from './schemas.ts';
import type {
  DataSource,
  Note,
  NoteAnswer,
  NoteKind,
  NoteRefType,
  SessionUser,
  Verification,
} from '../../../shared/logistics/contracts.ts';

interface NoteRow extends MetaRow, NoteRefColumns, CurrentAnswerColumns {
  organization_id: string;
  kind: NoteKind;
  text: string;
  event_id: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolved_at: unknown;
  note_event_name: string | null;
  note_ref_label: string | null;
  note_ref_is_contact: boolean | null;
  note_ref_directory: 'company' | 'offer' | null;
}

const SELECT_NOTE = `
  SELECT ${metaColumns('n')}, n.organization_id, n.kind, n.text, n.event_id,
         n.resolved, n.task_id, n.venue_id, n.company_id, n.contact_id,
         n.offer_id, n.warehouse_id, n.resource_id, ${NOTE_LABEL_COLUMNS},
         n.resolved_by, ru.display_name AS resolved_by_name, n.resolved_at,
         ${CURRENT_ANSWER_COLUMNS}
    FROM notes n ${NOTE_LABEL_JOINS}
    LEFT JOIN users ru ON ru.id = n.resolved_by
    ${CURRENT_ANSWER_JOIN}
    ${authorJoins('n')}`;

const EVENT_NOT_FOUND =
  'No encontramos ese evento en esta organización: puede que se haya eliminado.';
const REF_NOT_FOUND =
  'No encontramos ese registro en esta organización: puede que se haya eliminado.';

/**
 * The single row → record mapping; the viewer decides what is withheld.
 * Without `directory.read`, a link to a company, person or offer reads as
 * what it is, not whose name (`DIRECTORY_REF_LABEL`, applied by `forViewer`).
 */
function toNote(row: NoteRow, viewer: Viewer): Note {
  const ref = refOf(row);
  return forViewer(
    'note',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      kind: row.kind,
      text: row.text,
      event:
        row.event_id && row.note_event_name
          ? {id: row.event_id, name: row.note_event_name}
          : null,
      ref: ref ? {...ref, label: row.note_ref_label ?? ''} : null,
      resolved: Boolean(row.resolved),
      answer: currentAnswerOf(row, viewer),
      resolvedBy:
        row.resolved_by && row.resolved_by_name !== null
          ? {id: row.resolved_by, displayName: row.resolved_by_name}
          : null,
      resolvedAt: toIsoOrNull(row.resolved_at),
    },
    viewer,
  );
}

type Ref = {type: NoteRefType; id: string} | null;

/** The editable state of a note, in comparable form. */
interface NoteState {
  kind: NoteKind;
  text: string;
  eventId: string | null;
  /** `type:id`, so two links compare by value. */
  ref: string | null;
  resolved: boolean;
  source: DataSource | null;
  verification: Verification;
}

const FIELD_NAMES: readonly (readonly [keyof NoteState, string])[] = [
  ['kind', 'kind'],
  ['text', 'text'],
  ['eventId', 'event'],
  ['ref', 'ref'],
  ['resolved', 'resolved'],
  ['source', 'source'],
  ['verification', 'verification'],
];

function refKey(ref: Ref): string | null {
  return ref ? `${ref.type}:${ref.id.toLowerCase()}` : null;
}

function parseRefKey(key: string | null): Ref {
  if (!key) return null;
  const [type, id] = key.split(':') as [NoteRefType, string];
  return {type, id};
}

function stateOf(row: NoteRow): NoteState {
  return {
    kind: row.kind,
    text: row.text,
    eventId: row.event_id,
    ref: refKey(refOf(row)),
    resolved: Boolean(row.resolved),
    source: row.source,
    verification: row.verification,
  };
}

/** One value per reference column: the id in the linked type's column. */
function refColumns(key: string | null): (string | null)[] {
  const ref = parseRefKey(key);
  return (Object.keys(NOTE_REF_COLUMN) as NoteRefType[]).map(type =>
    ref && ref.type === type ? ref.id : null,
  );
}

/** Newest first. */
export async function listNotes(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<Note[]> {
  const rows = await db.query<NoteRow>(
    `${SELECT_NOTE}
      WHERE n.organization_id = $1
      ORDER BY n.created_at DESC, n.id DESC`,
    [organizationId],
  );
  return rows.map(r => toNote(r, viewer));
}

async function loadNote(
  db: Queryable,
  id: string,
  lock = false,
): Promise<NoteRow | undefined> {
  const rows = await db.query<NoteRow>(
    `${SELECT_NOTE} WHERE n.id = $1${lock ? ' FOR UPDATE OF n' : ''}`,
    [id],
  );
  return rows[0];
}

function noteNotFound(): AppError {
  return notFound('No encontramos esa nota: puede que se haya eliminado.');
}

function staleNote(row: NoteRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado esta nota mientras la editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toNote(row, viewer)},
  );
}

/** Applies an input to a state, checking event and link against the organization. */
async function applyInput(
  tx: Queryable,
  organizationId: string,
  before: NoteState,
  input: NoteBody,
): Promise<NoteState> {
  const after: NoteState = {...before};
  if (input.kind !== undefined) after.kind = input.kind;
  if (input.text !== undefined) after.text = input.text;
  if (input.resolved !== undefined) after.resolved = input.resolved;
  if (input.source !== undefined) after.source = input.source;
  if (input.verification !== undefined) {
    after.verification = input.verification;
  }

  const fields: Record<string, string> = {};
  if (input.eventId !== undefined) {
    if (input.eventId === null) {
      after.eventId = null;
    } else {
      const found = await tx.query<{id: string}>(
        'SELECT id FROM events WHERE id = $1 AND organization_id = $2',
        [input.eventId, organizationId],
      );
      if (found[0]) after.eventId = found[0].id;
      else fields.eventId = EVENT_NOT_FOUND;
    }
  }
  if (input.ref !== undefined) {
    if (input.ref === null) {
      after.ref = null;
    } else {
      const {table} = NOTE_REF_TARGET[input.ref.type];
      const found = await tx.query<{id: string}>(
        `SELECT id FROM ${table} WHERE id = $1 AND organization_id = $2`,
        [input.ref.id, organizationId],
      );
      if (found[0]) after.ref = refKey({type: input.ref.type, id: found[0].id});
      else fields.ref = REF_NOT_FOUND;
    }
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
  return after;
}

const EMPTY: NoteState = {
  kind: 'note',
  text: '',
  eventId: null,
  ref: null,
  resolved: false,
  source: null,
  verification: 'draft',
};

export async function createNote(
  db: Db,
  actor: SessionUser,
  input: CreateNoteBody,
  now: Date,
): Promise<Created<Note>> {
  const device: DeviceCreate<Note> = {
    table: 'notes',
    id: input.id,
    organizationId: input.organizationId,
    actorId: actor.id,
    load: async (q, id) => {
      const row = await loadNote(q, id);
      return row && toNote(row, actor);
    },
  };
  return createOnce(db, device, async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    const replay = await findReplay(tx, device, org.id);
    if (replay) return replay;
    const state = await applyInput(tx, org.id, EMPTY, input);
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO notes
         (organization_id, kind, text, event_id, resolved, source,
          verification, created_by, created_at, updated_by, updated_at,
          task_id, venue_id, company_id, contact_id, offer_id, warehouse_id,
          resource_id, id, resolved_by, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $8,
               $9::timestamptz, $10, $11, $12, $13, $14, $15, $16,
               COALESCE($17::uuid, gen_random_uuid()),
               CASE WHEN $5 THEN $8::uuid END,
               CASE WHEN $5 THEN $9::timestamptz END)
       RETURNING id`,
      [
        org.id,
        state.kind,
        state.text,
        state.eventId,
        state.resolved,
        state.source,
        state.verification,
        actor.id,
        now.toISOString(),
        ...refColumns(state.ref),
        input.id ?? null,
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    const row = (await loadNote(tx, id)) as NoteRow;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'note',
      entityId: id,
      entityLabel: labelOf(row),
      action: 'create',
      at: now,
    });
    return fresh(toNote(row, actor));
  });
}

/** Loads the note and checks membership; foreign notes are «not found». */
async function loadOwnNote(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<NoteRow> {
  const row = await loadNote(tx, id);
  if (!row) throw noteNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw noteNotFound();
  }
  return row;
}

export async function updateNote(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateNoteBody,
  now: Date,
): Promise<Note> {
  if (!isUuid(id)) throw noteNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnNote(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadNote(tx, id, true);
    if (!row) throw noteNotFound();
    if (row.version !== input.version) throw staleNote(row, actor);

    const before = stateOf(row);
    const after = await applyInput(tx, orgId, before, input);
    await checkAnswerRules(tx, row, before, after, actor);
    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toNote(row, actor);

    // Who resolved it: set when it becomes resolved, cleared when reopened.
    const resolvedBy = after.resolved
      ? before.resolved
        ? row.resolved_by
        : actor.id
      : null;
    const resolvedAt = after.resolved
      ? before.resolved
        ? toIsoOrNull(row.resolved_at)
        : now.toISOString()
      : null;
    await tx.query(
      `UPDATE notes
          SET kind = $3, text = $4, event_id = $5, resolved = $6,
              source = $7, verification = $8, version = version + 1,
              updated_by = $9, updated_at = $10::timestamptz,
              task_id = $11, venue_id = $12, company_id = $13,
              contact_id = $14, offer_id = $15, warehouse_id = $16,
              resource_id = $17, resolved_by = $18,
              resolved_at = $19::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.kind,
        after.text,
        after.eventId,
        after.resolved,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
        ...refColumns(after.ref),
        resolvedBy,
        resolvedAt,
      ],
    );
    const updated = (await loadNote(tx, id)) as NoteRow;
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'note',
      entityId: id,
      entityLabel: labelOf(updated),
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toNote(updated, actor);
  });
}

export async function deleteNote(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw noteNotFound();
  await db.transaction(async tx => {
    const orgId = (await loadOwnNote(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadNote(tx, id, true);
    if (!row) throw noteNotFound();
    if (row.version !== version) throw staleNote(row, actor);
    // Its answers go with it (ON DELETE CASCADE).
    await tx.query('DELETE FROM notes WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'note',
      entityId: id,
      entityLabel: labelOf(row),
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}

// ---------------------------------------------------------------- answers (Revisión 1 · E3)

export const ONLY_THE_ASKER =
  'Solo quien hizo la pregunta puede darla por respondida (o reabrirla) cuando ya tiene una respuesta.';
export const KIND_HAS_ANSWERS =
  'Esta pregunta ya tiene respuestas: no se puede cambiar a otro tipo de nota.';
export const NOT_A_QUESTION = 'Solo las preguntas abiertas reciben respuestas.';
export const QUESTION_CLOSED =
  'Esta pregunta ya está dada por respondida: quien la hizo puede reabrirla si hace falta otra respuesta.';
export const ANSWER_CHANGED =
  'La respuesta ha cambiado mientras escribías. Mira la respuesta actual y quién la dio antes de sustituirla.';
const REPLACES_UNKNOWN =
  'Esa respuesta no es de esta pregunta. Vuelve a abrirla y responde de nuevo.';

/**
 * The rules an open question adds to a note edit: resolving or reopening it
 * is for its author, or for any member while it has no current answer; a
 * question with answers keeps its kind.
 */
async function checkAnswerRules(
  tx: Queryable,
  row: NoteRow,
  before: NoteState,
  after: NoteState,
  actor: SessionUser,
): Promise<void> {
  if (before.kind === 'open_question' && after.kind !== 'open_question') {
    const any = await tx.query(
      'SELECT 1 FROM note_answers WHERE note_id = $1 LIMIT 1',
      [row.id],
    );
    if (any.length > 0) throw validationError({kind: KIND_HAS_ANSWERS});
  }
  if (
    after.kind === 'open_question' &&
    before.resolved !== after.resolved &&
    row.ans_id !== null &&
    row.created_by !== actor.id
  ) {
    throw new AppError('FORBIDDEN', ONLY_THE_ASKER);
  }
}

/** Every answer of a note, newest first; `text` withheld from guests. */
export async function listAnswers(
  db: Db,
  actor: SessionUser,
  noteId: string,
): Promise<NoteAnswer[]> {
  if (!isUuid(noteId)) throw noteNotFound();
  const note = await loadOwnNote(db, actor, noteId);
  const rows = await db.query<AnswerRow>(
    `${SELECT_ANSWER} WHERE a.note_id = $1`,
    [note.id],
  );
  // The chain is linear: from the current answer back through `replaces`,
  // so two answers given in the same second still come in their real order.
  const byId = new Map(rows.map(r => [r.id, r]));
  const replaced = new Set(rows.map(r => r.replaces_id).filter(Boolean));
  const ordered: AnswerRow[] = [];
  let at = rows.find(r => !replaced.has(r.id));
  while (at && ordered.length < rows.length) {
    ordered.push(at);
    at = at.replaces_id ? byId.get(at.replaces_id) : undefined;
  }
  return ordered.map(r => toAnswer(r, actor));
}

/**
 * Answers an open question, or replaces its current answer when `replaces`
 * names it (409 with the current answer otherwise). The note's version
 * increases and the change is logged as a note update (`answer`).
 */
export async function createAnswer(
  db: Db,
  actor: SessionUser,
  noteId: string,
  input: AnswerBody,
  now: Date,
): Promise<NoteAnswer> {
  if (!isUuid(noteId)) throw noteNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnNote(tx, actor, noteId)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadNote(tx, noteId, true);
    if (!row) throw noteNotFound();
    if (row.kind !== 'open_question') {
      throw new AppError('VALIDATION', NOT_A_QUESTION);
    }
    if (row.resolved) throw new AppError('VALIDATION', QUESTION_CLOSED);
    const current = currentAnswerOf(row, actor);
    if ((input.replaces ?? null) !== (current?.id ?? null)) {
      const known =
        input.replaces === null ||
        (
          await tx.query(
            'SELECT 1 FROM note_answers WHERE id = $1 AND note_id = $2',
            [input.replaces, row.id],
          )
        ).length > 0;
      if (!known) throw validationError({replaces: REPLACES_UNKNOWN});
      throw new AppError('VERSION_CONFLICT', ANSWER_CHANGED, {current});
    }
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO note_answers (note_id, text, answered_by, answered_at, replaces_id)
       VALUES ($1, $2, $3, $4::timestamptz, $5)
       RETURNING id`,
      [row.id, input.text, actor.id, now.toISOString(), current?.id ?? null],
    );
    await tx.query(
      `UPDATE notes SET version = version + 1, updated_by = $2,
              updated_at = $3::timestamptz
        WHERE id = $1`,
      [row.id, actor.id, now.toISOString()],
    );
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'note',
      entityId: row.id,
      entityLabel: labelOf(row),
      action: 'update',
      changedFields: ['answer'],
      at: now,
      isDemo: row.is_demo,
    });
    const [answer] = await tx.query<AnswerRow>(
      `${SELECT_ANSWER} WHERE a.id = $1`,
      [(inserted[0] as {id: string}).id],
    );
    return toAnswer(answer as AnswerRow, actor);
  });
}
