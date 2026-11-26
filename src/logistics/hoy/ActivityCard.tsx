/**
 * «Actividad reciente»: who changed what and when, from the activity log.
 */
import React from 'react';
import type {ActivityEntry} from '../../../shared/logistics/contracts.ts';
import {FIELD_LABEL} from '../../../shared/logistics/history.ts';
import {initials, relativeTime} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Card, EmptyState, LoadError, SkeletonRows} from '../ui';

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

export const ActivityCard: React.FC<{timeZone: string}> = ({timeZone}) => {
  const activity = useLogisticsStore(s => s.activity);
  const state = useLogisticsStore(s => s.activityState);
  const error = useLogisticsStore(s => s.activityError);
  const refresh = useLogisticsStore(s => s.refresh);

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
        <ol className="lx-feed">
          {activity.map(entry => {
            const changed =
              entry.action === 'update'
                ? changedText(entry.changedFields)
                : null;
            return (
              <li key={entry.id} className="lx-feed__item">
                <span className="lx-avatar lx-avatar--sm" aria-hidden="true">
                  {initials(entry.user.displayName)}
                </span>
                <p className="lx-feed__text">
                  <strong>{entry.user.displayName}</strong>{' '}
                  {ACTION[entry.action] ?? 'ha tocado'}{' '}
                  {ENTITY[entry.entityType] ?? entry.entityType}{' '}
                  <span className="lx-feed__label">«{entry.entityLabel}»</span>
                  {changed && <span className="lx-muted"> · {changed}</span>}
                </p>
                <time className="lx-feed__time lx-num" dateTime={entry.at}>
                  {relativeTime(entry.at, timeZone)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
};
