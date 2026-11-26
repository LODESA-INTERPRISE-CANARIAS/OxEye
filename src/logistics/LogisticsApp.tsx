/**
 * OxEye Logistics Manager («Gestor logístico»): full-screen layer over the
 * hub, lazy-loaded from the main menu. Default export for `React.lazy`.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {LogisticsEvent, Task} from '../../shared/logistics/contracts.ts';
import {DEFAULT_TIMEZONE} from '../../shared/logistics/time.ts';
import '../styles/logistics/index.css';
import {CalendarScreen} from './calendar/CalendarScreen';
import {
  ActionsContext,
  type LogisticsActions,
  type TaskPrefill,
} from './common/actions';
import {EventSheet, type EventSheetMode} from './events/EventSheet';
import {HoyScreen} from './hoy/HoyScreen';
import {longDate, todayIn, zoneNote} from './lib/format';
import {clearRescue, readRescue} from './lib/rescue';
import {LoginScreen} from './screens/LoginScreen';
import {PlaceholderScreen} from './screens/PlaceholderScreen';
import {ServerGate} from './screens/ServerGate';
import {Shell} from './shell/Shell';
import {
  calendarDayFromHash,
  hashFor,
  MAIN_SPACES,
  SPACE_TITLE,
  spaceFromHash,
  type Space,
} from './shell/spaces';
import {useLogisticsStore} from './store/useLogisticsStore';
import {TaskSheet, type TaskSheetMode} from './tasks/TaskSheet';
import {ToastHostContext, Toaster, type ToastHost} from './ui';

const BACKGROUND_REFRESH_MS = 60_000;

export interface LogisticsAppProps {
  /** Leaves the module and returns to the OxEye hub. */
  onClose: () => void;
}

function spaceIndex(space: Space): number {
  const i = MAIN_SPACES.findIndex(s => s.id === space);
  return i < 0 ? MAIN_SPACES.length : i;
}

function replaceHash(target: string) {
  if (window.location.hash !== target) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${target}`,
    );
  }
}

const LogisticsApp: React.FC<LogisticsAppProps> = ({onClose}) => {
  const phase = useLogisticsStore(s => s.phase);
  const session = useLogisticsStore(s => s.session);
  const organizations = useLogisticsStore(s => s.organizations);
  const orgId = useLogisticsStore(s => s.orgId);
  const toasts = useLogisticsStore(s => s.toasts);
  const dismissToast = useLogisticsStore(s => s.dismissToast);
  const boot = useLogisticsStore(s => s.boot);
  const refresh = useLogisticsStore(s => s.refresh);
  const setBrowserOnline = useLogisticsStore(s => s.setBrowserOnline);

  const rootRef = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState<Space>(() =>
    spaceFromHash(window.location.hash),
  );
  const [calendarDay, setCalendarDay] = useState<string | null>(() =>
    calendarDayFromHash(window.location.hash),
  );
  const [timeline, setTimeline] = useState(false);
  const [direction, setDirection] = useState<1 | -1 | 0>(0);
  const [eventSheet, setEventSheet] = useState<EventSheetMode | null>(null);
  const [taskSheet, setTaskSheet] = useState<TaskSheetMode | null>(null);
  // Open sheets offer a slot for the toasts; the topmost one wins.
  const [toastSlots, setToastSlots] = useState<HTMLElement[]>([]);
  const toastHost = useMemo<ToastHost>(
    () => ({
      add: slot => setToastSlots(s => [...s.filter(x => x !== slot), slot]),
      remove: slot => setToastSlots(s => s.filter(x => x !== slot)),
    }),
    [],
  );

  const org = organizations.find(o => o.id === orgId);
  const timeZone = org?.timezone || DEFAULT_TIMEZONE;
  const [today, setToday] = useState(() => todayIn(timeZone));
  // Without an organization there is nowhere to write to.
  const canWrite = session?.user.role === 'member' && !!orgId;
  const userId = session?.user.id ?? null;

  useEffect(() => {
    void boot();
    rootRef.current?.focus();
  }, [boot]);

  // A sheet belongs to the session that opened it: drop it when the session
  // ends, and after signing in again reopen any form rescued from an expired
  // session (same person only; anyone else's rescue is discarded).
  useEffect(() => {
    if (phase !== 'ready') {
      setEventSheet(null);
      setTaskSheet(null);
      return;
    }
    if (!userId) return;
    const rescued = readRescue();
    if (!rescued) return;
    if (rescued.userId !== userId || !canWrite) {
      clearRescue();
      return;
    }
    if (rescued.orgId && rescued.orgId !== orgId) return;
    if (rescued.entity === 'task') {
      setTaskSheet(
        rescued.base
          ? {kind: 'edit', task: rescued.base, rescued: rescued.values}
          : {kind: 'create', rescued: rescued.values},
      );
    } else {
      setEventSheet(
        rescued.base
          ? {kind: 'edit', event: rescued.base, rescued: rescued.values}
          : {kind: 'create', rescued: rescued.values},
      );
    }
  }, [phase, userId, orgId, canWrite]);

  // Keep «today» right across midnight and time-zone changes.
  useEffect(() => {
    setToday(todayIn(timeZone));
    const timer = window.setInterval(() => setToday(todayIn(timeZone)), 60_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);

  // Connectivity and background refresh, so the office sees field updates.
  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true);
      void refresh({silent: true});
    };
    const onOffline = () => setBrowserOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh({silent: true});
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh({silent: true});
    }, BACKGROUND_REFRESH_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh, setBrowserOnline]);

  const goTo = useCallback(
    (next: Space, day: string | null = null) => {
      if (next === space && (next !== 'calendario' || day === calendarDay)) {
        return;
      }
      if (next !== space) {
        setDirection(spaceIndex(next) > spaceIndex(space) ? 1 : -1);
        setSpace(next);
        rootRef.current?.querySelector('.lx-main')?.scrollTo?.({top: 0});
      }
      setCalendarDay(next === 'calendario' ? day : null);
      replaceHash(hashFor(next, next === 'calendario' ? day : null));
    },
    [space, calendarDay],
  );

  // Follow links pasted or navigated while the module is open.
  useEffect(() => {
    const onHashChange = () => {
      if (!window.location.hash.startsWith('#logistica')) return;
      const next = spaceFromHash(window.location.hash);
      setCalendarDay(calendarDayFromHash(window.location.hash));
      setSpace(current => {
        if (current !== next) {
          setDirection(spaceIndex(next) > spaceIndex(current) ? 1 : -1);
        }
        return next;
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** The calendar moved between month and a day: keep the link in step. */
  const onCalendarDay = useCallback((day: string | null) => {
    setCalendarDay(day);
    replaceHash(hashFor('calendario', day));
  }, []);

  const openEvent = useCallback(
    (event: LogisticsEvent) =>
      setEventSheet(canWrite ? {kind: 'edit', event} : {kind: 'view', event}),
    [canWrite],
  );
  const addEvent = useCallback(() => setEventSheet({kind: 'create'}), []);
  const openTask = useCallback(
    (task: Task) =>
      setTaskSheet(canWrite ? {kind: 'edit', task} : {kind: 'view', task}),
    [canWrite],
  );
  const addTask = useCallback(
    (prefill?: TaskPrefill) => setTaskSheet({kind: 'create', prefill}),
    [],
  );
  /** «+ Añadir → Tarea» starts on the calendar day being looked at. */
  const addTaskHere = useCallback(
    () =>
      addTask(
        space === 'calendario' && calendarDay
          ? {date: calendarDay}
          : space === 'hoy'
            ? {date: today}
            : undefined,
      ),
    [addTask, space, calendarDay, today],
  );
  const openDay = useCallback(
    (date: string) => goTo('calendario', date),
    [goTo],
  );

  const actions = useMemo<LogisticsActions>(
    () => ({
      canWrite,
      today,
      timeZone,
      openEvent,
      addEvent,
      openTask,
      addTask,
      openDay,
    }),
    [
      canWrite,
      today,
      timeZone,
      openEvent,
      addEvent,
      openTask,
      addTask,
      openDay,
    ],
  );

  const timelineActive = space === 'calendario' && timeline;

  let body: React.ReactNode;
  if (phase === 'login') {
    body = <LoginScreen onExit={onClose} />;
  } else if (phase !== 'ready') {
    body = <ServerGate onExit={onClose} />;
  } else {
    const name = session?.user.displayName ?? '';
    body = (
      <Shell
        space={space}
        onSpace={goTo}
        direction={direction}
        title={space === 'hoy' ? `Hola, ${name}` : SPACE_TITLE[space]}
        subtitle={
          <>
            <span className="lx-num">{longDate(today)}</span> ·{' '}
            {zoneNote(timeZone)}
          </>
        }
        canWrite={canWrite}
        onAddEvent={addEvent}
        onAddTask={addTaskHere}
        swipeLocked={timelineActive}
        onExit={onClose}
      >
        {space === 'hoy' ? (
          <HoyScreen
            today={today}
            timeZone={timeZone}
            canWrite={canWrite}
            onOpenEvent={openEvent}
            onAdd={addEvent}
          />
        ) : space === 'calendario' ? (
          <CalendarScreen
            day={calendarDay}
            onDay={onCalendarDay}
            onTimelineChange={setTimeline}
          />
        ) : (
          <PlaceholderScreen space={space} onGoToday={() => goTo('hoy')} />
        )}
      </Shell>
    );
  }

  return (
    <div
      className="lx"
      id="logistics-app"
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-label="Gestor logístico"
      data-phase={phase}
      data-timeline={timelineActive || undefined}
    >
      <ToastHostContext.Provider value={toastHost}>
        <ActionsContext.Provider value={actions}>
          {body}
          {phase === 'ready' && (
            <>
              {/* Keyed by record (namespaced, they are siblings): opening
                  another one starts a fresh form. */}
              <EventSheet
                key={`event:${
                  eventSheet?.kind === 'create'
                    ? 'new'
                    : (eventSheet?.event.id ?? 'closed')
                }`}
                mode={eventSheet}
                onClose={() => setEventSheet(null)}
              />
              <TaskSheet
                key={`task:${
                  taskSheet?.kind === 'create'
                    ? 'new'
                    : (taskSheet?.task.id ?? 'closed')
                }`}
                mode={taskSheet}
                onClose={() => setTaskSheet(null)}
              />
            </>
          )}
        </ActionsContext.Provider>
      </ToastHostContext.Provider>
      <Toaster
        toasts={toasts}
        onDismiss={dismissToast}
        host={toastSlots[toastSlots.length - 1] ?? null}
      />
    </div>
  );
};

export default LogisticsApp;
