/**
 * @module engine/emergency/incident-center
 * Taxonomía visual, registro cronológico estructurado, privacidad (Punto Violeta),
 * evaluación de gestión, exportación y comparación alternativa de incidencias.
 */
import type {
  EmergencyIncident,
  IncidentAlertCategory,
  IncidentSeverityLevel,
  IncidentTimelineEvent,
  Infrastructure,
  Scene,
} from '../../types';
import {EventEngine} from '../crowd/event-engine';

export interface IncidentCategoryMeta {
  key: IncidentAlertCategory;
  label: string;
  prefix: string;
  color: string;
  softBg: string;
  sensitive?: boolean;
  /** Ruta SVG interna (viewBox 0 0 24 24) para icono vectorial consistente. */
  svgIcon: string;
}

export const INCIDENT_CATEGORIES: Record<IncidentAlertCategory, IncidentCategoryMeta> = {
  fire: {
    key: 'fire',
    label: 'Incendio y peligro inmediato',
    prefix: 'FUE',
    color: '#D94841',
    softBg: 'rgba(217, 72, 65, 0.12)',
    svgIcon:
      '<path d="M12 3c1.5 3 4 4.8 4 8.5a4 4 0 1 1-8 0c0-1.6.7-3 1.5-4.1.2 1.2.9 2 1.8 2.4-.5-2.1-.3-4.6.7-6.8z"/>',
  },
  medical: {
    key: 'medical',
    label: 'Asistencia sanitaria',
    prefix: 'SAN',
    color: '#1688CF',
    softBg: 'rgba(22, 136, 207, 0.12)',
    svgIcon: '<path d="M12 5v14M5 12h14"/>',
  },
  accessibility: {
    key: 'accessibility',
    label: 'Accesibilidad y Carpa Amarilla',
    prefix: 'ACC',
    color: '#E69A26',
    softBg: 'rgba(230, 154, 38, 0.14)',
    svgIcon:
      '<circle cx="12" cy="5.5" r="2"/><path d="M6.5 10h11M12 10v4.5l3.5 5M12 14.5l-3.5 5"/>',
  },
  violet_point: {
    key: 'violet_point',
    label: 'Punto Violeta',
    prefix: 'VIO',
    color: '#9755C2',
    softBg: 'rgba(151, 85, 194, 0.13)',
    sensitive: true,
    svgIcon:
      '<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6l7-3z"/><circle cx="12" cy="11.5" r="2.2"/>',
  },
  security: {
    key: 'security',
    label: 'Seguridad y policía',
    prefix: 'SEG',
    color: '#3977A6',
    softBg: 'rgba(57, 119, 166, 0.12)',
    svgIcon:
      '<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6l7-3z"/><path d="M9.5 12l1.8 1.8 3.5-3.8"/>',
  },
  logistics: {
    key: 'logistics',
    label: 'Logística y circulación',
    prefix: 'LOG',
    color: '#199A87',
    softBg: 'rgba(25, 154, 135, 0.12)',
    svgIcon:
      '<rect x="2.5" y="7" width="12" height="8.5" rx="1.5"/><path d="M14.5 9.5h4l2.5 3v3h-6.5"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  },
  congestion: {
    key: 'congestion',
    label: 'Congestión y afluencia',
    prefix: 'CON',
    color: '#C17A32',
    softBg: 'rgba(193, 122, 50, 0.13)',
    svgIcon:
      '<circle cx="8" cy="8" r="2.3"/><circle cx="16" cy="8" r="2.3"/><circle cx="12" cy="13" r="2.3"/><path d="M4 19c.4-2.2 2-3.5 4-3.5M20 19c-.4-2.2-2-3.5-4-3.5M8.5 20c.5-2 1.8-3 3.5-3s3 1 3.5 3"/>',
  },
  information: {
    key: 'information',
    label: 'Información y orientación',
    prefix: 'INF',
    color: '#64748B',
    softBg: 'rgba(100, 116, 139, 0.13)',
    svgIcon:
      '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v5.5"/><circle cx="12" cy="7.5" r=".7" fill="currentColor"/>',
  },
};

export const SEVERITY_META: Record<
  IncidentSeverityLevel,
  {label: string; badgeBg: string; badgeFg: string; border: string}
> = {
  informativa: {
    label: 'Informativa',
    badgeBg: '#eef2f6',
    badgeFg: '#334155',
    border: '#cbd5e1',
  },
  leve: {
    label: 'Leve',
    badgeBg: '#eff6ff',
    badgeFg: '#1d4ed8',
    border: '#bfdbfe',
  },
  moderada: {
    label: 'Moderada',
    badgeBg: '#fef3c7',
    badgeFg: '#92400e',
    border: '#fcd34d',
  },
  grave: {
    label: 'Grave',
    badgeBg: '#ffedd5',
    badgeFg: '#9a3412',
    border: '#fdba74',
  },
  critica: {
    label: 'Crítica',
    badgeBg: '#fee2e2',
    badgeFg: '#991b1b',
    border: '#fca5a5',
  },
};

export function categoryForIncidentType(type: string): IncidentAlertCategory {
  switch (type) {
    case 'fire':
      return 'fire';
    case 'fall':
    case 'cut':
    case 'minor':
      return 'medical';
    case 'accessibility':
      return 'accessibility';
    case 'violet_point':
      return 'violet_point';
    case 'conflict':
    case 'fence_breach':
      return 'security';
    case 'obstacle':
      return 'logistics';
    case 'congestion':
      return 'congestion';
    case 'orientation':
      return 'information';
    default:
      return 'information';
  }
}

export function normalizeSeverity(
  raw: string | undefined,
  type?: string
): IncidentSeverityLevel {
  if (
    raw === 'informativa' ||
    raw === 'leve' ||
    raw === 'moderada' ||
    raw === 'grave' ||
    raw === 'critica'
  ) {
    return raw;
  }
  if (type === 'fire') return 'critica';
  if (type === 'violet_point' || type === 'fall' || type === 'conflict') {
    return 'moderada';
  }
  if (type === 'accessibility' || type === 'orientation') return 'informativa';
  return 'leve';
}

export function formatIncidentCode(
  category: IncidentAlertCategory,
  seq: number
): string {
  const prefix = INCIDENT_CATEGORIES[category].prefix;
  return `${prefix}-${String(Math.max(1, seq)).padStart(3, '0')}`;
}

export function formatRelativeTime(relSeconds: number): string {
  const s = Math.max(0, Math.floor(relSeconds || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `T+${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function incidentStatusHeadline(
  row: EmergencyIncident,
  engineTime: number,
  fireCordonState?: string
): string {
  if (row.type === 'fire') {
    const stageState = fireCordonState || row.fireStage;
    if (stageState === 'hot_zone') return 'Incendio extinguido — Zona caliente en enfriamiento';
    if (stageState === 'approaching') return 'Incendio extinguido — Zona pendiente de asegurar';
    if (stageState === 'installing') return 'Incendio extinguido — Montando vallas de protección';
    if (stageState === 'fenced') return 'Zona de cenizas asegurada y vallada';
    if (stageState === 'cleanup') return 'Retirada de restos en curso';
    if (stageState === 'inspection') return 'Inspección técnica previa a reapertura';
    if (stageState === 'reopened') return 'Zona reabierta tras retirada de restos';
    if (stageState === 'propagacion' && row.status !== 'resolved') return 'Incendio activo · propagación térmica';
    if (stageState === 'exposicion' && row.status !== 'resolved') return 'Incendio desarrollado · exposición próxima';
    if (stageState === 'controlado' && row.status !== 'resolved') return 'Incendio contenido · enfriamiento';
    if (stageState === 'desarrollado' && row.status !== 'resolved') return 'Incendio desarrollado';
    if (stageState === 'conato' && row.status !== 'resolved') return 'Conato localizado';
  }
  if (row.category === 'violet_point' || row.type === 'violet_point') {
    if (row.status === 'resolved') return 'Atención reservada finalizada — Punto Violeta';
    if (row.status === 'assisting') return 'Atención reservada en curso — Punto Violeta';
    return 'Solicitud de atención reservada — Punto Violeta';
  }
  if (row.category === 'accessibility' || row.type === 'accessibility') {
    if (row.status === 'resolved') return 'Acompañamiento completado — Carpa Amarilla';
    if (row.status === 'waiting') return 'Carpa Amarilla sin auxiliares disponibles';
    if (row.status === 'assisting') return 'Acompañamiento en curso — Carpa Amarilla';
    if (row.status === 'assigned') return 'Auxiliar en camino — Carpa Amarilla';
    return 'Acompañamiento solicitado — Carpa Amarilla';
  }
  if (row.status === 'resolved') return 'Resuelta';
  if (row.status === 'blocked') return 'Acceso bloqueado';
  if (row.status === 'waiting') return 'En espera de recurso disponible';
  if (row.status === 'waiting_transport') return 'Esperando traslado compatible';
  if (row.status === 'local') return 'Primera intervención en curso';
  if (row.status === 'assisting') return 'Intervención en el lugar';
  if (row.phase === 'transfer') return 'Evacuación / traslado en curso';
  if (row.status === 'assigned') {
    return engineTime < (row.assigned || 0) + (row.alertDelay || 0)
      ? 'Preparando salida del equipo'
      : 'Recurso en desplazamiento';
  }
  if (row.status === 'pending') return 'Asistencia solicitada';
  return 'Detectada';
}

export function buildNotificationTitle(
  row: EmergencyIncident,
  engineTime: number,
  privacyMode: 'public' | 'authorized_synthetic' = 'public',
  fireCordonState?: string
): string {
  const cat = row.category || categoryForIncidentType(row.type);
  const code = row.code || formatIncidentCode(cat, Number(row.id) || 1);
  const statusStr = incidentStatusHeadline(row, engineTime, fireCordonState);
  if (cat === 'violet_point' && privacyMode === 'public') {
    return `${code} · ${statusStr}`;
  }
  const baseName = row.name || INCIDENT_CATEGORIES[cat].label;
  return `${code} · ${baseName} — ${statusStr}`;
}

/** Añade un hito a `row.timeline` evitando duplicados consecutivos equivalentes. */
export function appendIncidentMilestone(
  row: EmergencyIncident,
  entry: Omit<IncidentTimelineEvent, 'id' | 'relTime'>
): void {
  if (!row.timeline) row.timeline = [];
  const origin = row.created ?? entry.time;
  const relTime = Math.max(0, entry.time - origin);
  const prev = row.timeline[row.timeline.length - 1];
  if (
    prev &&
    prev.kind === entry.kind &&
    prev.status === entry.status &&
    prev.label === entry.label &&
    Math.abs(prev.time - entry.time) < 1
  ) {
    return;
  }
  row.timeline.push({
    ...entry,
    id: `${row.id}-ev-${row.timeline.length + 1}`,
    relTime,
    calibrated: entry.calibrated || 'simulated',
  });
}

/**
 * Observa los cambios en tiempo real de todas las incidencias del motor y registra
 * hitos, estados, relaciones simultáneas y evolución post-incendio.
 */
export function syncIncidentHistory(engine: any): void {
  const events: EmergencyIncident[] = engine?.emergency?.events || [];
  const t: number = engine?.time || 0;
  const activeIds = events
    .filter((r) => r.status !== 'resolved')
    .map((r) => r.id);

  for (const row of events) {
    const cat = row.category || categoryForIncidentType(row.type);
    row.category = cat;
    row.sensitive = cat === 'violet_point';
    row.severity = normalizeSeverity(row.severity, row.type);

    if (!row.timeline || row.timeline.length === 0) {
      row.hasPreDetectionData = true;
      appendIncidentMilestone(row, {
        time: row.created ?? t,
        kind: 'origin',
        label:
          row.type === 'fire'
            ? 'Se origina el foco de incendio'
            : row.type === 'accessibility'
              ? 'Solicitud de acompañamiento en Carpa Amarilla'
              : row.type === 'violet_point'
                ? 'Solicitud reservada en Punto Violeta'
                : `Se produce: ${row.name || INCIDENT_CATEGORIES[cat].label}`,
        detail: row.sensitive
          ? 'Registro reservado de solicitud en el servicio.'
          : row.note || 'Inicio registrado dentro de la simulación.',
        status: 'unreported',
        severity: row.severity as IncidentSeverityLevel,
        point: row.point ? [...row.point] : undefined,
      });
    }

    if (row.status !== 'resolved') {
      const others = activeIds.filter((id) => id !== row.id);
      if (others.length) {
        const set = new Set(row.simultaneousIds || []);
        for (const oid of others) set.add(oid);
        row.simultaneousIds = [...set];
      }
    }

    const lastLoggedStatus = row._histLastStatus as string | undefined;
    const lastLoggedPhase = row._histLastPhase as string | undefined;
    const lastLoggedRes = row._histLastResource as string | undefined;

    if (row.reportedAt != null && !row._histDetected) {
      row._histDetected = true;
      appendIncidentMilestone(row, {
        time: row.reportedAt,
        kind: 'detection',
        label: 'Se detecta y notifica la incidencia',
        detail: row.sensitive
          ? 'Aviso recibido en Punto Violeta (datos individuales reservados).'
          : row.reporters?.length
            ? `Detectada por ${row.reporters.length} agente(s) o testigo(s) próximo(s).`
            : 'Aviso registrado por el sistema de vigilancia.',
        status: 'pending',
        severity: row.severity as IncidentSeverityLevel,
        point: row.point ? [...row.point] : undefined,
      });
    }

    if (row.resourceId && row.resourceId !== lastLoggedRes) {
      row._histLastResource = row.resourceId;
      appendIncidentMilestone(row, {
        time: row.assigned ?? t,
        kind: 'assignment',
        label: 'Se asigna recurso operativo',
        detail: `Recurso asignado: ${row.resourceName || row.resourceId}.`,
        status: row.status,
        severity: row.severity as IncidentSeverityLevel,
        resourceId: row.resourceId,
        resourceName: row.resourceName,
      });
    }

    if (row.status !== lastLoggedStatus || row.phase !== lastLoggedPhase) {
      row._histLastStatus = row.status;
      row._histLastPhase = row.phase;

      if (row.status === 'waiting') {
        appendIncidentMilestone(row, {
          time: t,
          kind: 'waiting',
          label:
            row.category === 'accessibility'
              ? 'Carpa Amarilla sin auxiliares disponibles'
              : 'En espera por recursos ocupados',
          detail:
            row.note ||
            'Todos los equipos compatibles están atendiendo otras incidencias.',
          status: row.status,
          severity: row.severity as IncidentSeverityLevel,
        });
      } else if (row.status === 'blocked') {
        const reason =
          row.note || 'Obstáculo o estrechamiento en la ruta de acceso.';
        row.obstaclesEncountered = Array.from(
          new Set([...(row.obstaclesEncountered || []), reason])
        );
        appendIncidentMilestone(row, {
          time: t,
          kind: 'blocked',
          label: 'Bloqueo o desvío detectado en ruta',
          detail: reason,
          status: row.status,
          severity: row.severity as IncidentSeverityLevel,
        });
      } else if (row.status === 'assigned' && row.phase === 'transfer') {
        appendIncidentMilestone(row, {
          time: t,
          kind: 'transfer',
          label: 'Comienza la evacuación / traslado',
          detail: row.note || 'Traslado del paciente hacia ambulancia o zona segura.',
          status: row.status,
          severity: row.severity as IncidentSeverityLevel,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
          distanceMeters: row.distanceTravelled || 0,
        });
      } else if (row.status === 'assigned') {
        appendIncidentMilestone(row, {
          time: t,
          kind: 'dispatch',
          label: 'Equipo en desplazamiento',
          detail: row.note || 'El recurso sale hacia el punto de la incidencia.',
          status: row.status,
          severity: row.severity as IncidentSeverityLevel,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
        });
      } else if (row.status === 'assisting' || row.status === 'local') {
        if (row.arrived == null) row.arrived = t;
        appendIncidentMilestone(row, {
          time: t,
          kind: 'arrival',
          label:
            row.status === 'local'
              ? 'Primera intervención local con extintor'
              : 'Llegada del equipo e inicio de atención',
          detail: row.sensitive
            ? 'Atención reservada iniciada en Punto Violeta.'
            : row.note || 'Se inicia la intervención sobre el terreno.',
          status: row.status,
          severity: row.severity as IncidentSeverityLevel,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
          distanceMeters: row.distanceTravelled || 0,
        });
      } else if (row.status === 'resolved') {
        appendIncidentMilestone(row, {
          time: row.closed ?? t,
          kind: row.type === 'fire' ? 'extinguished' : 'resolution',
          label:
            row.type === 'fire'
              ? 'Incendio extinguido (zona caliente pendiente de asegurar)'
              : 'Finaliza la intervención',
          detail: row.sensitive
            ? 'Atención reservada concluida y servicio disponible.'
            : row.fireOutcome || row.note || 'Incidencia cerrada.',
          status: 'resolved',
          severity: row.severity as IncidentSeverityLevel,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
          distanceMeters:
            (row.distanceTravelled || 0) + (row.extinguisherWorker?.walked || 0),
        });
      }
    }

    if (row.type === 'fire' && engine.emergency?.fire?.cordons) {
      const cordon = engine.emergency.fire.cordons.find(
        (c: {rowId: string | number}) => c.rowId === row.id
      );
      if (cordon && cordon.state !== row._histCordonState) {
        row._histCordonState = cordon.state;
        const mapCordon: Record<
          string,
          {kind: IncidentTimelineEvent['kind']; label: string; detail: string}
        > = {
          hot_zone: {
            kind: 'hot_zone',
            label: 'Zona caliente en enfriamiento',
            detail:
              'Foco extinguido con perímetro térmico aún caliente y acceso restringido.',
          },
          approaching: {
            kind: 'cordon_approach',
            label: 'Zona caliente · equipo de montaje en camino',
            detail:
              'Se moviliza personal de montaje para perimetrar el área de cenizas.',
          },
          installing: {
            kind: 'cordon_install',
            label: 'Montaje de vallas perimetrales',
            detail:
              'Instalación de vallas alrededor del círculo afectado para impedir el paso.',
          },
          fenced: {
            kind: 'cordon_fenced',
            label: 'Zona asegurada y vallada',
            detail:
              'Perímetro cerrado; el flujo peatonal se desvía automáticamente fuera de las cenizas.',
          },
          cleanup: {
            kind: 'cleanup',
            label: 'Retirada de restos y enfriamiento',
            detail:
              'Saneamiento del área afectada antes de valorar la reapertura.',
          },
          inspection: {
            kind: 'inspection',
            label: 'Inspección técnica previa a reapertura',
            detail:
              'Verificación de estabilidad, ausencia de rescoldos y seguridad estructural.',
          },
          reopened: {
            kind: 'reopened',
            label: 'Reapertura del entorno',
            detail: 'Restos retirados; área de tránsito restablecida.',
          },
        };
        const spec = mapCordon[cordon.state];
        if (spec) {
          appendIncidentMilestone(row, {
            time: t,
            kind: spec.kind,
            label: spec.label,
            detail: spec.detail,
            status: 'resolved',
            severity: cordon.state === 'reopened' ? 'informativa' : 'moderada',
            point: cordon.center
              ? ([cordon.center[0], cordon.center[1]] as [number, number])
              : undefined,
          });
        }
      }
    }
  }
}

export interface IncidentEvaluationMetrics {
  detectionSeconds: number | null;
  assignmentSeconds: number | null;
  arrivalSeconds: number | null;
  interventionSeconds: number | null;
  totalResolutionSeconds: number | null;
  resourcesUsed: string[];
  distanceMeters: number;
  waitForBusySeconds: number;
  obstacles: string[];
  simultaneousCount: number;
  affectedVisitorsEstimate: number;
  estimatedCostEur: number;
  costIsEstimate: true;
  operationalComplete: boolean;
  firePhaseSummary?: string;
}

/**
 * Calcula métricas de evaluación distinguiendo tiempos realmente simulados
 * frente a estimaciones exploratorias no calibradas (p. ej. coste).
 */
export function evaluateIncidentManagement(
  row: EmergencyIncident,
  engine: any
): IncidentEvaluationMetrics {
  const created = row.created ?? 0;
  const reported = row.reportedAt ?? null;
  const assigned = row.assigned ?? null;
  const arrived =
    row.arrived ??
    row.timeline?.find((e) => e.kind === 'arrival')?.time ??
    null;
  const closed = row.closed ?? null;
  const now = engine?.time ?? created;

  const detectionSeconds =
    reported != null ? Math.max(0, reported - created) : null;
  const assignmentSeconds =
    assigned != null ? Math.max(0, assigned - (reported ?? created)) : null;
  const arrivalSeconds =
    arrived != null ? Math.max(0, arrived - created) : null;
  const interventionSeconds =
    arrived != null ? Math.max(0, (closed ?? now) - arrived) : null;
  const totalResolutionSeconds =
    closed != null ? Math.max(0, closed - created) : null;

  const resourcesUsed: string[] = [];
  if (row.resourceName) resourcesUsed.push(row.resourceName);
  else if (row.resourceId) resourcesUsed.push(String(row.resourceId));
  if (row.localAttempt) resourcesUsed.push('Extintor local del puesto');

  const cordon = engine?.emergency?.fire?.cordons?.find(
    (c: {rowId: string | number}) => c.rowId === row.id
  );
  if (cordon) {
    resourcesUsed.push('Equipo de montaje (vallado post-incendio)');
  }

  const distanceMeters = Number(
    (
      (row.distanceTravelled || 0) + (row.extinguisherWorker?.walked || 0)
    ).toFixed(1)
  );

  const waitEvent = row.timeline?.find((e) => e.kind === 'waiting');
  const waitForBusySeconds =
    waitEvent && assigned != null && assigned > waitEvent.time
      ? Math.round(assigned - waitEvent.time)
      : waitEvent && row.status === 'waiting'
        ? Math.round(Math.max(0, now - waitEvent.time))
        : 0;

  const affectedVisitorsEstimate =
    row.type === 'fire'
      ? Math.max(
          engine?.emergency?.evacuation?.stats?.evacuated || 0,
          (engine?.agents || []).filter(
            (a: {x: number; y: number; state?: string}) =>
              a.state !== 'gone' &&
              row.point &&
              Math.hypot(a.x - row.point[0], a.y - row.point[1]) <= 12
          ).length
        )
      : (engine?.agents || []).filter(
          (a: {x: number; y: number; state?: string}) =>
            a.state !== 'gone' &&
            row.point &&
            Math.hypot(a.x - row.point[0], a.y - row.point[1]) <= 6
        ).length;

  const hourlyUnitCost =
    row.type === 'fire'
      ? 240
      : row.responseMode === 'ambulance'
        ? 160
        : row.category === 'accessibility' || row.category === 'violet_point'
          ? 45
          : 65;
  const activeHours = Math.max(0.15, ((closed ?? now) - created) / 3600);
  const cordonExtra = cordon ? 95 : 0;
  const estimatedCostEur = Math.round(hourlyUnitCost * activeHours + cordonExtra);

  const firePhaseSummary =
    row.type === 'fire'
      ? cordon
        ? cordon.state === 'reopened'
          ? 'Extinción + vallado + retirada de restos + reapertura'
          : cordon.state === 'cleanup'
            ? 'Extinción + vallado completado · retirada de restos en curso'
            : cordon.state === 'fenced'
              ? 'Extinción completada · zona de cenizas vallada y asegurada'
              : 'Extinción completada · aseguramiento y montaje de vallas en curso'
        : row.status === 'resolved'
          ? 'Extinción completada · pendiente de aseguramiento'
          : 'Incendio activo'
      : undefined;

  const operationalComplete =
    row.type === 'fire'
      ? row.status === 'resolved' &&
        (!cordon || ['fenced', 'cleanup', 'reopened'].includes(cordon.state))
      : row.status === 'resolved';

  return {
    detectionSeconds,
    assignmentSeconds,
    arrivalSeconds,
    interventionSeconds,
    totalResolutionSeconds,
    resourcesUsed,
    distanceMeters,
    waitForBusySeconds,
    obstacles: row.obstaclesEncountered || [],
    simultaneousCount: row.simultaneousIds?.length || 0,
    affectedVisitorsEstimate,
    estimatedCostEur,
    costIsEstimate: true,
    operationalComplete,
    firePhaseSummary,
  };
}

export type AlternativeChangeKind =
  | 'add_extra_unit'
  | 'move_closer'
  | 'boost_capacity'
  | 'clear_corridor';

export interface AlternativeComparisonResult {
  changeKind: AlternativeChangeKind;
  changeLabel: string;
  original: IncidentEvaluationMetrics;
  alternative: IncidentEvaluationMetrics;
  deltaResponseSec: number | null;
  deltaResolutionSec: number | null;
  deltaDistanceM: number;
  deltaCostEur: number;
  caveat: string;
}

/**
 * Ejecuta un ensayo alternativo determinista a partir de una copia del escenario
 * previo a la incidencia, sin modificar la simulación original.
 */
export function runAlternativeIncidentTrial(
  baseScene: Scene,
  incident: EmergencyIncident,
  replayLog: Array<{time: number; kind: string; value: unknown}>,
  changeKind: AlternativeChangeKind,
  originalMetrics: IncidentEvaluationMetrics,
  horizonSeconds?: number
): AlternativeComparisonResult {
  const altScene = structuredClone(baseScene);
  const targetService =
    incident.type === 'fire'
      ? 'fire'
      : incident.category === 'accessibility'
        ? 'yellow_tent'
        : incident.category === 'violet_point'
          ? 'violet_point'
          : incident.category === 'medical'
            ? 'medical'
            : 'security';

  const pt = incident.point || [50, 50];
  let changeLabel = '';

  if (changeKind === 'add_extra_unit') {
    changeLabel = 'Añadir dotación/auxiliar adicional próxima al foco';
    const refRes =
      altScene.infrastructure.find(
        (o) =>
          o.role === 'emergency' &&
          (o.kind === targetService ||
            (targetService === 'medical' && o.kind === 'ambulance'))
      ) || altScene.infrastructure.find((o) => o.role === 'emergency');
    const clone: Infrastructure = refRes
      ? structuredClone(refRes)
      : {
          id: 'alt-extra-' + targetService,
          role: 'emergency',
          kind: targetService,
          name: 'Refuerzo alternativo',
          x: 50,
          y: 50,
          width: 3,
          depth: 3,
          rotation: 0,
          capacity: 2,
          staff: 2,
          delay: 30,
          handling: 180,
          active: true,
          cost: 120,
        };
    clone.id = `alt-extra-${Date.now()}`;
    clone.name = `${clone.name} (refuerzo)`;
    clone.delay = Math.max(15, Math.round((clone.delay || 45) * 0.65));
    clone.capacity = Math.max(2, (clone.capacity || 1) + 1);
    clone.active = true;
    altScene.infrastructure.push(clone);
  } else if (changeKind === 'move_closer') {
    changeLabel = 'Acercar recurso / carpa de asistencia al punto de incidencia';
    const targetRes = altScene.infrastructure.find(
      (o) => o.id === incident.resourceId || o.kind === targetService
    );
    if (targetRes) {
      const txPct = Math.max(8, Math.min(92, (pt[0] / 140) * 100));
      const tyPct = Math.max(8, Math.min(92, (pt[1] / 100) * 100));
      targetRes.x = targetRes.x + (txPct - targetRes.x) * 0.45;
      targetRes.y = targetRes.y + (tyPct - targetRes.y) * 0.45;
      targetRes.delay = Math.max(15, Math.round((targetRes.delay || 45) * 0.8));
    }
  } else if (changeKind === 'boost_capacity') {
    changeLabel = 'Aumentar capacidad operativa y reducir demora de salida';
    for (const o of altScene.infrastructure) {
      if (o.role === 'emergency') {
        o.capacity = (o.capacity || 1) + 1;
        o.staff = (o.staff || 2) + 1;
        o.delay = Math.max(15, Math.round((o.delay || 45) * 0.6));
      }
    }
  } else {
    changeLabel = 'Despejar corredores y ampliar margen de paso';
    altScene.base.space = Math.max(3, (altScene.base.space || 2) + 1);
    for (const ent of altScene.entrances || []) {
      ent.clearWidth = Math.max(4.5, (ent.clearWidth || 3) + 1);
    }
  }

  const altEngine = new EventEngine(altScene);
  const targetTime = Math.min(
    altEngine.duration,
    Math.max(
      (incident.closed ?? (incident.created || 0) + 420) + 120,
      horizonSeconds || 600
    )
  );
  let cursor = 0;
  let injectedFallback = false;

  while (altEngine.time + 0.49 <= targetTime && !altEngine.finished) {
    while (cursor < replayLog.length && replayLog[cursor].time <= altEngine.time) {
      const act = replayLog[cursor++];
      if (act.kind === 'inject') {
        const v = act.value as string | {type: string; sourceId?: string | null};
        altEngine.emergency.inject(
          typeof v === 'string' ? v : v.type,
          typeof v === 'string' ? null : v.sourceId || null
        );
      }
    }
    if (
      !injectedFallback &&
      altEngine.time >= (incident.created || 0) &&
      !altEngine.emergency.events.some((ev) => ev.type === incident.type)
    ) {
      injectedFallback = true;
      altEngine.emergency.inject(incident.type, incident.stationId || null);
    }
    altEngine.tick(0.5);
  }

  const matched =
    altEngine.emergency.events.find(
      (ev) => ev.code === incident.code || ev.type === incident.type
    ) || incident;
  const alternative = evaluateIncidentManagement(matched, altEngine);

  return {
    changeKind,
    changeLabel,
    original: originalMetrics,
    alternative,
    deltaResponseSec:
      originalMetrics.arrivalSeconds != null &&
      alternative.arrivalSeconds != null
        ? Math.round(alternative.arrivalSeconds - originalMetrics.arrivalSeconds)
        : null,
    deltaResolutionSec:
      originalMetrics.totalResolutionSeconds != null &&
      alternative.totalResolutionSeconds != null
        ? Math.round(
            alternative.totalResolutionSeconds -
              originalMetrics.totalResolutionSeconds
          )
        : null,
    deltaDistanceM: Number(
      (alternative.distanceMeters - originalMetrics.distanceMeters).toFixed(1)
    ),
    deltaCostEur: alternative.estimatedCostEur - originalMetrics.estimatedCostEur,
    caveat:
      'Resultados de dos escenarios simulados con la misma semilla; orientativos, no constituyen garantía de mejora real.',
  };
}

/** Construye la ficha exportable JSON respetando privacidad en incidencias sensibles. */
export function buildIncidentExportPayload(
  row: EmergencyIncident,
  engine: any,
  metrics: IncidentEvaluationMetrics,
  privacyMode: 'public' | 'authorized_synthetic',
  globalClockText: string,
  comparison?: AlternativeComparisonResult | null
): Record<string, unknown> {
  const cat = row.category || categoryForIncidentType(row.type);
  const redacted = cat === 'violet_point' && privacyMode === 'public';
  return {
    ficha: 'OxEye — Análisis de Incidencia',
    codigo: row.code || formatIncidentCode(cat, Number(row.id) || 1),
    categoria: INCIDENT_CATEGORIES[cat].label,
    gravedad: SEVERITY_META[normalizeSeverity(row.severity, row.type)].label,
    privacidad: redacted
      ? 'Modo público (datos individuales y trayectorias reservadas omitidas)'
      : privacyMode === 'authorized_synthetic'
        ? 'Prueba sintética autorizada (sin datos personales reales)'
        : 'Estándar (agentes anónimos)',
    instanteCapturaGlobal: globalClockText,
    tiempoRelativoCaptura: formatRelativeTime(
      (engine?.time || 0) - (row.created || 0)
    ),
    ubicacion: redacted
      ? 'Servicio Punto Violeta (ubicación individual reservada)'
      : row.point
        ? {
            xMetros: Number(row.point[0].toFixed(1)),
            yMetros: Number(row.point[1].toFixed(1)),
          }
        : null,
    estadoActual: incidentStatusHeadline(row, engine?.time || 0),
    cronologia: (row.timeline || []).map((ev) => ({
      tiempoRelativo: formatRelativeTime(ev.relTime),
      segundosGlobales: Math.round(ev.time),
      hito: ev.label,
      detalle: redacted ? 'Registro reservado de servicio.' : ev.detail,
      estado: ev.status,
      origenDato: ev.calibrated || 'simulated',
    })),
    metricas: metrics,
    hipotesisYLimitaciones: [
      'Los tiempos de detección, recorrido e intervención proceden de la simulación determinista.',
      'El coste estimado es orientativo y no está calibrado con tarifas locales.',
      'Este documento no sustituye a un plan de autoprotección ni a la validación técnica.',
    ],
    comparacionAlternativa: comparison || null,
  };
}

/** Genera el CSV de cronología de una incidencia respetando restricciones de privacidad. */
export function buildIncidentTimelineCsv(
  row: EmergencyIncident,
  privacyMode: 'public' | 'authorized_synthetic'
): string {
  const cat = row.category || categoryForIncidentType(row.type);
  const redacted = cat === 'violet_point' && privacyMode === 'public';
  const escCsv = (v: unknown) =>
    `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [
    [
      'Codigo',
      'TiempoRelativo',
      'SegundosGlobales',
      'Hito',
      'Estado',
      'Detalle',
      'OrigenDato',
    ].join(','),
  ];
  for (const ev of row.timeline || []) {
    lines.push(
      [
        escCsv(row.code || row.id),
        escCsv(formatRelativeTime(ev.relTime)),
        escCsv(Math.round(ev.time)),
        escCsv(ev.label),
        escCsv(ev.status),
        escCsv(redacted ? 'Registro reservado de servicio.' : ev.detail),
        escCsv(ev.calibrated || 'simulated'),
      ].join(',')
    );
  }
  return lines.join('\n');
}
