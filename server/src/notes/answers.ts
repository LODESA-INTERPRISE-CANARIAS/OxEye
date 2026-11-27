/**
 * Answers to open questions (Revisión 1 · E3): SQL pieces and the row →
 * record mapping, shared by the note queries (a note carries its current
 * answer) and the answer list. Answers are never edited, only replaced: the
 * current answer is the one no other answer replaces. The text is withheld
 * from guests (records/redact.ts), like the note's own text.
 */
import {toIso} from '../db/db.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import type {NoteAnswer} from '../../../shared/logistics/contracts.ts';

/** Answer columns selected from alias `ans` (current answer join). */
export interface CurrentAnswerColumns {
  ans_id: string | null;
  ans_text: string | null;
  ans_by: string | null;
  ans_by_name: string | null;
  ans_at: unknown;
  ans_replaces: string | null;
}

/** The current answer of note alias `n`, if any. */
export const CURRENT_ANSWER_JOIN = `
    LEFT JOIN LATERAL (
      SELECT a.id, a.text, a.answered_by, au.display_name, a.answered_at,
             a.replaces_id
        FROM note_answers a JOIN users au ON au.id = a.answered_by
       WHERE a.note_id = n.id
         AND NOT EXISTS (SELECT 1 FROM note_answers b WHERE b.replaces_id = a.id)
    ) ans ON true`;

export const CURRENT_ANSWER_COLUMNS = `ans.id AS ans_id, ans.text AS ans_text,
    ans.answered_by AS ans_by, ans.display_name AS ans_by_name,
    ans.answered_at AS ans_at, ans.replaces_id AS ans_replaces`;

export interface AnswerRow {
  id: string;
  note_id: string;
  text: string;
  answered_by: string;
  answered_by_name: string;
  answered_at: unknown;
  replaces_id: string | null;
}

export const SELECT_ANSWER = `
  SELECT a.id, a.note_id, a.text, a.answered_by,
         au.display_name AS answered_by_name, a.answered_at, a.replaces_id
    FROM note_answers a JOIN users au ON au.id = a.answered_by`;

/** The single row → record mapping; the viewer decides what is withheld. */
export function toAnswer(row: AnswerRow, viewer: Viewer): NoteAnswer {
  return forViewer(
    'answer',
    {
      id: row.id,
      noteId: row.note_id,
      text: row.text,
      answeredBy: {id: row.answered_by, displayName: row.answered_by_name},
      answeredAt: toIso(row.answered_at),
      replacesId: row.replaces_id,
    },
    viewer,
  );
}

/** The current answer carried by a note row, or null. */
export function currentAnswerOf(
  row: CurrentAnswerColumns & {id: string},
  viewer: Viewer,
): NoteAnswer | null {
  if (!row.ans_id || row.ans_text === null || !row.ans_by) return null;
  return toAnswer(
    {
      id: row.ans_id,
      note_id: row.id,
      text: row.ans_text,
      answered_by: row.ans_by,
      answered_by_name: row.ans_by_name ?? '',
      answered_at: row.ans_at,
      replaces_id: row.ans_replaces,
    },
    viewer,
  );
}
