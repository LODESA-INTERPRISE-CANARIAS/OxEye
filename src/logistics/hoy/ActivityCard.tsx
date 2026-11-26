/**
 * «Actividad reciente»: who changed what and when, from the activity log.
 */
import React from 'react';
import type {ActivityEntry} from '../../../shared/logistics/contracts.ts';
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

const FIELD: Record<string, string> = {
  name: 'nombre',
  venue: 'lugar',
  venueId: 'lugar',
  venueName: 'lugar',
  startsAt: 'horario',
  endsAt: 'horario',
  date: 'horario',
  startTime: 'horario',
  endTime: 'horario',
  status: 'estado',
  notes: 'notas',
  source: 'origen',
  verification: 'verificación',
  // Tasks (milestone 2).
  title: 'título',
  kind: 'tipo',
  endDate: 'horario',
  heavyLoad: 'carga pesada',
  dependsOn: 'dependencias',
  contact: 'persona de contacto',
  contactId: 'persona de contacto',
  // People, companies and offers (milestone 3).
  role: 'cargo',
  phone: 'teléfono',
  email: 'correo',
  description: 'descripción',
  company: 'empresa',
  companyId: 'empresa',
  companyName: 'empresa',
  eventIds: 'eventos',
  categoryIds: 'categorías',
  website: 'web',
  mainContactId: 'persona responsable',
  price: 'precio',
  unit: 'unidad',
  customUnit: 'unidad',
  transportCost: 'transporte',
  assemblyCost: 'montaje',
  maintenanceCost: 'mantenimiento',
  vatIncluded: 'impuestos (IGIC/IVA)',
  conditions: 'condiciones',
  categoryId: 'categoría',
};

function changedText(fields: string[]): string | null {
  const names = [...new Set(fields.map(f => FIELD[f] ?? f))];
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
