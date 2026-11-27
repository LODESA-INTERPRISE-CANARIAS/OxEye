/**
 * Revisión 1 · E3 on the server: answers to open questions (one current
 * answer, replaced only knowingly, closed and locked by the asker) and images
 * of inventory material (stored in PostgreSQL, checked against their own
 * bytes, one main, at most five). Fictitious data only; the images are tiny
 * synthetic headers, not real photos.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readImageHeader} from '../src/media/image.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {
  MEDIA_MAX_BYTES,
  MEDIA_PER_RECORD,
} from '../../shared/logistics/rules.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  ListResponse,
  MediaInfo,
  Note,
  NoteAnswer,
  Resource,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let elvis: string;
let dailos: string;
let guest: string;

beforeAll(async () => {
  h = await createHarness();
  elvis = (await h.login('Elvis')).token;
  dailos = (await h.login('Dailos')).token;
  guest = (await h.login('Invitado')).token;
});

afterAll(async () => {
  await h.db.close();
});

const orgPath = (what: string) => `/organizations/${h.org.id}/${what}`;

function post(path: string, body: Record<string, unknown>, t = elvis) {
  return h.request('POST', path, {
    token: t,
    body: {organizationId: h.org.id, ...body},
  });
}

function patch(path: string, body: Record<string, unknown>, t = elvis) {
  return h.request('PATCH', path, {token: t, body});
}

async function ok<T>(res: Response, status = 200): Promise<T> {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, got ${res.status}: ${await res.text()}`,
    );
  }
  return json<T>(res);
}

async function errorOf(res: Response, status: number): Promise<ApiErrorBody> {
  expect(res.status).toBe(status);
  return json<ApiErrorBody>(res);
}

async function listOf<T>(what: string, t = elvis): Promise<T[]> {
  return (
    await ok<ListResponse<T>>(await h.request('GET', orgPath(what), {token: t}))
  ).items;
}

async function noteById(id: string, t = elvis): Promise<Note> {
  return (await listOf<Note>('notes', t)).find(n => n.id === id)!;
}

function answer(
  noteId: string,
  text: string,
  replaces: string | null,
  t = elvis,
) {
  return h.request('POST', `/notes/${noteId}/answers`, {
    token: t,
    body: {text, replaces},
  });
}

async function question(t = elvis): Promise<Note> {
  return ok<Note>(
    await post(
      '/notes',
      {kind: 'open_question', text: '¿A qué hora abre la nave?'},
      t,
    ),
    201,
  );
}

describe('answers to open questions', () => {
  it('one current answer inside the note; replacing it needs to name it; history in the list', async () => {
    const q = await question();
    expect(q).toMatchObject({answer: null, resolvedBy: null, resolvedAt: null});

    const first = await ok<NoteAnswer>(
      await answer(q.id, ' A las 8 ', null, dailos),
      201,
    );
    expect(first).toMatchObject({
      noteId: q.id,
      text: 'A las 8',
      answeredBy: {displayName: 'Dailos'},
      replacesId: null,
      restricted: false,
    });
    const afterFirst = await noteById(q.id);
    expect(afterFirst.answer).toMatchObject({id: first.id, text: 'A las 8'});
    expect(afterFirst.version).toBe(q.version + 1);
    const [entry] = await listOf<ActivityEntry>(
      `activity?entityType=note&entityId=${q.id}`,
    );
    expect(entry).toMatchObject({action: 'update', changedFields: ['answer']});
    expect(entry?.entityLabel).not.toContain('A las 8');

    // Answering as if there were none → 409 with the current answer and its author.
    const conflict = await errorOf(await answer(q.id, 'A las 9', null), 409);
    expect(conflict.code).toBe('VERSION_CONFLICT');
    expect(conflict.current).toMatchObject({
      id: first.id,
      text: 'A las 8',
      answeredBy: {displayName: 'Dailos'},
    });

    const second = await ok<NoteAnswer>(
      await answer(q.id, 'A las 9', first.id),
      201,
    );
    expect(second.replacesId).toBe(first.id);
    expect((await noteById(q.id)).answer?.id).toBe(second.id);
    // Replacing the old one again → 409 (it is no longer current).
    expect((await answer(q.id, 'A las 10', first.id)).status).toBe(409);
    // An id that is not one of its answers → 400.
    const unknown = await errorOf(
      await answer(q.id, 'A las 10', '00000000-0000-4000-8000-000000000000'),
      400,
    );
    expect(unknown.fields?.replaces).toBeTruthy();

    const all = await ok<ListResponse<NoteAnswer>>(
      await h.request('GET', `/notes/${q.id}/answers`, {token: elvis}),
    );
    expect(all.items.map(a => a.id)).toEqual([second.id, first.id]);
  });

  it('only open questions, non-empty text, members only', async () => {
    const note = await ok<Note>(
      await post('/notes', {kind: 'note', text: 'Nota Prueba'}),
      201,
    );
    const err = await errorOf(await answer(note.id, 'x', null), 400);
    expect(err.message).toMatch(/preguntas abiertas/);
    const q = await question();
    expect(
      (await errorOf(await answer(q.id, '   ', null), 400)).fields?.text,
    ).toBeTruthy();
    expect(
      (await errorOf(await answer(q.id, 'x'.repeat(5001), null), 400)).fields
        ?.text,
    ).toBeTruthy();
    expect((await answer(q.id, 'Invitado', null, guest)).status).toBe(403);
    expect(
      (
        await h.request(
          'GET',
          '/notes/00000000-0000-4000-8000-000000000000/answers',
          {token: elvis},
        )
      ).status,
    ).toBe(404);
  });

  it('closing: the asker marks it answered (recorded and locked); others cannot once answered', async () => {
    const q = await question(elvis);
    await ok<NoteAnswer>(await answer(q.id, 'Sí, a las 8', null, dailos), 201);
    let current = await noteById(q.id);
    const denied = await errorOf(
      await patch(
        `/notes/${q.id}`,
        {version: current.version, resolved: true},
        dailos,
      ),
      403,
    );
    expect(denied.message).toMatch(/Solo quien hizo la pregunta/);

    const closed = await ok<Note>(
      await patch(`/notes/${q.id}`, {version: current.version, resolved: true}),
    );
    expect(closed).toMatchObject({
      resolved: true,
      resolvedBy: {displayName: 'Elvis'},
      resolvedAt: h.clock.now().toISOString(),
    });
    // Locked: no more answers.
    const locked = await errorOf(
      await answer(q.id, 'Otra', closed.answer!.id, dailos),
      400,
    );
    expect(locked.message).toMatch(/dada por respondida/);
    // The asker reopens it; who resolved is cleared.
    current = await ok<Note>(
      await patch(`/notes/${q.id}`, {version: closed.version, resolved: false}),
    );
    expect(current).toMatchObject({
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
    });
    // A question with answers keeps its kind.
    const kind = await errorOf(
      await patch(`/notes/${q.id}`, {version: current.version, kind: 'note'}),
      400,
    );
    expect(kind.fields?.kind).toBeTruthy();
  });

  it('without an answer any member may close it; incidents record who resolved them too', async () => {
    const q = await question(elvis);
    const closed = await ok<Note>(
      await patch(
        `/notes/${q.id}`,
        {version: q.version, resolved: true},
        dailos,
      ),
    );
    expect(closed.resolvedBy?.displayName).toBe('Dailos');
    const incident = await ok<Note>(
      await post('/notes', {
        kind: 'incident',
        text: 'Valla rota Prueba',
        resolved: true,
      }),
      201,
    );
    expect(incident.resolvedBy?.displayName).toBe('Elvis');
    // Deleting a question takes its answers with it.
    const q2 = await question();
    await ok<NoteAnswer>(await answer(q2.id, 'Respuesta Prueba', null), 201);
    const v = (await noteById(q2.id)).version;
    expect(
      (
        await h.request('DELETE', `/notes/${q2.id}?version=${v}`, {
          token: elvis,
        })
      ).status,
    ).toBe(204);
    const [left] = await h.db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM note_answers WHERE note_id = $1',
      [q2.id],
    );
    expect(left?.n).toBe(0);
  });
});

// ---------------------------------------------------------------- images

/** Signature, IHDR, an IDAT of `padding` bytes and IEND (CRCs not checked). */
function png(width: number, height: number, padding = 16): Uint8Array {
  const b = new Uint8Array(57 + padding);
  const view = new DataView(b.buffer);
  const type = (s: string, at: number) =>
    b.set(
      [...s].map(c => c.charCodeAt(0)),
      at,
    );
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  type('IHDR', 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(33, padding);
  type('IDAT', 37);
  type('IEND', 57 + padding - 8);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0 (length 17).
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return b;
}

function webpX(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  const put = (s: string, at: number) =>
    b.set(
      [...s].map(c => c.charCodeAt(0)),
      at,
    );
  put('RIFF', 0);
  put('WEBP', 8);
  put('VP8X', 12);
  const w = width - 1;
  const hh = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  b.set([hh & 0xff, (hh >> 8) & 0xff, (hh >> 16) & 0xff], 27);
  return b;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

describe('reading an image header', () => {
  it('reads type and size of JPEG, PNG and WebP; anything else is null', () => {
    expect(readImageHeader(png(1600, 1200))).toEqual({
      contentType: 'image/png',
      width: 1600,
      height: 1200,
    });
    expect(readImageHeader(jpeg(1600, 900))).toEqual({
      contentType: 'image/jpeg',
      width: 1600,
      height: 900,
    });
    expect(readImageHeader(webpX(1200, 1600))).toEqual({
      contentType: 'image/webp',
      width: 1200,
      height: 1600,
    });
    expect(
      readImageHeader(new TextEncoder().encode('GIF89a......')),
    ).toBeNull();
    expect(
      readImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    ).toBeNull();
    expect(readImageHeader(new Uint8Array())).toBeNull();
  });
});

describe('images of material', () => {
  let resource: Resource;

  beforeAll(async () => {
    resource = await ok<Resource>(
      await post('/resources', {name: 'Vallas Prueba Foto'}),
      201,
    );
    expect(resource.media).toEqual([]);
  });

  function upload(body: Record<string, unknown>, t = elvis) {
    return post(
      '/media',
      {
        ownerType: 'resource',
        ownerId: resource.id,
        contentType: 'image/png',
        width: 1600,
        height: 1200,
        data: b64(png(1600, 1200)),
        ...body,
      },
      t,
    );
  }

  it('the first is main; the resource lists them main first; bytes come back with long private caching', async () => {
    const first = await ok<MediaInfo>(await upload({}), 201);
    expect(first).toMatchObject({
      ownerType: 'resource',
      ownerId: resource.id,
      contentType: 'image/png',
      width: 1600,
      height: 1200,
      bytes: 73,
      main: true,
      createdBy: {displayName: 'Elvis'},
    });
    h.clock.advance(1000);
    const second = await ok<MediaInfo>(
      await upload({
        contentType: 'image/jpeg',
        width: 800,
        height: 600,
        data: b64(jpeg(800, 600)),
      }),
      201,
    );
    expect(second.main).toBe(false);
    const listed = (await listOf<Resource>('resources')).find(
      r => r.id === resource.id,
    )!;
    expect(listed.media.map(m => m.id)).toEqual([first.id, second.id]);
    // A photo never bumps the resource (no conflict for an open form) but is in its history.
    expect(listed.version).toBe(resource.version);
    const [entry] = await listOf<ActivityEntry>(
      `activity?entityType=resource&entityId=${resource.id}`,
    );
    expect(entry).toMatchObject({action: 'update', changedFields: ['media']});

    const res = await h.request('GET', `/media/${first.id}`, {token: guest});
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png(1600, 1200));
    expect((await h.request('GET', `/media/${first.id}`)).status).toBe(401);
    expect(
      (
        await h.request('GET', '/media/00000000-0000-4000-8000-000000000000', {
          token: elvis,
        })
      ).status,
    ).toBe(404);
    // Guests see the photos of material in the list too.
    const asGuest = (await listOf<Resource>('resources', guest)).find(
      r => r.id === resource.id,
    )!;
    expect(asGuest.media).toHaveLength(2);
  });

  it('main moves on request and on deleting the main one; at most five', async () => {
    let media = (await listOf<Resource>('resources')).find(
      r => r.id === resource.id,
    )!.media;
    const [first, second] = media as [MediaInfo, MediaInfo];
    const third = await ok<MediaInfo>(await upload({main: true}), 201);
    media = (await listOf<Resource>('resources')).find(
      r => r.id === resource.id,
    )!.media;
    expect(media.filter(m => m.main).map(m => m.id)).toEqual([third.id]);
    expect(media[0]?.id).toBe(third.id);

    const made = await ok<MediaInfo>(
      await patch(`/media/${second.id}`, {main: true}),
    );
    expect(made.main).toBe(true);
    expect((await patch(`/media/${second.id}`, {main: false})).status).toBe(
      400,
    );
    expect(
      (await h.request('DELETE', `/media/${second.id}`, {token: elvis})).status,
    ).toBe(204);
    media = (await listOf<Resource>('resources')).find(
      r => r.id === resource.id,
    )!.media;
    // The oldest left becomes main.
    expect(media.find(m => m.main)?.id).toBe(first.id);
    expect(media).toHaveLength(2);

    for (let i = media.length; i < MEDIA_PER_RECORD; i++) {
      await ok<MediaInfo>(await upload({}), 201);
    }
    const full = await errorOf(await upload({}), 400);
    expect(full.fields?.ownerId).toMatch(/5 fotos/);
  });

  it('checks the bytes: type, size, base64, limit; owner type and owner', async () => {
    const other = await ok<Resource>(
      await post('/resources', {name: 'Carpa Prueba Foto'}),
      201,
    );
    const up = (body: Record<string, unknown>) =>
      upload({ownerId: other.id, ...body});
    expect(
      (await errorOf(await up({contentType: 'image/jpeg'}), 400)).fields
        ?.contentType,
    ).toBeTruthy();
    expect(
      (await errorOf(await up({width: 1599}), 400)).fields?.width,
    ).toBeTruthy();
    expect(
      (await errorOf(await up({width: 5000}), 400)).fields?.width,
    ).toBeTruthy();
    expect(
      (
        await errorOf(
          await up({data: b64(new TextEncoder().encode('no es una imagen'))}),
          400,
        )
      ).fields?.data,
    ).toBeTruthy();
    expect(
      (await errorOf(await up({data: 'no*base64'}), 400)).fields?.data,
    ).toBeTruthy();
    expect(
      (await errorOf(await up({contentType: 'image/gif'}), 400)).fields
        ?.contentType,
    ).toBeTruthy();
    expect(
      (await errorOf(await up({ownerType: 'event'}), 400)).fields?.ownerType,
    ).toBeTruthy();
    // E4: a profile photo is only ever the uploader's own.
    expect((await errorOf(await up({ownerType: 'user'}), 403)).message).toBe(
      'Solo puedes cambiar tu propia foto de perfil.',
    );
    expect(
      (
        await errorOf(
          await up({ownerId: '00000000-0000-4000-8000-000000000000'}),
          400,
        )
      ).fields?.ownerId,
    ).toBeTruthy();
    // Over MEDIA_MAX_BYTES (but inside the 1 MB body) → fields.data.
    const tooBig = await errorOf(
      await up({data: b64(png(1600, 1200, MEDIA_MAX_BYTES))}),
      400,
    );
    expect(tooBig.fields?.data).toMatch(/demasiado/);
    // A large valid image passes the general 100 KB body limit (media has its own).
    const large = await ok<MediaInfo>(
      await up({data: b64(png(1600, 1200, 500 * 1024))}),
      201,
    );
    expect(large.bytes).toBe(57 + 500 * 1024);
    // A body over 1 MB is refused before parsing.
    const huge = await errorOf(await up({data: 'A'.repeat(1_200_000)}), 400);
    expect(huge.message).toMatch(/demasiado grande/);
    expect((await upload({}, guest)).status).toBe(403);
  });

  it('a device id replays like other creates', async () => {
    const other = await ok<Resource>(
      await post('/resources', {name: 'Mesa Prueba Foto'}),
      201,
    );
    const id = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
    const body = {ownerId: other.id, id};
    const created = await ok<MediaInfo>(await upload(body), 201);
    expect(created.id).toBe(id);
    const replay = await ok<MediaInfo>(await upload(body), 200);
    expect(replay).toEqual(created);
    const media = (await listOf<Resource>('resources')).find(
      r => r.id === other.id,
    )!.media;
    expect(media).toHaveLength(1);
    const foreign = await errorOf(await upload(body, dailos), 400);
    expect(foreign.fields?.id).toBeTruthy();
  });

  it('deleting a resource deletes its photos; removing the demo deletes demo photos', async () => {
    const r = await ok<Resource>(
      await post('/resources', {name: 'Silla Prueba Foto'}),
      201,
    );
    const photo = await ok<MediaInfo>(await upload({ownerId: r.id}), 201);
    expect(
      (
        await h.request('DELETE', `/resources/${r.id}?version=${r.version}`, {
          token: elvis,
        })
      ).status,
    ).toBe(204);
    expect(
      (await h.request('GET', `/media/${photo.id}`, {token: elvis})).status,
    ).toBe(404);

    const demo = (await listOf<Resource>('resources')).find(x => x.isDemo);
    expect(demo).toBeTruthy();
    const demoPhoto = await ok<MediaInfo>(
      await upload({ownerId: demo!.id}),
      201,
    );
    expect(
      (await h.request('DELETE', orgPath('demo'), {token: elvis})).status,
    ).toBe(200);
    const [left] = await h.db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM media WHERE id = $1',
      [demoPhoto.id],
    );
    expect(left?.n).toBe(0);
  });
});
