import {describe, expect, it} from 'vitest';
import {
  simulateDelay,
  type ScheduleItem,
} from '../../../shared/logistics/schedule';

/**
 * QA (M5): a delay hypothesis must only move what the delay pushes. A task
 * further down that already starts before its predecessor ends is a
 * pre-existing `dependency_order` conflict; when the delay is absorbed
 * upstream it must not be «moved by the hypothesis» (and then written by
 * «Aplicar al plan»).
 */

const at = (time: string) => `2026-12-02T${time}:00.000Z`;
const item = (
  id: string,
  start: string,
  end: string,
  dependsOn: string[] = [],
): ScheduleItem => ({
  id,
  label: id,
  startsAt: at(start),
  endsAt: at(end),
  lane: null,
  dependsOn,
});

// R 09:00–10:00 → P 10:30–12:00 (30 min of slack) → C 11:00–12:00, which
// already starts before P ends (a conflict that exists without any delay).
const plan = () => [
  item('R', '09:00', '10:00'),
  item('P', '10:30', '12:00', ['R']),
  item('C', '11:00', '12:00', ['P']),
];

describe('simulateDelay · only what the delay pushes', () => {
  it('P absorbs a 5-minute delay of R', () => {
    const r = simulateDelay(plan(), 'R', 5);
    expect(r.absorbed.map(a => a.id)).toContain('P');
    expect(r.shifted.map(s => s.id)).not.toContain('P');
  });

  it('a pre-existing conflict further down is not moved by it', () => {
    const r = simulateDelay(plan(), 'R', 5);
    expect(r.shifted.map(s => s.id)).toEqual(['R']);
  });

  it('a task pushed by a moved predecessor moves only as far as that push', () => {
    // C depends on P (moved) and on Q, which already ends after C starts.
    const items = [
      item('R', '09:00', '10:00'),
      item('P', '10:00', '10:30', ['R']),
      item('Q', '08:00', '11:30'),
      item('C', '11:00', '12:00', ['P', 'Q']),
    ];
    const r = simulateDelay(items, 'R', 45);
    // P → 10:45–11:15, so C → 11:15 (not 11:30, Q's end: that conflict was there before).
    expect(r.shifted.find(s => s.id === 'C')).toMatchObject({
      deltaMinutes: 15,
      startsAt: at('11:15'),
    });
  });
});
