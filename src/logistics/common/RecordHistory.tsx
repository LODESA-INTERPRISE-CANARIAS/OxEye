/**
 * «Historial» of one record: who changed it, when, and which fields (names
 * only, never values: `describeChange`). Collapsed by default and loaded the
 * first time it is opened, then again whenever the record's version changes
 * while it stays open.
 *
 * The time shows relative («hace 5 minutos»); tapping it (or hovering on a
 * desktop) shows the exact date and time, so it also works on a phone where
 * there is no hover.
 */
import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import type {ActivityEntry} from '../../../shared/logistics/contracts.ts';
import {describeChange} from '../../../shared/logistics/history.ts';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import {Signature} from '../account/Signature';
import {UserAvatar} from '../account/UserAvatar';
import {errorMessage} from '../api/client';
import {longDate, relativeTime} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, SkeletonRows} from '../ui';

/** Changes asked for at once; the screen says when there may be more. */
const LIMIT = 50;

export type HistoryEntity =
  | 'event'
  | 'task'
  | 'venue'
  | 'company'
  | 'contact'
  | 'offer'
  | 'warehouse'
  | 'resource'
  | 'note';

type Status = 'idle' | 'loading' | 'error' | 'ready';

/** «Miércoles, 2 de diciembre de 2026, 10:30». */
function exactTime(instant: string, timeZone: string): string {
  const local = utcToLocal(instant, timeZone);
  return `${longDate(local.date)}, ${local.time}`;
}

export const RecordHistory: React.FC<{
  entityType: HistoryEntity;
  entityId: string;
  /** The record's version: a new one reloads an open history. */
  version?: number;
  idPrefix: string;
}> = ({entityType, entityId, version, idPrefix}) => {
  const loadHistory = useLogisticsStore(s => s.loadHistory);
  const timeZone =
    useLogisticsStore(
      s => s.organizations.find(o => o.id === s.orgId)?.timezone,
    ) || DEFAULT_TIMEZONE;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const bodyId = `${idPrefix}-history-body`;
  const toggleId = `${idPrefix}-history-toggle`;

  const load = useCallback(async () => {
    const mine = ++request.current;
    setStatus(s => (s === 'ready' ? 'ready' : 'loading'));
    setError(null);
    try {
      const items = await loadHistory(entityType, entityId, LIMIT);
      if (mine !== request.current) return;
      setEntries(items);
      setStatus('ready');
    } catch (err) {
      if (mine !== request.current) return;
      setError(errorMessage(err));
      setStatus('error');
    }
  }, [loadHistory, entityType, entityId]);

  // Loaded lazily: only when opened, and again when the record changes.
  useEffect(() => {
    if (open) void load();
  }, [open, version, load]);

  // A late answer after the sheet closed is ignored.
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  return (
    <section
      className="lx-subsection lx-history"
      id={`${idPrefix}-history`}
      aria-labelledby={toggleId}
    >
      <h3 className="lx-history__heading">
        <button
          type="button"
          id={toggleId}
          className="lx-history__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(o => !o)}
        >
          <Icon name="history" size={20} />
          <span className="lx-history__title">Historial</span>
          <span className="lx-history__hint">Quién cambió qué y cuándo</span>
          <Icon name="chevronDown" size={18} className="lx-history__chev" />
        </button>
      </h3>
      <div id={bodyId} className="lx-history__body" hidden={!open}>
        {open &&
          (status === 'loading' || status === 'idle' ? (
            <SkeletonRows rows={3} label="Cargando el historial" />
          ) : status === 'error' ? (
            <div
              className="lx-notice lx-notice--error"
              role="alert"
              id={`${idPrefix}-history-error`}
            >
              <Icon name="alert" size={16} />
              <span>No se ha podido cargar el historial. {error}</span>
              <Button
                size="sm"
                icon="refresh"
                id={`${idPrefix}-history-retry`}
                onClick={() => void load()}
              >
                Reintentar
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <p className="lx-muted" id={`${idPrefix}-history-empty`}>
              Aún no hay cambios registrados.
            </p>
          ) : (
            <>
              <ol className="lx-history__list">
                {entries.map(entry => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    timeZone={timeZone}
                  />
                ))}
              </ol>
              {entries.length >= LIMIT && (
                <p className="lx-muted lx-num">
                  Se muestran los {LIMIT} cambios más recientes.
                </p>
              )}
            </>
          ))}
      </div>
    </section>
  );
};

const HistoryRow: React.FC<{entry: ActivityEntry; timeZone: string}> = ({
  entry,
  timeZone,
}) => {
  const [exact, setExact] = useState(false);
  const exactText = exactTime(entry.at, timeZone);
  const timeId = useId();
  return (
    <li className="lx-history__item">
      <UserAvatar
        name={entry.user.displayName}
        userId={entry.user.id}
        size="sm"
      />
      <p className="lx-history__text">
        <Signature user={entry.user} supportBy={entry.supportBy} />{' '}
        <span>{describeChange(entry)}</span>
      </p>
      <button
        type="button"
        className="lx-history__time lx-num"
        title={exactText}
        aria-describedby={timeId}
        aria-pressed={exact}
        onClick={() => setExact(e => !e)}
      >
        <time dateTime={entry.at}>
          {exact ? exactText : relativeTime(entry.at, timeZone)}
        </time>
      </button>
      <span id={timeId} className="lx-visually-hidden">
        {exactText}
      </span>
    </li>
  );
};
