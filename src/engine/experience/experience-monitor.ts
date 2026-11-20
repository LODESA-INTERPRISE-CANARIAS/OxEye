import type {
  Agent,
  ExperienceEpisode,
  Point,
  ShelterArea,
  SimStation,
} from '../../types';
import {inside, rect} from '../cartography/geometry';
import {fictionalIdentity} from '../crowd/feedback';
import {issueKey, issuePriority} from './review-memory';

/**
 * Dictionary of experience monitoring topic labels.
 */
export const TOPICS: Record<string, string> = {
  price: 'Precio',
  queue: 'Cola',
  shelter: 'Refugio climático',
  sound: 'Sonido',
  blocked: 'Paso bloqueado',
  exit: 'Salida',
  offer: 'Oferta',
};

/**
 * Calculates the satisfaction score, color, and label for an agent.
 *
 * @param a - Simulated agent.
 * @returns Object `{score, color, label}`.
 */
export function satisfaction(a: Agent): {
  score: number;
  color: string;
  label: string;
} {
  const penalties = a.experiencePenalty || 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      55 + Math.min(35, (a.completed || 0) * 18) - (a.failed || 0) * 12 - penalties
    )
  );
  return {
    score,
    color: score >= 70 ? '#b5e48c' : score >= 40 ? '#eed777' : '#e56b64',
    label:
      score >= 70 ? 'Satisfecho' : score >= 40 ? 'Neutral' : 'Descontento',
  };
}

/**
 * Estimates the free-field sound pressure level (dB) at an agent's position
 * from all active sound-emitting stations.
 *
 * @param e - EventEngine instance.
 * @param a - Agent position `{x, y}`.
 * @returns Estimated SPL in dB, or `null` if no sound sources are active.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function soundAt(e: any, a: {x: number; y: number}): number | null {
  let energy = 0;
  for (const b of e.stations as SimStation[]) {
    if (!b.sound?.enabled || !e.available(b)) continue;
    const distance = Math.max(
      1,
      Math.hypot(
        a.x - (b.x * e.g.m.widthMeters) / 100,
        a.y - (b.y * e.g.m.heightMeters) / 100
      )
    );
    const ref = Math.max(1, Number(b.sound.reference) || 5);
    const level = Number(b.sound.spl) - 20 * Math.log10(distance / ref);
    if (Number.isFinite(level)) energy += 10 ** (level / 10);
  }
  return energy > 0 ? 10 * Math.log10(energy) : null;
}

/**
 * Monitors synthetic visitor experience episodes (price, queue, shelter, sound, blocked, exit).
 */
export class ExperienceMonitor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  rows: Map<string, ExperienceEpisode>;
  next: number;
  omitted: number;
  episode: number;
  active: Map<string, ExperienceEpisode>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.rows = new Map();
    this.next = 0;
    this.omitted = 0;
    this.episode = 0;
    this.active = new Map();
  }

  update(): void {
    const e = this.e;
    if (e.time < this.next) return;
    this.next = e.time + 5;
    const seen = new Set<string>();
    const report = (
      a: Agent,
      type: ExperienceEpisode['type'],
      target: string | null | undefined,
      detail: string,
      penalty: number
    ) => {
      const key = a.id + ':' + type + ':' + (target || 'area');
      seen.add(key);
      let r = this.active.get(key);
      if (!r) {
        if (this.rows.size >= 5000) {
          this.omitted++;
          return;
        }
        r = {
          id: 'R' + ++this.episode,
          key,
          ...fictionalIdentity(a),
          agentId: a.id,
          type,
          target: target ?? null,
          detail,
          point: [a.x, a.y],
          first: e.time,
          last: e.time,
          status: 'active',
          synthetic: true,
        };
        this.rows.set(r.id, r);
        this.active.set(key, r);
      }
      r.last = e.time;
      r.detail = detail;
      r.point = [a.x, a.y];
      a.experiencePenalty = (a.experiencePenalty || 0) + penalty;
    };

    for (const a of e.agents as Agent[]) {
      a.experiencePenalty = 0;
      const b = (e.stations as SimStation[]).find((st) => st.id === a.target);
      if (
        b &&
        ['walk', 'queue', 'service', 'seat'].includes(a.state) &&
        ['food', 'commerce'].includes(b.type)
      ) {
        const budget = (a.persona?.budget ?? Infinity) - (a.spent || 0);
        if (Number(b.price) > budget) {
          report(
            a,
            'price',
            b.id,
            `${b.name}: ${b.price} €; presupuesto restante ${Number(budget).toFixed(1)} €.`,
            22
          );
        }
      }
      if (a.state === 'queue') {
        const seconds = e.time - a.waitStart;
        const tolerance = e.s.maxWait * 60 * (a.persona?.patience || 1);
        if (seconds > Math.min(120, tolerance * 0.5)) {
          report(
            a,
            'queue',
            b?.id,
            `${b?.name || 'Cola'}: ${(seconds / 60).toFixed(1)} min; tolerancia supuesta ${(tolerance / 60).toFixed(1)} min.`,
            Math.min(40, (seconds / Math.max(1, tolerance)) * 35)
          );
        }
      }
      if (a.stuck > 15) {
        report(
          a,
          'blocked',
          b?.id,
          `Sin avance durante ${Math.round(a.stuck)} s.`,
          25
        );
      }
      if (a.state === 'trapped') {
        report(
          a,
          'exit',
          null,
          'No encuentra una salida conectada.',
          55
        );
      }
      if (
        e.s.base.weather === 'rain' &&
        (a.persona?.shelterPreference ?? 0.65) >= 0.6 &&
        !(e.shelters as ShelterArea[]).some((s) =>
          inside([a.x, a.y], s.polygon)
        )
      ) {
        if (!a.exposedSince) a.exposedSince = e.time;
        if (e.time - a.exposedSince >= 30) {
          report(
            a,
            'shelter',
            null,
            `Lluvia: ${Math.round(e.time - a.exposedSince)} s sin estar bajo cubierta. ${a.state === 'shelter' ? 'Busca refugio.' : 'No está refugiado.'}`,
            25
          );
        }
      } else {
        a.exposedSince = 0;
      }

      const db = soundAt(e, a);
      const threshold = a.profile === 'music' ? 88 : 78;
      if (db !== null && db > threshold) {
        a.soundSince ??= e.time;
        if (e.time - a.soundSince >= 30) {
          report(
            a,
            'sound',
            null,
            `${db.toFixed(1)} dB estimados; umbral de confort ficticio ${threshold} dB. Campo libre, sin obstáculos ni certificación acústica.`,
            22
          );
        }
      } else {
        a.soundSince = null;
      }
    }

    for (const [key, r] of this.active) {
      if (!seen.has(key)) {
        r.status = e.byId.has(r.agentId) ? 'closed' : 'ended';
        r.closed = e.time;
        r.closeReason =
          r.status === 'closed'
            ? 'Condición ya no observada'
            : 'Visita terminada; no acredita solución';
        this.active.delete(key);
      }
    }
  }

  list(): ExperienceEpisode[] {
    return [...this.rows.values()].sort((a, b) => b.last - a.last);
  }
}

const polygonOverlap = (a: Point[], b: Point[]): boolean => {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis: Point = [-(q[1] - p[1]), q[0] - p[0]];
      const pa = a.map((pt) => pt[0] * axis[0] + pt[1] * axis[1]);
      const pb = b.map((pt) => pt[0] * axis[0] + pt[1] * axis[1]);
      if (
        Math.max(...pa) < Math.min(...pb) ||
        Math.max(...pb) < Math.min(...pa)
      ) {
        return false;
      }
    }
  }
  return true;
};

/**
 * Searches for a collision-free candidate move (`2m`, `4m`, `6m`) for an object near `point`.
 *
 * @param e - EventEngine instance.
 * @param point - Point `[x, y]` in meters where congestion/blockage occurred.
 * @returns Candidate move metadata or `null`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function moveCandidate(e: any, point: Point) {
  const objects = [
    ...e.s.base.booths,
    ...e.s.infrastructure.filter(
      (o: {role?: string}) => !['cover', 'emergency'].includes(o.role || '')
    ),
  ];
  const m = e.g.m;
  const object = objects
    .filter(
      (o) =>
        Math.hypot(
          (o.x * m.widthMeters) / 100 - point[0],
          (o.y * m.heightMeters) / 100 - point[1]
        ) < 15
    )
    .sort(
      (a, b) =>
        Math.hypot(
          (a.x * m.widthMeters) / 100 - point[0],
          (a.y * m.heightMeters) / 100 - point[1]
        ) -
        Math.hypot(
          (b.x * m.widthMeters) / 100 - point[0],
          (b.y * m.heightMeters) / 100 - point[1]
        )
    )[0];
  if (!object) return null;

  const old: Point = [
    (object.x * m.widthMeters) / 100,
    (object.y * m.heightMeters) / 100,
  ];
  const boundary: Point[] = e.s.boundary.map((p: Point) => [
    (p[0] * m.widthMeters) / 100,
    (p[1] * m.heightMeters) / 100,
  ]);

  for (const meters of [2, 4, 6]) {
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearing * Math.PI) / 180;
      const x = old[0] + meters * Math.sin(rad);
      const y = old[1] - meters * Math.cos(rad);
      if (
        Math.hypot(x - point[0], y - point[1]) <=
        Math.hypot(old[0] - point[0], old[1] - point[1]) + 1
      ) {
        continue;
      }
      const next = {
        ...object,
        x: (x / m.widthMeters) * 100,
        y: (y / m.heightMeters) * 100,
      };
      const poly = rect(
        {
          ...next,
          width: (next.width || 4) + 1,
          depth: (next.depth || 4) + 1,
        },
        m
      );
      const samples = poly.flatMap((p, i) =>
        Array.from({length: 10}, (_, j) => [
          p[0] + ((poly[(i + 1) % 4][0] - p[0]) * j) / 10,
          p[1] + ((poly[(i + 1) % 4][1] - p[1]) * j) / 10,
        ] as Point)
      );
      if (!samples.every((p) => inside(p, boundary))) continue;
      if (
        objects.some(
          (o) => o.id !== object.id && polygonOverlap(poly, rect(o, m))
        )
      ) {
        continue;
      }
      if (
        e.s.reserves.some((o: {points: Point[]}) =>
          polygonOverlap(
            poly,
            o.points.map((p) => [
              (p[0] * m.widthMeters) / 100,
              (p[1] * m.heightMeters) / 100,
            ])
          )
        )
      ) {
        continue;
      }
      const hitsFence = (e.s.fences || []).some((f: {points: Point[]}) =>
        f.points.slice(1).some((end, i) => {
          const a: Point = [
            (f.points[i][0] * m.widthMeters) / 100,
            (f.points[i][1] * m.heightMeters) / 100,
          ];
          const b: Point = [
            (end[0] * m.widthMeters) / 100,
            (end[1] * m.heightMeters) / 100,
          ];
          const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
          for (let j = 0; j <= n; j++) {
            if (
              inside(
                [
                  a[0] + ((b[0] - a[0]) * j) / n,
                  a[1] + ((b[1] - a[1]) * j) / n,
                ],
                poly
              )
            ) {
              return true;
            }
          }
          return false;
        })
      );
      if (hitsFence) continue;
      if (
        e.s.entrances.some(
          (g: {x: number; y: number}) =>
            Math.hypot(
              (g.x * m.widthMeters) / 100 - x,
              (g.y * m.heightMeters) / 100 - y
            ) <
            Math.hypot(next.width || 4, next.depth || 4) / 2 + 3
        )
      ) {
        continue;
      }
      return {
        id: object.id as string,
        name: object.name as string,
        x: next.x as number,
        y: next.y as number,
        meters,
        bearing,
        from: [object.x, object.y] as Point,
        text: `Ensayar mover ${object.name} ${meters} m hacia ${bearing}° desde el norte (sentido horario).`,
      };
    }
  }
  return null;
}

/**
 * Aggregates active experience episodes into prioritized diagnostic recommendations.
 *
 * @param e - EventEngine instance.
 * @returns Array of grouped diagnostic issues with suggested actions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function analyze(e: any) {
  const rows: ExperienceEpisode[] =
    e.experience?.list().filter((r: ExperienceEpisode) => r.status === 'active') ||
    [];
  const groups = new Map<
    string,
    {
      type: ExperienceEpisode['type'];
      target?: string | null;
      point: Point;
      people: Set<number>;
      evidence: string;
    }
  >();

  for (const r of rows) {
    const key =
      r.type +
      ':' +
      (r.target || Math.floor(r.point[0] / 10) + ',' + Math.floor(r.point[1] / 10));
    let g = groups.get(key);
    if (!g) {
      g = {
        type: r.type,
        target: r.target,
        point: r.point,
        people: new Set(),
        evidence: r.detail,
      };
      groups.set(key, g);
    }
    g.people.add(r.agentId);
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.people.size +
        issuePriority(e.s.reviewMemory?.[issueKey(b)]) * 3 -
        (a.people.size + issuePriority(e.s.reviewMemory?.[issueKey(a)]) * 3)
    )
    .slice(0, 12)
    .map((g) => {
      const b = (e.stations as SimStation[]).find((st) => st.id === g.target);
      const actions: Record<string, string> = {
        price: `Comparar una tarifa reducida en ${b?.name || 'el puesto'} y volver a ensayar; no se estima rentabilidad.`,
        queue: `Probar ${Math.max(1, (b?.capacity || 1) + 1)} plazas simultáneas en ${b?.name || 'el servicio'}, si hay personal y espacio; repetir el ensayo.`,
        shelter:
          'Comparar una cubierta accesible próxima, con plazas libres. Comprobar anclajes y cargas fuera del simulador.',
        sound:
          'Probar reducir 3 dB el nivel de referencia del escenario y repetir. No es una recomendación de cumplimiento acústico.',
        exit: 'Revisar y conectar una salida pública antes de continuar.',
        blocked: 'Revisar el paso y comparar otra ubicación del obstáculo.',
      };
      const action = actions[g.type] || '';
      const move = ['blocked', 'queue'].includes(g.type)
        ? moveCandidate(e, g.point)
        : null;
      const prio = issuePriority(e.s.reviewMemory?.[issueKey(g)]);
      return {
        ...g,
        people: g.people.size,
        action:
          (prio ? `Pendiente reiterado · prioridad ${prio}. ` : '') +
          (move?.text || action),
        move,
        limitation: move
          ? 'Candidato geométrico con margen de 0,5 m: aún no demuestra mejora de flujo, evacuación o accesibilidad.'
          : 'Hipótesis de comparación; no solución validada.',
      };
    });
}
