/**
 * Create, edit or view a task in a sheet.
 *
 * - Only the title is required; event, venue, times and company can wait
 *   («Pendiente de verificar»). A task may stand alone, without an event.
 * - Heavy load is asked only for set-up, delivery, transport and
 *   dismantling, with three answers: «No lo sé» is never taken as light.
 * - «Empieza cuando termine…» lists tasks of the same event or day; a choice
 *   that would close a loop is disabled before anything is sent.
 * - Warnings for this task (shared `planWarnings`) update while editing.
 * - Same guarantees as events: version conflicts never overwrite, guests get
 *   a read-only view, unsaved values survive a session expiry.
 */
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  planWarnings,
  type PlanTask,
} from '../../../shared/logistics/conflicts.ts';
import type {
  Contact,
  DataSource,
  LogisticsEvent,
  Resource,
  Task,
  TaskInput,
  TaskKind,
  TaskStatus,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {quantityLabel} from '../../../shared/logistics/inventory.ts';
import {
  NOTE_PRIVACY_HINT,
  TASK_KINDS,
  TASK_STATUSES,
} from '../../../shared/logistics/rules.ts';
import {findCycle} from '../../../shared/logistics/schedule.ts';
import {
  DEFAULT_TIMEZONE,
  eachDate,
  slotToInstants,
} from '../../../shared/logistics/time.ts';
import {errorMessage, isApiError} from '../api/client';
import type {TaskPrefill} from '../common/actions';
import {RecordHistory} from '../common/RecordHistory';
import {RecordNotes} from '../common/RecordNotes';
import {HeavyLoadValue, KindLabel, TaskStatusChip} from '../common/TaskChips';
import {TimeWindow, windowText} from '../common/TimeWindow';
import {
  WARNINGS_HELP,
  WarningList,
  warningsSummary,
} from '../common/WarningList';
import {usePlan} from '../common/usePlan';
import {VerificationChip, DemoChip} from '../events/EventChips';
import {
  ConflictNotice,
  DiscardStrip,
  Provenance,
  QualityFields,
  ReadOnlyNotice,
  useAlertFocus,
} from '../forms/FormParts';
import {
  SlotFields,
  slotChanged,
  slotInput,
  validateSlot,
  type SlotValues,
} from '../forms/SlotFields';
import {SOURCE_LABEL, sortEvents, VERIFICATION_LABEL} from '../lib/events';
import {dayMonthShort, longDate} from '../lib/format';
import {clearRescue, saveRescue} from '../lib/rescue';
import {
  dependentsOf,
  HEAVY_LOAD_HELP,
  isLoadBearing,
  nameKey,
  recordDate,
  recordDays,
  recordSlot,
  sortTasks,
  TASK_KIND_HELP,
  TASK_KIND_ICON,
  TASK_KIND_LABEL,
  TASK_STATUS_HELP,
  TASK_STATUS_LABEL,
} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {TaskContactField} from './TaskContactField';
import {TaskResourcesField} from './TaskResourcesField';
import {Value} from '../contacts/DirectoryParts';
import {ReachOut} from '../contacts/ReachOut';
import {LoadNoteTip} from '../inventory/ResourceParts';
import {useActions} from '../common/actions';
import {
  Button,
  Chip,
  Field,
  HelpTip,
  Icon,
  Input,
  Pending,
  Segmented,
  Select,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';

export type RescuedValues = Record<string, unknown>;

export type TaskSheetMode =
  | {kind: 'create'; prefill?: TaskPrefill; rescued?: RescuedValues}
  | {kind: 'edit'; task: Task; rescued?: RescuedValues}
  | {kind: 'view'; task: Task};

type Heavy = 'yes' | 'no' | 'unknown';

interface FormValues extends SlotValues {
  title: string;
  kind: TaskKind;
  eventId: string;
  venueName: string;
  companyName: string;
  /** Person to call about this task; '' = none. */
  contactId: string;
  status: TaskStatus;
  heavy: Heavy;
  dependsOn: string[];
  /** Inventory resources the task counts on. */
  resourceIds: string[];
  notes: string;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  title: '',
  kind: 'assembly',
  eventId: '',
  venueName: '',
  companyName: '',
  contactId: '',
  date: '',
  endDate: '',
  multiDay: false,
  startTime: '',
  endTime: '',
  status: 'planned',
  heavy: 'unknown',
  dependsOn: [],
  resourceIds: [],
  notes: '',
  source: null,
  verification: 'draft',
};

const toHeavy = (v: boolean | null): Heavy =>
  v === true ? 'yes' : v === false ? 'no' : 'unknown';
const fromHeavy = (v: Heavy): boolean | null =>
  v === 'yes' ? true : v === 'no' ? false : null;

function valuesFromTask(task: Task): FormValues {
  const slot = recordSlot(task);
  return {
    title: task.title,
    kind: task.kind,
    eventId: task.eventId ?? '',
    venueName: task.venue?.name ?? '',
    companyName: task.company?.name ?? '',
    contactId: task.contact?.id ?? '',
    date: slot.date ?? '',
    endDate: task.endDate ?? '',
    multiDay: !!task.endDate,
    startTime: slot.startTime ?? '',
    endTime: slot.endTime ?? '',
    status: task.status,
    heavy: toHeavy(task.heavyLoad),
    dependsOn: [...task.dependsOn],
    resourceIds: [...(task.resourceIds ?? [])],
    notes: task.notes ?? '',
    source: task.source,
    verification: task.verification,
  };
}

function valuesFromPrefill(
  prefill: TaskPrefill | undefined,
  events: LogisticsEvent[],
): FormValues {
  if (!prefill) return EMPTY;
  const event = prefill.eventId
    ? events.find(e => e.id === prefill.eventId)
    : undefined;
  return {
    ...EMPTY,
    eventId: event?.id ?? '',
    venueName: prefill.venueName ?? event?.venue?.name ?? '',
    date: prefill.date ?? (event ? (recordDate(event) ?? '') : ''),
    companyName: prefill.companyName ?? '',
    contactId: prefill.contactId ?? '',
    resourceIds: prefill.resourceIds ? [...prefill.resourceIds] : [],
  };
}

const TEXT_KEYS = [
  'title',
  'eventId',
  'venueName',
  'companyName',
  'contactId',
  'date',
  'endDate',
  'startTime',
  'endTime',
  'notes',
] as const;

function valuesFromRescue(
  raw: RescuedValues,
  fallback: FormValues,
): FormValues {
  const oneOf = <T extends string>(
    value: unknown,
    allowed: readonly string[],
  ) =>
    typeof value === 'string' && allowed.includes(value)
      ? (value as T)
      : undefined;
  const out: FormValues = {...fallback};
  for (const key of TEXT_KEYS) {
    if (typeof raw[key] === 'string') out[key] = raw[key];
  }
  if (typeof raw.multiDay === 'boolean') out.multiDay = raw.multiDay;
  if (
    Array.isArray(raw.dependsOn) &&
    raw.dependsOn.every(d => typeof d === 'string')
  ) {
    out.dependsOn = raw.dependsOn as string[];
  }
  if (
    Array.isArray(raw.resourceIds) &&
    raw.resourceIds.every(d => typeof d === 'string')
  ) {
    out.resourceIds = raw.resourceIds as string[];
  }
  out.kind = oneOf<TaskKind>(raw.kind, TASK_KINDS) ?? fallback.kind;
  out.status = oneOf<TaskStatus>(raw.status, TASK_STATUSES) ?? fallback.status;
  out.heavy =
    oneOf<Heavy>(raw.heavy, ['yes', 'no', 'unknown']) ?? fallback.heavy;
  out.source =
    raw.source === null
      ? null
      : (oneOf<DataSource>(raw.source, Object.keys(SOURCE_LABEL)) ??
        fallback.source);
  out.verification =
    oneOf<Verification>(raw.verification, Object.keys(VERIFICATION_LABEL)) ??
    fallback.verification;
  return out;
}

interface FormSnapshot {
  values: FormValues;
  base: Task | null;
  dirty: boolean;
  userId: string | null;
  orgId: string | null;
}

function rescueForm(form: FormSnapshot): void {
  if (!form.dirty || !form.userId) return;
  saveRescue({
    entity: 'task',
    userId: form.userId,
    orgId: form.orgId,
    base: form.base,
    values: form.values,
    savedAt: new Date().toISOString(),
  });
}

type Errors = Partial<Record<keyof FormValues | 'form', string>>;

const SERVER_FIELD: Record<string, keyof FormValues> = {
  title: 'title',
  kind: 'kind',
  eventId: 'eventId',
  venueName: 'venueName',
  venue: 'venueName',
  companyName: 'companyName',
  companyId: 'companyName',
  company: 'companyName',
  contactId: 'contactId',
  contact: 'contactId',
  date: 'date',
  endDate: 'endDate',
  startTime: 'startTime',
  endTime: 'endTime',
  startsAt: 'startTime',
  endsAt: 'endTime',
  status: 'status',
  heavyLoad: 'heavy',
  dependsOn: 'dependsOn',
  resourceIds: 'resourceIds',
  notes: 'notes',
  source: 'source',
  verification: 'verification',
};

const DOM_ID: Partial<Record<keyof FormValues, string>> = {
  title: 'title',
  eventId: 'event',
  venueName: 'venue',
  companyName: 'company',
  contactId: 'contact',
  date: 'date',
  endDate: 'enddate',
  startTime: 'start',
  endTime: 'end',
  notes: 'notes',
};

function validate(v: FormValues): Errors {
  const errors: Errors = {};
  if (!v.title.trim()) {
    errors.title = 'Escribe qué hay que hacer, aunque sea provisional.';
  }
  return {...errors, ...validateSlot(v)};
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const KIND_OPTIONS = TASK_KINDS.map(k => ({
  value: k,
  label: TASK_KIND_LABEL[k],
  title: TASK_KIND_HELP[k],
  icon: TASK_KIND_ICON[k],
}));
const STATUS_OPTIONS = TASK_STATUSES.map(s => ({
  value: s,
  label: TASK_STATUS_LABEL[s],
  title: TASK_STATUS_HELP[s],
}));
const HEAVY_OPTIONS: {value: Heavy; label: string}[] = [
  {value: 'yes', label: 'Sí'},
  {value: 'no', label: 'No'},
  {value: 'unknown', label: 'No lo sé'},
];

const DRAFT_ID = '__draft__';

function showsHeavyLoad(v: {kind: TaskKind; heavy: Heavy}): boolean {
  return isLoadBearing(v.kind) || v.heavy === 'yes';
}

/**
 * Venue or company as the server will resolve the typed name (find or create,
 * case-insensitive), so the warnings preview matches what will be saved.
 */
function refByName(
  name: string,
  list: {id: string; name: string}[],
): {id: string; name: string} | null {
  const key = nameKey(name);
  if (!key) return null;
  const found = list.find(x => nameKey(x.name) === key);
  return found
    ? {id: found.id, name: found.name}
    : {id: `new:${key}`, name: name.trim()};
}

export interface TaskSheetProps {
  mode: TaskSheetMode | null;
  onClose: () => void;
  /** Told whether the form has unsaved changes (so it is never replaced). */
  onDirty?: (dirty: boolean) => void;
}

export const TaskSheet: React.FC<TaskSheetProps> = ({
  mode,
  onClose,
  onDirty,
}) => {
  if (!mode) return null;
  if (mode.kind === 'view') {
    return <TaskView task={mode.task} onClose={onClose} />;
  }
  return <TaskForm mode={mode} onClose={onClose} onDirty={onDirty} />;
};

// ---------------------------------------------------------------- view

const TaskView: React.FC<{task: Task; onClose: () => void}> = ({
  task: opened,
  onClose,
}) => {
  // Follow the live copy, so a guest sees updates while the sheet is open.
  const live = useLogisticsStore(s => s.tasks.find(t => t.id === opened.id));
  const task = live ?? opened;
  const tasks = useLogisticsStore(s => s.tasks);
  const events = useLogisticsStore(s => s.events);
  const plan = usePlan();
  const warnings = plan.byTask.get(task.id) ?? [];
  const event = events.find(e => e.id === task.eventId);
  const {date} = recordSlot(task);
  const deps = task.dependsOn
    .map(id => plan.tasksById.get(id))
    .filter((t): t is Task => !!t);
  const dependents = dependentsOf(tasks, task.id);

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-task-sheet"
      eyebrow={<>Tarea · {TASK_KIND_LABEL[task.kind]}</>}
      title={task.title}
      meta={
        <>
          {task.isDemo && <DemoChip />}
          <TaskStatusChip status={task.status} />
          <VerificationChip verification={task.verification} />
        </>
      }
      footer={
        <Button variant="primary" onClick={onClose} id="lx-task-close">
          Cerrar
        </Button>
      }
    >
      <ReadOnlyNotice />
      <dl className="lx-detail">
        <div>
          <dt>Tipo</dt>
          <dd>
            <KindLabel kind={task.kind} />
          </dd>
        </div>
        <div>
          <dt>Evento</dt>
          <dd>{event ? event.name : 'Tarea suelta, sin evento'}</dd>
        </div>
        <div>
          <dt>Lugar</dt>
          <dd>{task.venue?.name ?? <Pending />}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{date ? longDate(date) : <Pending />}</dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd>
            <TimeWindow record={task} />
          </dd>
        </div>
        <div>
          <dt>Empresa</dt>
          <dd>{task.company?.name ?? <Pending />}</dd>
        </div>
        <div>
          <dt>Persona de contacto</dt>
          <dd>
            {task.contact ? (
              <TaskContactView contact={task.contact} />
            ) : (
              <span className="lx-muted">Sin persona de contacto</span>
            )}
          </dd>
        </div>
        {(isLoadBearing(task.kind) || task.heavyLoad === true) && (
          <div>
            <dt>Carga pesada</dt>
            <dd>
              <HeavyLoadValue value={task.heavyLoad} />
            </dd>
          </div>
        )}
        <div>
          <dt>Empieza cuando termine</dt>
          <dd>
            {deps.length
              ? deps.map(d => `«${d.title}»`).join(', ')
              : 'No depende de otra tarea'}
          </dd>
        </div>
        {dependents.length > 0 && (
          <div>
            <dt>Después empiezan</dt>
            <dd>{dependents.map(d => `«${d.title}»`).join(', ')}</dd>
          </div>
        )}
        <div>
          <dt>Origen del dato</dt>
          <dd>{task.source ? SOURCE_LABEL[task.source] : <Pending />}</dd>
        </div>
        <div>
          <dt>Observaciones</dt>
          <dd className="lx-detail__notes">
            <Value value={task.notes} withheld={task.restricted} empty="—" />
          </dd>
        </div>
      </dl>
      <TaskResourcesView ids={task.resourceIds ?? []} />
      {warnings.length > 0 && (
        <TaskWarnings warnings={warnings} selfId={task.id} />
      )}
      <RecordNotes
        target={{type: 'task', id: task.id}}
        prefill={{
          eventId: task.eventId,
          ref: {type: 'task', id: task.id, label: task.title},
        }}
        idPrefix="lx-task"
      />
      <RecordHistory
        entityType="task"
        entityId={task.id}
        version={task.version}
        idPrefix="lx-task"
      />
      <Provenance record={task} id="lx-task-provenance" />
    </Sheet>
  );
};

/** The task's person: a link to the card and, for the team, a quick reach-out. */
const TaskContactView: React.FC<{contact: {id: string; name: string}}> = ({
  contact: ref,
}) => {
  const contact = useLogisticsStore(s => s.contacts.find(c => c.id === ref.id));
  const {openContact} = useActions();
  if (!contact) return <>{ref.name}</>;
  return (
    <div className="lx-taskcontact__view">
      <button
        type="button"
        className="lx-link"
        id="lx-task-contact-link"
        onClick={() => openContact(contact)}
      >
        {contact.name}
        {contact.role ? ` · ${contact.role}` : ''}
      </button>
      <ReachOut
        compact
        idPrefix="lx-task-contact-reach"
        target={{
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          restricted: contact.restricted,
        }}
      />
    </div>
  );
};

/** The resources a task counts on, each opening its card. */
const TaskResourcesView: React.FC<{ids: string[]}> = ({ids}) => {
  const all = useLogisticsStore(s => s.resources);
  const {openResource} = useActions();
  const list = ids
    .map(id => all.find(r => r.id === id))
    .filter((r): r is Resource => !!r);
  if (!ids.length) return null;
  return (
    <section
      className="lx-subsection"
      id="lx-task-resources-view"
      aria-labelledby="lx-task-resources-title"
    >
      <h3 className="lx-subsection__title" id="lx-task-resources-title">
        Recursos
        <span className="lx-count lx-num">{ids.length}</span>
        <LoadNoteTip label="recursos y carga" />
      </h3>
      <ul className="lx-linklist">
        {list.map(r => (
          <li key={r.id}>
            <button
              type="button"
              className="lx-linkrow"
              onClick={() => openResource(r)}
            >
              <Icon
                name={r.ownership === 'owned' ? 'warehouse' : 'building'}
                size={18}
              />
              <span className="lx-linkrow__title">{r.name}</span>
              <span className="lx-linkrow__meta lx-num">
                {quantityLabel(r)}
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {list.length < ids.length && (
        <p className="lx-muted">
          {ids.length - list.length === 1
            ? '1 recurso aún no cargado o borrado.'
            : `${ids.length - list.length} recursos aún no cargados o borrados.`}
        </p>
      )}
    </section>
  );
};

const TaskWarnings: React.FC<{
  warnings: ReturnType<typeof planWarnings>;
  selfId: string;
}> = ({warnings, selfId}) => (
  <section
    className="lx-subsection"
    id="lx-task-warnings"
    aria-labelledby="lx-task-warnings-title"
  >
    <h3 className="lx-subsection__title" id="lx-task-warnings-title">
      Avisos para esta tarea
      <HelpTip label="avisos">{WARNINGS_HELP}</HelpTip>
    </h3>
    <WarningList warnings={warnings} selfId={selfId} />
  </section>
);

// ---------------------------------------------------------------- form

interface TaskFormProps {
  mode: Exclude<TaskSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onDirty?: (dirty: boolean) => void;
}

const TaskForm: React.FC<TaskFormProps> = ({mode, onClose, onDirty}) => {
  const createTask = useLogisticsStore(s => s.createTask);
  const updateTask = useLogisticsStore(s => s.updateTask);
  const deleteTask = useLogisticsStore(s => s.deleteTask);
  const toast = useLogisticsStore(s => s.toast);
  const venues = useLogisticsStore(s => s.venues);
  const companies = useLogisticsStore(s => s.companies);
  const tasks = useLogisticsStore(s => s.tasks);
  const tasksReady = useLogisticsStore(s => s.tasksState === 'ready');
  const events = useLogisticsStore(s => s.events);
  const resources = useLogisticsStore(s => s.resources);
  const resourcesReady = useLogisticsStore(s => s.resourcesState === 'ready');
  const userId = useLogisticsStore(s => s.session?.user.id ?? null);
  const orgId = useLogisticsStore(s => s.orgId);
  const orgZone = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.timezone,
  );

  const editing = mode.kind === 'edit' ? mode.task : null;
  const [base, setBase] = useState<Task | null>(editing);
  const [prefilled] = useState(() =>
    mode.kind === 'create' ? valuesFromPrefill(mode.prefill, events) : EMPTY,
  );
  const initial = useMemo(
    () => (base ? valuesFromTask(base) : prefilled),
    [base, prefilled],
  );
  const [values, setValues] = useState<FormValues>(() =>
    mode.rescued ? valuesFromRescue(mode.rescued, initial) : initial,
  );
  const [rescuedNotice, setRescuedNotice] = useState(!!mode.rescued);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<'save' | 'next' | 'delete' | null>(null);
  const [conflict, setConflict] = useState<Task | null>(null);
  const [conflictOn, setConflictOn] = useState<'save' | 'delete'>('save');
  const [conflictResolved, setConflictResolved] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const alertRef = useAlertFocus(conflict ?? errors.form);

  const dirty = (Object.keys(values) as (keyof FormValues)[]).some(k =>
    k === 'dependsOn' || k === 'resourceIds'
      ? !sameList(values[k], initial[k])
      : values[k] !== initial[k],
  );

  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const latest = useRef<FormSnapshot>({values, base, dirty, userId, orgId});
  useLayoutEffect(() => {
    const prev = latest.current;
    latest.current = {
      values,
      base,
      dirty,
      userId: userId ?? prev.userId,
      orgId: orgId ?? prev.orgId,
    };
  });
  useLayoutEffect(() => {
    const state = latest;
    return () => {
      if (useLogisticsStore.getState().phase !== 'ready') {
        rescueForm(state.current);
      }
    };
  }, []);

  const zone = (base ? base.timezone : orgZone) || DEFAULT_TIMEZONE;
  const selfId = base?.id ?? DRAFT_ID;

  const close = () => {
    if (mode.rescued) clearRescue();
    onClose();
  };

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues(v => ({...v, [key]: value}));
    setSavedTitle(null);
    if (errors[key] || errors.form) {
      setErrors(e => ({...e, [key]: undefined, form: undefined}));
    }
  };

  /** Choosing an event fills the venue and day when they are still empty. */
  const chooseEvent = (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    setValues(v => ({
      ...v,
      eventId,
      venueName: v.venueName || event?.venue?.name || '',
      date: v.date || (event ? (recordDate(event) ?? '') : ''),
    }));
    setSavedTitle(null);
  };

  /** Choosing a person fills the company when it is still empty. */
  const chooseContact = (contactId: string, contact: Contact | null) => {
    setValues(v => ({
      ...v,
      contactId,
      companyName: v.companyName || contact?.company?.name || '',
    }));
    setSavedTitle(null);
    if (errors.contactId || errors.form) {
      setErrors(e => ({...e, contactId: undefined, form: undefined}));
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (confirm === 'delete') {
      setConfirm(null);
      return;
    }
    if (dirty) {
      setConfirm(c => (c === 'discard' ? null : 'discard'));
      return;
    }
    close();
  };

  // ---- derived: draft as the plan sees it, warnings, dependency choices
  const draftSlot = useMemo(() => slotInput(values), [values]);
  const draftInstants = useMemo(() => {
    try {
      const s = draftSlot;
      return slotToInstants(s.date, s.startTime, s.endTime, zone, s.endDate);
    } catch {
      return {startsAt: null, endsAt: null};
    }
  }, [draftSlot, zone]);

  const others = useMemo(
    () => tasks.filter(t => t.id !== base?.id),
    [tasks, base?.id],
  );

  // Predecessors deleted meanwhile (by someone else, or in another tab) are
  // shown as «Tarea borrada» and never sent: the server would reject them.
  // Only judged once the task list is loaded, so nothing is dropped early.
  const knownIds = useMemo(
    () => (tasksReady ? new Set(tasks.map(t => t.id)) : null),
    [tasks, tasksReady],
  );
  const goneDeps = knownIds
    ? values.dependsOn.filter(id => !knownIds.has(id))
    : [];
  const liveDeps = (list: string[]) =>
    knownIds ? list.filter(id => knownIds.has(id)) : list;
  // Same for resources deleted from the inventory meanwhile.
  const knownResources = useMemo(
    () => (resourcesReady ? new Set(resources.map(r => r.id)) : null),
    [resources, resourcesReady],
  );
  const liveResources = (list: string[]) =>
    knownResources ? list.filter(id => knownResources.has(id)) : list;

  const warnings = useMemo(() => {
    const draft: PlanTask = {
      id: selfId,
      title: values.title.trim() || 'Esta tarea',
      kind: values.kind,
      status: values.status,
      eventId: values.eventId || null,
      venue: refByName(values.venueName, venues),
      company: refByName(values.companyName, companies),
      // The local day matters on its own: an untimed delivery on the event
      // day still gets the routes reminder, as it will once saved.
      date: draftSlot.date,
      endDate: draftSlot.endDate,
      timezone: zone,
      startsAt: draftInstants.startsAt,
      endsAt: draftInstants.endsAt,
      dependsOn: values.dependsOn,
      heavyLoad: fromHeavy(values.heavy),
      resourceIds: values.resourceIds,
    };
    return planWarnings([...others, draft], events, resources).filter(w =>
      w.taskIds.includes(selfId),
    );
  }, [
    values,
    draftSlot,
    draftInstants,
    zone,
    others,
    events,
    resources,
    venues,
    companies,
    selfId,
  ]);

  const draftDays = useMemo(() => {
    const s = slotInput(values);
    if (!s.date) return [];
    return s.endDate && s.endDate > s.date
      ? eachDate(s.date, s.endDate)
      : [s.date];
  }, [values]);

  const candidates = useMemo(
    () =>
      sortTasks(
        others.filter(
          t =>
            values.dependsOn.includes(t.id) ||
            (values.eventId && t.eventId === values.eventId) ||
            (draftDays.length > 0 &&
              recordDays(t).some(d => draftDays.includes(d))),
        ),
      ),
    [others, values.dependsOn, values.eventId, draftDays],
  );

  /** Candidates that would close a loop (they already wait for this task). */
  const blocked = useMemo(() => {
    const graph = others.map(t => ({
      id: t.id,
      label: t.title,
      startsAt: null,
      endsAt: null,
      lane: null,
      dependsOn: t.dependsOn,
    }));
    const out = new Set<string>();
    for (const c of candidates) {
      if (values.dependsOn.includes(c.id)) continue;
      const cycle = findCycle([
        ...graph,
        {
          id: selfId,
          label: '',
          startsAt: null,
          endsAt: null,
          lane: null,
          dependsOn: [...values.dependsOn, c.id],
        },
      ]);
      if (cycle?.includes(selfId)) out.add(c.id);
    }
    return out;
  }, [others, candidates, values.dependsOn, selfId]);

  const dependents = base ? dependentsOf(tasks, base.id) : [];

  // ---- server errors and submit
  const applyServerError = (err: unknown, action: 'save' | 'delete') => {
    if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
      rescueForm(latest.current);
      return;
    }
    if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
      const current =
        err.current && typeof err.current === 'object'
          ? (err.current as Task)
          : null;
      setConflict(current ?? base);
      setConflictOn(action);
      setConflictResolved(false);
      return;
    }
    if (isApiError(err) && err.code === 'VALIDATION' && err.fields) {
      const mapped: Errors = {};
      for (const [field, message] of Object.entries(err.fields)) {
        mapped[SERVER_FIELD[field] ?? 'form'] = message;
      }
      setErrors(mapped);
      return;
    }
    const what = action === 'delete' ? 'borrado' : 'guardado';
    if (isApiError(err) && err.isUnavailable) {
      setErrors({
        form: `Servidor no disponible: la tarea no se ha ${what}. ${
          action === 'save'
            ? 'Lo que has escrito sigue aquí; vuelve a intentarlo cuando haya conexión.'
            : 'Vuelve a intentarlo cuando haya conexión.'
        }`,
      });
      return;
    }
    setErrors({form: `No se ha ${what}. ${errorMessage(err)}`});
  };

  const inputFrom = (v: FormValues): TaskInput => ({
    title: v.title.trim(),
    kind: v.kind,
    status: v.status,
    eventId: v.eventId || null,
    venueName: nullIfEmpty(v.venueName),
    companyName: nullIfEmpty(v.companyName),
    // Only sent when chosen, so a task without a person reads as before.
    ...(v.contactId ? {contactId: v.contactId} : {}),
    ...slotInput(v),
    dependsOn: liveDeps(v.dependsOn),
    // Only sent when chosen, so a task without resources reads as before.
    ...(liveResources(v.resourceIds).length
      ? {resourceIds: liveResources(v.resourceIds)}
      : {}),
    heavyLoad: showsHeavyLoad(v) ? fromHeavy(v.heavy) : null,
    notes: nullIfEmpty(v.notes),
    source: v.source,
    verification: v.verification,
  });

  const submit = async (next: boolean) => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = Object.keys(found)[0] as keyof FormValues;
      document.getElementById(`lx-task-${DOM_ID[first] ?? first}`)?.focus();
      return;
    }
    setSaving(next ? 'next' : 'save');
    setErrors({});
    try {
      if (!base) {
        const created = await createTask(inputFrom(values));
        toast(`Tarea guardada: ${created.title}`, 'success');
        if (mode.rescued) clearRescue();
        setRescuedNotice(false);
        if (next) {
          setValues(v => ({
            ...EMPTY,
            kind: v.kind,
            eventId: v.eventId,
            venueName: v.venueName,
            date: v.date,
            endDate: v.endDate,
            multiDay: v.multiDay,
            status: v.status,
            source: v.source,
            verification: v.verification,
          }));
          setSavedTitle(created.title);
          titleRef.current?.focus();
        } else {
          close();
        }
        return;
      }
      const full = inputFrom(values);
      const patch: TaskInput = {version: base.version};
      if (values.title !== initial.title) patch.title = full.title;
      if (values.kind !== initial.kind) patch.kind = full.kind;
      if (values.status !== initial.status) patch.status = full.status;
      if (values.eventId !== initial.eventId) patch.eventId = full.eventId;
      if (values.venueName !== initial.venueName) {
        patch.venueName = full.venueName;
      }
      if (values.companyName !== initial.companyName) {
        patch.companyName = full.companyName;
      }
      if (values.contactId !== initial.contactId) {
        patch.contactId = values.contactId || null;
      }
      if (slotChanged(values, initial)) Object.assign(patch, slotInput(values));
      if (!sameList(full.dependsOn ?? [], initial.dependsOn)) {
        patch.dependsOn = full.dependsOn;
      }
      if (!sameList(values.resourceIds, initial.resourceIds)) {
        patch.resourceIds = liveResources(values.resourceIds);
      }
      if (values.heavy !== initial.heavy) {
        patch.heavyLoad = fromHeavy(values.heavy);
      }
      if (values.notes !== initial.notes) patch.notes = full.notes;
      if (values.source !== initial.source) patch.source = values.source;
      if (values.verification !== initial.verification) {
        patch.verification = values.verification;
      }
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        close();
        return;
      }
      const updated = await updateTask(base.id, patch);
      toast(`Cambios guardados: ${updated.title}`, 'success');
      close();
    } catch (err) {
      applyServerError(err, 'save');
    } finally {
      setSaving(null);
    }
  };

  const remove = async () => {
    if (!base || saving) return;
    setSaving('delete');
    setErrors({});
    try {
      await deleteTask(base);
      toast(`Tarea borrada: ${base.title}`, 'success');
      close();
    } catch (err) {
      setConfirm(null);
      applyServerError(err, 'delete');
    } finally {
      setSaving(null);
    }
  };

  const loadCurrent = () => {
    if (!conflict) return;
    setBase(conflict);
    setValues(valuesFromTask(conflict));
    setErrors({});
    setConflictResolved(true);
    setConflict(null);
    setRescuedNotice(false);
    setConfirm(null);
  };

  const toggleDependency = (id: string, on: boolean) =>
    set(
      'dependsOn',
      on ? [...values.dependsOn, id] : values.dependsOn.filter(d => d !== id),
    );

  const isCreate = !base;
  const ownConflict =
    !!conflict && !!userId && conflict.updatedBy?.id === userId;
  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  // Asked for load-bearing kinds; a «Sí» stays visible (and editable) for any
  // kind, because the subsoil reminder still applies to it.
  const loadBearing = showsHeavyLoad(values);

  const footer =
    confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-task-discard"
        onKeep={() => setConfirm(null)}
        onDiscard={close}
      />
    ) : confirm === 'delete' && base ? (
      <div
        className="lx-confirm-strip"
        role="alertdialog"
        aria-labelledby="lx-task-delete-text"
        aria-describedby="lx-task-delete-detail"
      >
        <div>
          <p id="lx-task-delete-text">¿Borrar «{base.title}»?</p>
          <p className="lx-confirm-strip__detail" id="lx-task-delete-detail">
            {dependents.length
              ? `${
                  dependents.length === 1
                    ? `«${dependents[0].title}» empieza cuando termina esta y perderá ese enlace.`
                    : `${dependents.length} tareas empiezan cuando termina esta y perderán ese enlace.`
                } No se puede deshacer.`
              : 'No se puede deshacer.'}
          </p>
        </div>
        <div className="lx-confirm-strip__actions">
          <Button onClick={() => setConfirm(null)} id="lx-task-delete-keep">
            Cancelar
          </Button>
          <Button
            variant="danger"
            icon="trash"
            busy={saving === 'delete'}
            onClick={() => void remove()}
            id="lx-task-delete-confirm"
          >
            {saving === 'delete' ? 'Borrando…' : 'Borrar'}
          </Button>
        </div>
      </div>
    ) : (
      <>
        {base ? (
          <Button
            variant="ghost"
            icon="trash"
            className="lx-btn--danger-text"
            id="lx-task-delete"
            disabled={!!saving}
            onClick={() => setConfirm('delete')}
          >
            Borrar
          </Button>
        ) : (
          <Button variant="ghost" onClick={requestClose} id="lx-task-cancel">
            Cancelar
          </Button>
        )}
        <span className="lx-sheet__foot-spacer" />
        {isCreate ? (
          <Button
            id="lx-task-save-next"
            busy={saving === 'next'}
            disabled={saving === 'save'}
            onClick={() => void submit(true)}
          >
            {saving === 'next' ? 'Guardando…' : 'Guardar y seguir'}
          </Button>
        ) : (
          <Button variant="ghost" onClick={requestClose} id="lx-task-cancel">
            Cancelar
          </Button>
        )}
        <Button
          variant="primary"
          id="lx-task-save"
          busy={saving === 'save'}
          disabled={saving === 'next' || saving === 'delete' || !!conflict}
          onClick={() => void submit(false)}
        >
          {saving === 'save' ? 'Guardando…' : 'Guardar'}
        </Button>
      </>
    );

  return (
    <Sheet
      open
      onClose={requestClose}
      id="lx-task-sheet"
      eyebrow={isCreate ? 'Nueva tarea' : 'Editar tarea'}
      title={isCreate ? 'Añadir tarea' : base.title}
      meta={
        base ? (
          <>
            {base.isDemo && <DemoChip />}
            <TaskStatusChip status={base.status} />
            <VerificationChip verification={base.verification} />
            {warnings.length > 0 && (
              <Chip tag tone="neutral" size="sm">
                <Icon name="bell" size={13} />
                {warningsSummary(warnings)}
              </Chip>
            )}
          </>
        ) : (
          <span className="lx-muted">
            Solo el título es obligatorio. Lo demás puede quedar pendiente.
          </span>
        )
      }
      footer={footer}
    >
      <form
        id="lx-task-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {conflict && (
          <ConflictNotice
            id="lx-task-conflict"
            loadId="lx-task-load-current"
            subject="esta tarea"
            outcome={
              conflictOn === 'delete'
                ? 'No se ha borrado'
                : 'Tus cambios no se han guardado'
            }
            current={conflict}
            ownConflict={ownConflict}
            onLoad={loadCurrent}
            alertRef={alertRef}
          />
        )}
        {rescuedNotice && (
          <p className="lx-notice" role="status" id="lx-task-rescued">
            <Icon name="refresh" size={16} />
            Hemos recuperado lo que estabas escribiendo. Revísalo y guarda.
          </p>
        )}
        {conflictResolved && (
          <p className="lx-notice" role="status" id="lx-task-current-loaded">
            <Icon name="refresh" size={16} />
            Estás viendo la versión actual. Vuelve a aplicar tus cambios si
            siguen haciendo falta y guarda.
          </p>
        )}
        {savedTitle && (
          <p
            className="lx-notice lx-notice--success"
            role="status"
            id="lx-task-saved"
          >
            <Icon name="check" size={16} />
            Guardada «{savedTitle}». Puedes añadir la siguiente.
          </p>
        )}
        {errors.form && (
          <p
            className="lx-notice lx-notice--error"
            role="alert"
            id="lx-task-error"
            tabIndex={-1}
            ref={el => {
              alertRef.current = el;
            }}
          >
            <Icon name="alert" size={16} />
            {errors.form}
          </p>
        )}

        <Field
          id="lx-task-title"
          label="Qué hay que hacer"
          error={errors.title}
        >
          <Input
            ref={titleRef}
            id="lx-task-title"
            name="lx-task-title"
            data-autofocus
            value={values.title}
            invalid={!!errors.title}
            aria-describedby={describedBy('lx-task-title', {
              error: errors.title,
            })}
            placeholder="Montaje del escenario principal"
            autoComplete="off"
            enterKeyHint="next"
            onChange={e => set('title', e.target.value)}
          />
        </Field>

        <Segmented<TaskKind>
          name="lx-task-kind"
          id="lx-task-kind"
          legend="Tipo"
          value={values.kind}
          options={KIND_OPTIONS}
          tiles
          onChange={v => v && set('kind', v)}
        />

        <div className="lx-form__row lx-form__row--2">
          <Field
            id="lx-task-event"
            label="Evento"
            optional
            error={errors.eventId}
            hint={values.eventId ? undefined : 'Puede ser una tarea suelta.'}
          >
            <Select
              id="lx-task-event"
              name="lx-task-event"
              value={values.eventId}
              invalid={!!errors.eventId}
              aria-describedby={describedBy('lx-task-event', {
                error: errors.eventId,
                hint: !values.eventId,
              })}
              onChange={e => chooseEvent(e.target.value)}
            >
              <option value="">Sin evento (tarea suelta)</option>
              {sortedEvents.map(ev => {
                const d = recordDate(ev);
                return (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                    {d ? ` · ${dayMonthShort(d)}` : ''}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field
            id="lx-task-venue"
            label="Lugar"
            optional
            error={errors.venueName}
            hint="Si el lugar no existe, se crea con este nombre."
          >
            <Input
              id="lx-task-venue"
              name="lx-task-venue"
              list="lx-task-venues"
              value={values.venueName}
              invalid={!!errors.venueName}
              aria-describedby={describedBy('lx-task-venue', {
                error: errors.venueName,
                hint: true,
              })}
              placeholder="Plaza del Cristo"
              autoComplete="off"
              onChange={e => set('venueName', e.target.value)}
            />
            <datalist id="lx-task-venues">
              {venues.map(v => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </Field>
        </div>

        <SlotFields
          idPrefix="lx-task"
          values={values}
          errors={errors}
          onChange={set}
          zone={zone}
          subject="la tarea"
        />

        <Field
          id="lx-task-company"
          label="Empresa responsable"
          optional
          error={errors.companyName}
          hint="Quién la hace. Si la empresa no existe, se crea con este nombre."
        >
          <Input
            id="lx-task-company"
            name="lx-task-company"
            list="lx-task-companies"
            value={values.companyName}
            invalid={!!errors.companyName}
            aria-describedby={describedBy('lx-task-company', {
              error: errors.companyName,
              hint: true,
            })}
            placeholder="Nova Staff"
            autoComplete="off"
            onChange={e => set('companyName', e.target.value)}
          />
          <datalist id="lx-task-companies">
            {companies.map(c => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </Field>

        <TaskContactField
          value={values.contactId}
          companyName={values.companyName}
          saved={base?.contact ?? null}
          error={errors.contactId}
          onChange={chooseContact}
        />

        <Segmented<TaskStatus>
          name="lx-task-status"
          id="lx-task-status"
          legend="Estado"
          value={values.status}
          options={STATUS_OPTIONS}
          onChange={v => v && set('status', v)}
          help="Prevista: está en el plan. Confirmada: la ha confirmado quien la hace. En curso: se está haciendo. Hecha: terminada. Con retraso: va tarde. Cancelada: no se hará."
        />

        <TaskResourcesField
          value={values.resourceIds}
          onChange={ids => set('resourceIds', ids)}
          error={errors.resourceIds}
        />

        {loadBearing && (
          <div className="lx-heavyq">
            <Segmented<Heavy>
              name="lx-task-heavy"
              id="lx-task-heavy"
              legend="¿Lleva carga pesada?"
              value={values.heavy}
              options={HEAVY_OPTIONS}
              onChange={v => v && set('heavy', v)}
              help={HEAVY_LOAD_HELP}
            />
            {values.heavy === 'unknown' && (
              <p className="lx-form__note lx-heavyq__note">
                <Pending>Queda pendiente de verificar</Pending>: no se da por
                ligera.
              </p>
            )}
          </div>
        )}

        <fieldset className="lx-deps" id="lx-task-deps">
          <legend className="lx-field__label lx-segmented__legend">
            Empieza cuando termine…
            <span className="lx-field__optional">{' '}· opcional</span>
            <HelpTip label="empieza cuando termine">
              Marca las tareas que tienen que terminar antes de que esta pueda
              empezar. Por ejemplo, el montaje del escenario no puede empezar
              hasta que el camión llegue y descargue. Si esta tarea está puesta
              antes de que terminen, aparecerá un aviso.
            </HelpTip>
          </legend>
          {candidates.length === 0 && goneDeps.length === 0 ? (
            <p className="lx-muted lx-deps__empty">
              {values.eventId || values.date
                ? 'No hay otras tareas del mismo evento o día.'
                : 'Elige un evento o una fecha para ver las tareas con las que se puede enlazar.'}
            </p>
          ) : (
            <ul className="lx-deps__list">
              {goneDeps.map(id => (
                <li
                  key={id}
                  className="lx-deps__gone"
                  id={`lx-task-dep-gone-${id}`}
                >
                  <Icon name="trash" size={18} />
                  <span className="lx-deps__gone-text">
                    <span className="lx-deps__title">Tarea borrada</span>
                    <span
                      className="lx-deps__when"
                      id={`lx-task-dep-gone-${id}-why`}
                    >
                      Alguien la ha borrado después de enlazarla. Este enlace no
                      se guardará.
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-describedby={`lx-task-dep-gone-${id}-why`}
                    aria-label="Quitar el enlace a la tarea borrada"
                    onClick={() => toggleDependency(id, false)}
                  >
                    Quitar
                  </Button>
                </li>
              ))}
              {candidates.map(c => {
                const checked = values.dependsOn.includes(c.id);
                const isBlocked = blocked.has(c.id);
                const cid = `lx-task-dep-${c.id}`;
                const {date} = recordSlot(c);
                return (
                  <li key={c.id} className={isBlocked ? 'is-blocked' : ''}>
                    <input
                      type="checkbox"
                      id={cid}
                      checked={checked}
                      disabled={isBlocked && !checked}
                      aria-describedby={isBlocked ? `${cid}-why` : undefined}
                      onChange={e => toggleDependency(c.id, e.target.checked)}
                    />
                    <label htmlFor={cid}>
                      <Icon name={TASK_KIND_ICON[c.kind]} size={18} />
                      <span className="lx-deps__title">{c.title}</span>
                      <span className="lx-deps__when lx-num">
                        {date ? `${dayMonthShort(date)} · ` : ''}
                        {windowText(c)}
                      </span>
                      {c.venue && (
                        <span className="lx-deps__venue">{c.venue.name}</span>
                      )}
                    </label>
                    {isBlocked && (
                      <p className="lx-deps__why" id={`${cid}-why`}>
                        No se puede: «{c.title}» ya espera a que termine esta.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {errors.dependsOn && (
            <p className="lx-field__error" role="alert">
              {errors.dependsOn}
            </p>
          )}
        </fieldset>

        {dependents.length > 0 && (
          <p className="lx-form__note" id="lx-task-dependents">
            <Icon name="link" size={14} /> Después de esta empiezan:{' '}
            {dependents.map(d => `«${d.title}»`).join(', ')}.
          </p>
        )}

        <section
          className="lx-subsection"
          id="lx-task-warnings"
          aria-labelledby="lx-task-warnings-title"
        >
          <h3 className="lx-subsection__title" id="lx-task-warnings-title">
            Avisos para esta tarea
            <HelpTip label="avisos">{WARNINGS_HELP}</HelpTip>
          </h3>
          <p className="lx-visually-hidden" role="status">
            {warningsSummary(warnings)}
          </p>
          {warnings.length ? (
            <WarningList warnings={warnings} selfId={selfId} />
          ) : (
            <p className="lx-muted lx-warnings__none">
              <Icon name="check" size={16} /> Sin avisos con lo que hay
              registrado ahora.
            </p>
          )}
        </section>

        <QualityFields
          idPrefix="lx-task"
          source={values.source}
          verification={values.verification}
          onSource={v => set('source', v)}
          onVerification={v => set('verification', v)}
        />

        <Field
          id="lx-task-notes"
          label="Observaciones"
          optional
          error={errors.notes}
          hint={NOTE_PRIVACY_HINT}
        >
          <Textarea
            id="lx-task-notes"
            name="lx-task-notes"
            rows={3}
            value={values.notes}
            invalid={!!errors.notes}
            aria-describedby={describedBy('lx-task-notes', {
              error: errors.notes,
              hint: true,
            })}
            placeholder="Material, accesos, quién abre…"
            onChange={e => set('notes', e.target.value)}
          />
        </Field>

        {base && (
          <>
            <RecordNotes
              target={{type: 'task', id: base.id}}
              prefill={{
                eventId: base.eventId,
                ref: {type: 'task', id: base.id, label: base.title},
              }}
              idPrefix="lx-task"
            />
            <RecordHistory
              entityType="task"
              entityId={base.id}
              version={base.version}
              idPrefix="lx-task"
            />
            <Provenance record={base} id="lx-task-provenance" />
          </>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
