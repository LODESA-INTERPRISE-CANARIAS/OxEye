import {describe, expect, it} from 'vitest';
import {createDefaultProject} from '../../src/db/repository';
import {eventDays, eventVenues} from '../../src/engine/workspace/context';
import type {WorkShiftDay} from '../../src/types';

function day(id: string, kind: WorkShiftDay['kind'], date: string): WorkShiftDay {
  return {id, name: 'Jornada ' + id, kind, date, from: '08:00', to: '16:00', hours: 8};
}

describe('Workspace context views', () => {
  it('orders Jornadas pre → event → post, then by date', () => {
    const project = createDefaultProject();
    project.active = 'cristo';
    project.scenes.cristo.workDays = [
      day('post-1', 'post', '2026-06-04'),
      day('event-2', 'event', '2026-06-03'),
      day('pre-2', 'pre', '2026-06-01'),
      day('event-1', 'event', '2026-06-02'),
      day('pre-1', 'pre', '2026-05-31'),
    ];
    const days = eventDays(project);
    expect(days.map((d) => d.id)).toEqual(['pre-1', 'pre-2', 'event-1', 'event-2', 'post-1']);
    expect(days[0]).toEqual({id: 'pre-1', name: 'Jornada pre-1', kind: 'pre', date: '2026-05-31'});
  });

  it('reads Jornadas from the active venue only and tolerates missing workDays', () => {
    const project = createDefaultProject();
    project.scenes.cristo.workDays = [day('c', 'event', '2026-06-02')];
    project.scenes.vega.workDays = [day('v', 'event', '2026-06-02')];
    project.active = 'vega';
    expect(eventDays(project).map((d) => d.id)).toEqual(['v']);
    project.scenes.vega.workDays = undefined as unknown as WorkShiftDay[];
    expect(eventDays(project)).toEqual([]);
  });

  it('includes the active venue plus venues with a defined perimeter', () => {
    const project = createDefaultProject();
    project.active = 'cristo';
    project.scenes.cristo.boundary = [];
    project.scenes.constitucion.boundary = [];
    project.scenes.vega.boundary = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(eventVenues(project).sort()).toEqual(['cristo', 'vega']);

    project.scenes.vega.boundary = [
      [0, 0],
      [10, 0],
    ];
    expect(eventVenues(project)).toEqual(['cristo']);

    project.active = 'constitucion';
    expect(eventVenues(project)).toEqual(['constitucion']);
  });
});
