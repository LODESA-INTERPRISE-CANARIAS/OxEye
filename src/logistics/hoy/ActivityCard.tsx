/**
 * «Actividad reciente»: who changed what and when, from the activity log.
 *
 * The list has a fixed height and scrolls inside (it never pushes the rest
 * of «Hoy» down), newest first. «Ver anteriores» adds older entries below,
 * a page at a time, fetched a week at a time from the server; the store
 * itself only keeps the newest ones.
 */
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ActivityEntry} from '../../../shared/logistics/contracts.ts';
import {FIELD_LABEL} from '../../../shared/logistics/history.ts';
import {ACTIVITY_RANGE_MAX} from '../../../shared/logistics/rules.ts';
import {Signature} from '../account/Signature';
import {UserAvatar} from '../account/UserAvatar';
import {errorMessage} from '../api/client';
import {relativeTime} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Card, EmptyState, LoadError, SkeletonRows} from '../ui';
import {
  ACTIVITY_EMPTY_WINDOWS,
  ACTIVITY_PAGE,
  ACTIVITY_WINDOW_DAYS,
  mergeActivity,
  oldestAt,
  olderWindow,
} from './activity-paging';

/** What the store asks for (`api.activity` default): fewer means no more. */
const RECENT_LIMIT = 20;

const ENTITY: Record<string, string> = {
  event: 'el evento',
  venue: 'el lugar',
  task: 'la tarea',
  contact: 'la persona',
  company: 'la empresa o entidad',
  category: 'la categoría',
  resource: 'el recurso',
  warehouse: 'el almacén',
  offer: 'la oferta',
  note: 'la nota',
};

const ACTION: Record<ActivityEntry['action'], string> = {
  create: 'ha registrado',
  update: 'ha cambiado',
  delete: 'ha borrado',
};

/** In a one-line summary, any change of dates or hours reads «horario». */
const SCHEDULE = new Set([
  'date',
  'endDate',
  'startsAt',
  'endsAt',
  'startTime',
  'endTime',
]);

/** Older entries may name the reference by its id or name column. */
const ALIAS: Record<string, string> = {
  venueId: 'venue',
  venueName: 'venue',
  contactId: 'contact',
  companyId: 'company',
  companyName: 'company',
  warehouseId: 'warehouse',
  warehouseName: 'warehouse',
};

function fieldName(field: string): string | undefined {
  if (SCHEDULE.has(field)) return 'horario';
  return FIELD_LABEL[ALIAS[field] ?? field];
}

function changedText(fields: string[]): string | null {
  // Field names only, never values, from the shared labels (the same ones
  // as the record history); an unknown name is left out.
  const names = [
    ...new Set(fields.map(fieldName).filter((x): x is string => !!x)),
  ];
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

type OlderStatus =
  | {kind: 'idle'}
  | {kind: 'loading'}
  | {kind: 'error'; message: string}
  /** Searched this many weeks back from the oldest entry without finding any. */
  | {kind: 'quiet'; weeks: number};

export const ActivityCard: React.FC<{timeZone: string}> = ({timeZone}) => {
  // Older pages belong to one organization and session: start over on a
  // switch (the store is wiped then too).
  const orgId = useLogisticsStore(s => s.orgId);
  const session = useLogisticsStore(s => s.session);
  return (
    <ActivityBody
      key={`${orgId ?? ''}|${session?.user.id ?? ''}`}
      timeZone={timeZone}
    />
  );
};

const ActivityBody: React.FC<{timeZone: string}> = ({timeZone}) => {
  const activity = useLogisticsStore(s => s.activity);
  const state = useLogisticsStore(s => s.activityState);
  const error = useLogisticsStore(s => s.activityError);
  const refresh = useLogisticsStore(s => s.refresh);
  const loadDayActivity = useLogisticsStore(s => s.loadDayActivity);
  const online = useLogisticsStore(s => s.connection === 'online');

  /** Entries shown beyond the store's newest ones (and a copy of those). */
  const [older, setOlder] = useState<ActivityEntry[]>([]);
  /** Fetched but not shown yet: the next pages (and how many, for render). */
  const buffer = useRef<ActivityEntry[]>([]);
  const [buffered, setBuffered] = useState(0);
  /** The next week to fetch ends here (ms); NaN until the first press. */
  const cursor = useRef(NaN);
  const [status, setStatus] = useState<OlderStatus>({kind: 'idle'});
  const [announce, setAnnounce] = useState('');
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const entries = older.length ? mergeActivity(activity, older) : activity;

  // Bring the first added entry to the top of the list, so the new page is
  // what the person sees without scrolling by hand.
  useLayoutEffect(() => {
    if (!scrollTo) return;
    const region = regionRef.current;
    const item = region?.querySelector<HTMLElement>(
      `[data-activity-id="${CSS.escape(scrollTo)}"]`,
    );
    if (region && item) region.scrollTop = Math.max(0, item.offsetTop - 4);
    setScrollTo(null);
  }, [scrollTo]);

  const showPage = (base: ActivityEntry[]) => {
    const page = buffer.current.slice(0, ACTIVITY_PAGE);
    buffer.current = buffer.current.slice(ACTIVITY_PAGE);
    setBuffered(buffer.current.length);
    setOlder(prev => mergeActivity(prev, base, page));
    setStatus({kind: 'idle'});
    setAnnounce(
      page.length === 1
        ? 'Se ha añadido 1 entrada anterior al final de la lista.'
        : `Se han añadido ${page.length} entradas anteriores al final de la lista.`,
    );
    if (page[0]) setScrollTo(page[0].id);
  };

  const loadOlder = async () => {
    // Keep what is on screen now: the store's newest list moves on with
    // every refresh, and an entry must not fall between the two lists.
    const base = mergeActivity(activity, older);
    if (buffer.current.length) {
      showPage(base);
      return;
    }
    const known = new Set(base.map(e => e.id));
    if (Number.isNaN(cursor.current)) cursor.current = oldestAt(base);
    if (Number.isNaN(cursor.current)) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStatus({kind: 'loading'});
    setAnnounce('');
    try {
      for (let i = 0; i < ACTIVITY_EMPTY_WINDOWS; i++) {
        const w = olderWindow(cursor.current);
        const items = await loadDayActivity(w.from, w.to, controller.signal);
        if (controller.signal.aborted) return;
        // A full answer may hide more in the same week: go on from its
        // oldest entry; otherwise the whole week is done.
        const full = items.length >= ACTIVITY_RANGE_MAX;
        const oldest = oldestAt(items);
        cursor.current = full && oldest < cursor.current ? oldest : w.next;
        const fresh = mergeActivity(items.filter(e => !known.has(e.id)));
        if (fresh.length) {
          buffer.current = fresh;
          showPage(base);
          return;
        }
      }
      setStatus(prev => ({
        kind: 'quiet',
        weeks:
          (prev.kind === 'quiet' ? prev.weeks : 0) + ACTIVITY_EMPTY_WINDOWS,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus({
        kind: 'error',
        message: `No se han podido cargar las anteriores. ${errorMessage(err)}`,
      });
    }
  };

  // The newest list came back shorter than asked: there is nothing older.
  const mayHaveOlder =
    older.length > 0 || activity.length >= RECENT_LIMIT || state !== 'ready';
  const canLoad = online || buffered > 0;
  const quietWeeks = status.kind === 'quiet' ? status.weeks : 0;

  return (
    <Card title="Actividad reciente" id="lx-activity" className="lx-activity">
      {state === 'loading' && activity.length === 0 ? (
        <SkeletonRows rows={4} label="Cargando actividad" />
      ) : state === 'error' && activity.length === 0 ? (
        <LoadError message={error ?? ''} onRetry={() => void refresh()} />
      ) : activity.length === 0 ? (
        <EmptyState compact icon="activity" title="Todavía no hay actividad">
          Lo que registréis aparecerá aquí, firmado por quien lo hizo.
        </EmptyState>
      ) : (
        <>
          <div
            className="lx-activity__scroll"
            id="lx-activity-list"
            ref={regionRef}
            role="region"
            aria-label="Actividad reciente, de lo más nuevo a lo más antiguo"
            tabIndex={0}
          >
            <ol className="lx-feed">
              {entries.map(entry => {
                const changed =
                  entry.action === 'update'
                    ? changedText(entry.changedFields)
                    : null;
                return (
                  <li
                    key={entry.id}
                    className="lx-feed__item"
                    data-activity-id={entry.id}
                  >
                    <UserAvatar
                      name={entry.user.displayName}
                      userId={entry.user.id}
                      size="sm"
                    />
                    <p className="lx-feed__text">
                      <Signature
                        user={entry.user}
                        supportBy={entry.supportBy}
                      />{' '}
                      {ACTION[entry.action] ?? 'ha tocado'}{' '}
                      {ENTITY[entry.entityType] ?? entry.entityType}{' '}
                      <span className="lx-feed__label">
                        «{entry.entityLabel}»
                      </span>
                      {changed && (
                        <span className="lx-muted"> · {changed}</span>
                      )}
                    </p>
                    <time className="lx-feed__time lx-num" dateTime={entry.at}>
                      {relativeTime(entry.at, timeZone)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </div>
          {mayHaveOlder && (
            <div className="lx-activity__more" id="lx-activity-more">
              {status.kind === 'error' && (
                <p className="lx-field__error" role="alert">
                  {status.message}
                </p>
              )}
              {quietWeeks > 0 && (
                <p className="lx-muted lx-num" id="lx-activity-quiet">
                  Sin actividad anterior en los{' '}
                  {quietWeeks * ACTIVITY_WINDOW_DAYS} días previos.
                </p>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={quietWeeks > 0 ? 'history' : 'chevronDown'}
                id="lx-activity-older"
                busy={status.kind === 'loading'}
                disabled={!canLoad}
                aria-describedby={!canLoad ? 'lx-activity-offline' : undefined}
                onClick={() => void loadOlder()}
              >
                {status.kind === 'error'
                  ? 'Reintentar'
                  : quietWeeks > 0
                    ? 'Buscar más atrás'
                    : 'Ver anteriores'}
              </Button>
              {!canLoad && (
                <p className="lx-muted" id="lx-activity-offline">
                  Sin conexión: las anteriores se cargan cuando vuelva.
                </p>
              )}
            </div>
          )}
          <p className="lx-visually-hidden" role="status" aria-live="polite">
            {announce}
          </p>
        </>
      )}
    </Card>
  );
};
