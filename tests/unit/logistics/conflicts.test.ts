import {describe, expect, it} from 'vitest';
import {
  planWarnings,
  SUBSOIL_THRESHOLD_NOTE,
  warningsByTask,
  type PlanEvent,
  type PlanTask,
} from '../../../shared/logistics/conflicts';
import {HEAVY_LOAD_THRESHOLD_KG_M2} from '../../../src/engine/planning/ballast';
import {
  daysBetween,
  eachDate,
  occupiedDates,
  slotToInstants,
} from '../../../shared/logistics/time';

const at = (hhmm: string, day = '02') => `2026-12-${day}T${hhmm}:00.000Z`;
const cristo = {id: 'v-cristo', name: 'Plaza del Cristo'};
const adelantado = {id: 'v-adel', name: 'Plaza del Adelantado'};
const escenarios = {id: 'c-esc', name: 'Escenarios Teide'};

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  kind: 'activity',
  status: 'planned',
  eventId: null,
  venue: cristo,
  company: null,
  startsAt: at('09:00'),
  endsAt: at('10:00'),
  dependsOn: [],
  heavyLoad: false,
  ...extra,
});

const kinds = (tasks: PlanTask[], events: PlanEvent[] = []) =>
  planWarnings(tasks, events).map(w => w.kind);

describe('plan warnings · clashes', () => {
  it('flags two live tasks at the same venue and time, with the overlap', () => {
    const w = planWarnings([
      task('carpas', {startsAt: at('09:00'), endsAt: at('11:00')}),
      task('sonido', {startsAt: at('10:30'), endsAt: at('12:00')}),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      kind: 'venue_overlap',
      severity: 'conflict',
      taskIds: ['carpas', 'sonido'],
      minutes: 30,
      title: 'Coinciden en Plaza del Cristo',
    });
  });

  it('ignores back-to-back, cancelled, finished and undated tasks', () => {
    expect(
      kinds([
        task('a', {startsAt: at('09:00'), endsAt: at('10:00')}),
        task('b', {startsAt: at('10:00'), endsAt: at('11:00')}),
        task('c', {status: 'cancelled'}),
        task('d', {status: 'done'}),
        task('e', {startsAt: null, endsAt: null}),
      ]),
    ).toEqual([]);
  });

  it('flags a company in two places at once, but not twice at one venue', () => {
    const w = planWarnings([
      task('montaje', {company: escenarios}),
      task('otro', {company: escenarios, venue: adelantado}),
    ]);
    expect(w.map(x => x.kind)).toEqual(['company_overlap']);
    expect(w[0].title).toBe('Escenarios Teide está en dos sitios a la vez');

    // Same venue: one venue overlap, no company warning on top.
    expect(
      kinds([
        task('a', {company: escenarios}),
        task('b', {company: escenarios}),
      ]),
    ).toEqual(['venue_overlap']);
  });

  it('flags a task starting before its predecessor ends', () => {
    const w = planWarnings([
      task('descarga', {
        venue: adelantado,
        startsAt: at('09:00'),
        endsAt: at('10:15'),
      }),
      task('carpas', {
        startsAt: at('10:00'),
        endsAt: at('12:00'),
        dependsOn: ['descarga'],
      }),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      kind: 'dependency_order',
      taskIds: ['carpas', 'descarga'],
      minutes: 15,
    });
  });
});

describe('plan warnings · reminders (never certify)', () => {
  it('asks about unknown heavy loads and quotes the indicative threshold', () => {
    const w = planWarnings([
      task('escenario', {kind: 'assembly', heavyLoad: true}),
      task('vallas', {kind: 'delivery', heavyLoad: null, venue: adelantado}),
      task('charla', {kind: 'activity', heavyLoad: null, venue: null}),
    ]);
    expect(w.map(x => [x.kind, x.taskIds[0]])).toEqual([
      ['heavy_load', 'escenario'],
      ['heavy_load_unknown', 'vallas'],
    ]);
    expect(w[0].detail).toContain('orientativo');
    expect(w[0].detail).toContain('no un límite certificado');
    for (const x of w) {
      expect(x.detail).not.toMatch(/\b(apto|seguro|admisible)\b/i);
    }
  });

  it('reminds about routes A/B/C when a delivery happens during its event', () => {
    const fiesta: PlanEvent = {
      id: 'ev',
      name: 'Navidad en la Plaza',
      startsAt: at('17:00'),
      endsAt: at('21:00'),
      status: 'confirmed',
    };
    const during = task('camión', {
      kind: 'delivery',
      eventId: 'ev',
      startsAt: at('18:00'),
      endsAt: at('18:30'),
    });
    const before = task('antes', {
      kind: 'delivery',
      eventId: 'ev',
      venue: adelantado,
      startsAt: at('10:00'),
      endsAt: at('11:00'),
    });
    const w = planWarnings([during, before], [fiesta]);
    const routes = w.filter(x => x.kind === 'route_window');
    expect(routes.map(x => x.taskIds[0])).toEqual(['camión']);
    expect(routes[0].detail).toContain('A (acceso de vehículos)');
    expect(routes[0].detail).toContain('B (sanitarios a pie)');
    expect(routes[0].detail).toContain('C (evacuación en camilla)');
    expect(routes[0].detail).toContain('Carpa Amarilla');
    expect(
      planWarnings([during], [{...fiesta, status: 'cancelled'}]).some(
        x => x.kind === 'route_window',
      ),
    ).toBe(false);
  });

  it('sends any task marked heavy to the subsoil review, whatever its kind', () => {
    expect(
      kinds([task('feria', {kind: 'activity', heavyLoad: true, venue: null})]),
    ).toEqual(['heavy_load']);
    expect(
      kinds([task('feria', {kind: 'other', heavyLoad: null, venue: null})]),
    ).toEqual([]);
  });

  it('reminds about routes for a standalone delivery at an event venue', () => {
    const fiesta: PlanEvent = {
      id: 'ev',
      name: 'Navidad en la Plaza',
      startsAt: at('17:00'),
      endsAt: at('21:00'),
      status: 'confirmed',
      venue: cristo,
    };
    const suelta = task('hielo', {
      kind: 'delivery',
      eventId: null,
      startsAt: at('19:00'),
      endsAt: at('19:20'),
    });
    expect(planWarnings([suelta], [fiesta]).map(w => w.kind)).toEqual([
      'route_window',
    ]);
    expect(
      planWarnings([{...suelta, venue: adelantado}], [fiesta]).map(w => w.kind),
    ).toEqual([]);
  });

  it('quotes exactly the simulator threshold, as indicative', () => {
    expect(SUBSOIL_THRESHOLD_NOTE).toContain(
      `${HEAVY_LOAD_THRESHOLD_KG_M2} kg/m²`,
    );
    expect(SUBSOIL_THRESHOLD_NOTE).toContain('orientativo');
  });

  describe('routes reminder when times are missing or on the edge', () => {
    const fiesta: PlanEvent = {
      id: 'ev',
      name: 'Navidad en la Plaza',
      startsAt: at('17:00'),
      endsAt: at('21:00'),
      status: 'confirmed',
      venue: cristo,
      date: '2026-12-02',
      endDate: null,
      timezone: 'UTC',
    };
    const hielo = (extra: Partial<PlanTask>) =>
      task('hielo', {
        kind: 'delivery',
        eventId: 'ev',
        heavyLoad: false,
        timezone: 'UTC',
        ...extra,
      });
    const routes = (t: PlanTask, ev: PlanEvent = fiesta) =>
      planWarnings([t], [ev]).filter(w => w.kind === 'route_window');

    it('reminds for an untimed delivery on the event day, saying the time is missing', () => {
      const w = routes(
        hielo({startsAt: null, endsAt: null, date: '2026-12-02'}),
      );
      expect(w).toHaveLength(1);
      expect(w[0].detail).toMatch(/^Falta la hora/);
      expect(
        routes(hielo({startsAt: null, endsAt: null, date: '2026-12-03'})),
      ).toEqual([]);
    });

    it('reminds for a timed delivery at a date-only event', () => {
      const dateOnly = {...fiesta, startsAt: null, endsAt: null};
      expect(routes(hielo({}), dateOnly)).toHaveLength(1);
    });

    it('counts an open-ended task starting exactly when the event starts', () => {
      expect(routes(hielo({startsAt: at('17:00'), endsAt: null}))).toHaveLength(
        1,
      );
      expect(routes(hielo({startsAt: at('21:00'), endsAt: null}))).toEqual([]);
    });

    it('reminds for assembly at the event venue during the event, not elsewhere', () => {
      const montaje = task('montaje', {
        kind: 'assembly',
        eventId: 'ev',
        heavyLoad: false,
        startsAt: at('16:00'),
        endsAt: at('18:00'),
      });
      expect(routes(montaje)).toHaveLength(1);
      expect(routes({...montaje, venue: adelantado})).toEqual([]);
      expect(routes({...montaje, kind: 'activity'}).length).toBe(0);
    });
  });

  it('lists conflicts before reminders and indexes them by task', () => {
    const w = planWarnings([
      task('escenario', {kind: 'assembly', heavyLoad: true}),
      task('sonido'),
    ]);
    expect(w.map(x => x.severity)).toEqual(['conflict', 'reminder']);
    const map = warningsByTask(w);
    expect(map.get('escenario')).toHaveLength(2);
    expect(map.get('sonido')).toHaveLength(1);
  });
});

describe('multi-day slots', () => {
  it('ends on endDate when given, overnight otherwise', () => {
    expect(
      slotToInstants('2026-12-05', '10:00', '20:00', 'UTC', '2026-12-07'),
    ).toEqual({
      startsAt: '2026-12-05T10:00:00.000Z',
      endsAt: '2026-12-07T20:00:00.000Z',
    });
    expect(slotToInstants('2026-12-05', '22:00', '02:00', 'UTC')).toEqual({
      startsAt: '2026-12-05T22:00:00.000Z',
      endsAt: '2026-12-06T02:00:00.000Z',
    });
  });

  it('lists the days a record occupies', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(eachDate('2026-12-30', '2027-01-01')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(
      occupiedDates(
        {date: '2026-12-05', endDate: '2026-12-07', endsAt: null},
        'UTC',
      ),
    ).toEqual(['2026-12-05', '2026-12-06', '2026-12-07']);
    expect(
      occupiedDates(
        {date: '2026-12-05', endDate: null, endsAt: '2026-12-06T02:00:00.000Z'},
        'UTC',
      ),
    ).toEqual(['2026-12-05', '2026-12-06']);
    expect(
      occupiedDates(
        {date: '2026-12-05', endDate: null, endsAt: '2026-12-06T00:00:00.000Z'},
        'UTC',
      ),
    ).toEqual(['2026-12-05']);
    expect(occupiedDates({date: null, endDate: null, endsAt: null})).toEqual(
      [],
    );
  });
});
