/**
 * Work orders (M5): one company's or one person's tasks as a sheet they can
 * print, save as PDF or receive as text, after the member confirms sending.
 *
 * Built only from records the viewer already received (the server passed
 * them through `forViewer`), never from raw rows, and only with the fields
 * the member ticks. Some fields are never offered at all: the text of notes,
 * people's notes and descriptions, offer conditions, prices and costs.
 * Fields marked `membersOnly` start unticked and are dropped for guests even
 * if asked for. No hypothesis ever reaches a work order: it shows the plan.
 */
import type {
  Contact,
  LogisticsEvent,
  Resource,
  Role,
  Task,
  Uuid,
  Warehouse,
} from './contracts.ts';
import {ROUTES_REMINDER, type PlanWarning} from './conflicts.ts';
import {quantityLabel} from './inventory.ts';
import {TASK_KIND_LABEL, TASK_STATUS_LABEL} from './rules.ts';
import {addDays, DEFAULT_TIMEZONE, utcToLocal} from './time.ts';

export type WorkOrderField =
  | 'schedule'
  | 'venue'
  | 'materials'
  | 'contact'
  | 'dependencies'
  | 'contactPhone'
  | 'warehouseAddress'
  | 'resourceLocation'
  | 'observations';

export interface WorkOrderFieldInfo {
  id: WorkOrderField;
  label: string;
  hint: string | null;
  defaultOn: boolean;
  /** Free text or details only the team receives: off by default, never for guests. */
  membersOnly: boolean;
}

export const WORK_ORDER_FIELDS: readonly WorkOrderFieldInfo[] = [
  {
    id: 'schedule',
    label: 'Fecha y horario',
    hint: 'Las horas que aún no están confirmadas se marcan «por confirmar».',
    defaultOn: true,
    membersOnly: false,
  },
  {
    id: 'venue',
    label: 'Lugar',
    hint: null,
    defaultOn: true,
    membersOnly: false,
  },
  {
    id: 'materials',
    label: 'Materiales',
    hint: 'Nombre y cantidad de los recursos de cada tarea.',
    defaultOn: true,
    membersOnly: false,
  },
  {
    id: 'contact',
    label: 'Persona de contacto',
    hint: 'Solo el nombre.',
    defaultOn: true,
    membersOnly: false,
  },
  {
    id: 'dependencies',
    label: 'Qué tiene que terminar antes',
    hint: 'Incluye el título y la hora de esas tareas, aunque sean de otras empresas.',
    defaultOn: true,
    membersOnly: false,
  },
  {
    id: 'contactPhone',
    label: 'Teléfono de la persona de contacto',
    hint: 'Solo si esa persona está de acuerdo en que lo tenga la empresa.',
    defaultOn: false,
    membersOnly: true,
  },
  {
    id: 'warehouseAddress',
    label: 'Dirección del almacén',
    hint: 'Para recoger material.',
    defaultOn: false,
    membersOnly: true,
  },
  {
    id: 'resourceLocation',
    label: 'Ubicación del material en el almacén',
    hint: null,
    defaultOn: false,
    membersOnly: true,
  },
  {
    id: 'observations',
    label: 'Observaciones de la tarea',
    hint: 'Texto libre del equipo: léelo antes de enviarlo. Sale de Ox Eye: que no lleve datos de salud, de personas atendidas ni casos de Punto Violeta.',
    defaultOn: false,
    membersOnly: true,
  },
];

/** Shown under the field choice. */
export const WORK_ORDER_NEVER_NOTE =
  'Nunca se incluyen el texto de las notas, las notas y descripciones de las personas, las condiciones de las ofertas ni precios o costes.';
/** Footer of every work order: it is the plan at a moment, not a guarantee. */
export const WORK_ORDER_FOOTER =
  'Horario del plan en el momento de generar esta orden; puede cambiar. Ante cualquier duda, llama a la persona de contacto.';

export function defaultWorkOrderFields(): Set<WorkOrderField> {
  return new Set(WORK_ORDER_FIELDS.filter(f => f.defaultOn).map(f => f.id));
}

/** The fields actually used: unknown ids dropped; members-only dropped for guests. */
export function effectiveFields(
  chosen: Iterable<WorkOrderField>,
  role: Role,
): Set<WorkOrderField> {
  const allowed = new Map(WORK_ORDER_FIELDS.map(f => [f.id, f]));
  const out = new Set<WorkOrderField>();
  for (const id of chosen) {
    const info = allowed.get(id);
    if (!info) continue;
    if (info.membersOnly && role !== 'member') continue;
    out.add(id);
  }
  return out;
}

export type WorkOrderRecipient =
  | {kind: 'company'; id: Uuid; name: string}
  | {kind: 'contact'; id: Uuid; name: string};

/** The recipient's tasks (company or person in charge), in plan order. */
export function tasksForRecipient(
  tasks: Task[],
  recipient: WorkOrderRecipient,
): Task[] {
  return tasks.filter(t =>
    recipient.kind === 'company'
      ? t.company?.id === recipient.id
      : t.contact?.id === recipient.id,
  );
}

/** Ticked by default: what is still to be done (not finished, not cancelled). */
export function isDefaultSelected(task: Pick<Task, 'status'>): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

export interface WorkOrderMaterial {
  name: string;
  quantity: string;
  warehouse: string | null;
  address: string | null;
  location: string | null;
}

export interface WorkOrderItem {
  taskId: Uuid;
  title: string;
  kindLabel: string;
  statusLabel: string;
  cancelled: boolean;
  /** «Miércoles, 2 de diciembre de 2026», or null without a date (or without the field). */
  day: string | null;
  /** «08:00–10:00», «07:00 → jue 3 dic, 22:30», «Desde las 08:00», or null. */
  time: string | null;
  /** True when the time is only planned (not confirmed). */
  toConfirm: boolean;
  venue: string | null;
  eventName: string | null;
  materials: WorkOrderMaterial[];
  contact: {name: string; phone: string | null} | null;
  dependencies: {title: string; when: string | null}[];
  observations: string | null;
  heavyLoad: boolean;
  /** A delivery or transport during a public event: the routes reminder applies. */
  routes: boolean;
}

export interface WorkOrder {
  recipient: WorkOrderRecipient;
  title: string;
  fields: WorkOrderField[];
  items: WorkOrderItem[];
  /** The routes A/B/C and Carpa Amarilla reminder, when any item needs it. */
  routesNote: string | null;
  generatedBy: string;
  generatedAt: string;
  footer: string;
}

const CONFIRMED: ReadonlySet<Task['status']> = new Set([
  'confirmed',
  'in_progress',
  'done',
]);

function longLocalDate(date: string): string {
  const text = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NBSP = String.fromCharCode(0xa0);

/**
 * «jue 3 dic» (with the year when it is not the year of `from`). Its words
 * are joined by no-break spaces, so a narrow time column wraps a long time
 * only after the arrow or the comma, never inside the date.
 */
function compactLocalDate(date: string, from: string): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const get = (type: string) =>
    parts.find(p => p.type === type)?.value.replace('.', '') ?? '';
  const words = [get('weekday'), get('day'), get('month')];
  if (date.slice(0, 4) !== from.slice(0, 4)) words.push(date.slice(0, 4));
  return words.join(NBSP);
}

function slotText(
  task: Pick<Task, 'startsAt' | 'endsAt' | 'date' | 'timezone'>,
): {day: string | null; time: string | null} {
  const tz = task.timezone || DEFAULT_TIMEZONE;
  const start = task.startsAt ? utcToLocal(task.startsAt, tz) : null;
  const end = task.endsAt ? utcToLocal(task.endsAt, tz) : null;
  const date = task.date ?? start?.date ?? null;
  let time: string | null = null;
  if (start && end) {
    // Same day, or a plain overnight slot (22:00–02:00), reads as a range;
    // any other later end day is named so it is not misread, in the compact
    // form («07:00 → jue 3 dic, 22:30») that fits the order's time column.
    const overnight =
      end.date === addDays(start.date, 1) && end.time <= start.time;
    time =
      end.date === start.date || overnight
        ? `${start.time}–${end.time}`
        : `${start.time}${NBSP}→ ${compactLocalDate(end.date, start.date)}, ${end.time}`;
  } else if (start) time = `Desde las ${start.time}`;
  else if (end) time = `Hasta las ${end.time}`;
  return {day: date ? longLocalDate(date) : null, time};
}

export interface BuildWorkOrderInput {
  recipient: WorkOrderRecipient;
  /** The tasks chosen for the order, already as the viewer received them. */
  tasks: Task[];
  /** Every task the viewer has, to name dependencies. */
  allTasks: Task[];
  events: Pick<LogisticsEvent, 'id' | 'name'>[];
  resources: Resource[];
  warehouses: Warehouse[];
  contacts: Contact[];
  /** Plan warnings of the real plan (never a hypothesis). */
  warnings: PlanWarning[];
  fields: Iterable<WorkOrderField>;
  role: Role;
  generatedBy: string;
  /** Already formatted for display, e.g. «26 nov 2026, 10:32». */
  generatedAt: string;
}

export function buildWorkOrder(input: BuildWorkOrderInput): WorkOrder {
  const fields = effectiveFields(input.fields, input.role);
  const has = (f: WorkOrderField) => fields.has(f);
  const tasksById = new Map(input.allTasks.map(t => [t.id, t]));
  const eventsById = new Map(input.events.map(e => [e.id, e]));
  const resourcesById = new Map(input.resources.map(r => [r.id, r]));
  const warehousesById = new Map(input.warehouses.map(w => [w.id, w]));
  const contactsById = new Map(input.contacts.map(c => [c.id, c]));
  const routeTasks = new Set(
    input.warnings
      .filter(w => w.kind === 'route_window')
      .flatMap(w => w.taskIds),
  );

  const items: WorkOrderItem[] = input.tasks.map(task => {
    const slot = has('schedule') ? slotText(task) : {day: null, time: null};
    const materials: WorkOrderMaterial[] = has('materials')
      ? task.resourceIds.flatMap(id => {
          const r = resourcesById.get(id);
          if (!r) return [];
          const wh = r.warehouse ? warehousesById.get(r.warehouse.id) : null;
          return [
            {
              name: r.name,
              quantity: quantityLabel(r),
              warehouse: r.warehouse?.name ?? null,
              address: has('warehouseAddress') ? (wh?.address ?? null) : null,
              location: has('resourceLocation') ? r.location : null,
            },
          ];
        })
      : [];
    const person = task.contact ? contactsById.get(task.contact.id) : null;
    const contact =
      has('contact') && task.contact
        ? {
            name: task.contact.name,
            phone: has('contactPhone') ? (person?.phone ?? null) : null,
          }
        : null;
    const dependencies = has('dependencies')
      ? task.dependsOn.flatMap(id => {
          const dep = tasksById.get(id);
          if (!dep || dep.status === 'cancelled') return [];
          const s = slotText(dep);
          return [{title: dep.title, when: has('schedule') ? s.time : null}];
        })
      : [];
    return {
      taskId: task.id,
      title: task.title,
      kindLabel: TASK_KIND_LABEL[task.kind],
      statusLabel: TASK_STATUS_LABEL[task.status],
      cancelled: task.status === 'cancelled',
      day: slot.day,
      time: slot.time,
      toConfirm: has('schedule') && !!slot.time && !CONFIRMED.has(task.status),
      venue: has('venue') ? (task.venue?.name ?? null) : null,
      eventName: task.eventId
        ? (eventsById.get(task.eventId)?.name ?? null)
        : null,
      materials,
      contact,
      dependencies,
      observations: has('observations') ? task.notes : null,
      heavyLoad: task.heavyLoad === true,
      routes: routeTasks.has(task.id),
    };
  });

  return {
    recipient: input.recipient,
    title: `Orden de trabajo · ${input.recipient.name}`,
    fields: [...fields],
    items,
    routesNote: items.some(i => i.routes) ? ROUTES_REMINDER : null,
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
    footer: WORK_ORDER_FOOTER,
  };
}

/** Plain text for WhatsApp, e-mail or the system share sheet. */
export function workOrderText(order: WorkOrder): string {
  const lines: string[] = [order.title, ''];
  order.items.forEach((item, i) => {
    const head = `${i + 1}. ${item.title} (${item.kindLabel.toLowerCase()})`;
    lines.push(item.cancelled ? `${head} · CANCELADA` : head);
    const when = [item.day, item.time].filter(Boolean).join(', ');
    if (when) {
      lines.push(`   ${when}${item.toConfirm ? ' · por confirmar' : ''}`);
    }
    if (item.venue) lines.push(`   Lugar: ${item.venue}`);
    if (item.eventName) lines.push(`   Evento: ${item.eventName}`);
    for (const m of item.materials) {
      const where = [m.warehouse, m.location, m.address]
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `   Material: ${m.name} (${m.quantity})${where ? ` · ${where}` : ''}`,
      );
    }
    if (item.contact) {
      lines.push(
        `   Contacto: ${item.contact.name}${item.contact.phone ? ` · ${item.contact.phone}` : ''}`,
      );
    }
    for (const d of item.dependencies) {
      lines.push(
        `   Empieza cuando termine: ${d.title}${d.when ? ` (${d.when})` : ''}`,
      );
    }
    if (item.heavyLoad) lines.push('   Carga pesada');
    if (item.observations) lines.push(`   Observaciones: ${item.observations}`);
    lines.push('');
  });
  if (order.routesNote) lines.push(order.routesNote, '');
  lines.push(
    `Enviada por ${order.generatedBy} desde Ox Eye · ${order.generatedAt}.`,
    order.footer,
  );
  return lines.join('\n');
}
