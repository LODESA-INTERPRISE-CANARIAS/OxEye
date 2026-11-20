/**
 * @module engine/emergency/response-example
 * Adds demonstration emergency response teams, extinguisher, and emergency gate to a scene.
 */
import type {Scene} from '../../types';
import {EventEngine} from '../crowd/event-engine';
import {footprintClear} from './response-model';

export function addResponseExample(scene: Scene): Scene {
  const s = structuredClone(scene);
  const e = new EventEngine(s);
  const m = e.g.m;
  const gate = s.entrances[0];
  if (!gate) {
    throw new Error('Define al menos un acceso antes de preparar el ejemplo.');
  }
  const origin: [number, number] = [
    (gate.x * m.widthMeters) / 100,
    (gate.y * m.heightMeters) / 100,
  ];
  const free: Array<{x: number; y: number; d: number}> = [];
  for (let k = 0; k < e.g.free.length; k++) {
    if (!e.g.free[k]) continue;
    const [x, y] = e.g.point(k);
    if (footprintClear(e, {x, y, angle: 0}, 3, 8)) {
      free.push({x, y, d: Math.hypot(x - origin[0], y - origin[1])});
    }
  }
  free.sort((a, b) => a.d - b.d);
  const p = free[0];
  if (!p) {
    throw new Error(
      'No hay espacio comprobable para situar la huella del vehículo de ejemplo.'
    );
  }
  const add = (
    kind: string,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    staff: number,
    delay: number,
    handling: number
  ) => {
    if (!s.infrastructure.some((o) => o.kind === kind)) {
      s.infrastructure.push({
        id: crypto.randomUUID(),
        kind,
        name,
        role: kind === 'extinguisher' ? 'facility' : 'emergency',
        x: (x / m.widthMeters) * 100,
        y: (y / m.heightMeters) * 100,
        width: w,
        depth: h,
        staff,
        capacity: 1,
        delay,
        handling,
        active: true,
        phaseTags: ['event'],
      });
    }
  };
  add('fire', 'Bomberos · dotación de ensayo', p.x, p.y, 3, 8, 4, 90, 360);
  const med = e.g.nearest(p.x + 6, p.y, 6);
  const q = med >= 0 ? e.g.point(med) : [p.x, p.y];
  add('medical', 'Primera atención · ensayo', q[0], q[1], 1, 1, 2, 30, 180);
  const sec = e.g.nearest(q[0] + 2, q[1] + 2, 6);
  const sp = sec >= 0 ? e.g.point(sec) : q;
  add('security', 'Patrulla a pie · ensayo', sp[0], sp[1], 0.9, 0.9, 2, 15, 120);
  const food = e.stations.find((o) => o.type === 'food');
  if (food && food.cell >= 0) {
    const point = e.g.point(food.cell);
    add('extinguisher', 'Extintor · ensayo', point[0], point[1], 0.5, 0.5, 0, 0, 0);
  }
  if (!s.entrances.some((g) => (g.phases?.event || g.role) === 'emergency')) {
    s.entrances.push({
      ...gate,
      id: crypto.randomUUID(),
      name: 'Acceso de emergencias · ensayo',
      role: 'emergency',
      clearWidth: 4.5,
      phases: {event: 'emergency'},
      phaseTags: ['event'],
    });
  }
  s.trained = true;
  s.fireFootAccess = true;
  s.responseExampleNote =
    'Dotaciones, formación y acceso son supuestos de demostración que requieren validación local.';
  return s;
}
