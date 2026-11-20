/**
 * @module engine/emergency/incident-dashboard
 * Renders the floating incident tracking cards (`#incident-corner`) during live simulations.
 */
import type {EmergencyIncident, Infrastructure} from '../../types';

const names: Record<string, string> = {
  unreported: 'Detección',
  pending: 'Aviso recibido',
  waiting: 'Esperando equipo',
  blocked: 'Acceso bloqueado',
  local: 'Primera intervención',
  assigned: 'Desplazamiento',
  assisting: 'Intervención',
  waiting_transport: 'Esperando traslado',
  resolved: 'Cerrada',
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function incidentDashboard(e: any, dismissed?: Set<string>): string {
  const rows = (e.emergency.events as EmergencyIncident[]).filter(
    (r) => r.status !== 'unreported' && !dismissed?.has(String(r.id))
  );
  return rows
    .slice(-4)
    .reverse()
    .map((row) => {
      const resource = (e.emergency.resources() as Infrastructure[]).find(
        (r) => r.id === row.resourceId
      );
      const service =
        row.type === 'fire'
          ? 'Bomberos'
          : row.type === 'conflict' ||
              row.type === 'orientation' ||
              row.type === 'obstacle'
            ? 'Seguridad'
            : 'Sanitarios';
      const busy = (e.emergency.events as EmergencyIncident[]).filter(
        (r) =>
          ['assigned', 'assisting', 'waiting_transport'].includes(r.status) &&
          r.resourceId &&
          r.resourceId === row.resourceId
      ).length;
      const capacity = resource?.capacity || 0;
      const personal = resource?.staff || 0;
      const steps = [
        'Aviso',
        'Preparación',
        'Desplazamiento',
        'Intervención',
        ...(row.responseMode === 'ambulance' || row.responseMode === 'stretcher'
          ? ['Traslado']
          : []),
        'Cierre',
      ];
      const current =
        row.status === 'resolved'
          ? steps.length - 1
          : row.phase === 'transfer'
            ? 4
            : row.status === 'assisting' || row.status === 'local'
              ? 3
              : row.status === 'assigned'
                ? e.time >= (row.assigned || 0) + (row.alertDelay || 0)
                  ? 2
                  : 1
                : row.resourceId
                  ? 1
                  : 0;
      const elapsed = (row.closed ?? e.time) - (row.created || 0);
      const distance =
        (row.distanceTravelled || 0) + (row.extinguisherWorker?.walked || 0);
      const people =
        row.status === 'resolved'
          ? 0
          : (['assigned', 'assisting', 'waiting_transport'].includes(row.status)
              ? row.profile?.staff || 0
              : 0) + (row.localTeam || 0);
      const esc = (v: unknown) =>
        String(v ?? '').replace(
          /[&<>"]/g,
          (c) =>
            ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] || c
        );
      return (
        '<article class="incident-tracker"><header><b>' +
        esc(row.name) +
        '</b><div class="incident-header-actions"><span>' +
        esc(
          row.status === 'assigned' &&
            e.time < (row.assigned || 0) + (row.alertDelay || 0)
            ? 'Preparando salida'
            : names[row.status] || row.status
        ) +
        '</span><button type="button" class="incident-close" data-dismiss-incident="' +
        esc(row.id) +
        '" aria-label="Cerrar tarjeta de incidencia" title="Ocultar incidencia">×</button></div></header><ol>' +
        steps
          .map(
            (s, i) =>
              '<li class="' +
              (i < current ? 'finished' : i === current ? 'current' : '') +
              '">' +
              s +
              '</li>'
          )
          .join('') +
        '</ol><p>' +
        clock(elapsed) +
        ' activa · ' +
        distance.toFixed(1) +
        ' m recorridos por los recursos</p><p>' +
        esc(service) +
        ' · ' +
        people +
        ' personas asignadas a esta incidencia' +
        (resource
          ? ' · ' +
            personal +
            ' en la dotación · ' +
            busy +
            '/' +
            capacity +
            ' equipos ocupados'
          : ' · sin equipo externo asignado') +
        '</p><small>' +
        esc(row.note || '') +
        '</small></article>'
      );
    })
    .join('');
}
