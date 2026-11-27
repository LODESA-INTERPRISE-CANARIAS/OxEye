/**
 * «¿Y si…?»: what happens to the plan if a task starts later or takes
 * longer. Everything shown is computed by `analyzeDelay` (shared) on the
 * plan in the store, inside a dashed panel labelled «Hipótesis: no cambia
 * el plan». Nothing is written until a member confirms «Aplicar al plan»,
 * and then only times move (plus «Con retraso» if ticked); the server
 * recomputes the shift and refuses it if the plan changed in between.
 *
 * Guests can explore the computation; they cannot save, apply or discard,
 * and the note of a saved hypothesis shows as «Visible para el equipo».
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  minutesLabel,
  type PlanWarning,
} from '../../../shared/logistics/conflicts.ts';
import type {
  DelayHypothesis,
  DelayMode,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {
  analyzeDelay,
  delayBlocker,
  delayModeFor,
  shiftExpectations,
  suggestedDelay,
  type DelayAnalysis,
} from '../../../shared/logistics/followup.ts';
import {hypothesisLabel} from '../../../shared/logistics/history.ts';
import {
  HYPOTHESIS_NOTE_MAX,
  NOTE_PRIVACY_HINT,
  QUICK_DELAYS,
  TASK_STATUS_LABEL,
} from '../../../shared/logistics/rules.ts';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import {errorMessage, isApiError} from '../api/client';
import {useActions} from '../common/actions';
import {TaskStatusChip} from '../common/TaskChips';
import {WarningList} from '../common/WarningList';
import {instantShort} from '../lib/format';
import {taskZone} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  Field,
  HelpTip,
  Icon,
  Input,
  Segmented,
  Select,
  Sheet,
  Textarea,
  Withheld,
  describedBy,
} from '../ui';
import {
  amountText,
  hypothesisSummary,
  marginText,
  parseDelayMinutes,
  slotText,
} from './text';

/** Where the sheet starts from. */
export type HypothesisStart =
  /** A row's «Retraso…» / «Se alarga…», or a task sheet. */
  | {kind: 'task'; taskId: string}
  /** «¿Y si…?» in Hoy: choose among today's delayable tasks. */
  | {kind: 'pick'; candidateIds: string[]; taskId?: string | null}
  /** A stored hypothesis, recomputed on the current plan. */
  | {kind: 'saved'; hypothesis: DelayHypothesis};

const MODE_OPTIONS: {value: DelayMode; label: string; title: string}[] = [
  {
    value: 'shift',
    label: 'Empieza más tarde',
    title: 'La tarea entera se desplaza: empieza y termina más tarde.',
  },
  {
    value: 'extend',
    label: 'Se alarga',
    title: 'Ya ha empezado: empieza a la misma hora y termina más tarde.',
  },
];

const BLOCKER_TEXT: Record<'finished' | 'cancelled' | 'untimed', string> = {
  finished: 'Esta tarea ya está terminada: no se puede retrasar.',
  cancelled: 'Esta tarea está cancelada: no se puede retrasar.',
  untimed:
    'A esta tarea le falta la hora de inicio o de fin: sin horario no se puede calcular qué se mueve.',
};

const MODE_NAME: Record<DelayMode, string> = {
  shift: 'Empieza más tarde',
  extend: 'Se alarga',
};

/** A stored hypothesis computed in a mode the task's status no longer fits. */
function outdatedText(h: DelayHypothesis, task: Task): string {
  const status = TASK_STATUS_LABEL[task.status].toLocaleLowerCase('es-ES');
  return `Desde que se guardó, «${task.title}» está ${status}. Esta hipótesis calcula «${MODE_NAME[h.mode]}»; con «Probar otra cifra» se calcula como «${MODE_NAME[delayModeFor(task)]}».`;
}

/** «a las 10:32» today, «el 2 dic, 10:32» another day. */
function atText(iso: string, timeZone: string, today: string): string {
  const local = utcToLocal(iso, timeZone);
  return local.date === today
    ? `a las ${local.time}`
    : `el ${instantShort(iso, timeZone)}`;
}

export const HypothesisSheet: React.FC<{
  start: HypothesisStart;
  onClose: () => void;
}> = ({start, onClose}) => {
  const {canWrite, today, timeZone} = useActions();
  const tasks = useLogisticsStore(s => s.tasks);
  const tasksReady = useLogisticsStore(s => s.tasksState === 'ready');
  const events = useLogisticsStore(s => s.events);
  const resources = useLogisticsStore(s => s.resources);
  const createHypothesis = useLogisticsStore(s => s.createHypothesis);
  const deleteHypothesis = useLogisticsStore(s => s.deleteHypothesis);
  const applyHypothesis = useLogisticsStore(s => s.applyHypothesis);
  const toast = useLogisticsStore(s => s.toast);
  // M6: hypotheses are never queued; applying needs the plan as the server
  // has it, so both wait for the connection.
  const noServer = useLogisticsStore(
    s => s.connection === 'offline' || s.fromCache,
  );
  const unsent = useLogisticsStore(s => s.unsent);
  const nowRef = useRef(Date.now());

  const opened = start.kind === 'saved' ? start.hypothesis : null;
  const [savedId, setSavedId] = useState<string | null>(opened?.id ?? null);
  const savedLive = useLogisticsStore(s =>
    savedId ? s.hypotheses.find(h => h.id === savedId) : undefined,
  );
  // The opened copy until the list has it (or after it was discarded).
  const saved: DelayHypothesis | null =
    savedLive ?? (savedId === opened?.id ? opened : null);

  const initialTaskId =
    start.kind === 'saved'
      ? start.hypothesis.taskId
      : start.kind === 'task'
        ? start.taskId
        : (start.taskId ?? start.candidateIds[0] ?? null);
  const [taskId, setTaskId] = useState<string | null>(initialTaskId);
  const root = taskId ? tasks.find(t => t.id === taskId) : undefined;

  const firstTask = initialTaskId
    ? tasks.find(t => t.id === initialTaskId)
    : undefined;
  const [mode, setMode] = useState<DelayMode>(() =>
    opened ? opened.mode : firstTask ? delayModeFor(firstTask) : 'shift',
  );
  const [minutesText, setMinutesText] = useState(() =>
    String(
      opened
        ? opened.delayMinutes
        : firstTask
          ? suggestedDelay(firstTask, nowRef.current)
          : 15,
    ),
  );
  const [estimated, setEstimated] = useState(opened?.estimated ?? false);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'explore' | 'confirm'>('explore');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [markDelayed, setMarkDelayed] = useState(true);
  const [busy, setBusy] = useState<'save' | 'apply' | 'discard' | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'error' | 'info';
    text: string;
  } | null>(null);
  const confirmTitleRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (step === 'confirm') confirmTitleRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const parsed = parseDelayMinutes(minutesText);
  const minutes = parsed.value;
  const blocker = root ? delayBlocker(root) : null;
  // A saved hypothesis shows what was stored; changing it starts a new one.
  const locked = !!saved;
  const applied = !!saved?.appliedAt;

  const analysis: DelayAnalysis<Task> | null = useMemo(() => {
    if (!root || !minutes || applied || delayBlocker(root)) return null;
    return analyzeDelay({
      tasks,
      events,
      resources,
      rootId: root.id,
      minutes,
      mode,
    });
  }, [root, minutes, mode, tasks, events, resources, applied]);

  const tz = root ? taskZone(root) : timeZone;
  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const candidates =
    start.kind === 'pick'
      ? start.candidateIds
          .map(id => tasksById.get(id))
          .filter((t): t is Task => !!t)
      : [];

  const chooseTask = (id: string) => {
    setTaskId(id);
    const t = tasksById.get(id);
    if (t) {
      setMode(delayModeFor(t));
      setMinutesText(String(suggestedDelay(t, Date.now())));
    }
    setNotice(null);
  };

  /**
   * Leaves the stored hypothesis and explores new figures from it, in the
   * mode the task's current status calls for.
   */
  const detach = () => {
    setSavedId(null);
    if (root) setMode(delayModeFor(root));
    setNote('');
    setNotice(null);
    setConfirmDiscard(false);
  };

  // The task moved on since the hypothesis was saved (e.g. it started).
  const modeOutdated =
    !!saved && !applied && !!root && saved.mode !== delayModeFor(root);

  const input = () => ({
    taskId: root!.id,
    delayMinutes: minutes!,
    mode,
    estimated,
    note: note.trim() ? note.trim() : null,
  });

  const save = async () => {
    if (!root || !minutes || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const created = await createHypothesis(input());
      setSavedId(created.id);
      toast(
        `Hipótesis guardada: ${hypothesisLabel(created)}. El plan no cambia.`,
        'success',
      );
    } catch (err) {
      setNotice({
        tone: 'error',
        text: `No se ha guardado la hipótesis. ${errorMessage(err)}`,
      });
    } finally {
      setBusy(null);
    }
  };

  const shifted = analysis?.impact.shifted ?? [];
  // Tasks of this plan with a change still on this device: the server would
  // compare against versions it has not seen yet.
  const waitingTasks =
    !!root && [root.id, ...shifted.map(s => s.id)].some(id => unsent.has(id));
  const offlineReason = noServer
    ? 'Sin conexión: la hipótesis se puede explorar, pero guardarla o aplicarla al plan necesita el servidor.'
    : waitingTasks
      ? 'Hay cambios de estas tareas guardados solo en este dispositivo: aplica la hipótesis cuando se hayan enviado.'
      : null;
  const canMarkDelayed =
    !!root && (root.status === 'planned' || root.status === 'confirmed');

  // What the member is confirming: if a background refresh changes it while
  // the confirmation is open, go back instead of changing the list under them.
  const shiftKey = shifted
    .map(s => `${s.id}@${s.startsAt}/${s.endsAt}`)
    .join('|');
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  useEffect(() => {
    if (step !== 'confirm' || busy === 'apply' || confirmedKey === null) return;
    if (shiftKey !== confirmedKey) {
      setStep('explore');
      setConfirmedKey(null);
      setNotice({
        tone: 'error',
        text: 'El plan ha cambiado mientras lo mirabas: revisa la hipótesis y vuelve a confirmar. No se ha movido nada.',
      });
    }
  }, [step, busy, shiftKey, confirmedKey]);

  const apply = async () => {
    if (!root || !minutes || !analysis || busy) return;
    setBusy('apply');
    setNotice(null);
    let target = saved && !saved.appliedAt ? saved : null;
    let savedNow = false;
    const expected = shiftExpectations(analysis.impact, tasks);
    try {
      if (!target) {
        target = await createHypothesis(input());
        setSavedId(target.id);
        savedNow = true;
      }
      await applyHypothesis(target.id, {
        expected,
        markDelayed: canMarkDelayed && markDelayed,
      });
      const n = expected.length;
      toast(
        `Plan actualizado: ${n} ${n === 1 ? 'tarea movida' : 'tareas movidas'}.`,
        'success',
      );
      onClose();
    } catch (err) {
      setStep('explore');
      setConfirmedKey(null);
      const kept = savedNow
        ? ' Se ha guardado como hipótesis abierta: el equipo la ve en Hoy.'
        : '';
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        setNotice({
          tone: 'error',
          text: `El plan ha cambiado mientras lo mirabas: revisa la hipótesis y vuelve a confirmar. No se ha movido nada.${kept}`,
        });
      } else {
        setNotice({
          tone: 'error',
          text: `No se ha aplicado: no se ha movido nada. ${errorMessage(err)}${kept}`,
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!saved || busy) return;
    setBusy('discard');
    try {
      await deleteHypothesis(saved);
      toast(`Hipótesis descartada: ${hypothesisLabel(saved)}.`, 'success');
      onClose();
    } catch (err) {
      setConfirmDiscard(false);
      setNotice({
        tone: 'error',
        text: `No se ha descartado. ${errorMessage(err)}`,
      });
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- applied
  if (saved && applied) {
    return (
      <Sheet
        open
        onClose={onClose}
        id="lx-hypo-sheet"
        eyebrow="Hipótesis aplicada"
        title={hypothesisLabel(saved)}
        footer={
          <Button variant="primary" onClick={onClose} id="lx-hypo-close">
            Cerrar
          </Button>
        }
      >
        <div className="lx-hypo-sheet">
          <p
            className="lx-notice lx-notice--quiet"
            id="lx-hypo-applied"
            tabIndex={-1}
            data-autofocus
          >
            <Icon name="check" size={16} />
            Aplicada por {saved.appliedBy?.displayName ?? 'alguien'}{' '}
            {atText(saved.appliedAt!, timeZone, today)}. Ya forma parte del
            plan: los horarios de las tareas lo reflejan.
          </p>
          <SavedFacts hypothesis={saved} today={today} timeZone={timeZone} />
        </div>
      </Sheet>
    );
  }

  // ---------------------------------------------------------------- footer
  const confirmFooter = (
    <>
      <Button
        variant="ghost"
        onClick={() => setStep('explore')}
        id="lx-hypo-back"
        disabled={busy === 'apply'}
      >
        Volver
      </Button>
      <span className="lx-sheet__foot-spacer" />
      <Button
        variant="primary"
        icon="check"
        busy={busy === 'apply'}
        onClick={() => void apply()}
        id="lx-hypo-apply-confirm"
      >
        {busy === 'apply'
          ? 'Aplicando…'
          : `Aplicar: mover ${shifted.length} ${shifted.length === 1 ? 'tarea' : 'tareas'}`}
      </Button>
    </>
  );

  const discardFooter = (
    <div
      className="lx-confirm-strip"
      role="alertdialog"
      aria-labelledby="lx-hypo-discard-text"
    >
      <p id="lx-hypo-discard-text">
        ¿Descartar esta hipótesis? Dejará de verse en Hoy.
      </p>
      <div className="lx-confirm-strip__actions">
        <Button
          onClick={() => setConfirmDiscard(false)}
          id="lx-hypo-discard-keep"
        >
          Cancelar
        </Button>
        <Button
          variant="danger"
          busy={busy === 'discard'}
          onClick={() => void discard()}
          id="lx-hypo-discard-confirm"
        >
          Descartar
        </Button>
      </div>
    </div>
  );

  const exploreFooter = canWrite ? (
    <>
      {saved ? (
        <Button
          variant="ghost"
          icon="trash"
          className="lx-btn--danger-text"
          id="lx-hypo-discard"
          disabled={!!busy}
          onClick={() => setConfirmDiscard(true)}
        >
          Descartar
        </Button>
      ) : (
        <Button variant="ghost" onClick={onClose} id="lx-hypo-close">
          Cerrar
        </Button>
      )}
      <span className="lx-sheet__foot-spacer" />
      {!saved && (
        <Button
          id="lx-hypo-save"
          busy={busy === 'save'}
          disabled={!analysis || busy === 'apply' || noServer}
          aria-describedby={noServer ? 'lx-hypo-offline' : undefined}
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Guardando…' : 'Guardar hipótesis'}
        </Button>
      )}
      <Button
        variant="primary"
        id="lx-hypo-apply"
        disabled={!analysis || !!busy || !!offlineReason}
        aria-describedby={offlineReason ? 'lx-hypo-offline' : undefined}
        onClick={() => {
          setNotice(null);
          setConfirmedKey(shiftKey);
          setStep('confirm');
        }}
      >
        Aplicar al plan…
      </Button>
    </>
  ) : (
    <Button variant="primary" onClick={onClose} id="lx-hypo-close">
      Cerrar
    </Button>
  );

  const footer =
    step === 'confirm'
      ? confirmFooter
      : confirmDiscard
        ? discardFooter
        : exploreFooter;

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : onClose}
      id="lx-hypo-sheet"
      className="lx-sheet--hypo"
      eyebrow={saved ? 'Hipótesis guardada' : '¿Y si…?'}
      title={root ? root.title : saved ? saved.taskTitle : '¿Y si se retrasa?'}
      meta={
        <>
          <Chip certainty="hypothesis" size="sm" />

          {root && <TaskStatusChip status={root.status} />}
          {root && (
            <span className="lx-sheet__sub lx-num">
              {slotText(root.startsAt, root.endsAt, tz)}
              {root.venue ? ` · ${root.venue.name}` : ''}
            </span>
          )}
        </>
      }
      footer={footer}
    >
      <div className="lx-hypo-sheet">
        {notice && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            className={`lx-notice ${notice.tone === 'error' ? 'lx-notice--error' : ''}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            id="lx-hypo-notice"
          >
            <Icon name={notice.tone === 'error' ? 'alert' : 'eye'} size={16} />
            {notice.text}
          </p>
        )}
        {canWrite && offlineReason && (
          <p className="lx-notice" role="status" id="lx-hypo-offline">
            <Icon name={noServer ? 'cloudOff' : 'clock'} size={16} />
            {offlineReason}
          </p>
        )}

        {step === 'confirm' && analysis && root ? (
          <ConfirmStep
            analysis={analysis}
            root={root}
            tasksById={tasksById}
            canMarkDelayed={canMarkDelayed}
            markDelayed={markDelayed}
            onMarkDelayed={setMarkDelayed}
            titleRef={confirmTitleRef}
          />
        ) : (
          <>
            {start.kind === 'pick' && !locked && (
              <Field
                id="lx-hypo-task"
                label="Tarea"
                hint={
                  candidates.length
                    ? 'Primero las que van tarde y las de ahora.'
                    : undefined
                }
              >
                <Select
                  id="lx-hypo-task"
                  value={taskId ?? ''}
                  aria-describedby={describedBy('lx-hypo-task', {
                    hint: candidates.length,
                  })}
                  onChange={e => chooseTask(e.target.value)}
                >
                  {candidates.map(t => (
                    <option key={t.id} value={t.id}>
                      {slotText(t.startsAt, t.endsAt, taskZone(t))} · {t.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {!root && (
              <p className="lx-notice" role="status" id="lx-hypo-missing">
                <Icon name="eye" size={16} />
                {!tasksReady
                  ? 'Cargando el plan…'
                  : start.kind === 'pick' && !candidates.length
                    ? 'Hoy no queda ninguna tarea con horario que se pueda retrasar.'
                    : 'Esta tarea ya no está en el plan.'}
              </p>
            )}
            {root && blocker && (
              <p className="lx-notice" role="status" id="lx-hypo-blocked">
                <Icon name="eye" size={16} />
                {BLOCKER_TEXT[blocker]}
              </p>
            )}

            {root && !blocker && (
              <>
                {locked && saved ? (
                  <div className="lx-hypo-saved" id="lx-hypo-saved">
                    <SavedFacts
                      hypothesis={saved}
                      today={today}
                      timeZone={timeZone}
                    />
                    {modeOutdated && root && (
                      <p
                        className="lx-notice"
                        role="status"
                        id="lx-hypo-outdated"
                      >
                        <Icon name="eye" size={16} />
                        {outdatedText(saved, root)}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="edit"
                      id="lx-hypo-detach"
                      onClick={detach}
                    >
                      Probar otra cifra
                    </Button>
                  </div>
                ) : (
                  <DelayInputs
                    mode={mode}
                    onMode={m => {
                      setMode(m);
                      setNotice(null);
                    }}
                    minutesText={minutesText}
                    onMinutes={t => {
                      setMinutesText(t);
                      setNotice(null);
                    }}
                    error={minutesText.trim() ? parsed.error : null}
                    estimated={estimated}
                    onEstimated={setEstimated}
                  />
                )}

                {analysis && minutes && (
                  <Results
                    analysis={analysis}
                    root={root}
                    minutes={minutes}
                    estimated={estimated}
                    tasksById={tasksById}
                  />
                )}

                {canWrite && !locked && (
                  <Field
                    id="lx-hypo-note"
                    label="Nota para el equipo"
                    optional
                    hint={NOTE_PRIVACY_HINT}
                  >
                    <Textarea
                      id="lx-hypo-note"
                      rows={2}
                      maxLength={HYPOTHESIS_NOTE_MAX}
                      value={note}
                      aria-describedby={describedBy('lx-hypo-note', {
                        hint: true,
                      })}
                      placeholder="El camión avisa de que sale tarde del almacén."
                      onChange={e => setNote(e.target.value)}
                    />
                  </Field>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------- pieces

/** Who saved it, when, the figures and the note (or «Visible para el equipo»). */
const SavedFacts: React.FC<{
  hypothesis: DelayHypothesis;
  today: string;
  timeZone: string;
}> = ({hypothesis: h, today, timeZone}) => (
  <dl className="lx-detail lx-hypo-facts">
    <div>
      <dt>Retraso</dt>
      <dd className="lx-num">
        {h.mode === 'extend' ? 'Se alarga ' : 'Empieza '}
        {amountText(h.delayMinutes, h.estimated)}
        {h.mode === 'extend' ? '' : ' más tarde'}
        {h.estimated ? ' (estimación)' : ''}
      </dd>
    </div>
    <div>
      <dt>Guardada por</dt>
      <dd>
        {h.createdBy.displayName} {atText(h.createdAt, timeZone, today)}
      </dd>
    </div>
    <div>
      <dt>Nota</dt>
      <dd className="lx-detail__notes">
        {h.restricted ? (
          <Withheld />
        ) : h.note ? (
          h.note
        ) : (
          <span className="lx-muted">—</span>
        )}
      </dd>
    </div>
  </dl>
);

const DelayInputs: React.FC<{
  mode: DelayMode;
  onMode: (mode: DelayMode) => void;
  minutesText: string;
  onMinutes: (text: string) => void;
  error: string | null;
  estimated: boolean;
  onEstimated: (on: boolean) => void;
}> = ({
  mode,
  onMode,
  minutesText,
  onMinutes,
  error,
  estimated,
  onEstimated,
}) => (
  <div className="lx-hypo-inputs">
    <Segmented<DelayMode>
      name="lx-hypo-mode"
      id="lx-hypo-mode"
      legend="Qué pasa"
      value={mode}
      options={MODE_OPTIONS}
      onChange={v => v && onMode(v)}
      help="Empieza más tarde: la tarea entera se desplaza. Se alarga: ya ha empezado, empieza a la misma hora y termina más tarde."
    />
    <fieldset className="lx-hypo-amount" id="lx-hypo-amount">
      <legend className="lx-field__label lx-segmented__legend">¿Cuánto?</legend>
      <div className="lx-hypo-amount__row">
        {QUICK_DELAYS.map(m => (
          <button
            key={m}
            type="button"
            className="lx-hypo-quick"
            id={`lx-hypo-quick-${m}`}
            aria-pressed={minutesText.trim() === String(m)}
            onClick={() => onMinutes(String(m))}
          >
            <span className="lx-num">{minutesLabel(m)}</span>
          </button>
        ))}
        <span className="lx-hypo-amount__other">
          <Input
            id="lx-hypo-minutes"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Otra cifra, en minutos"
            aria-invalid={!!error || undefined}
            aria-describedby={describedBy('lx-hypo-minutes', {error})}
            className="lx-num"
            value={minutesText}
            onChange={e => onMinutes(e.target.value)}
          />
          <span className="lx-hypo-amount__unit" aria-hidden="true">
            min
          </span>
        </span>
      </div>
      {error && (
        <p className="lx-field__error" id="lx-hypo-minutes-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
    <div className="lx-hypo-estimate">
      <span className="lx-switch">
        <input
          type="checkbox"
          role="switch"
          id="lx-hypo-estimated"
          checked={estimated}
          onChange={e => onEstimated(e.target.checked)}
        />
        <label htmlFor="lx-hypo-estimated">
          <span className="lx-switch__track" aria-hidden="true" />
          Es una estimación <span className="lx-num">(≈)</span>
        </label>
      </span>
      <HelpTip label="estimación">
        Actívalo si la cifra es aproximada («el camión dice que unos 15
        minutos»). Se muestra con ≈ para que nadie la lea como un dato exacto.
      </HelpTip>
    </div>
  </div>
);

/** A moved task: old time struck through, new time after it. */
const MovedRow: React.FC<{
  task: Task | undefined;
  label: string;
  startsAt: string;
  endsAt: string;
  isRoot: boolean;
}> = ({task, label, startsAt, endsAt, isRoot}) => {
  const tz = task ? taskZone(task) : undefined;
  return (
    <li className={`lx-hypo-moved${isRoot ? ' is-root' : ''}`}>
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
      </span>
    </li>
  );
};

/** Same wording as the move sheet: the reminder is fixed, never a «safe» verdict. */
const HYPOTHESIS_ROUTES_HELP =
  'El Gestor no conoce el trazado de las rutas de emergencia (A, acceso de vehículos; B, sanitarios a pie; C, evacuación en camilla) ni el de la Carpa Amarilla. Este recordatorio aparece siempre que la hipótesis mueve una tarea con vehículos o carga: revisa la nueva hora en el simulador. No indica que la nueva hora sea segura.';

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

const Results: React.FC<{
  analysis: DelayAnalysis<Task>;
  root: Task;
  minutes: number;
  estimated: boolean;
  tasksById: Map<string, Task>;
}> = ({analysis, root, minutes, estimated, tasksById}) => {
  const {impact} = analysis;
  const notRoutes = (w: PlanWarning) => w.kind !== 'route_window';
  const fresh = analysis.newWarnings.filter(notRoutes);
  const worse = analysis.worsened.filter(notRoutes);
  const unknown = impact.unknown.filter(id => id !== impact.rootId);
  return (
    <section
      className="lx-hypo"
      id="lx-hypo-results"
      aria-labelledby="lx-hypo-label"
    >
      <p className="lx-hypo__label" id="lx-hypo-label">
        <Icon name="flask" size={16} />
        Hipótesis: no cambia el plan
      </p>
      <p
        className="lx-hypo__summary"
        id="lx-hypo-summary"
        tabIndex={-1}
        data-autofocus
        aria-live="polite"
      >
        {hypothesisSummary({title: root.title, minutes, estimated, analysis})}
      </p>

      {analysis.eventMargins.length > 0 && (
        <Block
          id="lx-hypo-margins"
          title="Margen hasta el evento"
          help="Minutos entre el final de la última tarea que se mueve y el inicio del evento. Si es negativo, la preparación entraría en el horario del evento."
        >
          <ul className="lx-hypo-list">
            {analysis.eventMargins.map(m => {
              const t = marginText(m);
              return (
                <li
                  key={m.eventId}
                  className={`lx-hypo-margin${t.over ? ' is-over' : ''}`}
                >
                  {t.over && <Icon name="alert" size={16} />}
                  {t.text}
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      <Block id="lx-hypo-shifted" title="Se mueven">
        <ul className="lx-hypo-list">
          {impact.shifted.map(s => (
            <MovedRow
              key={s.id}
              task={tasksById.get(s.id)}
              label={s.label}
              startsAt={s.startsAt}
              endsAt={s.endsAt}
              isRoot={s.id === impact.rootId}
            />
          ))}
        </ul>
      </Block>

      {impact.absorbed.length > 0 && (
        <Block
          id="lx-hypo-absorbed"
          title="Absorben el retraso"
          help="Esperan a que termine, pero tienen margen suficiente: no se mueven."
        >
          <ul className="lx-hypo-list">
            {impact.absorbed.map(a => (
              <li key={a.id} className="lx-hypo-absorbed">
                <span>{tasksById.get(a.id)?.title ?? a.label}</span>
                <span className="lx-muted lx-num">
                  le {a.slackLeft === 1 ? 'queda' : 'quedan'}{' '}
                  {minutesLabel(a.slackLeft)} de margen
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {unknown.length > 0 && (
        <Block id="lx-hypo-unknown" title="Sin hora: no se puede calcular">
          <ul className="lx-hypo-list">
            {unknown.map(id => (
              <li key={id} className="lx-hypo-unknown">
                <span className="lx-chip__dot" aria-hidden="true" />
                {tasksById.get(id)?.title ?? 'Tarea'}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {analysis.routeReminders.length > 0 && (
        <Block
          id="lx-hypo-routes"
          title="Rutas de emergencia y Carpa Amarilla"
          className="lx-hypo-routes"
          help={HYPOTHESIS_ROUTES_HELP}
        >
          <WarningList warnings={analysis.routeReminders} />
        </Block>
      )}

      {fresh.length > 0 && (
        <Block id="lx-hypo-new" title="Avisos nuevos">
          <WarningList warnings={fresh} />
        </Block>
      )}
      {worse.length > 0 && (
        <Block id="lx-hypo-worse" title="Avisos que empeoran">
          <WarningList warnings={worse} />
        </Block>
      )}
      {analysis.clearedWarnings.length > 0 && (
        <Block
          id="lx-hypo-cleared"
          title="Dejarían de aparecer"
          className="lx-hypo-cleared"
        >
          <WarningList warnings={analysis.clearedWarnings} />
        </Block>
      )}
    </section>
  );
};

const ConfirmStep: React.FC<{
  analysis: DelayAnalysis<Task>;
  root: Task;
  tasksById: Map<string, Task>;
  canMarkDelayed: boolean;
  markDelayed: boolean;
  onMarkDelayed: (on: boolean) => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
}> = ({
  analysis,
  root,
  tasksById,
  canMarkDelayed,
  markDelayed,
  onMarkDelayed,
  titleRef,
}) => {
  const {shifted} = analysis.impact;
  const over = analysis.eventMargins.filter(m => m.after < 0);
  return (
    <div className="lx-hypo-confirm" id="lx-hypo-confirm">
      <h3
        className="lx-hypo-confirm__title"
        id="lx-hypo-confirm-title"
        tabIndex={-1}
        ref={titleRef}
      >
        Aplicar al plan
      </h3>
      <p>
        Se{' '}
        {shifted.length === 1
          ? 'cambiará el horario de 1 tarea'
          : `cambiará el horario de ${shifted.length} tareas`}
        :
      </p>
      <ul className="lx-hypo-list" id="lx-hypo-confirm-list">
        {shifted.map(s => (
          <MovedRow
            key={s.id}
            task={tasksById.get(s.id)}
            label={s.label}
            startsAt={s.startsAt}
            endsAt={s.endsAt}
            isRoot={s.id === root.id}
          />
        ))}
      </ul>
      {canMarkDelayed && (
        <label className="lx-check" htmlFor="lx-hypo-mark-delayed">
          <input
            type="checkbox"
            id="lx-hypo-mark-delayed"
            checked={markDelayed}
            onChange={e => onMarkDelayed(e.target.checked)}
          />
          <span>
            Marcar «{root.title}» como {TASK_STATUS_LABEL.delayed}
          </span>
        </label>
      )}
      {over.map(m => (
        <p
          className="lx-notice lx-notice--error"
          key={m.eventId}
          id={`lx-hypo-confirm-over-${m.eventId}`}
        >
          <Icon name="alert" size={16} />
          {marginText(m).text}
        </p>
      ))}
      {analysis.routeReminders.length > 0 && (
        <div
          className="lx-hypo-block lx-hypo-routes"
          id="lx-hypo-confirm-routes"
        >
          <p className="lx-hypo-block__title">
            Rutas de emergencia y Carpa Amarilla
          </p>
          <WarningList warnings={analysis.routeReminders} />
        </div>
      )}
      <p className="lx-hypo-confirm__keep" id="lx-hypo-confirm-keep">
        <Icon name="lock" size={15} />
        La carga pesada, los recursos y la revisión del subsuelo no cambian.
      </p>
    </div>
  );
};
