import {describe, expect, it} from 'vitest';
import type {
  LogisticsEvent,
  Note,
  Task,
} from '../../../shared/logistics/contracts';
import {
  canQueue,
  enqueue,
  entriesFor,
  guardSubsoil,
  nextToSend,
  outboxCounts,
  outboxLabel,
  rebaseVersions,
  referencedIds,
  settleAccepted,
  unsentRecordIds,
  type OutboxEntry,
} from '../../../shared/logistics/outbox';
import {
  isLocalId,
  localIdsIn,
  optimisticRecord,
  type OptimisticContext,
} from '../../../shared/logistics/optimistic';
import {
  WITHHELD_FROM_GUESTS,
  withholdFor,
} from '../../../shared/logistics/redaction';
import {
  changesLabel,
  listsToReload,
  replayOutcome,
  retryDelayMs,
  SYNC_LISTS,
  syncStatus,
} from '../../../shared/logistics/sync';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const ORG2 = '44444444-4444-4444-8444-444444444444';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const R3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const entry = (extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: `e-${Math.random()}`,
  seq: 0,
  userId: U1,
  orgId: ORG,
  entity: 'task',
  op: 'update',
  recordId: R1,
  input: {version: 3, title: 'Montaje Demo'},
  base: null,
  values: null,
  label: 'Cambios en la tarea · Montaje Demo',
  queuedAt: '2026-12-02T09:00:00.000Z',
  status: 'pending',
  attempts: 0,
  nextAttemptAt: null,
  error: null,
  current: null,
  dropped: [],
  ...extra,
});

describe('sync: lists to reload after …/changes', () => {
  it('reloads everything on full or an unknown type', () => {
    expect([...listsToReload({cursor: '1', types: [], full: true})]).toEqual([
      ...SYNC_LISTS,
    ]);
    expect(
      listsToReload({cursor: '1', types: ['demo'], full: false}).size,
    ).toBe(SYNC_LISTS.length);
  });

  it('reloads nothing when nothing changed', () => {
    expect(listsToReload({cursor: '9', types: [], full: false}).size).toBe(0);
  });

  it('reloads the touched lists plus activity', () => {
    const lists = listsToReload({cursor: '9', types: ['note'], full: false});
    expect([...lists].sort()).toEqual(['activity', 'notes']);
    const res = listsToReload({cursor: '9', types: ['resource'], full: false});
    // A resource edit can clear subsoil marks and change taskIds.
    expect(res.has('tasks')).toBe(true);
    expect(res.has('warehouses')).toBe(true);
    const hyp = listsToReload({
      cursor: '9',
      types: ['hypothesis'],
      full: false,
    });
    expect(hyp.has('tasks')).toBe(true);
  });
});

describe('sync: the chip is honest', () => {
  const base = {
    browserOnline: true,
    serverReachable: true,
    pending: 0,
    needsReview: 0,
    syncing: false,
  };

  it('says «Sincronizado» only when nothing waits', () => {
    expect(syncStatus(base)).toMatchObject({
      state: 'synced',
      label: 'Sincronizado',
    });
    expect(syncStatus({...base, pending: 1}).state).toBe('syncing');
    expect(syncStatus({...base, needsReview: 1}).state).toBe('attention');
  });

  it('counts pending changes without coverage', () => {
    expect(syncStatus({...base, browserOnline: false}).label).toBe(
      'Sin conexión',
    );
    expect(syncStatus({...base, browserOnline: false, pending: 3}).label).toBe(
      'Sin conexión · 3 cambios pendientes',
    );
    expect(syncStatus({...base, browserOnline: false, pending: 1}).label).toBe(
      'Sin conexión · 1 cambio pendiente',
    );
  });

  it('says «Solo en este dispositivo» when the server does not answer', () => {
    expect(syncStatus({...base, serverReachable: false}).label).toBe(
      'Solo en este dispositivo',
    );
    expect(
      syncStatus({...base, serverReachable: false, pending: 2, needsReview: 1})
        .label,
    ).toBe('Solo en este dispositivo · 3 cambios');
  });

  it('pluralises', () => {
    expect(changesLabel(1)).toBe('1 cambio');
    expect(changesLabel(2, 'pendiente')).toBe('2 cambios pendientes');
  });
});

describe('sync: replay outcomes', () => {
  it('retries the network, asks a person on conflicts and rejections', () => {
    expect(replayOutcome('UNAVAILABLE', 9)).toBe('retry');
    expect(replayOutcome('RATE_LIMITED', 1)).toBe('retry');
    expect(replayOutcome('INTERNAL', 1)).toBe('retry');
    expect(replayOutcome('INTERNAL', 3)).toBe('rejected');
    expect(replayOutcome('VERSION_CONFLICT', 1)).toBe('conflict');
    expect(replayOutcome('DUPLICATE', 1)).toBe('conflict');
    expect(replayOutcome('VALIDATION', 1)).toBe('rejected');
    expect(replayOutcome('FORBIDDEN', 1)).toBe('rejected');
    expect(replayOutcome('NOT_FOUND', 1)).toBe('rejected');
    expect(replayOutcome('UNAUTHENTICATED', 1)).toBe('paused');
  });

  it('backs off and honours Retry-After', () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(50)).toBe(60_000);
    expect(retryDelayMs(1, 30)).toBe(30_000);
  });
});

describe('outbox: who may queue what', () => {
  it('queues member creates and updates only', () => {
    expect(canQueue('member', 'note', 'create')).toBe(true);
    expect(canQueue('member', 'task', 'update')).toBe(true);
    expect(canQueue('guest', 'note', 'create')).toBe(false);
    expect(canQueue('member', 'task', 'delete')).toBe(false);
    // Applying a hypothesis always needs a live confirmation.
    expect(canQueue('member', 'hypothesis', 'create')).toBe(false);
    expect(canQueue('member', 'hypothesis', 'apply')).toBe(false);
    expect(canQueue('member', 'category', 'create')).toBe(false);
  });

  it('keeps entries per user and organization', () => {
    const list = [
      entry({seq: 2}),
      entry({seq: 1, recordId: R2}),
      entry({seq: 3, userId: U2}),
      entry({seq: 4, orgId: ORG2}),
    ];
    expect(entriesFor(list, U1, ORG).map(e => e.seq)).toEqual([1, 2]);
  });
});

describe('outbox: enqueue folds unsent edits of one record', () => {
  it('folds a second edit into a pending update keeping the first version', () => {
    const first = entry({seq: 1, input: {version: 3, title: 'A'}});
    const out = enqueue([first], entry({input: {version: 3, status: 'done'}}));
    expect(out).toHaveLength(1);
    expect(out[0].input).toEqual({version: 3, title: 'A', status: 'done'});
  });

  it('folds an edit into a pending create, which stays a create', () => {
    const create = entry({
      seq: 1,
      op: 'create',
      input: {id: R1, organizationId: ORG, title: 'A'},
    });
    const out = enqueue([create], entry({input: {version: 0, title: 'B'}}));
    expect(out).toHaveLength(1);
    expect(out[0].op).toBe('create');
    expect(out[0].input).toEqual({id: R1, organizationId: ORG, title: 'B'});
  });

  it('appends after an entry already in flight or in conflict', () => {
    const sending = entry({seq: 1, status: 'sending'});
    const out = enqueue([sending], entry({input: {version: 3, title: 'C'}}));
    expect(out).toHaveLength(2);
    expect(out[1].seq).toBe(2);
  });
});

describe('outbox: replay order', () => {
  it('sends one at a time, oldest first, honouring the retry time', () => {
    const a = entry({seq: 1, recordId: R1, nextAttemptAt: 5000});
    const b = entry({seq: 2, recordId: R2});
    expect(nextToSend([a, b], 1000)?.seq).toBe(2);
    expect(nextToSend([a, b], 6000)?.seq).toBe(1);
    expect(nextToSend([{...a, status: 'sending'}, b], 6000)).toBeNull();
  });

  it('holds later writes of a record behind its conflict, not others', () => {
    const conflict = entry({seq: 1, recordId: R1, status: 'conflict'});
    const same = entry({seq: 2, recordId: R1});
    const other = entry({seq: 3, recordId: R2});
    expect(nextToSend([conflict, same, other], 0)?.seq).toBe(3);
  });

  it('holds a note about a resource created offline until it is created', () => {
    const resource = entry({
      seq: 1,
      entity: 'resource',
      op: 'create',
      recordId: R2,
      input: {id: R2, name: 'Carpa Demo'},
      status: 'rejected',
    });
    const note = entry({
      seq: 2,
      entity: 'note',
      op: 'create',
      recordId: R3,
      input: {id: R3, kind: 'incident', ref: {type: 'resource', id: R2}},
    });
    expect(nextToSend([resource, note], 0)).toBeNull();
    expect(referencedIds(note.input).has(R2)).toBe(true);
  });

  it('rebases later edits after an own write was accepted', () => {
    const later = entry({seq: 2, input: {version: 0, title: 'B'}});
    const out = rebaseVersions([later], R1, 0, 1);
    expect(out[0].input.version).toBe(1);
    expect(rebaseVersions([later], R2, 0, 1)[0].input.version).toBe(0);
  });

  it('never folds an edit into a create that was already sent once', () => {
    // (a) The create reached the server but its answer was lost: a replay
    // answers with the first content, so a folded edit would vanish.
    const sent = entry({
      seq: 1,
      op: 'create',
      input: {id: R1, organizationId: ORG, title: 'A'},
      attempts: 1,
    });
    const out = enqueue([sent], entry({input: {version: 0, heavyLoad: true}}));
    expect(out).toHaveLength(2);
    expect(out[0].input).toEqual({id: R1, organizationId: ORG, title: 'A'});
    expect(out[1]).toMatchObject({
      op: 'update',
      input: {version: 0, heavyLoad: true},
    });
    const failed = enqueue(
      [{...sent, attempts: 0, error: {code: 'UNAVAILABLE', message: ''}}],
      entry({input: {version: 0, title: 'B'}}),
    );
    expect(failed).toHaveLength(2);
  });

  it('never folds a create into an earlier update', () => {
    const update = entry({seq: 1, input: {version: 0, title: 'B'}});
    const create = entry({op: 'create', input: {id: R1, title: 'A'}});
    expect(enqueue([update], create)).toHaveLength(2);
  });

  it('never rebases a later edit past the created version', () => {
    // (b) An edit made while the create was in flight must meet a 409 if
    // someone changed the record before the replay came back (version 4).
    const create = entry({seq: 1, op: 'create', input: {id: R1}});
    const later = entry({seq: 2, input: {version: 0, title: 'B'}});
    const out = settleAccepted([create, later], create, 4);
    expect(out).toHaveLength(1);
    expect(out[0].input.version).toBe(1);
  });

  it('rebases after an update only when the next version is our own', () => {
    const sent = entry({seq: 1, input: {version: 3, title: 'A'}});
    const later = entry({seq: 2, input: {version: 3, status: 'done'}});
    expect(settleAccepted([sent, later], sent, 4)[0].input.version).toBe(4);
    // Someone else wrote in between (a 409 that already held our change).
    expect(settleAccepted([sent, later], sent, 6)[0].input.version).toBe(3);
  });

  it('counts pending and what needs review', () => {
    const list = [
      entry({status: 'pending'}),
      entry({status: 'sending'}),
      entry({status: 'conflict'}),
      entry({status: 'rejected'}),
    ];
    expect(outboxCounts(list)).toEqual({pending: 2, needsReview: 2});
    expect(unsentRecordIds(list).has(R1)).toBe(true);
  });
});

describe('outbox: a queued subsoil declaration', () => {
  const baseTask = {
    version: 3,
    venue: {id: 'v1', name: 'Plaza del Cristo'},
    heavyLoad: true,
    resourceIds: ['r1', 'r2'],
  };
  const declared = entry({
    input: {version: 3, subsoilReviewed: true},
    base: baseTask,
  });

  it('is sent when nothing relevant changed on the server', () => {
    expect(guardSubsoil(declared, baseTask)).toBe(declared);
    expect(
      guardSubsoil(declared, {
        ...baseTask,
        version: 4,
        resourceIds: ['r2', 'r1'],
      }).input.subsoilReviewed,
    ).toBe(true);
  });

  it.each([
    ['venue', {venue: {id: 'v2', name: 'Plaza del Adelantado'}}],
    ['heavy load', {heavyLoad: null}],
    ['resources', {resourceIds: ['r1']}],
  ])('is dropped when the %s changed', (_what, change) => {
    const out = guardSubsoil(declared, {...baseTask, version: 4, ...change});
    expect(out.input.subsoilReviewed).toBeUndefined();
    expect(out.input.version).toBe(3);
    expect(out.dropped).toEqual(['subsoilReviewed']);
  });

  it('leaves other writes alone', () => {
    const plain = entry({input: {version: 3, title: 'X'}, base: baseTask});
    expect(guardSubsoil(plain, {...baseTask, heavyLoad: false})).toBe(plain);
  });
});

describe('outbox: labels never carry free text', () => {
  it('names the record', () => {
    expect(outboxLabel('task', 'create', 'Montaje Demo')).toBe(
      'Nueva tarea · Montaje Demo',
    );
    expect(outboxLabel('warehouse', 'update', 'Almacén Demo')).toBe(
      'Cambios en el almacén · Almacén Demo',
    );
    expect(outboxLabel('note', 'create', '')).toBe('Nueva nota');
  });
});

describe('optimistic records', () => {
  const ctx: OptimisticContext = {
    user: {id: U1, displayName: 'Prueba'},
    now: '2026-12-02T10:00:00.000Z',
    orgId: ORG,
    timezone: 'Atlantic/Canary',
    venues: [{id: 'v1', name: 'Plaza del Cristo'}],
    companies: [{id: 'c1', name: 'Escenarios Demo'}],
    contacts: [{id: 'p1', name: 'Ana Demo'}],
    events: [{id: 'e1', name: 'Navidad Demo'}],
    warehouses: [],
    refLabel: () => 'Carpa Demo',
  };

  it('builds a new task like the server would', () => {
    const t = optimisticRecord(
      'task',
      {
        id: R1,
        organizationId: ORG,
        title: 'Montaje Demo',
        venueName: 'plaza del cristo',
        companyName: 'Vallas Prueba',
        date: '2026-12-02',
        startTime: '09:00',
        endTime: '11:00',
      },
      null,
      ctx,
    ) as Task;
    expect(t).toMatchObject({
      id: R1,
      version: 0,
      kind: 'other',
      status: 'planned',
      verification: 'draft',
      heavyLoad: null,
      venue: {id: 'v1', name: 'Plaza del Cristo'},
      startsAt: '2026-12-02T09:00:00.000Z',
      endsAt: '2026-12-02T11:00:00.000Z',
      restricted: false,
    });
    expect(isLocalId(t.company?.id)).toBe(true);
    expect(t.company?.name).toBe('Vallas Prueba');
  });

  it('keeps unsent fields on update and clears the subsoil mark on a move', () => {
    const base = optimisticRecord(
      'task',
      {
        id: R1,
        title: 'Escenario Demo',
        venueName: 'Plaza del Cristo',
        heavyLoad: true,
        subsoilReviewed: true,
        date: '2026-12-02',
        startTime: '09:00',
      },
      null,
      ctx,
    ) as Task;
    expect(base.subsoilReview?.by.id).toBe(U1);
    const timeOnly = optimisticRecord(
      'task',
      {version: 0, startTime: '10:00'},
      base,
      ctx,
    ) as Task;
    expect(timeOnly.subsoilReview).not.toBeNull();
    expect(timeOnly.startsAt).toBe('2026-12-02T10:00:00.000Z');
    expect(timeOnly.title).toBe('Escenario Demo');
    const moved = optimisticRecord(
      'task',
      {version: 0, venueName: 'Plaza del Adelantado'},
      base,
      ctx,
    ) as Task;
    expect(moved.subsoilReview).toBeNull();
  });

  it('resolves a note event and labels its ref by name', () => {
    const n = optimisticRecord(
      'note',
      {
        id: R3,
        kind: 'incident',
        text: 'Dato ficticio.',
        eventId: 'e1',
        ref: {type: 'resource', id: R2},
      },
      null,
      ctx,
    ) as Note;
    expect(n.event).toEqual({id: 'e1', name: 'Navidad Demo'});
    expect(n.ref).toEqual({type: 'resource', id: R2, label: 'Carpa Demo'});
    expect(n.resolved).toBe(false);
  });

  it('clears an event end date with its date', () => {
    const e = optimisticRecord(
      'event',
      {id: R1, name: 'Feria Demo', date: '2026-12-02', endDate: '2026-12-04'},
      null,
      ctx,
    ) as LogisticsEvent;
    const cleared = optimisticRecord(
      'event',
      {version: 0, date: null},
      e,
      ctx,
    ) as LogisticsEvent;
    expect(cleared.endDate).toBeNull();
    expect(cleared.startsAt).toBeNull();
  });

  it('never lets a placeholder id into an API input unnoticed', () => {
    expect(localIdsIn({companyId: 'local:company:x', dependsOn: [R1]})).toEqual(
      ['local:company:x'],
    );
    expect(localIdsIn({companyName: 'Vallas Prueba'})).toEqual([]);
  });
});

describe('redaction: one list for server and device cache', () => {
  it('nulls every withheld field for guests', () => {
    const note = {id: R1, kind: 'incident', text: 'MARCA-TEXTO-NOTA'};
    const guest = withholdFor('note', note, 'guest');
    expect(guest.text).toBeNull();
    expect(guest.restricted).toBe(true);
    expect(note.text).toBe('MARCA-TEXTO-NOTA');
    expect(withholdFor('note', note, 'member')).toEqual({
      ...note,
      restricted: false,
    });
  });

  it('covers every free-text field agreed so far', () => {
    expect(WITHHELD_FROM_GUESTS.task).toContain('notes');
    expect(WITHHELD_FROM_GUESTS.hypothesis).toContain('note');
    expect(WITHHELD_FROM_GUESTS.contact).toEqual([
      'phone',
      'email',
      'description',
      'notes',
    ]);
  });
});
