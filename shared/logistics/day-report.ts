/**
 * Cierre de jornada (M6): what happened on one local day, built in the
 * browser from the records the viewer already received (the server's
 * `forViewer` copies, also from the device cache) plus that day's activity.
 * Pure: no React, no DOM, no network.
 *
 * Safety rules (M4–M5 audits):
 * - Input records are viewer copies, never raw rows; a guest's report has no
 *   notes and no hypotheses at all (`notes: null`, `hypotheses: null`).
 * - Notes are listed by `noteLabel` and status. Their text is included only
 *   when a member ticks that section (`includeText`); never in
 *   `dayReportText`.
 * - Hypotheses only by `hypothesisLabel`, open and applied apart, always
 *   called «hipótesis».
 * - A heavy task that finished without a declared subsoil review is listed
 *   as pending; a declared review is «declarada por X», never «verificada».
 * - Deliveries and transport inside an event's window carry the routes
 *   reminder (A/B/C, Carpa Amarilla). The threshold is only quoted through
 *   `SUBSOIL_THRESHOLD_NOTE`.
 */
import {
  LOAD_BEARING_KINDS,
  planWarnings,
  ROUTES_REMINDER,
  SUBSOIL_THRESHOLD_NOTE,
} from './conflicts.ts';
import type {
  ActivityEntry,
  Company,
  Contact,
  DelayHypothesis,
  IsoInstant,
  LocalDate,
  LogisticsEvent,
  Note,
  NoteKind,
  Offer,
  Resource,
  Role,
  Task,
  TaskKind,
  TaskStatus,
  UserRef,
  Uuid,
  Verification,
  Warehouse,
} from './contracts.ts';
import {hypothesisLabel, noteLabel} from './history.ts';
import {quantityLabel} from './inventory.ts';
import {
  missingForCompany,
  missingForContact,
  missingForEvent,
  missingForOffer,
  missingForResource,
  missingForTask,
  missingForWarehouse,
} from './quality.ts';
import {SUBSOIL_REVIEW_NOTE, TASK_KIND_LABEL} from './rules.ts';
import {addDays, localToUtc, occupiedDates} from './time.ts';

export type DayRecordType =
  | 'event'
  | 'task'
  | 'contact'
  | 'company'
  | 'offer'
  | 'warehouse'
  | 'resource'
  | 'note';

export const DAY_RECORD_TYPES: readonly DayRecordType[] = [
  'event',
  'task',
  'contact',
  'company',
  'offer',
  'warehouse',
  'resource',
  'note',
];

export const DAY_RECORD_LABEL: Record<DayRecordType, string> = {
  event: 'Eventos',
  task: 'Tareas',
  contact: 'Personas',
  company: 'Empresas y entidades',
  offer: 'Ofertas',
  warehouse: 'Almacenes',
  resource: 'Recursos',
  note: 'Notas',
};

/** Days after the report day listed under «Para los próximos días». */
export const NEXT_DAYS = 2;
const NEXT_TASKS_MAX = 50;

export interface DayCount {
  created: number;
  modified: number;
  /** Only known from the activity log (0 when it was not available). */
  deleted: number;
}

export interface DayRecordLine {
  type: DayRecordType;
  id: Uuid;
  /** The record's name; never free text. */
  label: string;
  /** Company, venue, kind or quantity; never free text. */
  detail: string | null;
  change: 'created' | 'modified';
  verification: Verification;
  /** What is still missing (`quality.ts`), «validación» included. */
  missing: string[];
  by: UserRef;
  at: IsoInstant;
  isDemo: boolean;
}

export type DayNoteKind = Exclude<NoteKind, 'note'>;

export const DAY_NOTE_KINDS: readonly DayNoteKind[] = [
  'incident',
  'decision',
  'open_question',
  'feature_idea',
];

export const DAY_NOTE_TITLE: Record<DayNoteKind, string> = {
  incident: 'Incidencias',
  decision: 'Decisiones',
  open_question: 'Preguntas abiertas',
  feature_idea: 'Ideas para la herramienta',
};

export interface DayNoteLine {
  id: Uuid;
  /** `noteLabel`: kind and what it is about, never the text. */
  label: string;
  /** «Abierta», «Resuelta», «Sin respuesta», «Respondida»; null otherwise. */
  status: string | null;
  by: UserRef;
  at: IsoInstant;
  /** Created before the report day (still open). */
  earlier: boolean;
  /** Only when a member included this section's text. */
  text: string | null;
}

export interface DayNoteSection {
  kind: DayNoteKind;
  title: string;
  items: DayNoteLine[];
  textIncluded: boolean;
}

export interface DayHypothesisLine {
  id: Uuid;
  /** `hypothesisLabel`; never the note. */
  label: string;
  by: UserRef;
  at: IsoInstant;
  appliedBy: UserRef | null;
  appliedAt: IsoInstant | null;
}

export const HYPOTHESIS_OPEN_TITLE =
  'Hipótesis exploradas (no cambian el plan)';
export const HYPOTHESIS_APPLIED_TITLE = 'Hipótesis aplicadas al plan';

export type SubsoilState =
  /** Heavy, still to happen, no review declared. */
  | 'pending'
  /** Heavy, finished, no review declared: finishing is not reviewing. */
  | 'finished_unreviewed'
  /** A member declared the review (never «verified»). */
  | 'declared'
  /** Load-bearing kind and nobody knows yet whether it is heavy. */
  | 'unknown_load';

export const SUBSOIL_STATE_LABEL: Record<SubsoilState, string> = {
  pending: 'Revisión del subsuelo pendiente',
  finished_unreviewed: 'Terminó sin revisión del subsuelo declarada',
  declared: 'Revisión del subsuelo declarada',
  unknown_load: 'Falta saber si lleva carga pesada',
};

export interface DaySubsoilLine {
  taskId: Uuid;
  title: string;
  date: LocalDate | null;
  state: SubsoilState;
  /** Who declared it (state `declared`): shown as «declarada por X». */
  declaredBy: UserRef | null;
  declaredAt: IsoInstant | null;
}

export interface DayRouteLine {
  taskIds: Uuid[];
  title: string;
  detail: string;
}

export interface DayTaskLine {
  id: Uuid;
  title: string;
  kind: TaskKind;
  kindLabel: string;
  status: TaskStatus;
  date: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  venue: string | null;
  company: string | null;
  verification: Verification;
}

export interface DayPending {
  total: number;
  validated: number;
  /** 0–100 rounded; null when nothing is recorded. */
  verifiedPercent: number | null;
  /** 100 − verified; null when nothing is recorded. */
  pendingPercent: number | null;
  /** Records still missing something; events and tasks first. */
  incomplete: {
    type: DayRecordType;
    id: Uuid;
    label: string;
    missing: string[];
  }[];
}

export interface DayReport {
  date: LocalDate;
  timezone: string;
  generatedAt: IsoInstant;
  generatedBy: UserRef;
  viewerRole: Role;
  /** False when the day's activity could not be loaded (offline). */
  activityAvailable: boolean;
  counts: Record<DayRecordType, DayCount>;
  contributors: {user: UserRef; changes: number}[];
  /** Created or modified that day, per section. */
  records: {
    events: DayRecordLine[];
    tasks: DayRecordLine[];
    contacts: DayRecordLine[];
    companies: DayRecordLine[];
    offers: DayRecordLine[];
    warehouses: DayRecordLine[];
    resources: DayRecordLine[];
  };
  pending: DayPending;
  /** Null for guests («Visible para el equipo»). */
  notes: DayNoteSection[] | null;
  /** Plain notes of the day: counted, never listed. Null for guests. */
  otherNotes: number | null;
  /** Null for guests. */
  hypotheses: {open: DayHypothesisLine[]; applied: DayHypothesisLine[]} | null;
  safety: {
    subsoil: DaySubsoilLine[];
    routes: DayRouteLine[];
    subsoilNote: string;
    thresholdNote: string;
    routesNote: string;
  };
  /** Tasks of the day still not done. */
  unfinished: DayTaskLine[];
  /** Live tasks on the next NEXT_DAYS days. */
  nextTasks: DayTaskLine[];
}

export interface DayReportInput {
  date: LocalDate;
  timezone: string;
  viewer: UserRef & {role: Role};
  generatedAt: IsoInstant;
  /** That day's activity, or null when it could not be loaded. */
  activity: readonly ActivityEntry[] | null;
  events: readonly LogisticsEvent[];
  tasks: readonly Task[];
  contacts: readonly Contact[];
  companies: readonly Company[];
  offers: readonly Offer[];
  warehouses: readonly Warehouse[];
  resources: readonly Resource[];
  notes: readonly Note[];
  hypotheses: readonly DelayHypothesis[];
  /** Note sections whose text a member chose to include. */
  includeText?: Partial<Record<DayNoteKind, boolean>>;
}

/** `from` ≤ instant < `to` for one local day (for the activity route). */
export function dayBounds(
  date: LocalDate,
  timezone: string,
): {from: IsoInstant; to: IsoInstant} {
  return {
    from: localToUtc(date, '00:00', timezone),
    to: localToUtc(addDays(date, 1), '00:00', timezone),
  };
}

const inRange = (iso: string | null, from: number, to: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= from && t < to;
};

const withValidation = (missing: string[], v: Verification) =>
  v === 'validated' ? missing : [...missing, 'validación'];

interface Described {
  type: DayRecordType;
  record: {
    id: Uuid;
    createdAt: IsoInstant;
    updatedAt: IsoInstant;
    createdBy: UserRef;
    updatedBy: UserRef;
    verification: Verification;
    isDemo: boolean;
  };
  label: string;
  detail: string | null;
  missing: string[];
}

function describeAll(input: DayReportInput): Described[] {
  const out: Described[] = [];
  for (const e of input.events) {
    out.push({
      type: 'event',
      record: e,
      label: e.name,
      detail: e.venue?.name ?? null,
      missing: withValidation(missingForEvent(e), e.verification),
    });
  }
  for (const t of input.tasks) {
    out.push({
      type: 'task',
      record: t,
      label: t.title,
      detail: [TASK_KIND_LABEL[t.kind], t.company?.name]
        .filter(Boolean)
        .join(' · '),
      missing: withValidation(missingForTask(t), t.verification),
    });
  }
  for (const c of input.contacts) {
    out.push({
      type: 'contact',
      record: c,
      label: c.name,
      detail: [c.role, c.company?.name].filter(Boolean).join(' · ') || null,
      missing: withValidation(missingForContact(c), c.verification),
    });
  }
  for (const c of input.companies) {
    out.push({
      type: 'company',
      record: c,
      label: c.name,
      detail: null,
      missing: withValidation(missingForCompany(c), c.verification),
    });
  }
  for (const o of input.offers) {
    out.push({
      type: 'offer',
      record: o,
      label: o.name,
      detail: o.company.name || null,
      missing: withValidation(missingForOffer(o), o.verification),
    });
  }
  for (const w of input.warehouses) {
    out.push({
      type: 'warehouse',
      record: w,
      label: w.name,
      detail: null,
      missing: withValidation(missingForWarehouse(w), w.verification),
    });
  }
  for (const r of input.resources) {
    out.push({
      type: 'resource',
      record: r,
      label: r.name,
      detail:
        [quantityLabel(r), r.warehouse?.name ?? r.company?.name]
          .filter(Boolean)
          .join(' · ') || null,
      missing: withValidation(missingForResource(r), r.verification),
    });
  }
  return out;
}

const emptyCounts = (): Record<DayRecordType, DayCount> =>
  Object.fromEntries(
    DAY_RECORD_TYPES.map(t => [t, {created: 0, modified: 0, deleted: 0}]),
  ) as Record<DayRecordType, DayCount>;

const isDayType = (t: string): t is DayRecordType =>
  (DAY_RECORD_TYPES as readonly string[]).includes(t);

function taskLine(t: Task): DayTaskLine {
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    kindLabel: TASK_KIND_LABEL[t.kind],
    status: t.status,
    date: t.date,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    timezone: t.timezone,
    venue: t.venue?.name ?? null,
    company: t.company?.name ?? null,
    verification: t.verification,
  };
}

const byStart = (a: DayTaskLine, b: DayTaskLine) =>
  (a.date ?? '').localeCompare(b.date ?? '') ||
  (a.startsAt ?? '￿').localeCompare(b.startsAt ?? '￿') ||
  a.title.localeCompare(b.title, 'es');

function noteStatus(n: Note): string | null {
  if (n.kind === 'incident') return n.resolved ? 'Resuelta' : 'Abierta';
  if (n.kind === 'open_question') {
    return n.resolved ? 'Respondida' : 'Sin respuesta';
  }
  return null;
}

export function buildDayReport(input: DayReportInput): DayReport {
  const {date, timezone, viewer} = input;
  const {from, to} = dayBounds(date, timezone);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const member = viewer.role === 'member';

  // ------------------------------------------------ what changed that day
  const described = describeAll(input);
  const counts = emptyCounts();
  const change = new Map<
    string,
    {change: 'created' | 'modified'; by: UserRef; at: IsoInstant}
  >();
  const contributors = new Map<string, {user: UserRef; changes: number}>();
  const activityAvailable = input.activity !== null;

  if (input.activity) {
    const seen = new Map<string, Set<string>>();
    // Oldest first, so the latest actor wins.
    const ordered = [...input.activity]
      .filter(a => inRange(a.at, fromMs, toMs))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const a of ordered) {
      const who = contributors.get(a.user.id) ?? {user: a.user, changes: 0};
      who.changes++;
      contributors.set(a.user.id, who);
      if (!isDayType(a.entityType)) continue;
      const key = `${a.entityType}:${a.entityId}`;
      const actions = seen.get(key) ?? new Set<string>();
      actions.add(a.action);
      seen.set(key, actions);
      const prev = change.get(key);
      change.set(key, {
        change:
          a.action === 'create' || prev?.change === 'created'
            ? 'created'
            : 'modified',
        by: a.user,
        at: a.at,
      });
    }
    for (const [key, actions] of seen) {
      const type = key.slice(0, key.indexOf(':')) as DayRecordType;
      if (actions.has('create')) counts[type].created++;
      else if (actions.has('update')) counts[type].modified++;
      if (actions.has('delete')) counts[type].deleted++;
    }
  } else {
    const all = [
      ...described.map(d => ({type: d.type, r: d.record})),
      ...input.notes.map(n => ({type: 'note' as const, r: n})),
    ];
    for (const {type, r} of all) {
      const key = `${type}:${r.id}`;
      if (inRange(r.createdAt, fromMs, toMs)) {
        counts[type].created++;
        change.set(key, {change: 'created', by: r.createdBy, at: r.createdAt});
      } else if (inRange(r.updatedAt, fromMs, toMs)) {
        counts[type].modified++;
        change.set(key, {change: 'modified', by: r.updatedBy, at: r.updatedAt});
      } else {
        continue;
      }
      const user = change.get(key)!.by;
      const who = contributors.get(user.id) ?? {user, changes: 0};
      who.changes++;
      contributors.set(user.id, who);
    }
  }

  const lines = (type: DayRecordType, only?: 'created'): DayRecordLine[] =>
    described
      .filter(d => d.type === type)
      .flatMap(d => {
        const c = change.get(`${type}:${d.record.id}`);
        if (!c || (only && c.change !== only)) return [];
        return [
          {
            type,
            id: d.record.id,
            label: d.label,
            detail: d.detail,
            change: c.change,
            verification: d.record.verification,
            missing: d.missing,
            by: c.by,
            at: c.at,
            isDemo: d.record.isDemo,
          },
        ];
      })
      .sort(
        (a, b) =>
          (a.change === b.change ? 0 : a.change === 'created' ? -1 : 1) ||
          a.label.localeCompare(b.label, 'es'),
      );

  // ------------------------------------------------ information still pending
  const total = described.length;
  const validated = described.filter(
    d => d.record.verification === 'validated',
  ).length;
  const verifiedPercent = total ? Math.round((validated / total) * 100) : null;
  const firstTypes: ReadonlySet<DayRecordType> = new Set(['event', 'task']);
  const incomplete = described
    .filter(d => d.missing.length)
    .map(d => ({
      type: d.type,
      id: d.record.id,
      label: d.label,
      missing: d.missing,
    }))
    .sort(
      (a, b) =>
        Number(firstTypes.has(b.type)) - Number(firstTypes.has(a.type)) ||
        b.missing.length - a.missing.length ||
        a.label.localeCompare(b.label, 'es'),
    );

  // ------------------------------------------------ notes (members only)
  let notes: DayNoteSection[] | null = null;
  let otherNotes: number | null = null;
  if (member) {
    notes = DAY_NOTE_KINDS.map(kind => {
      const textIncluded = input.includeText?.[kind] === true;
      const resolvable = kind === 'incident' || kind === 'open_question';
      const items = input.notes
        .filter(n => n.kind === kind)
        .filter(
          n =>
            inRange(n.createdAt, fromMs, toMs) ||
            (resolvable && !n.resolved && Date.parse(n.createdAt) < fromMs),
        )
        .map((n): DayNoteLine => ({
          id: n.id,
          label: noteLabel(n),
          status: noteStatus(n),
          by: n.createdBy,
          at: n.createdAt,
          earlier: Date.parse(n.createdAt) < fromMs,
          text: textIncluded && !n.restricted ? n.text : null,
        }))
        .sort(
          (a, b) =>
            Number(a.earlier) - Number(b.earlier) || a.at.localeCompare(b.at),
        );
      return {kind, title: DAY_NOTE_TITLE[kind], items, textIncluded};
    });
    otherNotes = input.notes.filter(
      n => n.kind === 'note' && inRange(n.createdAt, fromMs, toMs),
    ).length;
  }

  // ------------------------------------------------ hypotheses (members only)
  let hypotheses: DayReport['hypotheses'] = null;
  if (member) {
    const line = (h: DelayHypothesis): DayHypothesisLine => ({
      id: h.id,
      label: hypothesisLabel(h),
      by: h.createdBy,
      at: h.createdAt,
      appliedBy: h.appliedBy,
      appliedAt: h.appliedAt,
    });
    hypotheses = {
      open: input.hypotheses
        .filter(h => !h.appliedAt && inRange(h.createdAt, fromMs, toMs))
        .map(line)
        .sort((a, b) => a.at.localeCompare(b.at)),
      applied: input.hypotheses
        .filter(h => inRange(h.appliedAt, fromMs, toMs))
        .map(line)
        .sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? '')),
    };
  }

  // ------------------------------------------------ plan: today and next days
  const lastNext = addDays(date, NEXT_DAYS);
  const days = (t: Task) => occupiedDates(t, t.timezone);
  const onDay = (t: Task) => days(t).includes(date);
  const inWindow = (t: Task) => days(t).some(d => d >= date && d <= lastNext);
  const onNext = (t: Task) => days(t).some(d => d > date && d <= lastNext);
  const live = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';

  const subsoil: DaySubsoilLine[] = input.tasks
    .filter(t => t.status !== 'cancelled' && inWindow(t))
    .flatMap((t): DaySubsoilLine[] => {
      let state: SubsoilState | null = null;
      if (t.heavyLoad === true) {
        state = t.subsoilReview
          ? 'declared'
          : t.status === 'done'
            ? 'finished_unreviewed'
            : 'pending';
      } else if (t.heavyLoad === null && LOAD_BEARING_KINDS.has(t.kind)) {
        state = 'unknown_load';
      }
      if (!state) return [];
      return [
        {
          taskId: t.id,
          title: t.title,
          date: t.date,
          state,
          declaredBy:
            state === 'declared' ? (t.subsoilReview?.by ?? null) : null,
          declaredAt:
            state === 'declared' ? (t.subsoilReview?.at ?? null) : null,
        },
      ];
    })
    .sort((a, b) => {
      const order: Record<SubsoilState, number> = {
        finished_unreviewed: 0,
        pending: 1,
        unknown_load: 2,
        declared: 3,
      };
      return (
        order[a.state] - order[b.state] ||
        (a.date ?? '').localeCompare(b.date ?? '') ||
        a.title.localeCompare(b.title, 'es')
      );
    });

  const windowIds = new Set(input.tasks.filter(inWindow).map(t => t.id));
  const routes: DayRouteLine[] = planWarnings(
    [...input.tasks],
    [...input.events],
    [...input.resources],
  )
    .filter(
      w => w.kind === 'route_window' && w.taskIds.some(id => windowIds.has(id)),
    )
    .map(w => ({taskIds: w.taskIds, title: w.title, detail: w.detail}));

  const unfinished = input.tasks
    .filter(t => live(t) && onDay(t))
    .map(taskLine)
    .sort(byStart);
  const nextTasks = input.tasks
    .filter(t => live(t) && onNext(t))
    .map(taskLine)
    .sort(byStart)
    .slice(0, NEXT_TASKS_MAX);

  return {
    date,
    timezone,
    generatedAt: input.generatedAt,
    generatedBy: {id: viewer.id, displayName: viewer.displayName},
    viewerRole: viewer.role,
    activityAvailable,
    counts,
    contributors: [...contributors.values()].sort(
      (a, b) =>
        b.changes - a.changes ||
        a.user.displayName.localeCompare(b.user.displayName, 'es'),
    ),
    records: {
      events: lines('event'),
      tasks: lines('task'),
      contacts: lines('contact', 'created'),
      companies: lines('company', 'created'),
      offers: lines('offer', 'created'),
      warehouses: lines('warehouse', 'created'),
      resources: lines('resource'),
    },
    pending: {
      total,
      validated,
      verifiedPercent,
      pendingPercent: verifiedPercent === null ? null : 100 - verifiedPercent,
      incomplete,
    },
    notes,
    otherNotes,
    hypotheses,
    safety: {
      subsoil,
      routes,
      subsoilNote: SUBSOIL_REVIEW_NOTE,
      thresholdNote: SUBSOIL_THRESHOLD_NOTE,
      routesNote: ROUTES_REMINDER,
    },
    unfinished,
    nextTasks,
  };
}

/** «declarada por Elvis», never «verificada». */
export function subsoilLineLabel(line: DaySubsoilLine): string {
  if (line.state === 'declared' && line.declaredBy) {
    return `Revisión del subsuelo declarada por ${line.declaredBy.displayName}`;
  }
  return SUBSOIL_STATE_LABEL[line.state];
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * «Copiar resumen»: a short plain-text summary for a message. Counts,
 * record names and labels only: never note text, observations, contact
 * details or prices, whatever the screen includes.
 */
export function dayReportText(report: DayReport, dateLabel: string): string {
  const out: string[] = [`Cierre de jornada · ${dateLabel}`];
  const c = report.counts;
  const parts = (
    [
      ['event', 'evento', 'eventos'],
      ['task', 'tarea', 'tareas'],
      ['contact', 'persona', 'personas'],
      ['company', 'empresa o entidad', 'empresas y entidades'],
      ['offer', 'oferta', 'ofertas'],
      ['resource', 'recurso', 'recursos'],
    ] as const
  )
    .map(([type, one, many]) => {
      const n = c[type];
      if (!n.created && !n.modified) return null;
      const bits = [
        n.created ? `${n.created} de alta` : null,
        n.modified ? `${n.modified} con cambios` : null,
      ].filter(Boolean);
      return `${plural(n.created + n.modified, one, many)} (${bits.join(', ')})`;
    })
    .filter(Boolean);
  out.push(
    parts.length
      ? `Registros: ${parts.join('; ')}.`
      : 'Sin registros nuevos ni cambios.',
  );
  if (report.pending.pendingPercent !== null) {
    out.push(
      `Información pendiente de verificar: ${report.pending.pendingPercent} %.`,
    );
  }
  if (report.notes) {
    for (const s of report.notes) {
      if (!s.items.length) continue;
      out.push(`${s.title}:`);
      for (const n of s.items) {
        out.push(`- ${n.label}${n.status ? ` (${n.status})` : ''}`);
      }
    }
  }
  if (report.hypotheses?.applied.length) {
    out.push(`${HYPOTHESIS_APPLIED_TITLE}:`);
    for (const h of report.hypotheses.applied) {
      out.push(`- Hipótesis: ${h.label}`);
    }
  }
  const pendingSubsoil = report.safety.subsoil.filter(
    s => s.state === 'pending' || s.state === 'finished_unreviewed',
  );
  if (pendingSubsoil.length) {
    out.push('Subsuelo:');
    for (const s of pendingSubsoil) {
      out.push(`- ${s.title}: ${subsoilLineLabel(s)}`);
    }
  }
  if (report.safety.routes.length) {
    out.push(
      `Rutas de emergencia y Carpa Amarilla: ${plural(report.safety.routes.length, 'recordatorio', 'recordatorios')}.`,
    );
  }
  if (report.nextTasks.length) {
    out.push(
      `Próximos días: ${plural(report.nextTasks.length, 'tarea prevista', 'tareas previstas')}.`,
    );
  }
  out.push('Resumen generado con OxEye. Ayuda a decidir; no certifica.');
  return out.join('\n');
}
