/**
 * OxEye Logistics Manager («Gestor logístico»): full-screen layer over the
 * hub, lazy-loaded from the main menu. Default export for `React.lazy`.
 *
 * Addresses and browser history: `shell/route.ts` (every deep link,
 * including `/ficha/<tipo>/<id>` for a record sheet) and
 * `shell/historyNav.ts` (Back / Forward over spaces, days and sheets).
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Company,
  Contact,
  LogisticsEvent,
  Note,
  Offer,
  Resource,
  Task,
  Warehouse,
} from '../../shared/logistics/contracts.ts';
import type {OutboxEntry} from '../../shared/logistics/outbox.ts';
import {POLL_MS} from '../../shared/logistics/sync.ts';
import {DEFAULT_TIMEZONE} from '../../shared/logistics/time.ts';
import '../styles/logistics/index.css';
import {BudgetRoute} from './budget/BudgetRoute';
import {CalendarScreen} from './calendar/CalendarScreen';
import {CatalogScreen} from './catalog/CatalogScreen';
import {OfferSheet, type OfferSheetMode} from './catalog/OfferSheet';
import {DayCloseScreen} from './closing/DayCloseScreen';
import {
  ActionsContext,
  type CompanyPrefill,
  type ContactPrefill,
  type LogisticsActions,
  type NotePrefill,
  type OfferPrefill,
  type ResourcePrefill,
  type TaskPrefill,
  type WarehousePrefill,
} from './common/actions';
import {CompanySheet, type CompanySheetMode} from './contacts/CompanySheet';
import {ContactSheet, type ContactSheetMode} from './contacts/ContactSheet';
import {ContactsScreen} from './contacts/ContactsScreen';
import {EventSheet, type EventSheetMode} from './events/EventSheet';
import {HoyScreen} from './hoy/HoyScreen';
import {InventoryScreen} from './inventory/InventoryScreen';
import {ResourceSheet, type ResourceSheetMode} from './inventory/ResourceSheet';
import {
  WarehouseSheet,
  type WarehouseSheetMode,
} from './inventory/WarehouseSheet';
import {longDate, todayIn, zoneNote} from './lib/format';
import {clearRescue, readRescue} from './lib/rescue';
import {NoteSheet, type NoteSheetMode} from './notes/NoteSheet';
import {LIST_OF} from './offline/local';
import {LeaveConfirm} from './offline/LeaveConfirm';
import {OutboxSheet} from './offline/OutboxSheet';
import {reviewOf} from './offline/review';
import {registerServiceWorker} from './offline/serviceWorker';
import {can} from '../../shared/logistics/permissions.ts';
import {orgPermissions} from './account/access';
import {AccountLayer} from './account/AccountLayer';
import {NoAccess} from './account/NoAccess';
import {LoginScreen} from './screens/LoginScreen';
import {ServerGate} from './screens/ServerGate';
import {SearchSheet} from './search/SearchSheet';
import {SupplierApp} from './supplier/SupplierApp';
import {useSupplierLink} from './supplier/useSupplierLink';
import {VenueSheet} from './search/VenueSheet';
import type {AddOption} from './shell/AddMenu';
import {
  HistoryNav,
  type HistoryNavHost,
  type OpenResult,
} from './shell/historyNav';
import {
  baseHash,
  parseRoute,
  ROOT_HASH,
  stripSheet,
  type Route,
  type SheetAddress,
} from './shell/route';
import {Shell} from './shell/Shell';
import {MAIN_SPACES, SPACE_TITLE, type Space} from './shell/spaces';
import {
  useLogisticsStore,
  type LoadState,
  type LogisticsState,
} from './store/useLogisticsStore';
import {TaskSheet, type TaskSheetMode} from './tasks/TaskSheet';
import {TasksScreen} from './tasks-space/TasksScreen';
import {SkeletonRows, ToastHostContext, Toaster, type ToastHost} from './ui';

export interface LogisticsAppProps {
  /** Leaves the module and returns to the OxEye hub. */
  onClose: () => void;
}

// Mock-ups for Yeray's two features: development builds only. In a
// production build `import.meta.env.DEV` is false, the branch is dropped
// and the chunk is never emitted.
const MockupsApp = import.meta.env.DEV
  ? React.lazy(() => import('./mockups/MockupsApp'))
  : null;

/** What a locked space is for, so a guest still learns what it holds. */
const LOCKED_ABOUT = {
  contactos: {
    icon: 'contacts' as const,
    lines: [
      'Personas y empresas con cargo, teléfono, correo y notas.',
      'Llamar, escribir por WhatsApp o enviar un correo tras confirmar.',
      'Compartir una ficha de contacto solo con los datos que se elijan.',
    ],
  },
  catalogo: {
    icon: 'catalog' as const,
    lines: [
      'Ofertas de proveedores con precio, unidad y condiciones.',
      'Comparar ofertas de la misma categoría.',
      'Costes de transporte, montaje y mantenimiento por separado.',
    ],
  },
};

const MISSING_SHEET =
  'No se encuentra esa ficha: puede que se haya borrado o que no tengas acceso.';

/** Before the first render has given the navigator its callbacks. */
const IDLE_HOST: HistoryNavHost = {
  address: () => null,
  showRoute: () => undefined,
  openAddress: () => 'pending',
  onMissing: () => undefined,
};

/** Whether a list may still bring the record of a link. */
function stillLoading(state: LoadState): boolean {
  return state === 'idle' || state === 'loading';
}

/** Record lists by sheet type, and the load state that tells if it is final. */
const LINK_LISTS: Record<
  SheetAddress['type'],
  [keyof LogisticsState, keyof LogisticsState]
> = {
  event: ['events', 'eventsState'],
  task: ['tasks', 'tasksState'],
  contact: ['contacts', 'contactsState'],
  company: ['companies', 'companiesState'],
  offer: ['offers', 'offersState'],
  warehouse: ['warehouses', 'warehousesState'],
  resource: ['resources', 'resourcesState'],
  note: ['notes', 'notesState'],
  venue: ['venues', 'eventsState'],
  // An event's budget: the address carries the event's id.
  budget: ['events', 'eventsState'],
};

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

/**
 * A one-sheet slot that remembers the card a new sheet replaced, e.g. a
 * resource card under the warehouse whose «Añadir recurso aquí» opened a
 * new resource form in the same slot: closing the form brings it back.
 */
interface Slot<M> extends Opened<M> {
  under?: Slot<M> | null;
}

/** Opens `next` in the slot, keeping what was there to come back to. */
const over =
  <M,>(next: Opened<M>) =>
  (current: Slot<M> | null): Slot<M> => ({...next, under: current});

/** Closes the top sheet of the slot, back to the one it replaced. */
const back = <M,>(current: Slot<M> | null): Slot<M> | null =>
  current?.under ?? null;

/** Whether the user is typing somewhere (then «/» is just a character). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  );
}

/** The sheet on top: the one opened last. */
function topOf(
  candidates: {seq: number; address: SheetAddress | null}[],
): SheetAddress | null {
  let top: {seq: number; address: SheetAddress | null} | null = null;
  for (const c of candidates) if (!top || c.seq > top.seq) top = c;
  return top?.address ?? null;
}

const LogisticsApp: React.FC<LogisticsAppProps> = ({onClose}) => {
  const phase = useLogisticsStore(s => s.phase);
  const session = useLogisticsStore(s => s.session);
  const organizations = useLogisticsStore(s => s.organizations);
  const orgId = useLogisticsStore(s => s.orgId);
  const toasts = useLogisticsStore(s => s.toasts);
  const dismissToast = useLogisticsStore(s => s.dismissToast);
  const holdToast = useLogisticsStore(s => s.holdToast);
  const boot = useLogisticsStore(s => s.boot);
  const syncNow = useLogisticsStore(s => s.syncNow);
  const setBrowserOnline = useLogisticsStore(s => s.setBrowserOnline);
  const discardEntry = useLogisticsStore(s => s.discardEntry);
  const toast = useLogisticsStore(s => s.toast);
  const supplierLink = useSupplierLink();

  const rootRef = useRef<HTMLDivElement>(null);
  const [initialRoute] = useState(() => parseRoute(window.location.hash));
  const [space, setSpace] = useState<Space>(initialRoute.space);
  const [calendarDay, setCalendarDay] = useState<string | null>(
    initialRoute.calendarDay,
  );
  const [closeDay, setCloseDay] = useState<string | null>(
    initialRoute.closeDay,
  );
  const [mockups, setMockups] = useState(!!MockupsApp && initialRoute.mockups);
  // Browser history: what the navigator needs from this render, kept fresh
  // in a layout effect below.
  const live = useRef<HistoryNavHost>(IDLE_HOST);
  const [nav] = useState(
    () =>
      new HistoryNav({
        address: () => live.current.address(),
        showRoute: route => live.current.showRoute(route),
        openAddress: address => live.current.openAddress(address),
        onMissing: () => live.current.onMissing(),
      }),
  );
  useEffect(() => {
    // The opening address is shown as any other (a future day close falls
    // back to today, mock-ups only in development) and its link kept tidy.
    live.current.showRoute(nav.start());
    return () => nav.stop();
  }, [nav]);
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
  const [warehouseSheet, setWarehouseSheet] =
    useState<Opened<WarehouseSheetMode> | null>(null);
  const [resourceSheet, setResourceSheet] =
    useState<Slot<ResourceSheetMode> | null>(null);
  const [noteSheet, setNoteSheet] = useState<Slot<NoteSheetMode> | null>(null);
  // Search, venue and «Cambios pendientes» also remember when they opened,
  // so the address follows the sheet on top.
  const [search, setSearch] = useState<Opened<true> | null>(null);
  const [venue, setVenue] = useState<Opened<string> | null>(null);
  const [budgetSheet, setBudgetSheet] = useState<Opened<LogisticsEvent> | null>(
    null,
  );
  const [outbox, setOutbox] = useState<Opened<true> | null>(null);
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
  // Without an organization there is nowhere to write to. E4: writing is
  // `plan.edit` (the guest account and «Ver como Invitado» lack it).
  const permissions = orgPermissions(org, session?.user.role);
  const canWrite = can(permissions, 'plan.edit') && !!orgId;
  const readsDirectory = can(permissions, 'directory.read');
  const userId = session?.user.id ?? null;

  // E7: a supplier link shows only the supplier form. No boot: no session
  // restore, no device copy, no `/me`, never the Gestor's login. If the form
  // is left (link cleared), the Gestor starts as usual.
  useEffect(() => {
    if (supplierLink) return;
    void boot();
    rootRef.current?.focus();
  }, [boot, supplierLink]);

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
      setWarehouseSheet(null);
      setResourceSheet(null);
      setNoteSheet(null);
      setSearch(null);
      setVenue(null);
      setBudgetSheet(null);
      setOutbox(null);
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
    } else if (rescued.entity === 'warehouse') {
      setWarehouseSheet(
        opened<WarehouseSheetMode>(
          rescued.base
            ? {kind: 'edit', warehouse: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      );
    } else if (rescued.entity === 'resource') {
      setResourceSheet(
        opened<ResourceSheetMode>(
          rescued.base
            ? {kind: 'edit', resource: rescued.base, rescued: rescued.values}
            : {kind: 'create', rescued: rescued.values},
        ),
      );
    } else if (rescued.entity === 'note') {
      setNoteSheet(
        opened<NoteSheetMode>(
          rescued.base
            ? {kind: 'edit', note: rescued.base, rescued: rescued.values}
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

  // Connectivity and background sync, so the office sees field updates and
  // what was saved without coverage goes out by itself (M6): `…/changes`
  // every POLL_MS, a full reload on reconnect.
  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true);
      void syncNow({full: true});
    };
    const onOffline = () => setBrowserOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, POLL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [syncNow, setBrowserOnline]);

  // Lets OxEye reopen from the device without coverage (production only).
  useEffect(() => registerServiceWorker(), []);

  const goTo = useCallback(
    (next: Space, day: string | null = null) => {
      if (
        !mockups &&
        next === space &&
        (next !== 'calendario' || day === calendarDay)
      ) {
        return;
      }
      setMockups(false);
      if (next !== space) {
        setDirection(spaceIndex(next) > spaceIndex(space) ? 1 : -1);
        setSpace(next);
        rootRef.current?.querySelector('.lx-main')?.scrollTo?.({top: 0});
      }
      const nextDay = next === 'calendario' ? day : null;
      setCalendarDay(nextDay);
      setCloseDay(null);
      nav.go(
        baseHash({
          space: next,
          calendarDay: nextDay,
          closeDay: null,
          mockups: false,
        }),
      );
    },
    [space, calendarDay, mockups, nav],
  );

  /** The calendar moved between month and a day: a step of «Atrás». */
  const onCalendarDay = useCallback(
    (day: string | null) => {
      setCalendarDay(day);
      nav.go(
        baseHash({
          space: 'calendario',
          calendarDay: day,
          closeDay: null,
          mockups: false,
        }),
        {fold: true},
      );
    },
    [nav],
  );

  /** The day close moved to another day (null = today). */
  const onCloseDay = useCallback(
    (day: string | null) => {
      setCloseDay(day);
      nav.go(
        baseHash({
          space: 'cierre',
          calendarDay: null,
          closeDay: day,
          mockups: false,
        }),
        {fold: true},
      );
    },
    [nav],
  );

  const openMockups = useCallback(() => {
    setMockups(true);
    nav.go(baseHash({space, calendarDay: null, closeDay: null, mockups: true}));
  }, [nav, space]);
  const exitMockups = useCallback(() => {
    // Back to where the mock-ups were opened from; from a direct link, Hoy.
    if (nav.back()) return;
    setMockups(false);
    setSpace('hoy');
    setCalendarDay(null);
    setCloseDay(null);
    nav.go(ROOT_HASH, {push: false});
  }, [nav]);

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
  const openVenue = useCallback(
    (id: string) => setVenue(opened<string>(id)),
    [opened],
  );
  const openBudget = useCallback(
    (event: LogisticsEvent) => setBudgetSheet(opened<LogisticsEvent>(event)),
    [opened],
  );
  const openSearch = useCallback(
    () => setSearch(s => s ?? opened<true>(true)),
    [opened],
  );
  // Warehouses, resources and notes also open on their card (view).
  const openWarehouse = useCallback(
    (warehouse: Warehouse) =>
      setWarehouseSheet(opened<WarehouseSheetMode>({kind: 'view', warehouse})),
    [opened],
  );
  const addWarehouse = useCallback(
    (prefill?: WarehousePrefill) =>
      setWarehouseSheet(opened<WarehouseSheetMode>({kind: 'create', prefill})),
    [opened],
  );
  const openResource = useCallback(
    (resource: Resource) =>
      setResourceSheet(opened<ResourceSheetMode>({kind: 'view', resource})),
    [opened],
  );
  // Adding one from inside another sheet (a warehouse's «Añadir recurso
  // aquí», a record's «Añadir nota») may land on a slot already showing a
  // card further down: it comes back when the new sheet closes.
  const addResource = useCallback(
    (prefill?: ResourcePrefill) =>
      setResourceSheet(
        over(opened<ResourceSheetMode>({kind: 'create', prefill})),
      ),
    [opened],
  );
  const openNote = useCallback(
    (note: Note) => setNoteSheet(opened<NoteSheetMode>({kind: 'view', note})),
    [opened],
  );
  const addNote = useCallback(
    (prefill?: NotePrefill) =>
      setNoteSheet(over(opened<NoteSheetMode>({kind: 'create', prefill}))),
    [opened],
  );

  // M6: «Cambios pendientes» and «Revisar» a change the server did not take.
  const openOutbox = useCallback(
    () => setOutbox(s => s ?? opened<true>(true)),
    [opened],
  );
  const reviewChange = useCallback(
    (entry: OutboxEntry) => {
      const review = reviewOf(entry);
      const create = entry.op === 'create';
      // The server no longer has the record: there is nothing to edit, and
      // a form opened over the queued copy would only queue a lost update.
      if (!create && entry.error?.code === 'NOT_FOUND') {
        toast(
          'Este registro ya no existe en el servidor: solo puedes descartar el cambio.',
          'info',
        );
        return;
      }
      const state = useLogisticsStore.getState();
      // A 409 merges over the copy the user edited; other answers are fixed
      // over what the server has now.
      const listed = (state[LIST_OF[entry.entity]] as {id: string}[]).find(
        r => r.id === entry.recordId,
      );
      const editing =
        entry.error?.code === 'VERSION_CONFLICT'
          ? (entry.base ?? listed)
          : (listed ?? entry.base);
      if (!create && !editing) {
        toast(
          'Este registro ya no existe en el servidor: solo puedes descartar el cambio.',
          'info',
        );
        return;
      }
      setOutbox(null);
      switch (entry.entity) {
        case 'event':
          setEventSheets(
            stack(
              opened<EventSheetMode>(
                create
                  ? {kind: 'create', review}
                  : {kind: 'edit', event: editing as LogisticsEvent, review},
              ),
            ),
          );
          return;
        case 'task':
          setTaskSheets(
            stack(
              opened<TaskSheetMode>(
                create
                  ? {kind: 'create', review}
                  : {kind: 'edit', task: editing as Task, review},
              ),
            ),
          );
          return;
        case 'contact':
          setContactSheet(
            opened<ContactSheetMode>(
              create
                ? {kind: 'create', review}
                : {kind: 'edit', contact: editing as Contact, review},
            ),
          );
          return;
        case 'company':
          setCompanySheet(
            opened<CompanySheetMode>(
              create
                ? {kind: 'create', review}
                : {kind: 'edit', company: editing as Company, review},
            ),
          );
          return;
        case 'offer':
          setOfferSheet(
            opened<OfferSheetMode>(
              create
                ? {kind: 'create', review}
                : {kind: 'edit', offer: editing as Offer, review},
            ),
          );
          return;
        case 'warehouse':
          setWarehouseSheet(
            opened<WarehouseSheetMode>(
              create
                ? {kind: 'create', review}
                : {kind: 'edit', warehouse: editing as Warehouse, review},
            ),
          );
          return;
        case 'resource':
          setResourceSheet(
            over(
              opened<ResourceSheetMode>(
                create
                  ? {kind: 'create', review}
                  : {kind: 'edit', resource: editing as Resource, review},
              ),
            ),
          );
          return;
        case 'note':
          setNoteSheet(
            over(
              opened<NoteSheetMode>(
                create
                  ? {kind: 'create', review}
                  : {kind: 'edit', note: editing as Note, review},
              ),
            ),
          );
          return;
      }
    },
    [opened, stack, toast],
  );
  /** DUPLICATE: the queued new record gives way to the one that exists. */
  const takeExisting = useCallback(
    (entry: OutboxEntry) => {
      const existing = entry.current;
      const existingId = (existing as {id?: unknown} | null)?.id;
      void discardEntry(entry.id, {
        useInstead: typeof existingId === 'string' ? existingId : undefined,
      });
      setOutbox(null);
      if (entry.entity === 'company') {
        setCompanySheet(
          opened<CompanySheetMode>({
            kind: 'view',
            company: existing as Company,
          }),
        );
      } else if (entry.entity === 'warehouse') {
        setWarehouseSheet(
          opened<WarehouseSheetMode>({
            kind: 'view',
            warehouse: existing as Warehouse,
          }),
        );
      }
    },
    [discardEntry, opened],
  );

  // «+ Añadir»: what is captured on site first (large targets), then the
  // planning records as smaller tiles. Ids of the M2/M3 options are kept.
  const addOptions = useMemo<AddOption[]>(
    () => [
      {
        id: 'incident',
        group: 'Captura rápida',
        label: 'Incidencia',
        description:
          'Algo ha salido mal en la logística: un camión que no llega, una valla rota.',
        icon: 'alert',
        onSelect: () => addNote({kind: 'incident'}),
      },
      {
        id: 'note',
        group: 'Captura rápida',
        label: 'Nota',
        description: 'Un apunte, una decisión o una pregunta pendiente.',
        icon: 'note',
        onSelect: () => addNote({kind: 'note'}),
      },
      {
        id: 'resource',
        group: 'Captura rápida',
        label: 'Recurso',
        description: 'Material de un almacén o un servicio contratado.',
        icon: 'inventory',
        onSelect: () => addResource(),
      },
      {
        id: 'contact',
        group: 'Captura rápida',
        label: 'Persona',
        description: 'Alguien a quien llamar: basta con el nombre.',
        icon: 'user',
        onSelect: () => addContact(),
      },
      {
        id: 'task',
        group: 'Planificación',
        compact: true,
        label: 'Tarea',
        description: 'Montaje, entrega, transporte… con empresa y hora.',
        icon: 'task',
        onSelect: addTaskHere,
      },
      {
        id: 'event',
        group: 'Planificación',
        compact: true,
        label: 'Evento',
        description: 'Lo que se celebra: fecha, lugar y horario.',
        icon: 'calendar',
        onSelect: addEvent,
      },
      {
        id: 'company',
        group: 'Planificación',
        compact: true,
        label: 'Empresa o entidad',
        description: 'Proveedor, área municipal, asociación…',
        icon: 'building',
        onSelect: () => addCompany(),
      },
      {
        id: 'offer',
        group: 'Planificación',
        compact: true,
        label: 'Oferta',
        description: 'Lo que ofrece un proveedor y a qué precio.',
        icon: 'offer',
        onSelect: () => addOffer(),
      },
    ],
    [
      addNote,
      addResource,
      addContact,
      addTaskHere,
      addEvent,
      addCompany,
      addOffer,
    ],
  );

  // «/» or Ctrl+K (⌘K) opens the search from anywhere in the workspace, but
  // never over an open sheet or while typing «/» in a field.
  useEffect(() => {
    if (phase !== 'ready' || mockups || supplierLink) return;
    const onKey = (e: KeyboardEvent) => {
      const combo =
        (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!combo && !(slash && !isTyping(e.target))) return;
      if (rootRef.current?.querySelector('dialog[open]')) return;
      e.preventDefault();
      openSearch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, mockups, supplierLink, openSearch]);

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
      openWarehouse,
      addWarehouse,
      openResource,
      addResource,
      openNote,
      addNote,
      openBudget,
      openOutbox,
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
      openWarehouse,
      addWarehouse,
      openResource,
      addResource,
      openNote,
      addNote,
      openBudget,
      openOutbox,
    ],
  );

  // ---------------------------------------------------------- history
  /** Address of the record sheet on top (the one opened last), if any. */
  const topAddress = useMemo(() => {
    const at = (
      seq: number,
      type: SheetAddress['type'],
      record: {id: string} | null,
    ) => ({seq, address: record ? {type, id: record.id} : null});
    return topOf([
      ...eventSheets.map(s =>
        at(s.seq, 'event', s.mode.kind === 'create' ? null : s.mode.event),
      ),
      ...taskSheets.map(s =>
        at(s.seq, 'task', s.mode.kind === 'create' ? null : s.mode.task),
      ),
      ...(contactSheet
        ? [
            at(
              contactSheet.seq,
              'contact',
              contactSheet.mode.kind === 'create'
                ? null
                : contactSheet.mode.contact,
            ),
          ]
        : []),
      ...(companySheet
        ? [
            at(
              companySheet.seq,
              'company',
              companySheet.mode.kind === 'create'
                ? null
                : companySheet.mode.company,
            ),
          ]
        : []),
      ...(offerSheet
        ? [
            at(
              offerSheet.seq,
              'offer',
              offerSheet.mode.kind === 'create' ? null : offerSheet.mode.offer,
            ),
          ]
        : []),
      ...(warehouseSheet
        ? [
            at(
              warehouseSheet.seq,
              'warehouse',
              warehouseSheet.mode.kind === 'create'
                ? null
                : warehouseSheet.mode.warehouse,
            ),
          ]
        : []),
      ...(resourceSheet
        ? [
            at(
              resourceSheet.seq,
              'resource',
              resourceSheet.mode.kind === 'create'
                ? null
                : resourceSheet.mode.resource,
            ),
          ]
        : []),
      ...(noteSheet
        ? [
            at(
              noteSheet.seq,
              'note',
              noteSheet.mode.kind === 'create' ? null : noteSheet.mode.note,
            ),
          ]
        : []),
      ...(venue ? [at(venue.seq, 'venue', {id: venue.mode})] : []),
      ...(budgetSheet ? [at(budgetSheet.seq, 'budget', budgetSheet.mode)] : []),
      ...(search ? [{seq: search.seq, address: null}] : []),
      ...(outbox ? [{seq: outbox.seq, address: null}] : []),
    ]);
  }, [
    eventSheets,
    taskSheets,
    contactSheet,
    companySheet,
    offerSheet,
    warehouseSheet,
    resourceSheet,
    noteSheet,
    venue,
    budgetSheet,
    search,
    outbox,
  ]);

  /** Back / Forward or a link reached another space or day. */
  const showRoute = useCallback(
    (route: Route) => {
      const wantsMockups = !!MockupsApp && route.mockups;
      const next: Space = route.mockups ? 'hoy' : route.space;
      // A day close is about a day that happened; today keeps the plain link.
      const pastDay =
        route.closeDay && route.closeDay < today ? route.closeDay : null;
      setMockups(wantsMockups);
      setSpace(current => {
        if (current !== next) {
          setDirection(spaceIndex(next) > spaceIndex(current) ? 1 : -1);
        }
        return next;
      });
      setCalendarDay(route.calendarDay);
      setCloseDay(pastDay);
      const normal = baseHash({
        space: next,
        calendarDay: route.calendarDay,
        closeDay: pastDay,
        mockups: wantsMockups,
      });
      if (normal !== stripSheet(window.location.hash)) {
        nav.go(normal, {push: false});
      }
    },
    [today, nav],
  );

  /** Opens the sheet of a shared link once its record is on the device. */
  const openAddress = useCallback(
    (address: SheetAddress): OpenResult => {
      const s = useLogisticsStore.getState();
      if (s.phase !== 'ready') return 'pending';
      const [listKey, stateKey] = LINK_LISTS[address.type];
      const list = s[listKey] as {id: string}[];
      const found = list.find(r => r.id === address.id);
      if (!found) {
        return stillLoading(s[stateKey] as LoadState) ? 'pending' : 'missing';
      }
      switch (address.type) {
        case 'event':
          openEvent(found as LogisticsEvent);
          break;
        case 'task':
          openTask(found as Task);
          break;
        case 'contact':
          openContact(found as Contact);
          break;
        case 'company':
          openCompany(found as Company);
          break;
        case 'offer':
          openOffer(found as Offer);
          break;
        case 'warehouse':
          openWarehouse(found as Warehouse);
          break;
        case 'resource':
          openResource(found as Resource);
          break;
        case 'note':
          openNote(found as Note);
          break;
        case 'venue':
          openVenue(address.id);
          break;
        case 'budget':
          openBudget(found as LogisticsEvent);
          break;
      }
      return 'opened';
    },
    [
      openBudget,
      openEvent,
      openTask,
      openContact,
      openCompany,
      openOffer,
      openWarehouse,
      openResource,
      openNote,
      openVenue,
    ],
  );

  useLayoutEffect(() => {
    live.current = {
      address: () => topAddress,
      showRoute,
      openAddress,
      onMissing: () => toast(MISSING_SHEET, 'info'),
    };
  });

  // A shared link waits for the sign-in and for its record to load.
  useEffect(() => {
    if (phase !== 'ready' || supplierLink) return;
    nav.resolveLink();
    return useLogisticsStore.subscribe(() => nav.resolveLink());
  }, [phase, supplierLink, nav]);

  /** Leaving the Gestor: rewind its history first (see `historyNav.ts`). */
  const exit = useCallback(() => nav.exit(onClose), [nav, onClose]);

  const timelineActive = space === 'calendario' && timeline;

  let body: React.ReactNode;
  if (supplierLink) {
    // E7: before the mock-ups and the login gate; a supplier never sees
    // the Gestor.
    body = <SupplierApp link={supplierLink} />;
  } else if (mockups && MockupsApp) {
    // Fictitious data only: no server, no sign-in needed.
    body = (
      <React.Suspense
        fallback={<SkeletonRows rows={4} label="Cargando las maquetas" />}
      >
        <MockupsApp onExit={exitMockups} />
      </React.Suspense>
    );
  } else if (phase === 'login') {
    body = <LoginScreen onExit={exit} />;
  } else if (phase !== 'ready') {
    body = <ServerGate onExit={exit} />;
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
        addOptions={addOptions}
        onSearch={openSearch}
        swipeLocked={timelineActive}
        onExit={exit}
        onMockups={MockupsApp ? openMockups : undefined}
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
        ) : space === 'tareas' ? (
          <TasksScreen />
        ) : space === 'contactos' ? (
          readsDirectory ? (
            <ContactsScreen />
          ) : (
            <NoAccess
              permission="directory.read"
              what="Contactos"
              id="lx-contactos-noaccess"
              about={LOCKED_ABOUT.contactos}
              onGoToday={() => goTo('hoy')}
            />
          )
        ) : space === 'catalogo' ? (
          readsDirectory ? (
            <CatalogScreen />
          ) : (
            <NoAccess
              permission="directory.read"
              what="Catálogo"
              id="lx-catalogo-noaccess"
              about={LOCKED_ABOUT.catalogo}
              onGoToday={() => goTo('hoy')}
            />
          )
        ) : space === 'inventarios' ? (
          <InventoryScreen />
        ) : (
          <DayCloseScreen day={closeDay} onDay={onCloseDay} />
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
          {phase === 'ready' && !mockups && !supplierLink && (
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
              <WarehouseSheet
                key={`warehouse:${warehouseSheet?.seq ?? 'closed'}`}
                mode={warehouseSheet?.mode ?? null}
                onClose={() => setWarehouseSheet(null)}
              />
              <ResourceSheet
                key={`resource:${resourceSheet?.seq ?? 'closed'}`}
                mode={resourceSheet?.mode ?? null}
                onClose={() => setResourceSheet(back)}
              />
              <NoteSheet
                key={`note:${noteSheet?.seq ?? 'closed'}`}
                mode={noteSheet?.mode ?? null}
                onClose={() => setNoteSheet(back)}
              />
              {venue && (
                <VenueSheet
                  key={`venue:${venue.seq}`}
                  venueId={venue.mode}
                  onClose={() => setVenue(null)}
                />
              )}
              {budgetSheet && (
                <BudgetRoute
                  key={`budget:${budgetSheet.seq}`}
                  event={budgetSheet.mode}
                  onClose={() => setBudgetSheet(null)}
                />
              )}
              {search && <SearchSheet onClose={() => setSearch(null)} />}
              {outbox && (
                <OutboxSheet
                  onClose={() => setOutbox(null)}
                  onReview={reviewChange}
                  onUseExisting={takeExisting}
                />
              )}
              <LeaveConfirm />
              <AccountLayer />
            </>
          )}
        </ActionsContext.Provider>
      </ToastHostContext.Provider>
      <Toaster
        toasts={toasts}
        onDismiss={dismissToast}
        onHold={holdToast}
        host={toastSlots[toastSlots.length - 1] ?? null}
      />
    </div>
  );
};

export default LogisticsApp;
