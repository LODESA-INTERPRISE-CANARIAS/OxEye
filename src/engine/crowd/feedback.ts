/**
 * @module engine/crowd/feedback
 * Registro de episodios narrativos y quejas de los visitantes simulados.
 */
import type {Point2D} from '../../types';

const first = [
  'Lucía',
  'Mateo',
  'Carmen',
  'Hugo',
  'Elena',
  'Daniel',
  'Sara',
  'Adrián',
  'Nora',
  'Pablo',
  'Inés',
  'Leo',
  'Alicia',
  'Bruno',
  'Clara',
  'Iván',
  'Eva',
  'Marcos',
  'Julia',
  'Óscar',
  'Lara',
  'Álex',
  'Vera',
  'Nicolás',
  'Paula',
  'Darío',
  'Alba',
  'Sergio',
  'Irene',
  'Samuel',
  'Marina',
  'Tomás',
];

const last = [
  'Pérez',
  'García',
  'Díaz',
  'Hernández',
  'Martín',
  'Rodríguez',
  'Alonso',
  'Suárez',
  'González',
  'Cabrera',
  'Torres',
  'Méndez',
  'Delgado',
  'Castro',
  'Morales',
  'Navarro',
];

const interests: Record<string, string> = {
  buyer: 'comprar y descubrir productos',
  foodie: 'comer y probar sabores',
  culture: 'participar en talleres y actividades culturales',
  music: 'escuchar música y disfrutar del espectáculo',
  walker: 'pasear y descansar',
};

const effortBase: Record<string, number> = {
  cuello: 2,
  recorrido: 3,
  espera: 2,
  oferta: 3,
  sin_salida: 4,
  acceso: 2,
};

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ] || c,
  );
const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

/**
 * Construye una identidad narrativa ficticia para un agente visitante.
 */
export function fictionalIdentity(a: Record<string, any>) {
  const n = Math.max(0, (a.id || 1) - 1);
  return {
    name:
      a.persona?.personName ||
      first[n % first.length] +
        ' ' +
        last[Math.floor(n / first.length) % last.length],
    visitId: 'V' + String(a.id).padStart(4, '0'),
    description:
      (a.persona?.age != null
        ? a.persona.age +
          ' años. ' +
          a.persona.home +
          '. ' +
          a.persona.education +
          '. '
        : '') +
      'Venía a ' +
      (interests[a.profile] || 'disfrutar del evento') +
      '. ' +
      (a.persona?.pace < 0.9
        ? 'Prefiere avanzar sin prisa. '
        : a.persona?.pace > 1.1
          ? 'Suele moverse con agilidad. '
          : 'Se mueve a un ritmo habitual. ') +
      (a.persona?.patience < 0.9
        ? 'Tolera poco las esperas.'
        : a.persona?.patience > 1.2
          ? 'Tiene margen para esperar algo más.'
          : 'Acepta una espera moderada.'),
  };
}

export const clock = (seconds: number, start: number) => {
  const m = Math.floor(seconds / 60) + Math.round(start * 60);
  return (
    String(Math.floor(m / 60) % 24).padStart(2, '0') +
    ':' +
    String(m % 60).padStart(2, '0')
  );
};

function narrative(r: Record<string, any>, start: number) {
  const where = r.detail || r.place.replace(/^Entorno de /, '');
  const minutes = Math.max(0.3, Math.round(r.seconds / 6) / 10);
  const mins = new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 1,
  }).format(minutes);
  const time =
    r.first === r.last
      ? clock(r.first, start)
      : clock(r.first, start) + '–' + clock(r.last, start);

  const stories: Record<string, [string, string, string, string]> = {
    cuello: [
      'Me cuesta avanzar',
      'Intento seguir mi recorrido, pero no consigo avanzar cerca de ' +
        where +
        '.',
      'Mi avance se ha interrumpido durante un episodio de unos ' +
        mins +
        ' minutos.',
      'Probar a despejar el paso junto a ' +
        where +
        ' y separar a quienes esperan de quienes solo pasan.',
    ],
    recorrido: [
      'No consigo llegar a la actividad',
      'Quiero acceder a ' + where + ' y la aproximación se me hace difícil.',
      'No he logrado completar esta aproximación antes de agotar mi tolerancia.',
      'Separar la zona de espera de ' +
        where +
        ' del paso general y probar una aproximación alternativa.',
    ],
    espera: [
      'La espera me hace desistir',
      'Estoy esperando en ' + where + ' y termino dejando la cola.',
      r.cause === 'horario'
        ? 'La actividad cierra antes de que pueda ser atendida mi petición.'
        : r.cause === 'agenda'
          ? 'Se me acaba el tiempo previsto para esta visita y dejo la cola tras ' +
            mins +
            ' minutos.'
          : 'La espera llega a ' +
            mins +
            ' minutos y supera el tiempo que aceptaba esperar.',
      'Revisar el horario y probar más atención simultánea o turnos en ' +
        where +
        '.',
    ],
    oferta: [
      'Lo que buscaba no está disponible',
      'Busco ' +
        (interests[r.profile] || 'una actividad') +
        ' y no encuentro una opción accesible y abierta en ese momento.',
      'Tengo que cambiar o abandonar uno de mis objetivos.',
      'Contrastar el horario y la oferta de este perfil antes de aumentar las llegadas.',
    ],
    sin_salida: [
      'No encuentro una salida conectada',
      'Quiero marcharme, pero no encuentro un camino hacia una salida abierta.',
      'No puedo completar mi salida del recinto.',
      'Abrir una salida pública conectada y comprobar su recorrido antes de continuar.',
    ],
  };

  const v = stories[r.type] || [
    'Un acceso me dificulta la visita',
    'Tengo dificultades al acceder cerca de ' + where + '.',
    'Mi llegada se retrasa.',
    'Comprobar el acceso y repartir las llegadas.',
  ];
  return {
    title: v[0],
    quote: v[1],
    reason: v[2],
    suggestion: v[3],
    when: time,
    duration: minutes,
  };
}

export interface FeedbackRow {
  id: string;
  synthetic: boolean;
  type: string;
  visitId: string;
  name: string;
  age?: number;
  profile: string;
  place: string;
  point: Point2D;
  detail: string;
  cause: string;
  first: number;
  last: number;
  signals: number;
  seconds: number;
  tolerance: number;
  impact: number;
  effort: number;
  [key: string]: any;
}

/**
 * Registro de episodios de dolor/queja generados durante la simulación.
 */
export class FeedbackLog {
  start: number;
  max: number;
  rows: Map<string, FeedbackRow>;
  omitted: number;

  constructor(start = 17, max = 1500) {
    this.start = start;
    this.max = max;
    this.rows = new Map();
    this.omitted = 0;
  }

  record({
    type,
    agent,
    time,
    place,
    point,
    detail = '',
    seconds = 0,
    tolerance = 720,
    cause = '',
  }: {
    type: string;
    agent: Record<string, any>;
    time: number;
    place: string;
    point: Point2D;
    detail?: string;
    seconds?: number;
    tolerance?: number;
    cause?: string;
  }) {
    if (!agent?.persona) return;
    const area = place.split(' · ')[0];
    const key = agent.id + ':' + type + ':' + (detail || area);
    let row = this.rows.get(key);
    if (!row) {
      if (this.rows.size >= this.max) {
        this.omitted++;
        return;
      }
      row = {
        id: key,
        synthetic: true,
        type,
        ...fictionalIdentity(agent),
        profile: agent.profile,
        place: area,
        point: [...point],
        detail,
        cause,
        first: Math.max(agent.born || 0, time - (seconds || 0)),
        last: time,
        signals: 0,
        seconds: 0,
        tolerance,
        impact: 1,
        effort: 2,
      };
      this.rows.set(key, row);
    }
    row.last = time;
    row.signals++;
    row.seconds = Math.max(row.seconds, seconds || 0);
    row.impact =
      type === 'sin_salida'
        ? 5
        : type === 'oferta'
          ? 3
          : type === 'recorrido' || type === 'espera'
            ? clamp(3 + row.seconds / Math.max(60, tolerance))
            : clamp(1 + (4 * row.seconds) / Math.max(60, tolerance));
    row.effort = effortBase[type] || 2;
  }

  list() {
    return [...this.rows.values()]
      .map(row => ({...row, ...narrative(row, this.start)}))
      .sort(
        (a, b) => b.impact - a.impact || a.effort - b.effort || a.first - b.first,
      );
  }
}

export function scoreHTML(value: number, label: string, kind = 'impact') {
  return (
    '<div class="feedback-score ' +
    kind +
    '"><span>' +
    label +
    '</span><b>' +
    value +
    '<small>/5</small></b><i aria-hidden="true">' +
    Array.from(
      {length: 5},
      (_, i) => '<em class="' + (i < value ? 'filled' : '') + '"></em>',
    ).join('') +
    '</i></div>'
  );
}

export function feedbackCard(r: Record<string, any>) {
  return (
    '<article class="feedback-card" data-feedback-card="' +
    esc(r.id) +
    '"><header><span class="feedback-avatar" aria-hidden="true">' +
    esc(
      r.name
        .split(' ')
        .map((w: string) => w[0])
        .join(''),
    ) +
    '</span><div><b>' +
    esc(r.name) +
    '</b><small>' +
    esc(r.visitId) +
    ' · personaje simulado</small></div><time><small>Cuándo</small>' +
    esc(r.when) +
    '</time></header><p class="feedback-description">' +
    esc(r.description) +
    '</p><h3>' +
    esc(r.title) +
    '</h3><blockquote>«' +
    esc(r.quote) +
    '»</blockquote><p class="feedback-reason">' +
    esc(r.reason) +
    '</p><div class="feedback-scores">' +
    scoreHTML(r.impact, 'Impacto en su visita') +
    scoreHTML(r.effort, 'Esfuerzo que cree necesario', 'effort') +
    '</div><p class="feedback-place">' +
    esc(r.place) +
    '</p><details open><summary>Su propuesta de mejora</summary><p>' +
    esc(r.suggestion) +
    '</p><small>Opinión simulada. El esfuerzo es una hipótesis de dificultad, no un presupuesto técnico.</small></details><button class="feedback-locate" data-feedback="' +
    esc(r.id) +
    '">Ver dónde ocurrió ↗</button></article>'
  );
}
