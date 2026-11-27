import {describe, expect, it} from 'vitest';
import {dependencyPath} from '../../../shared/logistics/schedule';
import {cycleText} from '../../../src/logistics/tasks/cycle-text';

describe('cycle text · why a link would close a loop', () => {
  it('names a direct link', () => {
    expect(cycleText(['Montaje de escenario'])).toBe(
      '«Montaje de escenario» ya depende de esta tarea.',
    );
  });

  it('names a chain of two', () => {
    expect(cycleText(['Montaje de escenario', 'Entrega de vallas'])).toBe(
      '«Montaje de escenario» ya depende de «Entrega de vallas», que a su vez depende de esta tarea.',
    );
  });

  it('names every link of a longer chain', () => {
    expect(cycleText(['Prueba de sonido', 'Montaje', 'Entrega'])).toBe(
      '«Prueba de sonido» ya depende de «Montaje», que depende de «Entrega», que a su vez depende de esta tarea.',
    );
  });

  it('has a plain fallback for an empty chain', () => {
    expect(cycleText([])).toBe('Crearía un círculo de dependencias.');
  });

  it('reads the chain the task sheet builds from the plan', () => {
    const node = (id: string, dependsOn: string[]) => ({
      id,
      label: id,
      startsAt: null,
      endsAt: null,
      lane: null,
      dependsOn,
    });
    const titles: Record<string, string> = {
      escenario: 'Montaje de escenario',
      vallas: 'Entrega de vallas',
    };
    // «vallas» waits for the task being edited; «escenario» waits for vallas.
    const graph = [node('escenario', ['vallas']), node('vallas', ['self'])];
    const path = dependencyPath(graph, 'escenario', 'self')!;
    expect(cycleText(path.slice(0, -1).map(id => titles[id]))).toBe(
      '«Montaje de escenario» ya depende de «Entrega de vallas», que a su vez depende de esta tarea.',
    );
  });
});
