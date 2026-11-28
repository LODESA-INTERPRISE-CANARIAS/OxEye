import {describe, expect, it, vi} from 'vitest';
import type {PlanWarning} from '../../../shared/logistics/conflicts';
import type {Task} from '../../../shared/logistics/contracts';
import {
  activeFilterCount,
  applyFilters,
  chainOf,
  clearTasksPrefs,
  DEFAULT_PREFS,
  dependencies,
  EMPTY_FILTERS,
  groupByDay,
  groupTasks,
  NONE,
  parsePrefs,
  readPrefs,
  waitsForText,
  writePrefs,
  type TaskFilters,
} from '../../../src/logistics/tasks-space/filters';
import {PHONE_TABS, MAIN_SPACES} from '../../../src/logistics/shell/spaces';
import {parseRoute} from '../../../src/logistics/shell/route';

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
const user = {id: 'u1', displayName: 'Prueba'};
const D1 = '2026-12-02';
const D2 = '2026-12-03';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  version: 1,
  createdBy: user,
  createdAt: at(D1, '08:00'),
  updatedBy: user,
  updatedAt: at(D1, '08:00'),
  source: null,
  verification: 'draft',
  isDemo: false,
  organizationId: 'org',
  id,
  eventId: 'ev',
  venue: {id: 'v-cristo', name: 'Plaza del Cristo'},
  title: id,
  kind: 'assembly',
  status: 'planned',
  date: D1,
  endDate: null,
  startsAt: at(D1, '09:00'),
  endsAt: at(D1, '11:00'),
  timezone: 'Atlantic/Canary',
  company: {id: 'co-esc', name: 'Escenarios Demo'},
  contact: null,
  dependsOn: [],
  heavyLoad: false,
  resourceIds: [],
  subsoilReview: null,
  notes: 'MARCA-OBSERVACION',
  restricted: false,
  ...extra,
});

const tasks = [
  task('camion', {
    title: 'Camión de vallas',
    kind: 'delivery',
    startsAt: at(D1, '07:00'),
    endsAt: at(D1, '08:00'),
    company: {id: 'co-tra', name: 'Transportes Demo'},
  }),
  task('vallas', {title: 'Montaje de vallas', dependsOn: ['camion']}),
  task('escenario', {
    title: 'Escenario Áurea',
    dependsOn: ['vallas'],
    startsAt: at(D1, '10:00'),
    endsAt: at(D1, '12:00'),
  }),
  task('suelta', {
    title: 'Revisar mesas',
    eventId: null,
    venue: null,
    company: null,
    date: null,
    startsAt: null,
    endsAt: null,
  }),
  task('manana', {
    title: 'Desmontaje',
    kind: 'dismantling',
    status: 'done',
    date: D2,
    startsAt: at(D2, '09:00'),
    endsAt: at(D2, '10:00'),
    venue: {id: 'v-adel', name: 'Plaza del Adelantado'},
  }),
];

const warning: PlanWarning = {
  key: 'venue:vallas:escenario',
  kind: 'venue_overlap',
  severity: 'conflict',
  taskIds: ['vallas', 'escenario'],
  minutes: 60,
  title: 'Dos tareas a la vez en Plaza del Cristo',
  detail: '',
};
const ctx = {
  byTask: new Map([
    ['vallas', [warning]],
    ['escenario', [warning]],
  ]),
  eventNames: new Map([['ev', 'Navidad Demo']]),
};
const ids = (list: Task[]) => list.map(t => t.id);
const f = (extra: Partial<TaskFilters>): TaskFilters => ({
  ...EMPTY_FILTERS,
  ...extra,
});

describe('Tareas · filters', () => {
  it('without filters: every task in time order, undated last', () => {
    expect(ids(applyFilters(tasks, EMPTY_FILTERS, ctx))).toEqual([
      'camion',
      'vallas',
      'escenario',
      'manana',
      'suelta',
    ]);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('search ignores accents and case, every word must match, never the observations', () => {
    expect(ids(applyFilters(tasks, f({query: 'aurea'}), ctx))).toEqual([
      'escenario',
    ]);
    expect(
      ids(applyFilters(tasks, f({query: 'vallas transportes'}), ctx)),
    ).toEqual(['camion']);
    // The event name counts.
    expect(applyFilters(tasks, f({query: 'navidad'}), ctx)).toHaveLength(4);
    expect(applyFilters(tasks, f({query: 'MARCA-OBSERVACION'}), ctx)).toEqual(
      [],
    );
  });

  it('event, venue, company and status, with «Sin …» as a choice', () => {
    expect(ids(applyFilters(tasks, f({events: [NONE]}), ctx))).toEqual([
      'suelta',
    ]);
    expect(
      ids(applyFilters(tasks, f({venues: ['v-adel', NONE]}), ctx)),
    ).toEqual(['manana', 'suelta']);
    expect(ids(applyFilters(tasks, f({companies: ['co-tra']}), ctx))).toEqual([
      'camion',
    ]);
    expect(ids(applyFilters(tasks, f({statuses: ['done']}), ctx))).toEqual([
      'manana',
    ]);
  });

  it('«Con avisos», «Sin hora», «Sin lugar» and a range of days', () => {
    expect(ids(applyFilters(tasks, f({withWarnings: true}), ctx))).toEqual([
      'vallas',
      'escenario',
    ]);
    expect(ids(applyFilters(tasks, f({noTime: true}), ctx))).toEqual([
      'suelta',
    ]);
    expect(ids(applyFilters(tasks, f({noVenue: true}), ctx))).toEqual([
      'suelta',
    ]);
    expect(ids(applyFilters(tasks, f({from: D2}), ctx))).toEqual(['manana']);
    expect(ids(applyFilters(tasks, f({to: D1}), ctx))).toEqual([
      'camion',
      'vallas',
      'escenario',
    ]);
    expect(activeFilterCount(f({from: D1, to: D2, noTime: true}))).toBe(2);
  });
});

describe('Tareas · views', () => {
  it('the list goes by day, «Sin fecha» last', () => {
    const days = groupByDay(applyFilters(tasks, EMPTY_FILTERS, ctx));
    expect(days.map(d => [d.day, d.items.length])).toEqual([
      [D1, 3],
      [D2, 1],
      ['', 1],
    ]);
  });

  it('groups by event, venue or company, «Sin …» last, conflicts counted', () => {
    const all = applyFilters(tasks, EMPTY_FILTERS, ctx);
    expect(
      groupTasks(all, 'event', ctx).map(g => [
        g.label,
        g.items.length,
        g.conflicts,
      ]),
    ).toEqual([
      ['Navidad Demo', 4, 2],
      ['Sin evento', 1, 0],
    ]);
    expect(groupTasks(all, 'venue', ctx).map(g => g.label)).toEqual([
      'Plaza del Adelantado',
      'Plaza del Cristo',
      'Sin lugar',
    ]);
    expect(groupTasks(all, 'company', ctx).map(g => g.key)).toEqual([
      'co-esc',
      'co-tra',
      NONE,
    ]);
  });
});

describe('Tareas · dependencies', () => {
  it('knows what each task waits for and what waits for it', () => {
    const deps = dependencies(tasks);
    expect(ids(deps.waitsFor.get('vallas')!)).toEqual(['camion']);
    expect(ids(deps.waitedBy.get('camion')!)).toEqual(['vallas']);
    expect(waitsForText(deps.waitsFor.get('escenario')!)).toBe(
      'Espera a: Montaje de vallas',
    );
    expect(waitsForText([tasks[0], tasks[1]])).toBe(
      'Espera a: Camión de vallas y Montaje de vallas',
    );
  });

  it('a chain goes both ways and survives a cycle', () => {
    const chain = chainOf(dependencies(tasks), 'vallas');
    expect([...chain.before]).toEqual(['camion']);
    expect([...chain.after]).toEqual(['escenario']);
    const loop = [task('a', {dependsOn: ['b']}), task('b', {dependsOn: ['a']})];
    const c = chainOf(dependencies(loop), 'a');
    expect([...c.before]).toEqual(['b']);
    expect([...c.after]).toEqual(['b']);
  });
});

describe('Tareas · device and navigation', () => {
  it('reads remembered filters defensively', () => {
    expect(parsePrefs(null).view).toBe('list');
    const p = parsePrefs({
      view: 'grouped',
      groupBy: 'venue',
      panel: false,
      filters: {
        query: 'vallas',
        statuses: ['done', 'nope'],
        from: '2026-13-01',
        to: D2,
        events: ['ev', 3],
        noTime: 'yes',
      },
    });
    expect(p).toMatchObject({view: 'grouped', groupBy: 'venue', panel: false});
    expect(p.filters).toMatchObject({
      // A stored query (older copies) is never read back.
      query: '',
      statuses: ['done'],
      from: '',
      to: D2,
      events: ['ev'],
      noTime: false,
    });
  });

  it('remembers filters per person and organization, never the search', () => {
    // An in-memory Storage: Node's own `localStorage` global shadows jsdom's.
    const data = new Map<string, string>();
    const storage = {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    };
    vi.stubGlobal('localStorage', storage);
    localStorage.setItem(
      'oxeye.logistics.tasks-space.v1:org',
      JSON.stringify({filters: {query: 'Juan Pérez'}}),
    );
    const mine = {
      ...DEFAULT_PREFS,
      filters: {...EMPTY_FILTERS, query: 'Juan Pérez', companies: ['co-tra']},
    };
    writePrefs('u1', 'org', mine);
    const stored = localStorage.getItem(
      'oxeye.logistics.tasks-space.v2:u1:org',
    );
    expect(stored).not.toContain('Juan Pérez');
    expect(readPrefs('u1', 'org').filters).toMatchObject({
      query: '',
      companies: ['co-tra'],
    });
    // Another person on the same device starts clean.
    expect(readPrefs('u2', 'org')).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null, 'org')).toEqual(DEFAULT_PREFS);
    // Logout leaves nothing behind, older copies included.
    localStorage.setItem('oxeye.other', 'keep');
    clearTasksPrefs();
    expect([...data.keys()]).toEqual(['oxeye.other']);
    vi.unstubAllGlobals();
  });

  it('«Tareas» is a space with its own address; five tabs on phones', () => {
    expect(MAIN_SPACES.map(s => s.id)).toEqual([
      'hoy',
      'calendario',
      'tareas',
      'inventarios',
      'contactos',
      'catalogo',
    ]);
    expect(PHONE_TABS).toHaveLength(5);
    expect(parseRoute('/gestor-logistico/tareas').space).toBe('tareas');
    expect(parseRoute('/gestor-logistico/tareas/ficha/tarea/t1').sheet).toEqual(
      {
        type: 'task',
        id: 't1',
      },
    );
  });
});
