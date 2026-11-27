/**
 * Revisión 1 · E3 on the device: the order and local copy of material
 * photos, the photos waiting in the outbox, the size a photo is prepared
 * to, and the status of an answered open question.
 */
import {describe, expect, it} from 'vitest';
import type {
  MediaInfo,
  Note,
  NoteAnswer,
} from '../../../shared/logistics/contracts';
import {
  canQueue,
  MEDIA_QUEUE_MAX,
  outboxLabel,
  queuedMedia,
  type OutboxEntry,
} from '../../../shared/logistics/outbox';
import {MEDIA_PER_RECORD} from '../../../shared/logistics/rules';
import {
  categoryIcon,
  mainMedia,
  photoRoom,
  queuedPhotos,
  sortMedia,
  withMain,
  withMedia,
  withoutMedia,
} from '../../../src/logistics/inventory/media';
import {
  fitWithin,
  longSides,
  PHOTO_LONG_SIDE,
  PHOTO_TARGET_BYTES,
} from '../../../src/logistics/inventory/photo-prepare';
import {
  awaitsAsker,
  isOpenNote,
  resolvedLabel,
} from '../../../src/logistics/lib/inventory';
import {LIST_OF, recordName} from '../../../src/logistics/offline/local';

const elvis = {id: 'u-elvis', displayName: 'Elvis'};

function media(id: string, extra: Partial<MediaInfo> = {}): MediaInfo {
  return {
    id,
    ownerType: 'resource',
    ownerId: 'r1',
    contentType: 'image/jpeg',
    bytes: 1000,
    width: 1600,
    height: 1200,
    main: false,
    createdBy: elvis,
    createdAt: '2026-11-27T08:00:00.000Z',
    ...extra,
  };
}

function entry(
  id: string,
  extra: Partial<OutboxEntry> = {},
  input: Record<string, unknown> = {},
): OutboxEntry {
  return {
    id,
    seq: 1,
    userId: 'u-elvis',
    orgId: 'o1',
    entity: 'media',
    op: 'create',
    recordId: `m-${id}`,
    input: {
      ownerId: 'r1',
      contentType: 'image/jpeg',
      width: 1600,
      height: 900,
      data: 'QUJD',
      ...input,
    },
    base: null,
    values: null,
    label: 'Nueva foto · Vallas',
    queuedAt: '2026-11-27T08:00:00.000Z',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    error: null,
    current: null,
    dropped: [],
    ...extra,
  };
}

describe('material photos · order and local copy', () => {
  const a = media('a', {main: true, createdAt: '2026-11-27T09:00:00.000Z'});
  const b = media('b', {createdAt: '2026-11-27T07:00:00.000Z'});
  const c = media('c', {createdAt: '2026-11-27T08:00:00.000Z'});

  it('main first, then oldest first', () => {
    expect(sortMedia([c, a, b]).map(m => m.id)).toEqual(['a', 'b', 'c']);
    expect(mainMedia({media: [b, a]})?.id).toBe('a');
    expect(mainMedia({media: []})).toBeNull();
  });

  it('a first photo is always main; a new main photo takes the mark', () => {
    const first = withMedia({media: []}, media('x'));
    expect(first.media.map(m => [m.id, m.main])).toEqual([['x', true]]);
    const next = withMedia({media: [a, b]}, media('n', {main: true}));
    expect(next.media.filter(m => m.main).map(m => m.id)).toEqual(['n']);
    expect(next.media[0].id).toBe('n');
    // Refreshing a photo already there never duplicates it.
    expect(withMedia(next, {...b}).media).toHaveLength(3);
  });

  it('«Hacer principal» moves the mark; an unknown photo changes nothing', () => {
    const r = {media: [a, b, c]};
    const moved = withMain(r, 'c');
    expect(moved.media.map(m => [m.id, m.main])).toEqual([
      ['c', true],
      ['b', false],
      ['a', false],
    ]);
    expect(withMain(r, 'zz')).toBe(r);
  });

  it('removing the main photo makes the oldest remaining one main', () => {
    const r = {media: [a, b, c]};
    const left = withoutMedia(r, 'a');
    expect(left.media.map(m => [m.id, m.main])).toEqual([
      ['b', true],
      ['c', false],
    ]);
    expect(withoutMedia(r, 'c').media.map(m => m.id)).toEqual(['a', 'b']);
    expect(withoutMedia({media: [a]}, 'a').media).toEqual([]);
  });

  it('stored and waiting photos share the limit per material', () => {
    expect(photoRoom(0, 0)).toBe(MEDIA_PER_RECORD);
    expect(photoRoom(3, 1)).toBe(MEDIA_PER_RECORD - 4);
    expect(photoRoom(5, 2)).toBe(0);
  });

  it('a resource without photo shows its category icon', () => {
    expect(categoryIcon('Vehículos')).toBe('transport');
    expect(categoryIcon('Vallas')).toBe('fence');
    expect(categoryIcon('Categoría propia')).toBe('inventory');
    expect(categoryIcon(null)).toBe('inventory');
  });
});

describe('material photos · waiting on this device', () => {
  it('members queue photo uploads; never updates, never guests', () => {
    expect(canQueue('member', 'media', 'create')).toBe(true);
    expect(canQueue('member', 'media', 'update')).toBe(false);
    expect(canQueue('guest', 'media', 'create')).toBe(false);
    // The other record types keep their rules.
    expect(canQueue('member', 'resource', 'update')).toBe(true);
    expect(MEDIA_QUEUE_MAX).toBeGreaterThan(0);
  });

  it('labels name the material, never anything else', () => {
    expect(outboxLabel('media', 'create', 'Vallas tipo A')).toBe(
      'Nueva foto · Vallas tipo A',
    );
    expect(recordName('media', null)).toBe('');
    // A photo belongs to its resource's list.
    expect(LIST_OF.media).toBe('resources');
  });

  it('lists the unresolved photos of one material, oldest first', () => {
    const list = [
      entry('2', {seq: 4}),
      entry('1', {seq: 2}),
      entry('x', {seq: 3}, {ownerId: 'r2'}),
      entry('done', {seq: 5, status: 'pending', entity: 'note'}),
      entry('refused', {
        seq: 6,
        status: 'rejected',
        error: {code: 'VALIDATION', message: 'Este material ya tiene 5 fotos.'},
      }),
    ];
    expect(queuedMedia(list, 'r1').map(e => e.id)).toEqual([
      '1',
      '2',
      'refused',
    ]);
    expect(queuedMedia(list).map(e => e.id)).toEqual([
      '1',
      'x',
      '2',
      'refused',
    ]);
    const shown = queuedPhotos(list, 'r1');
    expect(shown[0]).toMatchObject({
      id: 'm-1',
      ownerId: 'r1',
      src: 'data:image/jpeg;base64,QUJD',
      width: 1600,
      height: 900,
      state: 'waiting',
      error: null,
    });
    expect(shown[2]).toMatchObject({
      state: 'refused',
      error: 'Este material ya tiene 5 fotos.',
    });
  });
});

describe('material photos · prepared on the device', () => {
  it('fits the long side, keeps proportions, never enlarges', () => {
    expect(fitWithin(4032, 3024, PHOTO_LONG_SIDE)).toEqual({
      width: 1600,
      height: 1200,
    });
    expect(fitWithin(3024, 4032, PHOTO_LONG_SIDE)).toEqual({
      width: 1200,
      height: 1600,
    });
    expect(fitWithin(800, 600, PHOTO_LONG_SIDE)).toEqual({
      width: 800,
      height: 600,
    });
    expect(fitWithin(10000, 3, 1600)).toEqual({width: 1600, height: 1});
  });

  it('shrinks step by step when quality alone is not enough', () => {
    expect(longSides()).toEqual([1600, 1200, 900, 675]);
    expect(PHOTO_TARGET_BYTES).toBeLessThanOrEqual(400 * 1024);
  });
});

describe('open questions · answered state', () => {
  const answer: NoteAnswer = {
    id: 'a1',
    noteId: 'n1',
    text: 'En conserjería.',
    answeredBy: elvis,
    answeredAt: '2026-11-27T09:00:00.000Z',
    replacesId: null,
    restricted: false,
  };
  const q = (extra: Partial<Note>) =>
    ({kind: 'open_question', resolved: false, answer: null, ...extra}) as Pick<
      Note,
      'kind' | 'resolved' | 'answer'
    >;

  it('«Sin responder», «Con respuesta» (still open), «Respondida»', () => {
    expect(resolvedLabel(q({}))).toBe('Sin responder');
    expect(resolvedLabel(q({answer}))).toBe('Con respuesta');
    expect(resolvedLabel(q({answer, resolved: true}))).toBe('Respondida');
    expect(resolvedLabel(q({resolved: true}))).toBe('Respondida');
    // An answered question waits for its asker: it stays among the open ones.
    expect(isOpenNote(q({answer}))).toBe(true);
    expect(awaitsAsker(q({answer}))).toBe(true);
    expect(awaitsAsker(q({answer, resolved: true}))).toBe(false);
    expect(awaitsAsker(q({}))).toBe(false);
  });

  it('guests see that there is an answer, not its text', () => {
    const withheld = {...answer, text: null, restricted: true};
    expect(resolvedLabel(q({answer: withheld}))).toBe('Con respuesta');
  });

  it('incidents keep their own words', () => {
    expect(resolvedLabel({kind: 'incident', resolved: false})).toBe('Abierta');
    expect(resolvedLabel({kind: 'incident', resolved: true})).toBe('Resuelta');
  });
});
