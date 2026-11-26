import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {createNoteSchema, updateNoteSchema} from './schemas.ts';
import {createNote, deleteNote, listNotes, updateNote} from './service.ts';
import type {ListResponse, Note} from '../../../shared/logistics/contracts.ts';

export function registerNoteRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/notes', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Note> = {
      items: await listNotes(deps.db, org.id, user),
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
