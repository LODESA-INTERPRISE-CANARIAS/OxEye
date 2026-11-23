/**
 * @module engine/emergency/incident-dashboard
 * Renderiza las notificaciones inteligentes flotantes (`#incident-corner`) con categoría,
 * color identificativo, icono vectorial, gravedad independiente, estado dinámico y acceso por doble clic / toque.
 */
import type {EmergencyIncident, Infrastructure} from '../../types';
import {
  buildNotificationTitle,
  categoryForIncidentType,
  formatIncidentCode,
  INCIDENT_CATEGORIES,
  normalizeSeverity,
  SEVERITY_META,
} from './incident-center';

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"]/g,
    (c) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] || c
  );

export interface IncidentDashboardOptions {
  privacyMode?: 'public' | 'authorized_synthetic';
  activeIncidentId?: string | number | null;
}

 
export function incidentDashboard(
   
  e: any,
  dismissed?: Set<string>,
  opts?: IncidentDashboardOptions
): string {
  const rows = (e.emergency.events as EmergencyIncident[]).filter(
    (r) => r.status !== 'unreported' && !dismissed?.has(String(r.id))
  );
  const privacyMode = opts?.privacyMode || 'public';
  const activeId = opts?.activeIncidentId ?? null;

  return rows
    .slice(-5)
    .reverse()
    .map((row) => {
      const cat = row.category || categoryForIncidentType(row.type);
      const catMeta = INCIDENT_CATEGORIES[cat];
      const sev = normalizeSeverity(row.severity, row.type);
      const sevMeta = SEVERITY_META[sev];
      const code = row.code || formatIncidentCode(cat, Number(row.id) || 1);

      const cordon = e.emergency?.fire?.cordons?.find(
        (c: {rowId: string | number}) => c.rowId === row.id
      );
      const title = buildNotificationTitle(row, e.time, privacyMode, cordon?.state);

      const resource = (e.emergency.resources() as Infrastructure[]).find(
        (r) => r.id === row.resourceId
      );
      const service =
        row.type === 'fire'
          ? 'Bomberos'
          : row.category === 'accessibility'
            ? 'Carpa Amarilla'
            : row.category === 'violet_point'
              ? 'Punto Violeta'
              : row.type === 'conflict' ||
                  row.type === 'orientation' ||
                  row.type === 'obstacle' ||
                  row.type === 'fence_breach' ||
                  row.type === 'congestion'
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
      const staffCount =
        (['assigned', 'assisting', 'waiting_transport', 'resolved'].includes(row.status)
          ? (row.profile?.staff || (row.resourceId ? 1 : 0)) + (row.policeSupportId ? 1 : 0)
          : 0) + (row.localTeam || 0);
      const peopleLabel =
        row.status === 'resolved'
          ? `${staffCount} personas intervinieron`
          : `${staffCount} personas asignadas`;

      const isResolved = row.status === 'resolved';
      const isSelected = activeId != null && String(activeId) === String(row.id);
      const isVioletPublic = cat === 'violet_point' && privacyMode === 'public';

      const noteText = isVioletPublic
        ? 'Atención reservada · Servicio operativo sin detalle personal en modo público.'
        : row.note || '';

      return (
        `<article class="incident-tracker ${isResolved ? 'is-resolved' : ''} ${
          isSelected ? 'is-investigating' : ''
        }" style="--inc-color:${catMeta.color};--inc-bg:${catMeta.softBg}" data-investigate-incident="${esc(
          row.id
        )}" tabindex="0" role="group" aria-label="${esc(title)}">` +
        '<header>' +
        '<div class="inc-title-block">' +
        '<div class="inc-badges-row">' +
        `<span class="inc-cat-badge" style="color:${catMeta.color};background:${catMeta.softBg};border-color:${catMeta.color}">` +
        `<svg class="inc-cat-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${catMeta.svgIcon}</svg>` +
        `<span>${esc(code)}</span>` +
        '</span>' +
        `<span class="inc-severity-badge" style="background:${sevMeta.badgeBg};color:${sevMeta.badgeFg};border-color:${sevMeta.border}">${esc(
          sevMeta.label
        )}</span>` +
        `<span class="inc-state-pill ${isResolved ? 'is-closed' : 'is-open'}">${
          isResolved ? 'Cerrada' : 'Activa'
        }</span>` +
        '</div>' +
        `<b>${esc(title)}</b>` +
        '</div>' +
        '<div class="incident-header-actions">' +
        `<button type="button" class="incident-close" data-dismiss-incident="${esc(
          row.id
        )}" aria-label="Ocultar tarjeta de incidencia" title="Ocultar incidencia">×</button>` +
        '</div>' +
        '</header>' +
        '<ol>' +
        steps
          .map(
            (s, i) =>
              `<li class="${
                i < current ? 'finished' : i === current ? 'current' : ''
              }">${s}</li>`
          )
          .join('') +
        '</ol>' +
        `<p>${clock(elapsed)} ${isResolved ? 'resolución' : 'activa'} · ${
          isVioletPublic ? 'registro reservado' : `${distance.toFixed(1)} m recorridos`
        }</p>` +
        `<p>${esc(service)} · ${peopleLabel}` +
        (row.policeSupportName ? ` (+ ${esc(row.policeSupportName)})` : '') +
        (resource
          ? ` · ${personal} en la dotación · ${busy}/${capacity} equipos ocupados`
          : ' · sin equipo externo asignado') +
        '</p>' +
        (noteText ? `<small>${esc(noteText)}</small>` : '') +
        '<div class="inc-card-footer">' +
        `<small>Semilla #${esc(e.s?.seed ?? 2026)} · inicio ${clock(
          row.created || 0
        )} · doble clic para pausar e investigar</small>` +
        `<button type="button" class="inc-investigate-btn" data-investigate-btn="${esc(
          row.id
        )}">Investigar incidencia</button>` +
        '</div>' +
        '</article>'
      );
    })
    .join('');
}
