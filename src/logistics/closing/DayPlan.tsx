/**
 * The plan side of the day close: what we still need to know, the safety
 * reminders (subsoil and routes A/B/C with Carpa Amarilla), what was left
 * unfinished and what comes in the next days. Times are shown in each
 * task's own time zone.
 */
import React, {useMemo} from 'react';
import type {LocalDate, Task} from '../../../shared/logistics/contracts.ts';
import {
  NEXT_DAYS,
  subsoilLineLabel,
  type DayReport,
  type DaySubsoilLine,
  type DayTaskLine,
} from '../../../shared/logistics/day-report.ts';
import {addDays} from '../../../shared/logistics/time.ts';
import {TaskStatusChip} from '../common/TaskChips';
import {windowText} from '../common/TimeWindow';
import {shortDate} from '../lib/format';
import {recordDays, TASK_KIND_ICON} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Card, HelpTip, Icon, type IconName} from '../ui';
import {groupByDay} from './day';
import {QuietLine, ShowMore, TYPE_ICON, useOpenLine} from './parts';

const NEEDS_SHOWN = 5;

function useTaskIndex(): Map<string, Task> {
  const tasks = useLogisticsStore(s => s.tasks);
  return useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
}

/** «Qué seguimos necesitando»: records still missing something. */
export const DayNeeds: React.FC<{report: DayReport}> = ({report}) => {
  const open = useOpenLine();
  const {incomplete, total} = report.pending;
  return (
    <Card
      title="Qué seguimos necesitando"
      id="lx-day-needs"
      className="lx-dayneeds"
      actions={
        <HelpTip label="qué seguimos necesitando">
          Registros a los que aún les falta algo (lugar, fecha, horas, empresa,
          contacto…) o que están sin validar con su fuente. Primero eventos y
          tareas. Tócalos para completarlos.
        </HelpTip>
      }
    >
      {total === 0 ? (
        <QuietLine>Aún no hay nada registrado.</QuietLine>
      ) : incomplete.length === 0 ? (
        <QuietLine>Todo lo registrado está completo y validado.</QuietLine>
      ) : (
        <ShowMore
          items={incomplete}
          shown={NEEDS_SHOWN}
          noun="registros"
          className="lx-missing"
          render={row => (
            <li key={`${row.type}:${row.id}`}>
              <button
                type="button"
                className="lx-missing__row"
                onClick={() => open(row.type, row.id)}
              >
                <Icon
                  name={TYPE_ICON[row.type]}
                  size={18}
                  className="lx-missing__kind"
                />
                <span className="lx-missing__name">{row.label}</span>
                <span className="lx-missing__tags">
                  <span className="lx-visually-hidden">Falta: </span>
                  {row.missing.map(m => (
                    <span key={m} className="lx-missing__tag">
                      {m}
                    </span>
                  ))}
                </span>
                <Icon name="chevronRight" size={18} />
              </button>
            </li>
          )}
        />
      )}
    </Card>
  );
};

const SUBSOIL_ICON: Record<DaySubsoilLine['state'], IconName> = {
  finished_unreviewed: 'alert',
  pending: 'weight',
  unknown_load: 'weight',
  declared: 'check',
};

/** Subsoil and routes: reminders, never a verdict. */
export const DaySafety: React.FC<{report: DayReport}> = ({report}) => {
  const open = useOpenLine();
  const {subsoil, routes, subsoilNote, thresholdNote, routesNote} =
    report.safety;
  const none = subsoil.length === 0 && routes.length === 0;
  return (
    <Card
      title="Seguridad"
      eyebrow="Subsuelo y rutas de emergencia"
      id="lx-day-safety"
      className="lx-daysafety"
      actions={
        <HelpTip label="los recordatorios de seguridad">
          Tareas de este día y de los {NEXT_DAYS} siguientes que llevan (o
          pueden llevar) carga pesada, y entregas o transportes que coinciden
          con un evento. Son recordatorios para revisarlo en el simulador de
          Ox Eye; Ox Eye ayuda a decidir, no certifica.
        </HelpTip>
      }
    >
      {none ? (
        <QuietLine id="lx-day-safety-none">
          Sin avisos de subsuelo ni de rutas para este día y los {NEXT_DAYS}{' '}
          siguientes.
        </QuietLine>
      ) : (
        <div className="lx-dayrecords__groups">
          {subsoil.length > 0 && (
            <section
              className="lx-daygroup"
              aria-labelledby="lx-day-subsoil-title"
              id="lx-day-subsoil"
            >
              <h3 className="lx-daygroup__title" id="lx-day-subsoil-title">
                Subsuelo
                <span className="lx-count lx-num">{subsoil.length}</span>
              </h3>
              <ul className="lx-daylines">
                {subsoil.map(s => (
                  <li key={s.taskId}>
                    <button
                      type="button"
                      className={`lx-dayline lx-daysoil is-${s.state}`}
                      onClick={() => open('task', s.taskId)}
                    >
                      <Icon
                        name={SUBSOIL_ICON[s.state]}
                        size={18}
                        className="lx-dayline__icon"
                      />
                      <span className="lx-dayline__main">
                        <span className="lx-dayline__name">{s.title}</span>
                        <span className="lx-daysoil__state">
                          {subsoilLineLabel(s)}
                        </span>
                        {s.date && (
                          <span className="lx-dayline__meta lx-num">
                            {shortDate(s.date)}
                          </span>
                        )}
                      </span>
                      <Icon
                        name="chevronRight"
                        size={18}
                        className="lx-dayline__go"
                      />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="lx-dayclose__fine">{subsoilNote}</p>
              <p className="lx-dayclose__fine" id="lx-day-threshold">
                {thresholdNote}
              </p>
            </section>
          )}
          {routes.length > 0 && (
            <section
              className="lx-daygroup"
              aria-labelledby="lx-day-routes-title"
              id="lx-day-routes"
            >
              <h3 className="lx-daygroup__title" id="lx-day-routes-title">
                Rutas A/B/C y Carpa Amarilla
                <span className="lx-count lx-num">{routes.length}</span>
              </h3>
              <ul className="lx-daylines">
                {routes.map(r => {
                  const extra = r.detail.replace(routesNote, '').trim();
                  return (
                    <li key={r.taskIds.join(',')}>
                      <button
                        type="button"
                        className="lx-dayline"
                        onClick={() => open('task', r.taskIds[0])}
                      >
                        <Icon
                          name="transport"
                          size={18}
                          className="lx-dayline__icon"
                        />
                        <span className="lx-dayline__main">
                          <span className="lx-dayline__name">{r.title}</span>
                          {extra && (
                            <span className="lx-dayline__detail">{extra}</span>
                          )}
                        </span>
                        <Icon
                          name="chevronRight"
                          size={18}
                          className="lx-dayline__go"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <aside className="lx-dayroutes">
                <Icon name="transport" size={18} />
                <p>{routesNote}</p>
              </aside>
            </section>
          )}
        </div>
      )}
    </Card>
  );
};

const TaskLineRow: React.FC<{line: DayTaskLine; task: Task | undefined}> = ({
  line,
  task,
}) => {
  const open = useOpenLine();
  const when = windowText(
    task ?? {
      date: line.date,
      endDate: null,
      startsAt: line.startsAt,
      endsAt: line.endsAt,
      timezone: line.timezone,
    },
  );
  const where = [line.venue, line.company].filter(Boolean).join(' · ');
  return (
    <li>
      <button
        type="button"
        className="lx-dayline lx-daytask"
        onClick={() => open('task', line.id)}
      >
        <span
          className={`lx-daytask__when lx-num${line.startsAt ? '' : ' is-pending'}`}
        >
          {when}
        </span>
        <span className="lx-dayline__main">
          <span className="lx-dayline__name">{line.title}</span>
          <span className="lx-dayline__detail">
            <Icon name={TASK_KIND_ICON[line.kind]} size={14} /> {line.kindLabel}
            {where && ` · ${where}`}
          </span>
        </span>
        <span className="lx-dayline__chips">
          <TaskStatusChip status={line.status} />
        </span>
        <Icon name="chevronRight" size={18} className="lx-dayline__go" />
      </button>
    </li>
  );
};

/** «Quedó sin terminar»: tasks of the day not done (nor cancelled). */
export const DayUnfinished: React.FC<{report: DayReport}> = ({report}) => {
  const index = useTaskIndex();
  const lines = report.unfinished;
  return (
    <Card
      title="Quedó sin terminar"
      id="lx-day-unfinished"
      className="lx-dayplan"
    >
      {lines.length === 0 ? (
        <QuietLine id="lx-day-unfinished-none">
          Nada pendiente de este día: lo previsto está hecho o cancelado.
        </QuietLine>
      ) : (
        <ShowMore
          items={lines}
          shown={8}
          noun="tareas"
          className="lx-daylines"
          render={l => (
            <TaskLineRow key={l.id} line={l} task={index.get(l.id)} />
          )}
        />
      )}
    </Card>
  );
};

/** «Para los próximos días», grouped by day. */
export const DayNext: React.FC<{report: DayReport}> = ({report}) => {
  const index = useTaskIndex();
  const days = useMemo<LocalDate[]>(
    () =>
      Array.from({length: NEXT_DAYS}, (_, i) => addDays(report.date, i + 1)),
    [report.date],
  );
  const groups = useMemo(
    () =>
      groupByDay(report.nextTasks, days, line => {
        const task = index.get(line.id);
        return task ? recordDays(task) : line.date ? [line.date] : [];
      }),
    [report.nextTasks, days, index],
  );
  return (
    <Card
      title="Para los próximos días"
      id="lx-day-next"
      className="lx-dayplan"
    >
      {groups.length === 0 ? (
        <QuietLine id="lx-day-next-none">
          Sin tareas previstas para los {NEXT_DAYS} días siguientes.
        </QuietLine>
      ) : (
        <div className="lx-dayrecords__groups">
          {groups.map(g => (
            <section
              key={g.day}
              className="lx-daygroup"
              aria-labelledby={`lx-day-next-${g.day}`}
            >
              <h3
                className="lx-daygroup__title lx-num"
                id={`lx-day-next-${g.day}`}
              >
                {shortDate(g.day)}
                <span className="lx-count lx-num">{g.items.length}</span>
              </h3>
              <ul className="lx-daylines">
                {g.items.map(l => (
                  <TaskLineRow key={l.id} line={l} task={index.get(l.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
};
