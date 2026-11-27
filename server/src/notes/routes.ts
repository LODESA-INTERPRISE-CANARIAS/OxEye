import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {viewerIn} from '../records/redact.ts';
import {answerSchema, createNoteSchema, updateNoteSchema} from './schemas.ts';
import {
  createAnswer,
  createNote,
  deleteNote,
  listAnswers,
  listNotes,
  updateNote,
} from './service.ts';
import type {
  ListResponse,
  Note,
  NoteAnswer,
} from '../../../shared/logistics/contracts.ts';

export function registerNoteRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/notes', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Note> = {
      items: await listNotes(deps.db, org.id, viewerIn(user, org)),
    };
    return c.json(body);
  });

  api.post('/notes', auth, async c => {
    const input = await jsonBody(c, createNoteSchema);
    const created = await createNote(deps.db, c.get('user'), input, deps.now());
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/notes/:id', auth, async c => {
    const input = await jsonBody(c, updateNoteSchema);
    const note = await updateNote(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(note);
  });

  // Revisión 1 · E3: answers to open questions (guests read them without
  // the text; writing gets 403 from auth).
  api.get('/notes/:id/answers', auth, async c => {
    const body: ListResponse<NoteAnswer> = {
      items: await listAnswers(deps.db, c.get('user'), c.req.param('id')),
    };
    return c.json(body);
  });

  api.post('/notes/:id/answers', auth, async c => {
    const input = await jsonBody(c, answerSchema);
    const answer = await createAnswer(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(answer, 201);
  });

  api.delete('/notes/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'), 'la nota');
    await deleteNote(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
