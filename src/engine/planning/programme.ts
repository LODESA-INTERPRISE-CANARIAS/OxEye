/**
 * @module engine/planning/programme
 * Multi-day activity programme catalog, local providers reference, and budget-constrained scheduler.
 */
import type {Scene} from '../../types';

export interface ActivitySpec {
  id: string;
  name: string;
  category: string;
  minutes: number;
  cost: number;
  places: number;
  need: 'roof' | 'stage' | 'tables' | 'power' | 'open';
  area: number;
  enabled?: boolean;
}

export const activities: ActivitySpec[] = (
  [
    ['stories', 'Cuentacuentos', 'Lectura y cultura', 45, 160, 25, 'roof', 12],
    ['puppets', 'Teatro de títeres', 'Lectura y cultura', 45, 280, 35, 'stage', 20],
    ['poetry', 'Poesía y lectura compartida', 'Lectura y cultura', 45, 120, 20, 'roof', 12],
    ['letters', 'Cartas a los Reyes', 'Navidad', 60, 140, 12, 'tables', 12],
    ['ornaments', 'Adornos navideños', 'Navidad', 60, 180, 12, 'tables', 15],
    ['wrapping', 'Envoltorios reutilizables', 'Navidad', 60, 170, 12, 'tables', 15],
    ['cards', 'Tarjetas de Navidad', 'Navidad', 60, 140, 12, 'tables', 15],
    ['faces', 'Pintacaras', 'Infantil', 60, 150, 12, 'roof', 9],
    ['balloons', 'Globoflexia', 'Infantil', 60, 150, 16, 'roof', 12],
    ['magic', 'Magia de pequeño formato', 'Espectáculo', 45, 300, 40, 'stage', 20],
    ['castle', 'Castillo hinchable con monitor', 'Infantil', 90, 350, 12, 'power', 50],
    ['games', 'Juegos tradicionales canarios', 'Juego y patrimonio', 60, 180, 20, 'open', 35],
    ['board', 'Juegos de mesa en familia', 'Juego y patrimonio', 60, 140, 12, 'tables', 15],
    ['brega', 'Introducción al juego La Brega', 'Juego y patrimonio', 60, 140, 12, 'tables', 15],
    ['clay', 'Modelado de arcilla', 'Taller', 60, 220, 12, 'tables', 18],
    ['painting', 'Pintura creativa', 'Taller', 60, 180, 12, 'tables', 15],
    ['recycle', 'Juguetes con material reutilizado', 'Taller', 60, 180, 12, 'tables', 18],
    ['science', 'Experimentos divulgativos', 'Taller', 60, 260, 12, 'tables', 18],
    ['plants', 'Semilleros y cuidado de plantas', 'Taller', 60, 200, 12, 'tables', 18],
    ['crafts', 'Demostración de artesanía', 'Artesanía', 60, 220, 20, 'roof', 20],
    ['carols', 'Villancicos en pequeño formato', 'Música', 45, 450, 50, 'stage', 30],
    ['acoustic', 'Dúo acústico', 'Música', 45, 400, 40, 'stage', 25],
    ['dance', 'Baile participativo', 'Movimiento', 45, 240, 25, 'open', 45],
    ['gentle', 'Movimiento suave y descanso activo', 'Movimiento', 45, 180, 20, 'open', 35],
    ['history', 'Historias de La Laguna', 'Patrimonio', 45, 150, 20, 'roof', 18],
    ['signs', 'Juego de comunicación visual', 'Inclusión', 60, 200, 12, 'tables', 16],
    ['chess', 'Ajedrez intergeneracional', 'Juego y patrimonio', 60, 140, 12, 'tables', 16],
    ['musicworkshop', 'Ritmo y percusión sencilla', 'Música', 60, 240, 15, 'roof', 25],
    ['reading', 'Lectura tranquila acompañada', 'Descanso', 45, 120, 12, 'roof', 15],
    ['photo', 'Taller de fotografía con móvil', 'Taller', 60, 180, 15, 'open', 25],
  ] as const
).map(([id, name, category, minutes, cost, places, need, area]) => ({
  id,
  name,
  category,
  minutes,
  cost,
  places,
  need,
  area,
}));

export const providers = [
  {
    name: 'Actividades Tafor',
    offer: 'Talleres y pintacaras',
    url: 'https://actividadestafor.com/servicios/talleres',
    region: 'Tenerife',
  },
  {
    name: 'Anima Canarias',
    offer: 'Animación e hinchables',
    url: 'https://animacanarias.com/',
    region: 'Tenerife',
  },
  {
    name: 'Playme Diversión',
    offer: 'Alquiler de hinchables',
    url: 'https://playmediversion.com/',
    region: 'Tenerife',
  },
  {
    name: 'El Rasti Animación',
    offer: 'Animación infantil e hinchables',
    url: 'https://elrastianimacion.es/sobre-nosotros/',
    region: 'Tenerife',
  },
];

export interface ProgrammePlanOptions {
  budget: number;
  reserve: number;
  sessions: number;
  start: number;
  finish: number;
  area: number;
  items: ActivitySpec[];
}

export interface ScheduledSession extends ActivitySpec {
  day: number;
  start: number;
  end: number;
}

export function planProgramme(scene: Scene, options: ProgrammePlanOptions) {
  const days = Math.max(1, Math.min(30, scene.eventDays || 1));
  const start = options.start;
  const finish = options.finish;
  if (finish <= start) {
    throw new Error('El final debe ser posterior al inicio del programa.');
  }
  const spending = options.budget * (1 - options.reserve / 100);
  const pool = options.items.filter(
    (a) => a.enabled && a.cost >= 0 && Number.isFinite(a.cost)
  );
  const installed = scene.infrastructure;
  const has: Record<ActivitySpec['need'], boolean> = {
    tables: installed.filter((o) => o.kind === 'picnic').length >= 2,
    roof: installed.some((o) => o.role === 'cover'),
    stage: scene.base.booths.some((o) => o.type === 'stage'),
    power: installed.some((o) => o.kind === 'power'),
    open: true,
  };
  let spent = 0;
  const counts = new Map<string, number>();
  const schedule: ScheduledSession[] = [];
  const pending: Array<{day: number; reason: string}> = [];

  for (let day = 0; day < days; day++) {
    let time = start * 60;
    const categories = new Set<string>();
    for (let slot = 0; slot < options.sessions; slot++) {
      const remainingBudget = spending - spent;
      const choices = pool.filter(
        (a) =>
          a.minutes + time <= finish * 60 &&
          a.cost <= remainingBudget &&
          a.area <= options.area &&
          has[a.need] &&
          !schedule.some((s) => s.day === day && s.id === a.id)
      );
      choices.sort(
        (a, b) =>
          (counts.get(a.id) || 0) - (counts.get(b.id) || 0) ||
          Number(categories.has(a.category)) -
            Number(categories.has(b.category)) ||
          a.cost - b.cost
      );
      const choice = choices[0];
      if (!choice) {
        pending.push({
          day,
          reason:
            'Sin actividad compatible con el presupuesto restante, horario o recursos disponibles.',
        });
        break;
      }
      schedule.push({...choice, day, start: time, end: time + choice.minutes});
      counts.set(choice.id, (counts.get(choice.id) || 0) + 1);
      categories.add(choice.category);
      spent += choice.cost;
      time += choice.minutes + 15;
    }
  }
  return {
    schedule,
    pending,
    spent,
    reserved: (options.budget * options.reserve) / 100,
    unspent: options.budget - spent,
    assumptions:
      'Importes orientativos introducidos por el usuario; confirmar presupuesto, disponibilidad y requisitos técnicos con el proveedor.',
  };
}
