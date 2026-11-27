/**
 * Move preview (Revisión 1 · E2): before a task changes time, show what
 * changes with it, as computed by the shared `analyzeMove` on the plan as it
 * was when the sheet opened. The server recomputes the same move and refuses
 * it if the plan changed in between (409), so what is confirmed is exactly
 * what is written, or nothing is.
 *
 * The same sheet holds «Mantener ambas»: accepting a conflict with a reason.
 *
 * Routes A/B/C, Carpa Amarilla and subsoil reminders are always listed when
 * they apply. The Gestor has no route geometry: nothing here says a slot is
 * safe or certified.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {windowsFor} from '../../../shared/logistics/acceptance.ts';
import {
  planWarnings,
  SUBSOIL_THRESHOLD_NOTE,
  type PlanWarning,
} from '../../../shared/logistics/conflicts.ts';
import type {
  LogisticsEvent,
  Resource,
  Task,
  Venue,
} from '../../../shared/logistics/contracts.ts';
import {shiftExpectations} from '../../../shared/logistics/followup.ts';
import {
  analyzeMove,
  MOVE_BLOCKED,
  moveBlocker,
  outsideHoursMessage,
} from '../../../shared/logistics/move.ts';
import {
  ACCEPT_REASON_MAX,
  ACCEPT_REASON_MIN,
  NOTE_PRIVACY_HINT,
} from '../../../shared/logistics/rules.ts';
import {errorMessage, isApiError} from '../api/client';
import {useActions} from '../common/actions';
import {WarningItems} from '../common/WarningItem';
import {slotText} from '../followup/text';
import {taskZone} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  Field,
  HelpTip,
  Icon,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';
import {shiftText, undoExpectations} from './exits';
import type {MoveRequest} from './useMoveFlow';

export const ROUTES_HELP =
  'El Gestor no conoce el trazado de las rutas de emergencia (A, acceso de vehículos; B, sanitarios a pie; C, evacuación en camilla) ni el de la Carpa Amarilla. Este recordatorio aparece siempre que se mueve una tarea con vehículos o carga: revisa la nueva hora en el simulador. No indica que la nueva hora sea segura.';

export const SUBSOIL_HELP = `Las cargas pesadas siguen necesitando la revisión del subsuelo en el simulador. ${SUBSOIL_THRESHOLD_NOTE} Mover la tarea no cambia la carga ni la revisión declarada.`;

const PLAN_CHANGED =
  'El plan ha cambiado desde que abriste esta vista previa: vuelve a calcular y revisa el cambio antes de confirmarlo. No se ha movido nada.';

/** The plan as it was when the preview was computed. */
interface Snapshot {
  tasks: Task[];
  events: LogisticsEvent[];
  resources: Resource[];
  venues: Venue[];
}

function useSnapshot(): [Snapshot, boolean, () => void] {
  const tasks = useLogisticsStore(s => s.tasks);
  const events = useLogisticsStore(s => s.events);
  const resources = useLogisticsStore(s => s.resources);
  const venues = useLogisticsStore(s => s.venues);
  const [snap, setSnap] = useState<Snapshot>(() => ({
    tasks,
    events,
    resources,
    venues,
  }));
  const stale =
    snap.tasks !== tasks ||
    snap.events !== events ||
    snap.resources !== resources ||
    snap.venues !== venues;
  const refresh = () => setSnap({tasks, events, resources, venues});
  return [snap, stale, refresh];
}

export const MoveSheet: React.FC<{
  request: MoveRequest;
  onDone: (confirmed: boolean) => void;
}> = ({request, onDone}) =>
  request.kind === 'move' ? (
    <MovePreview request={request} onDone={onDone} />
  ) : (
    <KeepConflict warning={request.warning} onDone={onDone} />
  );

// ---------------------------------------------------------------- shared bits

/** A moved task: old time struck through, new time after it. */
const MovedRow: React.FC<{
  task: Task | undefined;
  label: string;
  startsAt: string;
  endsAt: string;
  outside?: boolean;
}> = ({task, label, startsAt, endsAt, outside}) => {
  const tz = task ? taskZone(task) : undefined;
  return (
    <li className={`lx-hypo-moved${outside ? ' lx-move__outside' : ''}`}>
      <span className="lx-hypo-moved__title">{task?.title ?? label}</span>
      <span className="lx-hypo-moved__times lx-num">
        {task && (
          <>
            <s aria-label={`antes ${slotText(task.startsAt, task.endsAt, tz)}`}>
              {slotText(task.startsAt, task.endsAt, tz)}
            </s>
            <Icon name="chevronRight" size={14} />
          </>
        )}
        <strong>{slotText(startsAt, endsAt, tz)}</strong>
        {outside && <span className="lx-move__tag">Fuera de horario</span>}
      </span>
    </li>
  );
};

const Block: React.FC<{
  id: string;
  title: string;
  className?: string;
  help?: string;
  children: React.ReactNode;
}> = ({id, title, className, help, children}) => (
  <section
    className={['lx-hypo-block', className].filter(Boolean).join(' ')}
    id={id}
    aria-labelledby={`${id}-title`}
  >
    <h3 className="lx-hypo-block__title" id={`${id}-title`}>
      {title}
      {help && (
        <HelpTip label={title.toLocaleLowerCase('es-ES')}>{help}</HelpTip>
      )}
    </h3>
    {children}
  </section>
);

const Notice: React.FC<{
  tone: 'error' | 'info';
  id: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({tone, id, children, action}) => (
  <div
    className={`lx-notice lx-move__notice${tone === 'error' ? ' lx-notice--error' : ''}`}
    role={tone === 'error' ? 'alert' : 'status'}
    id={id}
  >
    <Icon name={tone === 'error' ? 'alert' : 'refresh'} size={16} />
    <span className="lx-move__notice-text">{children}</span>
    {action}
  </div>
);

const EYEBROW: Record<Extract<MoveRequest, {kind: 'move'}>['origin'], string> =
  {
    calendar: 'Cambiar la hora',
    conflict_delay: 'Resolver un conflicto · retrasar',
    conflict_advance: 'Resolver un conflicto · adelantar',
  };

// ---------------------------------------------------------------- move

const MovePreview: React.FC<{
  request: Extract<MoveRequest, {kind: 'move'}>;
  onDone: (confirmed: boolean) => void;
}> = ({request, onDone}) => {
  const {timeZone, canWrite} = useActions();
  const moveTask = useLogisticsStore(s => s.moveTask);
  const toast = useLogisticsStore(s => s.toast);
  const noServer = useLogisticsStore(
    s => s.connection === 'offline' || s.fromCache,
  );
  const [snap, stale, refresh] = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'error' | 'info';
    text: string;
    recompute?: boolean;
  } | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const {taskId, minutes, origin} = request;

  const tasksById = useMemo(
    () => new Map(snap.tasks.map(t => [t.id, t])),
    [snap.tasks],
  );
  const root = tasksById.get(taskId);
  const blocker = root ? moveBlocker(root) : null;
  const analysis = useMemo(
    () =>
      root && !blocker
        ? analyzeMove({
            tasks: snap.tasks,
            events: snap.events,
            resources: snap.resources,
            venues: snap.venues.map(v => ({
              id: v.id,
              name: v.name,
              openingHours: v.openingHours ?? null,
            })),
            rootId: root.id,
            minutes,
            timeZone,
          })
        : null,
    [snap, root, blocker, minutes, timeZone],
  );

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const shifted = analysis?.impact.shifted ?? [];
  const rootShift = shifted.find(s => s.id === taskId);
  const dependants = shifted.filter(s => s.id !== taskId);
  const outside = new Set(analysis?.outsideHours ?? []);
  const venue = root?.venue
    ? snap.venues.find(v => v.id === root.venue!.id)
    : undefined;
  const rootOutside = outside.has(taskId);
  const notCheck = (w: PlanWarning) =>
    w.kind !== 'route_window' &&
    w.kind !== 'heavy_load' &&
    w.kind !== 'heavy_load_unknown';
  const fresh = analysis?.newWarnings.filter(notCheck) ?? [];
  const worse = analysis?.worsened.filter(notCheck) ?? [];
  const cleared = analysis?.clearedWarnings.filter(notCheck) ?? [];
  const tz = root ? taskZone(root) : undefined;

  const refusal = !root
    ? 'Esta tarea ya no está en el plan.'
    : blocker
      ? MOVE_BLOCKED[blocker]
      : !rootShift
        ? 'Con este cambio no se movería nada.'
        : rootOutside && venue?.openingHours
          ? `${outsideHoursMessage(venue.name, venue.openingHours)} Elige otra hora.`
          : null;

  const confirm = async () => {
    if (!analysis || !root || refusal || busy || stale) return;
    setBusy(true);
    setNotice(null);
    const before = new Map(snap.tasks.map(t => [t.id, t]));
    const expected = shiftExpectations(analysis.impact, snap.tasks);
    try {
      const res = await moveTask(root.id, {
        minutes,
        origin,
        warningKey: request.warningKey ?? null,
        expected,
      });
      const n = res.tasks.length;
      const back = undoExpectations(before, res.tasks);
      toast(
        n === 1
          ? `Hora cambiada: «${root.title}» ${slotText(rootShift!.startsAt, rootShift!.endsAt, tz)}.`
          : `Hora cambiada: «${root.title}» y ${n - 1} ${n === 2 ? 'tarea más' : 'tareas más'}.`,
        'success',
        {
          action: {
            label: 'Deshacer',
            run: () => {
              void moveTask(root.id, {
                minutes: -minutes,
                origin: 'undo',
                expected: back,
              }).then(
                () => toast('Cambio deshecho: vuelven a su hora.', 'success'),
                err =>
                  toast(`No se ha deshecho. ${errorMessage(err)}`, 'error'),
              );
            },
          },
          durationMs: 8000,
        },
      );
      onDone(true);
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        setNotice({tone: 'error', text: PLAN_CHANGED, recompute: true});
      } else if (isApiError(err) && err.fields?.minutes) {
        setNotice({
          tone: 'error',
          text: `No se ha movido. ${err.fields.minutes}`,
        });
      } else {
        setNotice({
          tone: 'error',
          text: `No se ha movido nada. ${errorMessage(err)}`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const recompute = () => {
    refresh();
    setNotice(null);
  };

  const canConfirm = canWrite && !refusal && !stale && !noServer && !!analysis;
  const n = shifted.length;

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : () => onDone(false)}
      id="lx-move-sheet"
      className="lx-sheet--hypo lx-sheet--move"
      eyebrow={EYEBROW[origin]}
      title={root?.title ?? 'Cambiar la hora'}
      meta={
        <>
          <Chip tag size="sm">
            Vista previa
          </Chip>
          {root?.venue && (
            <span className="lx-sheet__sub">{root.venue.name}</span>
          )}
        </>
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onDone(false)}
            id="lx-move-cancel"
            disabled={busy}
          >
            Cancelar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            variant="primary"
            icon="check"
            busy={busy}
            onClick={() => void confirm()}
            disabled={!canConfirm}
            id="lx-move-confirm"
            aria-describedby={
              refusal
                ? 'lx-move-refusal'
                : noServer
                  ? 'lx-move-offline'
                  : undefined
            }
          >
            {busy
              ? 'Guardando…'
              : n > 1
                ? `Confirmar cambio · ${n} tareas`
                : 'Confirmar cambio'}
          </Button>
        </>
      }
    >
      <div className="lx-move">
        {notice && (
          <div ref={noticeRef} tabIndex={-1} className="lx-move__focus">
            <Notice
              tone={notice.tone}
              id="lx-move-notice"
              action={
                notice.recompute ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="refresh"
                    onClick={recompute}
                    id="lx-move-recompute"
                  >
                    Volver a calcular
                  </Button>
                ) : undefined
              }
            >
              {notice.text}
            </Notice>
          </div>
        )}
        {stale && !notice && (
          <Notice
            tone="info"
            id="lx-move-stale"
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                onClick={recompute}
                id="lx-move-recompute"
              >
                Volver a calcular
              </Button>
            }
          >
            El plan ha cambiado mientras mirabas esta vista previa.
          </Notice>
        )}
        {noServer && (
          <p className="lx-notice" role="status" id="lx-move-offline">
            <Icon name="cloudOff" size={16} />
            Sin conexión: cambiar una hora necesita el plan tal como lo tiene el
            servidor. Podrás confirmarlo cuando vuelva la conexión.
          </p>
        )}

        {root && rootShift && (
          <div
            className={`lx-move__summary${rootOutside ? ' is-refused' : ''}`}
            id="lx-move-summary"
            tabIndex={-1}
            data-autofocus
          >
            <span className="lx-move__shift">{shiftText(minutes)}</span>
            <span className="lx-move__times lx-num">
              <s
                aria-label={`antes ${slotText(root.startsAt, root.endsAt, tz)}`}
              >
                {slotText(root.startsAt, root.endsAt, tz)}
              </s>
              <Icon name="chevronRight" size={18} />
              <strong>
                {slotText(rootShift.startsAt, rootShift.endsAt, tz)}
              </strong>
            </span>
            {venue && (
              <span className="lx-move__hours">
                <Icon name="clock" size={14} />
                {venue.openingHours
                  ? `Horario de «${venue.name}»: ${venue.openingHours.opensAt}–${venue.openingHours.closesAt}`
                  : `Horario de «${venue.name}»: pendiente de verificar`}
              </span>
            )}
          </div>
        )}

        {refusal && (
          <p
            className="lx-notice lx-notice--error"
            id="lx-move-refusal"
            role="alert"
          >
            <Icon name="alert" size={16} />
            {refusal}
          </p>
        )}

        {analysis && !refusal && (
          <>
            {dependants.length > 0 ? (
              <Block
                id="lx-move-chain"
                title={`También se mueven (${dependants.length})`}
                help="Tareas que esperan a esta y se quedarían sin margen: se mueven lo justo para seguir empezando después."
              >
                <ul className="lx-hypo-list">
                  {dependants.map(s => (
                    <MovedRow
                      key={s.id}
                      task={tasksById.get(s.id)}
                      label={s.label}
                      startsAt={s.startsAt}
                      endsAt={s.endsAt}
                      outside={outside.has(s.id)}
                    />
                  ))}
                </ul>
                {dependants.some(s => outside.has(s.id)) && (
                  <p className="lx-move__warnline" id="lx-move-chain-outside">
                    <Icon name="alert" size={15} />
                    Alguna de estas tareas quedaría fuera del horario de su
                    lugar. Se puede confirmar, pero conviene revisarla.
                  </p>
                )}
              </Block>
            ) : (
              <p className="lx-move__quiet" id="lx-move-alone">
                {analysis.impact.absorbed.length > 0
                  ? `Solo se mueve esta tarea: ${analysis.impact.absorbed.length === 1 ? 'la que la espera tiene' : 'las que la esperan tienen'} margen suficiente.`
                  : 'Solo se mueve esta tarea.'}
              </p>
            )}

            {fresh.length > 0 && (
              <Block id="lx-move-new" title="Avisos nuevos">
                <WarningItems warnings={fresh} />
              </Block>
            )}
            {worse.length > 0 && (
              <Block id="lx-move-worse" title="Avisos que empeoran">
                <WarningItems warnings={worse} />
              </Block>
            )}
            {cleared.length > 0 && (
              <Block
                id="lx-move-cleared"
                title="Dejarían de aparecer"
                className="lx-hypo-cleared"
              >
                <WarningItems warnings={cleared} />
              </Block>
            )}
            {!fresh.length && !worse.length && !cleared.length && (
              <p className="lx-move__quiet" id="lx-move-nochange">
                No aparece ni desaparece ningún conflicto.
              </p>
            )}

            {analysis.routeReminders.length > 0 && (
              <Block
                id="lx-move-routes"
                title="Rutas de emergencia y Carpa Amarilla"
                className="lx-hypo-routes"
                help={ROUTES_HELP}
              >
                <WarningItems warnings={analysis.routeReminders} />
              </Block>
            )}
            {analysis.subsoilReminders.length > 0 && (
              <Block
                id="lx-move-subsoil"
                title="Subsuelo"
                className="lx-hypo-routes"
                help={SUBSOIL_HELP}
              >
                <WarningItems warnings={analysis.subsoilReminders} />
              </Block>
            )}

            <p className="lx-hypo-confirm__keep" id="lx-move-keep">
              <Icon name="lock" size={15} />
              Solo cambian las horas: el lugar, los recursos, la carga pesada y
              la revisión del subsuelo siguen igual. Es una estimación sobre el
              plan; no certifica que la nueva hora sea segura.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------- keep both

const KeepConflict: React.FC<{
  warning: PlanWarning;
  onDone: (confirmed: boolean) => void;
}> = ({warning, onDone}) => {
  const {canWrite} = useActions();
  const tasks = useLogisticsStore(s => s.tasks);
  const events = useLogisticsStore(s => s.events);
  const resources = useLogisticsStore(s => s.resources);
  const acceptConflict = useLogisticsStore(s => s.acceptConflict);
  const toast = useLogisticsStore(s => s.toast);
  const noServer = useLogisticsStore(
    s => s.connection === 'offline' || s.fromCache,
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The warning as the plan has it now (it may be gone after a move).
  const current = useMemo(
    () =>
      planWarnings(tasks, events, resources).find(w => w.key === warning.key),
    [tasks, events, resources, warning.key],
  );
  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const windows = current ? windowsFor(current, tasks) : null;
  const trimmed = reason.trim();
  const count = trimmed.length;

  const submit = async () => {
    if (busy || !current || !windows) return;
    if (count < ACCEPT_REASON_MIN) {
      setError(
        `Escribe un motivo de al menos ${ACCEPT_REASON_MIN} caracteres: el equipo lo verá junto al aviso.`,
      );
      return;
    }
    if (count > ACCEPT_REASON_MAX) {
      setError(`El motivo admite como mucho ${ACCEPT_REASON_MAX} caracteres.`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await acceptConflict({warningKey: current.key, windows, reason: trimmed});
      toast(
        'Conflicto aceptado: se lista aparte con tu motivo. Volverá a abrirse si alguna tarea cambia de hora.',
        'success',
      );
      onDone(true);
    } catch (err) {
      if (isApiError(err) && err.code === 'DUPLICATE') {
        toast('Otra persona ya había aceptado este conflicto.', 'info');
        onDone(false);
      } else if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        setNotice(
          'Alguna de las tareas ha cambiado de hora: el conflicto ya no es el mismo. Revisa el plan antes de aceptarlo.',
        );
      } else if (isApiError(err) && err.fields?.reason) {
        setError(err.fields.reason);
      } else {
        setNotice(`No se ha guardado. ${errorMessage(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const gone = !current || !windows;
  const counterId = 'lx-keep-reason-count';

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : () => onDone(false)}
      id="lx-keep-sheet"
      className="lx-sheet--move"
      size="sm"
      eyebrow="Mantener ambas"
      title={warning.title}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onDone(false)}
            id="lx-keep-cancel"
            disabled={busy}
          >
            Cancelar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            variant="primary"
            icon="check"
            busy={busy}
            onClick={() => void submit()}
            disabled={!canWrite || gone || noServer}
            id="lx-keep-confirm"
          >
            {busy ? 'Guardando…' : 'Mantener ambas'}
          </Button>
        </>
      }
    >
      <div className="lx-move">
        {notice && (
          <Notice tone="error" id="lx-keep-notice">
            {notice}
          </Notice>
        )}
        {gone && !notice && (
          <Notice tone="info" id="lx-keep-gone">
            Este conflicto ya no aparece en el plan: no hay nada que aceptar.
          </Notice>
        )}
        {noServer && (
          <p className="lx-notice" role="status" id="lx-keep-offline">
            <Icon name="cloudOff" size={16} />
            Sin conexión: podrás guardarlo cuando vuelva la conexión.
          </p>
        )}
        <p className="lx-move__lead" tabIndex={-1} data-autofocus>
          Las dos tareas se quedan como están. El aviso deja de contar como
          pendiente y se lista aparte como «Aceptado», con tu motivo y tu
          nombre. Vuelve a abrirse solo si alguna de las dos cambia de hora.
        </p>
        {windows && (
          <ul className="lx-hypo-list" id="lx-keep-windows">
            {windows.map(w => {
              const t = tasksById.get(w.taskId);
              return (
                <li key={w.taskId} className="lx-hypo-moved">
                  <span className="lx-hypo-moved__title">
                    {t?.title ?? 'Tarea'}
                  </span>
                  <span className="lx-hypo-moved__times lx-num">
                    <strong>
                      {slotText(
                        w.startsAt,
                        w.endsAt,
                        t ? taskZone(t) : undefined,
                      )}
                    </strong>
                    {t?.venue ? ` · ${t.venue.name}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Field
          id="lx-keep-reason"
          label="Motivo"
          hint={NOTE_PRIVACY_HINT}
          error={error}
        >
          <Textarea
            id="lx-keep-reason"
            value={reason}
            rows={3}
            maxLength={ACCEPT_REASON_MAX + 40}
            invalid={!!error}
            placeholder="Por ejemplo: la descarga se hace por el acceso norte y no coincide con el montaje."
            onChange={e => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            aria-describedby={[
              describedBy('lx-keep-reason', {hint: !error, error}),
              counterId,
            ]
              .filter(Boolean)
              .join(' ')}
          />
        </Field>
        <p
          className={`lx-move__count lx-num${count > ACCEPT_REASON_MAX ? ' is-over' : ''}`}
          id={counterId}
          aria-live="polite"
        >
          {count}/{ACCEPT_REASON_MAX}
        </p>
        <p className="lx-hypo-confirm__keep" id="lx-keep-honest">
          <Icon name="lock" size={15} />
          Aceptar un conflicto no lo resuelve ni lo certifica: deja constancia
          de que el equipo lo ha revisado y por qué sigue así.
        </p>
      </div>
    </Sheet>
  );
};
