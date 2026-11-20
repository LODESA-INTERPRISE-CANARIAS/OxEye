/**
 * @module engine/logistics/phases
 * Gestión de fases operativas (Pre-evento, Evento, Postevento), reservas logísticas y solapamientos.
 */
import {rect} from '../cartography/geometry';
import type {MapMetadata, PhaseKey, Point2D, Scene} from '../../types';

/** Etiquetas legibles de cada fase operativa. */
export const phases: Record<PhaseKey, string> = {
  pre: 'Pre-evento',
  event: 'Evento',
  post: 'Postevento',
};

/** Colores identificativos de cada fase operativa en la vista compuesta. */
export const phaseColors: Record<PhaseKey, string> = {
  pre: '#89561d',
  event: '#175e58',
  post: '#77548d',
};

/**
 * Piezas logísticas de montaje, desmontaje, maniobra y servicios técnicos (`[nombre, ancho, fondo]`).
 */
export const logistics: Record<string, [string, number, number]> = {
  cleaning: ['Limpieza', 4, 3],
  prep: ['Acondicionamiento', 5, 4],
  assembly: ['Montaje', 6, 4],
  dismantle: ['Desmontaje', 6, 4],
  turning: ['Maniobra de vehículos', 10, 8],
  loading: ['Carga y descarga', 8, 4],
  power: ['Punto eléctrico', 1, 1],
  storage: ['Acopio temporal', 4, 4],
};

/**
 * Determina en qué fases operativas está vigente un objeto del plano.
 * @param o Elemento del plano.
 * @param fallback Fases por defecto si el objeto no declara etiquetas explícitas.
 */
export function membership(
  o: Record<string, any>,
  fallback: PhaseKey[] = ['event'],
): PhaseKey[] {
  if (Array.isArray(o.phaseTags)) {
    return (Object.keys(phases) as PhaseKey[]).filter(k =>
      o.phaseTags.includes(k),
    );
  }
  if (['loading', 'turning'].includes(o.kind) && !o.phases) {
    return ['pre', 'post'];
  }
  if (o.phases) {
    const known: Record<PhaseKey, string | undefined> = {
      pre: o.phases.setup,
      event: o.phases.event,
      post: o.phases.strike,
    };
    const open = (Object.keys(known) as PhaseKey[]).filter(
      k => known[k] && known[k] !== 'closed',
    );
    if (open.length) return open;
  }
  return fallback;
}

/**
 * Filtra una escena devolviendo únicamente los elementos activos en la fase indicada.
 * @param s Escena completa del recinto.
 * @param key Fase operativa (`pre`, `event`, `post`) o `'all'` para vista compuesta.
 */
export function phaseScene(s: Scene, key: string): Scene {
  if (key === 'all') return s;
  const filter = <T extends Record<string, any>>(
    arr: T[] | undefined,
    fallback?: PhaseKey[],
  ): T[] =>
    (arr || []).filter(o => membership(o, fallback).includes(key as PhaseKey));

  return {
    ...s,
    base: {...s.base, booths: filter(s.base.booths)},
    infrastructure: filter(s.infrastructure),
    entrances: filter(s.entrances),
    flows: filter(s.flows),
    corridors: filter(s.corridors),
    roadPlans: filter(s.roadPlans),
    reserves: filter(s.reserves, Object.keys(phases) as PhaseKey[]),
    fences: filter(s.fences),
    annotations: filter(s.annotations),
    measurements: filter(s.measurements),
  };
}

/**
 * Comprueba mediante el teorema de ejes separadores (SAT) si dos polígonos rectangulares se solapan.
 */
export function intersects(a: Point2D[], b: Point2D[]): boolean {
  for (const p of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const q = p[(i + 1) % 4];
      const axis: Point2D = [q[1] - p[i][1], p[i][0] - q[0]];
      const project = (v: Point2D[]) =>
        v.map(([x, y]) => x * axis[0] + y * axis[1]);
      const aa = project(a);
      const bb = project(b);
      if (
        Math.max(...aa) <= Math.min(...bb) ||
        Math.max(...bb) <= Math.min(...aa)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Detecta solapamientos geométricos entre reservas logísticas y piezas del escenario,
 * indicando si comparten alguna fase activa o si son usos sucesivos.
 */
export function comparePhases(
  scene: Scene,
  map: MapMetadata,
): Array<{a: string; b: string; shared: PhaseKey[]}> {
  const objects = [...scene.base.booths, ...scene.infrastructure].map(o => ({
    o,
    poly: rect(o, map),
    tags: membership(o),
  }));
  const rows: Array<{a: string; b: string; shared: PhaseKey[]}> = [];
  for (let i = 0; i < objects.length; i++) {
    for (const b of objects.slice(i + 1)) {
      const a = objects[i];
      if (
        !(logistics[a.o.kind || ''] || logistics[b.o.kind || '']) ||
        !intersects(a.poly, b.poly)
      ) {
        continue;
      }
      rows.push({
        a: a.o.name,
        b: b.o.name,
        shared: a.tags.filter(k => b.tags.includes(k)),
      });
    }
  }
  return rows;
}
