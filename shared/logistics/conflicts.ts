/**
 * Plan warnings for the Logistics Manager: what clashes (same venue or same
 * company at the same time, a task starting before what it depends on) and
 * what must be checked elsewhere (heavy loads → subsoil review in the
 * simulator; deliveries during the event → emergency routes A/B/C and access
 * to the Carpa Amarilla). Pure and shared by the UI, the server and the tests.
 *
 * Warnings support decisions; they never certify anything. The 500 kg/m²
 * figure is the simulator's indicative review threshold and is only quoted
 * here, never computed.
 */
import type {LogisticsEvent, Resource, Task, Uuid} from './contracts.ts';
import {formatQuantity, unitFor} from './inventory.ts';
import {
  DEFAULT_RESOURCE_UNIT,
  RESOURCE_AVAILABILITY_LABEL,
  RESOURCE_CONDITION_LABEL,
} from './rules.ts';
import {findOverlaps, type ScheduleItem} from './schedule.ts';
import {occupiedDates, utcToLocal} from './time.ts';

export type WarningKind =
  | 'venue_overlap'
  | 'company_overlap'
  | 'dependency_order'
  | 'heavy_load'
  | 'heavy_load_unknown'
  | 'route_window'
  /** The same inventory resource in two live tasks at the same time (M4). */
  | 'resource_overlap'
  /** A live task uses a resource recorded as damaged or under repair (M4). */
  | 'resource_unavailable';

/** `conflict`: two things cannot both happen as planned. `reminder`: check it. */
export type WarningSeverity = 'conflict' | 'reminder';

export interface PlanWarning {
  /** Stable key for lists and dismissing in the UI. */
  key: string;
  kind: WarningKind;
  severity: WarningSeverity;
  /** Tasks involved, in display order. */
  taskIds: Uuid[];
  /** Minutes of overlap or of early start, when it applies. */
  minutes: number | null;
  title: string;
  detail: string;
}

export type PlanTask = Pick<
  Task,
  | 'id'
  | 'title'
  | 'kind'
  | 'status'
  | 'eventId'
  | 'venue'
  | 'company'
  | 'startsAt'
  | 'endsAt'
  | 'dependsOn'
  | 'heavyLoad'
> &
  Partial<
    Pick<
      Task,
      'date' | 'endDate' | 'timezone' | 'resourceIds' | 'subsoilReview'
    >
  >;
/**
 * What the warnings need from a resource. Quantity only decides whether two
 * tasks can share it; weight, unit and dimensions never feed a load check.
 */
export type PlanResource = Pick<
  Resource,
  'id' | 'name' | 'quantity' | 'unit' | 'condition' | 'availability'
>;
export type PlanEvent = Pick<
  LogisticsEvent,
  'id' | 'name' | 'startsAt' | 'endsAt' | 'status'
> &
  Partial<Pick<LogisticsEvent, 'venue' | 'date' | 'endDate' | 'timezone'>>;

/** Kinds that may put heavy material on the venue or move vehicles. */
export const LOAD_BEARING_KINDS: ReadonlySet<Task['kind']> = new Set([
  'assembly',
  'delivery',
  'transport',
  'dismantling',
]);
/** Vehicles that cross the town to reach the venue. */
const VEHICLE_KINDS: ReadonlySet<Task['kind']> = new Set([
  'delivery',
  'transport',
]);

/**
 * The only place the logistics code quotes the simulator's heavy-load
 * threshold (`HEAVY_LOAD_THRESHOLD_KG_M2` in src/engine/planning/ballast.ts;
 * a unit test keeps them equal). Quoted, never computed.
 */
export const SUBSOIL_THRESHOLD_NOTE =
  '500 kg/m² es un umbral orientativo de revisión, no un límite certificado.';
export const SUBSOIL_REMINDER = `Revisa el subsuelo en el simulador (análisis de rayos X). ${SUBSOIL_THRESHOLD_NOTE}`;
export const ROUTES_REMINDER =
  'Comprueba en el simulador que no corta las rutas de emergencia A (acceso de vehículos), B (sanitarios a pie) y C (evacuación en camilla) ni el acceso a la Carpa Amarilla y a los servicios de accesibilidad.';
/**
 * Shown next to a resource's quantity, unit and dimensions. They describe
 * what was observed; the subsoil question belongs to the simulator.
 */
export const RESOURCE_LOAD_NOTE =
  'El peso, la cantidad y las medidas son datos de inventario: no calculan la carga sobre el suelo. Si algo pesado va a la vía pública, marca «Carga pesada» en su tarea y revisa el subsuelo en el simulador (análisis de rayos X).';
const UNTIMED_PREFIX = 'Falta la hora, pero es el mismo día. ';

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const MIN = 60_000;

/** Cancelled and finished tasks no longer occupy anything. */
function isLive(t: PlanTask): boolean {
  return t.status !== 'cancelled' && t.status !== 'done';
}

function quote(t: PlanTask): string {
  return `«${t.title}»`;
}

/** «45 min», «1 h», «2 h 15 min». */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function toItems(
  tasks: PlanTask[],
  lane: (t: PlanTask) => string | null,
): ScheduleItem[] {
  return tasks.map(t => ({
    id: t.id,
    label: t.title,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    lane: lane(t),
    dependsOn: t.dependsOn,
  }));
}

export function planWarnings(
  tasks: PlanTask[],
  events: PlanEvent[] = [],
  resources: PlanResource[] = [],
): PlanWarning[] {
  const live = tasks.filter(isLive);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const out: PlanWarning[] = [];

  // Same resource, same time. One item per (task, resource); a resource that
  // is the only one of its kind cannot be in two places (conflict); with
  // more than one, or not counted yet, the team checks there are enough.
  const resourcesById = new Map(resources.map(r => [r.id, r]));
  const perResource: ScheduleItem[] = live.flatMap(t =>
    (t.resourceIds ?? [])
      .filter(id => resourcesById.has(id))
      .map(id => ({
        id: t.id,
        label: t.title,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        lane: id,
        dependsOn: [],
      })),
  );
  for (const o of findOverlaps(perResource)) {
    const a = byId.get(o.a)!;
    const b = byId.get(o.b)!;
    const r = resourcesById.get(o.lane)!;
    // Only a count in units says «just one»: 1 kg or 1 m² may be shared.
    const single = r.quantity === 1 && r.unit.trim() === DEFAULT_RESOURCE_UNIT;
    const none = r.quantity === 0;
    const stock =
      r.quantity === null
        ? 'Aún no consta cuántos hay.'
        : `Constan ${formatQuantity(r.quantity)} ${unitFor(r.quantity, r.unit)}.`;
    const overlap = `${quote(a)} y ${quote(b)} se solapan ${minutesLabel(o.minutes)}`;
    out.push({
      key: `resource:${o.lane}:${o.a}:${o.b}`,
      kind: 'resource_overlap',
      severity: single || none ? 'conflict' : 'reminder',
      taskIds: [o.a, o.b],
      minutes: o.minutes,
      title:
        single || none
          ? `«${r.name}» está en dos tareas a la vez`
          : `Dos tareas usan «${r.name}» a la vez`,
      detail: single
        ? `${overlap} y solo hay uno.`
        : none
          ? `${overlap} y en el inventario consta que no hay ninguno.`
          : `${overlap}. ${stock} Comprueba que hay suficientes para las dos.`,
    });
  }

  // A live task counting on something damaged or under repair.
  for (const t of live) {
    for (const id of t.resourceIds ?? []) {
      const r = resourcesById.get(id);
      if (!r) continue;
      const why =
        r.availability === 'maintenance'
          ? RESOURCE_AVAILABILITY_LABEL.maintenance
          : r.condition === 'damaged'
            ? RESOURCE_CONDITION_LABEL.damaged
            : null;
      if (!why) continue;
      out.push({
        key: `resource-state:${id}:${t.id}`,
        kind: 'resource_unavailable',
        severity: 'reminder',
        taskIds: [t.id],
        minutes: null,
        title: `«${r.name}»: ${why.toLowerCase()}`,
        detail: `${quote(t)} cuenta con este recurso. Confirma que estará listo o busca otro.`,
      });
    }
  }

  // Same venue, same time.
  for (const o of findOverlaps(toItems(live, t => t.venue?.id ?? null))) {
    const a = byId.get(o.a)!;
    const b = byId.get(o.b)!;
    out.push({
      key: `venue:${o.a}:${o.b}`,
      kind: 'venue_overlap',
      severity: 'conflict',
      taskIds: [o.a, o.b],
      minutes: o.minutes,
      title: `Coinciden en ${a.venue!.name}`,
      detail: `${quote(a)} y ${quote(b)} se solapan ${minutesLabel(o.minutes)} en el mismo lugar.`,
    });
  }

  // Same company in two different places at once.
  for (const o of findOverlaps(toItems(live, t => t.company?.id ?? null))) {
    const a = byId.get(o.a)!;
    const b = byId.get(o.b)!;
    if (a.venue && b.venue && a.venue.id === b.venue.id) continue;
    out.push({
      key: `company:${o.a}:${o.b}`,
      kind: 'company_overlap',
      severity: 'conflict',
      taskIds: [o.a, o.b],
      minutes: o.minutes,
      title: `${a.company!.name} está en dos sitios a la vez`,
      detail: `${quote(a)} y ${quote(b)} se solapan ${minutesLabel(o.minutes)}.`,
    });
  }

  // A task that starts before something it depends on has finished.
  for (const t of live) {
    const start = ms(t.startsAt);
    if (Number.isNaN(start)) continue;
    for (const depId of t.dependsOn) {
      const dep = byId.get(depId);
      // A cancelled or finished predecessor no longer holds anything back.
      if (!dep || dep.status === 'cancelled' || dep.status === 'done') {
        continue;
      }
      const end = ms(dep.endsAt);
      if (Number.isNaN(end) || start >= end) continue;
      const minutes = Math.round((end - start) / MIN);
      out.push({
        key: `dependency:${dep.id}:${t.id}`,
        kind: 'dependency_order',
        severity: 'conflict',
        // The late task first: it is the one the warning is about.
        taskIds: [t.id, dep.id],
        minutes,
        title: `${quote(t)} empieza antes de tiempo`,
        detail: `Depende de ${quote(dep)}, que termina ${minutesLabel(minutes)} después.`,
      });
    }
  }

  // Heavy loads: known (any kind) → subsoil review until someone declares
  // it was done in the simulator; a finished task keeps the reminder if
  // nobody declared it (finishing is not reviewing). Unknown on
  // load-bearing kinds → ask.
  for (const t of tasks) {
    if (t.status !== 'done' || t.heavyLoad !== true || t.subsoilReview) {
      continue;
    }
    out.push({
      key: `heavy:${t.id}`,
      kind: 'heavy_load',
      severity: 'reminder',
      taskIds: [t.id],
      minutes: null,
      title: `${quote(t)} terminó sin revisión del subsuelo declarada`,
      detail: SUBSOIL_REMINDER,
    });
  }
  for (const t of live) {
    if (t.heavyLoad === true && t.subsoilReview) continue;
    if (t.heavyLoad === true) {
      out.push({
        key: `heavy:${t.id}`,
        kind: 'heavy_load',
        severity: 'reminder',
        taskIds: [t.id],
        minutes: null,
        title: `Carga pesada en ${quote(t)}`,
        detail: SUBSOIL_REMINDER,
      });
    } else if (t.heavyLoad === null && LOAD_BEARING_KINDS.has(t.kind)) {
      out.push({
        key: `heavy-unknown:${t.id}`,
        kind: 'heavy_load_unknown',
        severity: 'reminder',
        taskIds: [t.id],
        minutes: null,
        title: `¿${quote(t)} lleva carga pesada?`,
        detail:
          'Escenario, generador, depósitos o lastre. Si no se sabe, queda pendiente de verificar; no se da por ligera.',
      });
    }
  }

  // Vehicles and heavy works while a public event is on. Deliveries and
  // transport: their own event (anywhere) or any event at their venue.
  // Assembly and dismantling: an event at their venue (trucks, cranes).
  // Unknown times are not «outside the event»: same day → remind anyway.
  const eventsById = new Map(events.map(e => [e.id, e]));
  for (const t of live) {
    const vehicle = VEHICLE_KINDS.has(t.kind);
    if (!vehicle && !LOAD_BEARING_KINDS.has(t.kind)) continue;
    const own = t.eventId ? eventsById.get(t.eventId) : undefined;
    const candidates = [
      ...(own && (vehicle || sameVenue(t, own)) ? [own] : []),
      ...events.filter(e => e !== own && sameVenue(t, e)),
    ];
    let match: {ev: PlanEvent; timed: boolean} | null = null;
    for (const ev of candidates) {
      const when = coincides(t, ev);
      if (when === 'timed') {
        match = {ev, timed: true};
        break;
      }
      if (when === 'same_day' && !match) match = {ev, timed: false};
    }
    if (!match) continue;
    out.push({
      key: `routes:${t.id}`,
      kind: 'route_window',
      severity: 'reminder',
      taskIds: [t.id],
      minutes: null,
      title: `${quote(t)} coincide con «${match.ev.name}»`,
      detail: (match.timed ? '' : UNTIMED_PREFIX) + ROUTES_REMINDER,
    });
  }

  const rank = (w: PlanWarning) => (w.severity === 'conflict' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

function sameVenue(t: PlanTask, ev: PlanEvent): boolean {
  return !!t.venue && !!ev.venue && t.venue.id === ev.venue.id;
}

/**
 * `timed`: both windows known and they intersect (an open-ended task counts
 * from its start). `same_day`: some time is missing but they share a local
 * day. `null`: they do not coincide, or there is not even a date.
 */
function coincides(t: PlanTask, ev: PlanEvent): 'timed' | 'same_day' | null {
  if (ev.status === 'cancelled') return null;
  const [ts, te, es, ee] = [
    ms(t.startsAt),
    ms(t.endsAt),
    ms(ev.startsAt),
    ms(ev.endsAt),
  ];
  if (![ts, es, ee].some(Number.isNaN)) {
    const inside = Number.isNaN(te) ? ts >= es && ts < ee : ts < ee && te > es;
    return inside ? 'timed' : null;
  }
  const taskDays = occupiedDates(
    {
      date:
        t.date ??
        (t.startsAt
          ? utcToLocal(t.startsAt, t.timezone ?? undefined).date
          : null),
      endDate: t.endDate ?? null,
      endsAt: t.endsAt,
    },
    t.timezone ?? undefined,
  );
  const eventDays = new Set(
    occupiedDates(
      {
        date:
          ev.date ??
          (ev.startsAt
            ? utcToLocal(ev.startsAt, ev.timezone ?? undefined).date
            : null),
        endDate: ev.endDate ?? null,
        endsAt: ev.endsAt,
      },
      ev.timezone ?? undefined,
    ),
  );
  return taskDays.some(d => eventDays.has(d)) ? 'same_day' : null;
}

/** Warnings indexed by every task they involve. */
export function warningsByTask(
  warnings: PlanWarning[],
): Map<Uuid, PlanWarning[]> {
  const map = new Map<Uuid, PlanWarning[]>();
  for (const w of warnings) {
    for (const id of w.taskIds) {
      const list = map.get(id);
      if (list) list.push(w);
      else map.set(id, [w]);
    }
  }
  return map;
}
