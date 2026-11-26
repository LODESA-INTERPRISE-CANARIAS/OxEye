import {describe, expect, it} from 'vitest';
import {
  findCycle,
  findOverlaps,
  simulateDelay,
  slackMinutes,
  successorsOf,
  type ScheduleItem,
} from '../../../shared/logistics/schedule';

const at = (hhmm: string) => `2026-12-02T${hhmm}:00.000Z`;
const item = (
  id: string,
  start: string | null,
  end: string | null,
  deps: string[] = [],
  lane: string | null = 'cristo',
): ScheduleItem => ({
  id,
  label: id,
  startsAt: start ? at(start) : null,
  endsAt: end ? at(end) : null,
  lane,
  dependsOn: deps,
});

// Example from the specification: truck → unloading → tents → inspection.
const plan = (): ScheduleItem[] => [
  item('camion', '09:30', '09:45', [], 'acceso-norte'),
  item('descarga', '09:45', '10:15', ['camion']),
  item('carpas', '10:15', '11:30', ['descarga']),
  item('inspeccion', '11:45', '12:15', ['carpas']),
  item('adelantado', '10:00', '11:00', [], 'adelantado'),
];

describe('schedule · overlaps', () => {
  it('finds overlaps only inside the same lane', () => {
    const items = [
      item('a', '09:00', '10:00'),
      item('b', '09:30', '10:30'),
      item('c', '09:30', '10:30', [], 'otra'),
    ];
    expect(findOverlaps(items)).toEqual([
      {a: 'a', b: 'b', lane: 'cristo', minutes: 30},
    ]);
  });

  it('touching windows, undated and cancelled items do not overlap', () => {
    const items = [
      item('a', '09:00', '10:00'),
      item('b', '10:00', '11:00'),
      item('c', null, null),
      {...item('d', '09:00', '11:00'), cancelled: true},
    ];
    expect(findOverlaps(items)).toEqual([]);
  });
});

describe('schedule · dependencies', () => {
  it('lists successors transitively', () => {
    expect(successorsOf(plan(), 'camion')).toEqual([
      'descarga',
      'carpas',
      'inspeccion',
    ]);
  });

  it('computes slack against the latest predecessor', () => {
    expect(slackMinutes(plan(), 'inspeccion')).toBe(15);
    expect(slackMinutes(plan(), 'descarga')).toBe(0);
    expect(slackMinutes(plan(), 'camion')).toBeNull();
  });

  it('detects cycles', () => {
    expect(findCycle(plan())).toBeNull();
    const cyc = [item('a', null, null, ['b']), item('b', null, null, ['a'])];
    expect(findCycle(cyc)).not.toBeNull();
  });
});

describe('schedule · delay hypothesis', () => {
  it('+15 min on the truck moves unloading and tents, inspection absorbs it', () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    const r = simulateDelay(original, 'camion', 15);
    expect(r.shifted.map(s => [s.id, s.deltaMinutes])).toEqual([
      ['camion', 15],
      ['descarga', 15],
      ['carpas', 15],
    ]);
    expect(r.shifted.find(s => s.id === 'carpas')?.endsAt).toBe(at('11:45'));
    expect(r.absorbed).toEqual([
      {id: 'inspeccion', label: 'inspeccion', slackLeft: 0},
    ]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('a larger delay propagates beyond the slack', () => {
    const r = simulateDelay(plan(), 'camion', 30);
    expect(r.shifted.find(s => s.id === 'inspeccion')?.deltaMinutes).toBe(15);
  });

  it('reports overlaps that only exist under the hypothesis', () => {
    const items = [
      ...plan(),
      item('montaje-escenario', '11:35', '11:44', [], 'cristo'),
    ];
    const before = findOverlaps(items).length;
    const r = simulateDelay(items, 'camion', 15);
    expect(before).toBe(0);
    expect(r.newOverlaps.map(o => [o.a, o.b].sort())).toEqual([
      ['carpas', 'montaje-escenario'],
    ]);
  });

  it('diamond dependencies take the latest predecessor', () => {
    const items = [
      item('a', '09:00', '10:00', [], null),
      item('b', '10:00', '10:30', ['a'], null),
      item('c', '10:00', '11:00', ['a'], null),
      item('d', '11:00', '12:00', ['b', 'c'], null),
    ];
    const r = simulateDelay(items, 'a', 20);
    expect(r.shifted.find(s => s.id === 'd')?.deltaMinutes).toBe(20);
  });

  it('unknown times are reported, not guessed', () => {
    const items = [item('a', '09:00', '10:00'), item('b', null, null, ['a'])];
    const r = simulateDelay(items, 'a', 10);
    expect(r.unknown).toEqual(['b']);
    expect(simulateDelay([item('x', null, null)], 'x', 10).unknown).toEqual([
      'x',
    ]);
    expect(simulateDelay(items, 'a', 0).shifted).toEqual([]);
  });
});
