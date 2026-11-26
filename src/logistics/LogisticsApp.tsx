/**
 * OxEye Logistics Manager («Gestor logístico»): full-screen layer over the
 * hub, lazy-loaded from the main menu. Default export for `React.lazy`.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  Company,
  Contact,
  LogisticsEvent,
  Offer,
  Task,
} from '../../shared/logistics/contracts.ts';
import {DEFAULT_TIMEZONE} from '../../shared/logistics/time.ts';
import '../styles/logistics/index.css';
import {CalendarScreen} from './calendar/CalendarScreen';
import {CatalogScreen} from './catalog/CatalogScreen';
import {OfferSheet, type OfferSheetMode} from './catalog/OfferSheet';
import {
  ActionsContext,
  type CompanyPrefill,
  type ContactPrefill,
  type LogisticsActions,
  type OfferPrefill,
  type TaskPrefill,
} from './common/actions';
import {CompanySheet, type CompanySheetMode} from './contacts/CompanySheet';
import {ContactSheet, type ContactSheetMode} from './contacts/ContactSheet';
import {ContactsScreen} from './contacts/ContactsScreen';
import {EventSheet, type EventSheetMode} from './events/EventSheet';
import {HoyScreen} from './hoy/HoyScreen';
import {longDate, todayIn, zoneNote} from './lib/format';
import {clearRescue, readRescue} from './lib/rescue';
import {LoginScreen} from './screens/LoginScreen';
import {PlaceholderScreen} from './screens/PlaceholderScreen';
import {ServerGate} from './screens/ServerGate';
import {SearchSheet} from './search/SearchSheet';
import {VenueSheet} from './search/VenueSheet';
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

/**
 * A directory sheet and the opening it belongs to: every opening gets a new
 * key, so the sheet remounts on top of whatever is open (a person opened from
 * a company opened from a person) instead of staying underneath.
 */
interface Opened<M> {
  mode: M;
  seq: number;
}

/** Whether the user is typing somewhere (then «/» is just a character). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  );
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
  // Task and event sheets stack: opening another one (e.g. a task from the
  // person sheet opened from a task) mounts it on top and keeps any sheet
  // with unsaved changes underneath; clean ones are simply replaced.
  const [eventSheets, setEventSheets] = useState<Opened<EventSheetMode>[]>([]);
  const [taskSheets, setTaskSheets] = useState<Opened<TaskSheetMode>[]>([]);
  const dirtySheets = useRef(new Set<number>());
  const markDirty = useCallback((seq: number, dirty: boolean) => {
    if (dirty) dirtySheets.current.add(seq);
    else dirtySheets.current.delete(seq);
  }, []);
  const [contactSheet, setContactSheet] =
    useState<Opened<ContactSheetMode> | null>(null);
  const [companySheet, setCompanySheet] =
    useState<Opened<CompanySheetMode> | null>(null);
  const [offerSheet, setOfferSheet] = useState<Opened<OfferSheetMode> | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  const openSeq = useRef(0);
  const opened = useCallback(
    <M,>(mode: M): Opened<M> => ({mode, seq: ++openSeq.current}),
    [],
  );
  /** Puts a new sheet on the stack, dropping the clean ones under it. */
  const stack = useCallback(
    <M,>(next: Opened<M>) =>
      (sheets: Opened<M>[]) => [
        ...sheets.filter(s => dirtySheets.current.has(s.seq)),
        next,
      ],
    [],
  );
  const unstack = useCallback(
    (seq: number) =>
      <M,>(sheets: Opened<M>[]) => {
        dirtySheets.current.delete(seq);
        return sheets.filter(s => s.seq !== seq);
      },
    [],
  );
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
      setEventSheets([]);
      setTaskSheets([]);
      dirtySheets.current.clear();
      setContactSheet(null);
      setCompanySheet(null);
      setOfferSheet(null);
      setSearchOpen(false);
      setVenueId(null);
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
      setTaskSheets([
        opened<TaskSheetMode>(
          rescued.base
            ? {kind: 'edit', task: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      ]);
    } else if (rescued.entity === 'contact') {
      setContactSheet(
        opened<ContactSheetMode>(
          rescued.base
            ? {kind: 'edit', contact: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      );
    } else if (rescued.entity === 'company') {
      setCompanySheet(
        opened<CompanySheetMode>(
          rescued.base
            ? {kind: 'edit', company: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      );
    } else if (rescued.entity === 'offer') {
      setOfferSheet(
        opened<OfferSheetMode>(
          rescued.base
            ? {kind: 'edit', offer: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      );
    } else {
      setEventSheets([
        opened<EventSheetMode>(
          rescued.base
            ? {kind: 'edit', event: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      ]);
    }
  }, [phase, userId, orgId, canWrite, opened]);

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
      setEventSheets(
        stack(
          opened<EventSheetMode>(
            canWrite ? {kind: 'edit', event} : {kind: 'view', event},
          ),
        ),
      ),
    [canWrite, opened, stack],
  );
  const addEvent = useCallback(
    () => setEventSheets(stack(opened<EventSheetMode>({kind: 'create'}))),
    [opened, stack],
  );
  const openTask = useCallback(
    (task: Task) =>
      setTaskSheets(
        stack(
          opened<TaskSheetMode>(
            canWrite ? {kind: 'edit', task} : {kind: 'view', task},
          ),
        ),
      ),
    [canWrite, opened, stack],
  );
  const addTask = useCallback(
    (prefill?: TaskPrefill) =>
      setTaskSheets(stack(opened<TaskSheetMode>({kind: 'create', prefill}))),
    [opened, stack],
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

  // People, companies and offers open on their card (view) for everyone:
  // they are looked up far more often than edited; «Editar» is on the card.
  const openContact = useCallback(
    (contact: Contact) =>
      setContactSheet(opened<ContactSheetMode>({kind: 'view', contact})),
    [opened],
  );
  const addContact = useCallback(
    (prefill?: ContactPrefill) =>
      setContactSheet(opened<ContactSheetMode>({kind: 'create', prefill})),
    [opened],
  );
  const openCompany = useCallback(
    (company: Company) =>
      setCompanySheet(opened<CompanySheetMode>({kind: 'view', company})),
    [opened],
  );
  const addCompany = useCallback(
    (prefill?: CompanyPrefill) =>
      setCompanySheet(opened<CompanySheetMode>({kind: 'create', prefill})),
    [opened],
  );
  const openOffer = useCallback(
    (offer: Offer) =>
      setOfferSheet(opened<OfferSheetMode>({kind: 'view', offer})),
    [opened],
  );
  const addOffer = useCallback(
    (prefill?: OfferPrefill) =>
      setOfferSheet(opened<OfferSheetMode>({kind: 'create', prefill})),
    [opened],
  );
  const openVenue = useCallback((id: string) => setVenueId(id), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);

  // «/» or Ctrl+K (⌘K) opens the search from anywhere in the workspace, but
  // never over an open sheet or while typing «/» in a field.
  useEffect(() => {
    if (phase !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const combo =
        (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!combo && !(slash && !isTyping(e.target))) return;
      if (rootRef.current?.querySelector('dialog[open]')) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase]);

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
      openContact,
      addContact,
      openCompany,
      addCompany,
      openOffer,
      addOffer,
      openVenue,
      openSearch,
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
      openContact,
      addContact,
      openCompany,
      addCompany,
      openOffer,
      addOffer,
      openVenue,
      openSearch,
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
        onAddContact={addContact}
        onAddCompany={addCompany}
        onAddOffer={addOffer}
        onSearch={openSearch}
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
        ) : space === 'contactos' ? (
          <ContactsScreen />
        ) : space === 'catalogo' ? (
          <CatalogScreen />
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
              {/* Keyed by opening (namespaced, they are siblings): every
                  opening mounts a fresh sheet on top. */}
              {eventSheets.map(s => (
                <EventSheet
                  key={`event:${s.seq}`}
                  mode={s.mode}
                  onClose={() => setEventSheets(unstack(s.seq))}
                  onDirty={d => markDirty(s.seq, d)}
                />
              ))}
              {taskSheets.map(s => (
                <TaskSheet
                  key={`task:${s.seq}`}
                  mode={s.mode}
                  onClose={() => setTaskSheets(unstack(s.seq))}
                  onDirty={d => markDirty(s.seq, d)}
                />
              ))}
              <ContactSheet
                key={`contact:${contactSheet?.seq ?? 'closed'}`}
                mode={contactSheet?.mode ?? null}
                onClose={() => setContactSheet(null)}
              />
              <CompanySheet
                key={`company:${companySheet?.seq ?? 'closed'}`}
                mode={companySheet?.mode ?? null}
                onClose={() => setCompanySheet(null)}
              />
              <OfferSheet
                key={`offer:${offerSheet?.seq ?? 'closed'}`}
                mode={offerSheet?.mode ?? null}
                onClose={() => setOfferSheet(null)}
              />
              {venueId && (
                <VenueSheet
                  key={`venue:${venueId}`}
                  venueId={venueId}
                  onClose={() => setVenueId(null)}
                />
              )}
              {searchOpen && (
                <SearchSheet onClose={() => setSearchOpen(false)} />
              )}
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
