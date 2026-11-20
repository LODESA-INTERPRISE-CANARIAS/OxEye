/**
 * @module engine/dining/furniture
 * Configuración y geometría de zonas de mesas picnic y sus asientos.
 */
import type {MapMetadata, Scene} from '../../types';

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ] || c,
  );

/**
 * Añade la zona de comedor picnic de ejemplo (12 mesas y 1 carpa) a la escena si no existe.
 */
export function addPicnicZone(s: Scene): boolean {
  if (s.infrastructure.some(o => o.kind === 'picnic')) return false;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 2; col++) {
      s.infrastructure.push({
        id: 'picnic-' + row + '-' + col,
        name: 'Mesa picnic ' + (row * 2 + col + 1),
        kind: 'picnic',
        role: 'furniture',
        x: 36 + col * 1.75,
        y: 47 + row * 2.1,
        width: 3,
        depth: 1.8,
        rotation: 0,
        capacity: 6,
        time: 16,
        price: 0,
        open: 0,
        close: s.base.hours,
        cost: 12,
        tableWidth: 1,
        benchWidth: 0.4,
      });
    }
  }
  s.infrastructure.push({
    id: 'picnic-roof',
    name: 'Comedor picnic · carpa',
    kind: 'tent',
    role: 'cover',
    x: 36.875,
    y: 52.25,
    width: 12,
    depth: 23,
    rotation: 0,
    capacity: 72,
    cost: 240,
  });
  return true;
}

export function picnicSVG(o: Record<string, any>, m: MapMetadata): string {
  const x = (o.x * m.widthMeters) / 100;
  const y = (o.y * m.heightMeters) / 100;
  const w = o.width || 3;
  const d = o.depth || 1.8;
  const top = Math.max(0.2, d - 0.8);
  return (
    '<g data-item="' +
    esc(o.id) +
    '" transform="translate(' +
    x +
    ' ' +
    y +
    ') rotate(' +
    (o.rotation || 0) +
    ')"><title>' +
    esc(o.name) +
    ' · tablero ' +
    w +
    ' × ' +
    top.toFixed(1) +
    ' m, bancos de 0,40 m</title><rect x="' +
    -w / 2 +
    '" y="' +
    -top / 2 +
    '" width="' +
    w +
    '" height="' +
    top +
    '" rx=".1" fill="#ac8057" stroke="#6e533c" stroke-width=".1"/>' +
    [-1, 1]
      .map(
        sign =>
          '<rect x="' +
          -w / 2 +
          '" y="' +
          (sign > 0 ? top / 2 : -top / 2 - 0.4) +
          '" width="' +
          w +
          '" height=".4" rx=".07" fill="#c39b71" stroke="#6e533c" stroke-width=".08"/>',
      )
      .join('') +
    '<path d="M' +
    (-w / 2 + 0.2) +
    ' 0H' +
    (w / 2 - 0.2) +
    '" stroke="#e2c49d" stroke-width=".08"/></g>'
  );
}

/**
 * Calcula las coordenadas en metros de hasta 6 plazas de asiento alrededor de una mesa picnic.
 */
export function picnicSlots(
  o: Record<string, any>,
  m: MapMetadata,
  freeAt: (x: number, y: number) => boolean,
  diameter: number,
): Array<{x: number; y: number}> {
  const a = ((o.rotation || 0) * Math.PI) / 180;
  const x = (o.x * m.widthMeters) / 100;
  const y = (o.y * m.heightMeters) / 100;
  const slots: Array<{x: number; y: number}> = [];
  for (const v of [-1, 1]) {
    for (const u of [-1, 0, 1]) {
      const sx =
        x + Math.cos(a) * u - Math.sin(a) * v * (o.depth / 2 + diameter / 2 + 0.08);
      const sy =
        y + Math.sin(a) * u + Math.cos(a) * v * (o.depth / 2 + diameter / 2 + 0.08);
      if (freeAt(sx, sy)) slots.push({x: sx, y: sy});
    }
  }
  return slots;
}
