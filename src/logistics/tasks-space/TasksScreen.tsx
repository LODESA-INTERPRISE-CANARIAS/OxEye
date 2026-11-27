/**
 * «Tareas» (Revisión 1 · E2, note 6): every task of the organization in one
 * place, to review the plan («¿qué falta por cerrar?») and to prepare a day
 * («¿qué hace cada empresa en cada lugar?»).
 *
 * - Search (title, event, venue, company, person in charge) and filters:
 *   event, venue, company, status, days, «Con avisos», «Sin hora» and «Sin
 *   lugar». Kept per device and organization, not in the address.
 * - Two views: the compact list by day, and groups by event, venue or
 *   company with their conflicts counted.
 * - Dependencies: a mark on tasks that wait or are waited for, «Espera a:»
 *   under the title, and a button that highlights the whole chain.
 * - Tapping a task opens its sheet (with its own address).
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {Task, TaskStatus} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {useMediaQuery} from '../common/useMediaQuery';
import {usePlan} from '../common/usePlan';
import {plural, shortDate} from '../lib/format';
import {TASK_STATUS_LABEL} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  DateField,
  EmptyState,
  HelpTip,
  Icon,
  LoadError,
  MultiSelectField,
  SearchInput,
  SkeletonRows,
  type SelectOption,
} from '../ui';
import {
  activeFilterCount,
  applyFilters,
  chainOf,
  dependencies,
  EMPTY_FILTERS,
  GROUP_LABEL,
  groupByDay,
  groupTasks,
  lacksTime,
  NONE,
  readPrefs,
  TASK_STATUSES,
  writePrefs,
  type GroupBy,
  type TaskFilters,
  type TasksPrefs,
  type TaskView,
} from './filters';
import {TaskListRow, type ChainRole as RowRole} from './TaskListRow';

const WARNINGS_HELP =
  'Los avisos salen del plan: dos tareas a la vez en el mismo lugar o con la misma empresa, una tarea que empieza antes de que termine aquella a la que espera, carga pesada sin revisar el subsuelo, entregas durante el evento (rutas A/B/C y Carpa Amarilla)… Son indicaciones para revisar, no una certificación. Los conflictos aceptados («Mantener ambas») no cuentan aquí.';

const CHAIN_HELP =
  'Una tarea «espera a» otra cuando no puede empezar hasta que esa termine. Pulsa el botón de cadena de una tarea para resaltar todo lo que va antes y todo lo que va después.';

export const TasksScreen: React.FC = () => {
  const tasks = useLogisticsStore(s => s.tasks);
  const events = useLogisticsStore(s => s.events);
  const state = useLogisticsStore(s => s.tasksState);
  const error = useLogisticsStore(s => s.tasksError);
  const refresh = useLogisticsStore(s => s.refresh);
  const orgId = useLogisticsStore(s => s.orgId);
  const offline = useLogisticsStore(
    s => s.connection !== 'online' || s.fromCache,
  );
  const {canWrite, today, timeZone, openTask, addTask} = useActions();
  const plan = usePlan();
  const phone = useMediaQuery('(max-width: 899px)');

  const userId = useLogisticsStore(s => s.session?.user.id ?? null);
  const [prefs, setPrefsState] = useState<TasksPrefs>(() =>
    readPrefs(userId, orgId),
  );
  const [chainRoot, setChainRoot] = useState<string | null>(null);

  // Another person or organization brings its own remembered filters (and
  // an empty search: the query is never remembered).
  const owner = `${userId ?? ''}|${orgId ?? ''}`;
  const lastOwner = useRef(owner);
  useEffect(() => {
    if (lastOwner.current === owner) return;
    lastOwner.current = owner;
    setPrefsState(readPrefs(userId, orgId));
    setChainRoot(null);
  }, [owner, userId, orgId]);

  const setPrefs = (next: Partial<TasksPrefs>) =>
    setPrefsState(prev => {
      const merged = {...prev, ...next};
      writePrefs(userId, orgId, merged);
      return merged;
    });
  const setFilters = (next: Partial<TaskFilters>) =>
    setPrefs({filters: {...prefs.filters, ...next}});
  const {filters, view, groupBy} = prefs;
  const panelOpen = prefs.panel ?? !phone;

  const eventNames = useMemo(
    () => new Map(events.map(e => [e.id, e.name])),
    [events],
  );
  const ctx = useMemo(
    () => ({byTask: plan.byTask, eventNames}),
    [plan.byTask, eventNames],
  );
  const deps = useMemo(() => dependencies(tasks), [tasks]);
  const shown = useMemo(
    () => applyFilters(tasks, filters, ctx),
    [tasks, filters, ctx],
  );
  const chain = useMemo(
    () =>
      chainRoot && plan.tasksById.has(chainRoot)
        ? chainOf(deps, chainRoot)
        : null,
    [chainRoot, deps, plan.tasksById],
  );
  const roleOf = (id: string): RowRole => {
    if (!chain) return null;
    if (id === chain.root) return 'root';
    if (chain.before.has(id)) return 'before';
    if (chain.after.has(id)) return 'after';
    return 'out';
  };

  const options = useFilterOptions(tasks, eventNames);
  const count = activeFilterCount(filters);
  const withWarnings = useMemo(
    () => tasks.filter(t => plan.byTask.get(t.id)?.length).length,
    [tasks, plan.byTask],
  );

  const clear = () => setFilters(EMPTY_FILTERS);
  const toggleChain = (t: Task) =>
    setChainRoot(root => (root === t.id ? null : t.id));

  const loading =
    (state === 'loading' || state === 'idle') && tasks.length === 0;
  const failed = state === 'error' && tasks.length === 0;

  const row = (t: Task, showDate: boolean) => (
    <TaskListRow
      key={t.id}
      task={t}
      warnings={plan.byTask.get(t.id) ?? []}
      waitsFor={deps.waitsFor.get(t.id) ?? []}
      waitedBy={deps.waitedBy.get(t.id) ?? []}
      showDate={showDate}
      chain={roleOf(t.id)}
      onOpen={openTask}
      onChain={toggleChain}
    />
  );

  let body: React.ReactNode;
  if (loading) {
    body = <SkeletonRows rows={7} label="Cargando las tareas" />;
  } else if (failed) {
    body = <LoadError message={error ?? ''} onRetry={() => void refresh()} />;
  } else if (tasks.length === 0) {
    body = (
      <EmptyState
        icon="task"
        title="Aún no hay tareas"
        id="lx-tasks-empty"
        action={
          canWrite && (
            <Button
              variant="primary"
              icon="plus"
              id="lx-tasks-empty-add"
              onClick={() => addTask()}
            >
              Añadir tarea
            </Button>
          )
        }
      >
        {canWrite
          ? 'Montajes, entregas, transportes, desmontajes… Basta con el título: la hora, el lugar y la empresa pueden quedar pendientes y aparecerán aquí como «Sin hora» o «Sin lugar».'
          : 'Cuando el equipo registre tareas, aparecerán aquí.'}
      </EmptyState>
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        compact
        icon="search"
        title={
          filters.query.trim()
            ? `Ninguna tarea coincide con «${filters.query.trim()}»`
            : 'Ninguna tarea con estos filtros'
        }
        id="lx-tasks-noresults"
        action={
          <Button id="lx-tasks-noresults-clear" onClick={clear}>
            Quitar filtros
          </Button>
        }
      >
        Prueba con parte del título, el lugar o la empresa, o quita algún
        filtro.
      </EmptyState>
    );
  } else if (view === 'grouped') {
    body = groupTasks(shown, groupBy, ctx).map(g => (
      <section
        key={g.key}
        className="lx-tlgroup"
        aria-labelledby={`lx-tlgroup-${g.key}`}
        data-group={g.key}
      >
        <h3 className="lx-tlgroup__title" id={`lx-tlgroup-${g.key}`}>
          <span>{g.label}</span>
          <span className="lx-count lx-num">{g.items.length}</span>
          {g.conflicts > 0 && (
            <span className="lx-tlgroup__conflicts lx-num">
              <Icon name="alert" size={14} />
              {plural(g.conflicts, 'con conflicto', 'con conflicto')}
            </span>
          )}
        </h3>
        <ul className="lx-tllist">{g.items.map(t => row(t, true))}</ul>
      </section>
    ));
  } else {
    body = groupByDay(shown).map(g => (
      <section
        key={g.day || NONE}
        className="lx-tlgroup lx-tlgroup--day"
        aria-labelledby={`lx-tlday-${g.day || NONE}`}
        data-day={g.day || NONE}
      >
        <h3 className="lx-tlgroup__title" id={`lx-tlday-${g.day || NONE}`}>
          <span className="lx-num">
            {g.day ? shortDate(g.day) : 'Sin fecha'}
          </span>
          {g.day === today && <span className="lx-tlgroup__today">Hoy</span>}
          <span className="lx-count lx-num">{g.items.length}</span>
        </h3>
        <ul className="lx-tllist">{g.items.map(t => row(t, false))}</ul>
      </section>
    ));
  }

  const chainTask = chain ? plan.tasksById.get(chain.root) : null;
  const hiddenInChain = chain
    ? [chain.root, ...chain.before, ...chain.after].filter(
        id => !shown.some(t => t.id === id),
      ).length
    : 0;

  return (
    <div className="lx-directory lx-tasks" id="lx-space-tareas">
      <div className="lx-directory__bar lx-tasks__bar">
        <div className="lx-directory__tools">
          <SearchInput
            id="lx-tasks-search"
            value={filters.query}
            onValue={query => setFilters({query})}
            label="Buscar tareas"
            placeholder="Buscar por título, evento, lugar o empresa"
          />
          <ViewSwitch
            view={view}
            onView={v => setPrefs({view: v})}
            groupBy={groupBy}
            onGroupBy={g => setPrefs({view: 'grouped', groupBy: g})}
          />
          {canWrite && (
            <Button
              icon="plus"
              id="lx-tasks-add"
              onClick={() =>
                addTask(
                  filters.events.length === 1 && filters.events[0] !== NONE
                    ? {eventId: filters.events[0]}
                    : undefined,
                )
              }
            >
              Añadir tarea
            </Button>
          )}
        </div>

        <div
          className="lx-filterchips lx-tasks__quick"
          role="group"
          aria-label="Filtros rápidos"
          id="lx-tasks-quick"
        >
          <button
            type="button"
            className="lx-filterchip"
            id="lx-tasks-filter-warnings"
            aria-pressed={filters.withWarnings}
            onClick={() => setFilters({withWarnings: !filters.withWarnings})}
          >
            <Icon name="alert" size={14} />
            Con avisos
            <span className="lx-num">{withWarnings}</span>
          </button>
          <button
            type="button"
            className="lx-filterchip"
            id="lx-tasks-filter-notime"
            aria-pressed={filters.noTime}
            onClick={() => setFilters({noTime: !filters.noTime})}
          >
            <Icon name="clock" size={14} />
            Sin hora
            <span className="lx-num">{options.noTime}</span>
          </button>
          <button
            type="button"
            className="lx-filterchip"
            id="lx-tasks-filter-novenue"
            aria-pressed={filters.noVenue}
            onClick={() => setFilters({noVenue: !filters.noVenue})}
          >
            <Icon name="pin" size={14} />
            Sin lugar
            <span className="lx-num">{options.noVenue}</span>
          </button>
          <HelpTip label="avisos">{WARNINGS_HELP}</HelpTip>
          <span className="lx-tasks__spacer" />
          <button
            type="button"
            className="lx-filterchip lx-tasks__more"
            id="lx-tasks-filters-toggle"
            aria-expanded={panelOpen}
            aria-controls="lx-tasks-filters"
            onClick={() => setPrefs({panel: !panelOpen})}
          >
            <Icon name="list" size={14} />
            Más filtros
            {count > 0 && <span className="lx-num">{count}</span>}
            <Icon
              name="chevronDown"
              size={14}
              className={panelOpen ? 'is-open' : ''}
            />
          </button>
        </div>

        {panelOpen && (
          <div
            className="lx-tasks__filters"
            id="lx-tasks-filters"
            role="group"
            aria-label="Filtros de las tareas"
          >
            <FilterField id="lx-tasks-f-event" label="Evento">
              <MultiSelectField
                id="lx-tasks-f-event"
                values={filters.events}
                onChange={v => setFilters({events: v})}
                options={options.events}
                noneLabel="Todos"
              />
            </FilterField>
            <FilterField id="lx-tasks-f-venue" label="Lugar">
              <MultiSelectField
                id="lx-tasks-f-venue"
                values={filters.venues}
                onChange={v => setFilters({venues: v})}
                options={options.venues}
                noneLabel="Todos"
              />
            </FilterField>
            <FilterField id="lx-tasks-f-company" label="Empresa">
              <MultiSelectField
                id="lx-tasks-f-company"
                values={filters.companies}
                onChange={v => setFilters({companies: v})}
                options={options.companies}
                noneLabel="Todas"
              />
            </FilterField>
            <FilterField id="lx-tasks-f-status" label="Estado">
              <MultiSelectField
                id="lx-tasks-f-status"
                values={filters.statuses}
                onChange={v => setFilters({statuses: v as TaskStatus[]})}
                options={STATUS_OPTIONS}
                noneLabel="Todos"
              />
            </FilterField>
            <fieldset className="lx-tasks__dates" id="lx-tasks-f-dates">
              <legend className="lx-field__label">Días</legend>
              <div className="lx-tasks__dates-row">
                <DateField
                  id="lx-tasks-f-from"
                  aria-label="Desde"
                  placeholder="Desde"
                  value={filters.from}
                  max={filters.to || undefined}
                  today={today}
                  timeZone={timeZone}
                  onChange={from => setFilters({from})}
                />
                <span aria-hidden="true">–</span>
                <DateField
                  id="lx-tasks-f-to"
                  aria-label="Hasta"
                  placeholder="Hasta"
                  value={filters.to}
                  min={filters.from || undefined}
                  today={today}
                  timeZone={timeZone}
                  onChange={to => setFilters({to})}
                />
              </div>
              <div className="lx-tasks__dates-quick">
                <button
                  type="button"
                  className="lx-tasks__link"
                  id="lx-tasks-f-today"
                  onClick={() => setFilters({from: today, to: today})}
                >
                  Solo hoy
                </button>
                <button
                  type="button"
                  className="lx-tasks__link"
                  id="lx-tasks-f-upcoming"
                  onClick={() => setFilters({from: today, to: ''})}
                >
                  De hoy en adelante
                </button>
              </div>
            </fieldset>
          </div>
        )}
      </div>

      {offline && tasks.length > 0 && (
        <p className="lx-notice lx-tasks__offline" id="lx-tasks-offline">
          <Icon name="cloudOff" size={16} />
          Sin conexión con el servidor: ves la copia guardada en este
          dispositivo. Lo que cambie el equipo llegará al volver la conexión.
        </p>
      )}

      <div className="lx-directory__panel">
        {!loading && !failed && tasks.length > 0 && (
          <p
            className="lx-directory__count lx-num"
            role="status"
            id="lx-tasks-count"
          >
            {count
              ? `${plural(shown.length, 'tarea', 'tareas')} de ${tasks.length}`
              : plural(tasks.length, 'tarea', 'tareas')}
            {count > 0 && (
              <button
                type="button"
                className="lx-tasks__link"
                id="lx-tasks-clear"
                onClick={clear}
              >
                Quitar filtros
              </button>
            )}
          </p>
        )}

        {chainTask && (
          <div className="lx-tasks__chain" id="lx-tasks-chain" role="status">
            <Icon name="link" size={16} />
            <span>
              Cadena de <strong>{chainTask.title}</strong>:{' '}
              <span className="lx-num">
                {plural(chain!.before.size, 'tarea antes', 'tareas antes')} ·{' '}
                {plural(chain!.after.size, 'tarea después', 'tareas después')}
              </span>
              {hiddenInChain > 0 && (
                <span className="lx-muted lx-num">
                  {' '}
                  ({plural(hiddenInChain, 'oculta', 'ocultas')} por los filtros)
                </span>
              )}
            </span>
            <HelpTip label="cadena de tareas">{CHAIN_HELP}</HelpTip>
            <Button
              size="sm"
              variant="ghost"
              id="lx-tasks-chain-clear"
              onClick={() => setChainRoot(null)}
            >
              Quitar resaltado
            </Button>
          </div>
        )}

        <div
          className={`lx-tasks__list${chain ? ' has-chain' : ''}`}
          id="lx-tasks-list"
          data-view={view}
        >
          {body}
        </div>
      </div>
    </div>
  );
};

const STATUS_OPTIONS: SelectOption[] = TASK_STATUSES.map(s => ({
  value: s,
  label: TASK_STATUS_LABEL[s],
}));

const FilterField: React.FC<{
  id: string;
  label: string;
  children: React.ReactNode;
}> = ({id, label, children}) => (
  <div className="lx-field lx-tasks__field">
    <label className="lx-field__label" htmlFor={id}>
      {label}
    </label>
    {children}
  </div>
);

/** «Lista» or «Agrupar por: Evento · Lugar · Empresa», as one radio group. */
const ViewSwitch: React.FC<{
  view: TaskView;
  onView: (view: TaskView) => void;
  groupBy: GroupBy;
  onGroupBy: (by: GroupBy) => void;
}> = ({view, onView, groupBy, onGroupBy}) => {
  const choices: {id: string; label: string; on: boolean; pick: () => void}[] =
    [
      {
        id: 'list',
        label: 'Lista',
        on: view === 'list',
        pick: () => onView('list'),
      },
      ...(['event', 'venue', 'company'] as const).map(by => ({
        id: by,
        label: GROUP_LABEL[by],
        on: view === 'grouped' && groupBy === by,
        pick: () => onGroupBy(by),
      })),
    ];
  return (
    <div
      className="lx-tasks__views"
      role="radiogroup"
      aria-label="Cómo ver las tareas"
      id="lx-tasks-views"
    >
      <span className="lx-tasks__views-label" aria-hidden="true">
        Ver
      </span>
      {choices.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.on}
          tabIndex={c.on ? 0 : -1}
          id={`lx-tasks-view-${c.id}`}
          className="lx-tasks__view"
          title={
            c.id === 'list'
              ? 'Lista por días'
              : `Agrupar por ${c.label.toLocaleLowerCase('es-ES')}`
          }
          onClick={c.pick}
          onKeyDown={e => {
            const step =
              e.key === 'ArrowRight' || e.key === 'ArrowDown'
                ? 1
                : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (!step) return;
            e.preventDefault();
            const next = choices[(i + step + choices.length) % choices.length];
            next.pick();
            document.getElementById(`lx-tasks-view-${next.id}`)?.focus();
          }}
        >
          {c.id === 'list' ? (
            <Icon name="list" size={16} />
          ) : (
            <Icon name="columns" size={16} />
          )}
          <span>
            {c.id === 'list'
              ? c.label
              : `Por ${c.label.toLocaleLowerCase('es-ES')}`}
          </span>
        </button>
      ))}
    </div>
  );
};

/**
 * Options of the multi-value filters: the events, venues and companies the
 * tasks name (alphabetical, «Sin …» last), each with its number of tasks.
 */
function useFilterOptions(
  tasks: readonly Task[],
  eventNames: ReadonlyMap<string, string>,
) {
  return useMemo(() => {
    const collect = (
      ref: (t: Task) => {id: string; name: string} | null,
      noneLabel: string,
    ): {options: SelectOption[]; none: number} => {
      const named = new Map<string, {name: string; n: number}>();
      let none = 0;
      for (const t of tasks) {
        const r = ref(t);
        if (!r) {
          none++;
          continue;
        }
        const e = named.get(r.id) ?? {name: r.name, n: 0};
        e.n++;
        named.set(r.id, e);
      }
      const options: SelectOption[] = [...named]
        .sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'))
        .map(([id, e]) => ({
          value: id,
          label: e.name,
          hint: plural(e.n, 'tarea', 'tareas'),
        }));
      if (none) {
        options.push({
          value: NONE,
          label: noneLabel,
          hint: plural(none, 'tarea', 'tareas'),
        });
      }
      return {options, none};
    };
    const events = collect(
      t =>
        t.eventId
          ? {
              id: t.eventId,
              name: eventNames.get(t.eventId) ?? 'Evento sin nombre',
            }
          : null,
      'Sin evento',
    );
    const venues = collect(t => t.venue, 'Sin lugar');
    const companies = collect(t => t.company, 'Sin empresa');
    return {
      events: events.options,
      venues: venues.options,
      companies: companies.options,
      noTime: tasks.filter(lacksTime).length,
      noVenue: venues.none,
    };
  }, [tasks, eventNames]);
}
