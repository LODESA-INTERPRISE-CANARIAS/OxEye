import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {setMainSchema, uploadMediaSchema} from './schemas.ts';
import {deleteMedia, readMedia, setMainMedia, uploadMedia} from './service.ts';

/** Larger body allowed for POST /media only (base64 of MEDIA_MAX_BYTES + JSON). */
export const MEDIA_BODY_MAX_BYTES = 1024 * 1024;

/**
 * Images (Revisión 1 · E3). Reading needs a session (guests too); writes are
 * members only (guests get 403 from auth).
 */
export function registerMediaRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.post('/media', auth, async c => {
    const input = await jsonBody(c, uploadMediaSchema);
    const created = await uploadMedia(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.get('/media/:id', auth, async c => {
    const image = await readMedia(deps.db, c.get('user'), c.req.param('id'));
    // An image never changes once stored (a new photo has a new id).
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    c.header('Content-Type', image.contentType);
    c.header('Content-Length', String(image.bytes.length));
    return c.body(image.bytes as Uint8Array<ArrayBuffer>, 200);
  });

  api.patch('/media/:id', auth, async c => {
    await jsonBody(c, setMainSchema);
    const media = await setMainMedia(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      deps.now(),
    );
    return c.json(media);
  });

  api.delete('/media/:id', auth, async c => {
    await deleteMedia(deps.db, c.get('user'), c.req.param('id'), deps.now());
    return c.body(null, 204);
  });
}
