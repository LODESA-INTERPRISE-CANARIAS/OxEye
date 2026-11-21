/**
 * @module engine/emergency/risk
 * Pre-flight risk assessment, Poisson medical demand tail, live critical failure checks, and trial result summaries.
 */
import {MAPS_DATA} from '../../data/geodata';
import {MAPS} from '../../data/venue-maps';
import type {
  EmergencyIncident,
  Infrastructure,
  Point,
  Scene,
  VenueKey,
} from '../../types';
import type {EventEngine} from '../crowd/event-engine';
import {phaseScene} from '../logistics/phases';
import {demandPlan} from '../planning/demand';
import {evaluateHeavyLoadConflicts} from '../subsoil/heat';
import {RESPONSE_PROFILES, responseRoute} from './response-model';
import {gateAllowsAuthority} from './priority';

export interface RiskIssueMeta {
  kind?: string;
  resourceId?: string;
  resourceName?: string;
  targetId?: string;
  targetName?: string;
  unreachableNames?: string[];
  reason?: 'start_blocked' | 'no_corridor' | 'narrow_turn';
  requiredWidth?: number;
  errorDetail?: string;
}

export interface RiskIssue {
  id: string;
  level: 'critical' | 'warning';
  title: string;
  action: string;
  meta?: RiskIssueMeta;
}

export interface RiskStatisticalReport {
  rate: number;
  exposure: number;
  expected: number;
  any: number;
  overlap: number;
  slots: number;
  serviceMinutes: number;
}

export interface RiskAssessmentReport {
  issues: RiskIssue[];
  critical: RiskIssue[];
  warnings: RiskIssue[];
  expected: number;
  statistical: RiskStatisticalReport | null;
  slots: {
    medical: number;
    security: number;
    fire: number;
  };
  checkedAt: string;
}

export function safetyFingerprint(s: Scene): string {
  const fields = [
    'id',
    'kind',
    'role',
    'type',
    'x',
    'y',
    'width',
    'depth',
    'rotation',
    'staff',
    'capacity',
    'active',
    'reserve',
    'delay',
    'handling',
    'phaseTags',
    'phases',
    'clearWidth',
    'points',
    'labCapacity',
    'labTime',
    'heavyLoad',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objects = (a?: any[]) =>
    (a || []).map((o) =>
      Object.fromEntries(
        fields.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])
      )
    );
  return JSON.stringify({
    arrivals: s.base.arrivals,
    hours: s.base.hours,
    weather: s.base.weather,
    booths: objects(s.base.booths),
    infrastructure: objects(s.infrastructure),
    entrances: objects(s.entrances),
    fences: objects(s.fences),
    reserves: objects(s.reserves),
    boundary: s.boundary,
    passages: objects(s.passages),
    responseMode: s.responseMode,
    policeMode: s.policeMode,
    fireFootAccess: s.fireFootAccess,
    trained: s.trained,
    riskInputs: s.riskInputs,
    demand: s.demandInputs,
    subsoil: s.subsoil,
  });
}

export function medicalKind(s: Scene): string {
  return s.responseMode === 'ambulance' ? 'ambulance' : 'medical';
}

export function requiredStaff(s: Scene, kind: string): number {
  return kind === 'medical'
    ? s.responseMode === 'stretcher'
      ? 2
      : 1
    : ({fire: 2, ambulance: 2, patrol: 1, security: 1} as Record<string, number>)[
        kind
      ] || 1;
}

export function resourceSlots(s: Scene, r: Infrastructure): number {
  return r.active === false
    ? 0
    : Math.max(
        0,
        Math.min(
          Math.floor(Number(r.capacity) || 0),
          Math.floor((Number(r.staff) || 0) / requiredStaff(s, r.kind))
        )
      );
}

export function poissonTail(mean: number, capacity: number): number {
  if (
    !Number.isFinite(mean) ||
    mean < 0 ||
    !Number.isInteger(capacity) ||
    capacity < 0
  ) {
    throw new Error('Hipótesis estadística inválida');
  }
  if (mean === 0) return 0;
  if (capacity === 0) return -Math.expm1(-mean);
  if (mean > 700) return 1;
  let term = Math.exp(-mean);
  let sum = term;
  for (let i = 1; i <= capacity; i++) {
    term *= mean / i;
    sum += term;
  }
  return Math.max(0, Math.min(1, 1 - sum));
}

export function assessRisk(
  raw: Scene,
  engine: EventEngine | null = null,
  {routes = false}: {routes?: boolean} = {}
): RiskAssessmentReport {
  const s = phaseScene(raw, 'event');
  const issues: RiskIssue[] = [];
  const add = (
    id: string,
    level: 'critical' | 'warning',
    title: string,
    action: string,
    meta?: RiskIssueMeta
  ) => issues.push({id, level, title, action, ...(meta ? {meta} : {})});

  const resources = s.infrastructure.filter((r) => r.role === 'emergency');
  if (
    !Number.isFinite(s.base.arrivals) ||
    s.base.arrivals < 0 ||
    s.base.arrivals > 3000 ||
    !Number.isFinite(s.base.hours) ||
    s.base.hours < 1 ||
    s.base.hours > 24
  ) {
    add(
      'inputs',
      'critical',
      'Previsión de público o duración inválida',
      'Introduce llegadas entre 0 y 3.000 por hora y una duración de 1 a 24 horas.'
    );
  }
  if (
    s.demandInputs &&
    Object.values(s.demandInputs).some((v) => !Number.isFinite(v) || v < 0)
  ) {
    add(
      'demand-invalid',
      'critical',
      'Hay hipótesis de demanda inválidas',
      'Revisa Dimensionar oferta; todos sus valores deben ser números finitos no negativos.'
    );
  }
  if (
    s.riskInputs?.maxWaitSeconds != null &&
    (!Number.isFinite(s.riskInputs.maxWaitSeconds) ||
      s.riskInputs.maxWaitSeconds < 15 ||
      s.riskInputs.maxWaitSeconds > 600)
  ) {
    add(
      'wait-invalid',
      'critical',
      'El límite de espera no es válido',
      'Configura un umbral de ensayo entre 15 y 600 segundos.'
    );
  }
  const expected = s.demandInputs
    ? demandPlan(s.demandInputs).occupied
    : Math.max(0, (s.base.arrivals * (s.base.stay || 60)) / 60);
  const publicPresent = expected > 0 || (engine?.agents.length || 0) > 0;
  const slots = (kind: string) =>
    resources
      .filter((r) => r.kind === kind)
      .reduce((n, r) => n + resourceSlots(s, r), 0);
  const response = medicalKind(s);
  const security = s.policeMode === 'patrol' ? 'patrol' : 'security';

  for (const r of resources) {
    if (
      ['ambulance', 'fire', 'patrol'].includes(r.kind) &&
      (r.capacity || 0) > 1
    ) {
      add(
        'vehicle-capacity-' + r.id,
        'critical',
        'Un mismo vehículo no puede acudir a varias intervenciones a la vez',
        'Declara cada vehículo por separado; su disponibilidad simultánea máxima en este modelo es una intervención.'
      );
    }
    if (
      !Number.isInteger(r.staff) ||
      (r.staff || 0) < 0 ||
      !Number.isInteger(r.capacity) ||
      (r.capacity || 0) < 0
    ) {
      add(
        'invalid-' + r.id,
        'critical',
        'Dotación inválida en ' + r.name,
        'Introduce personas y equipos como números enteros no negativos.'
      );
    }
    if (
      r.active !== false &&
      Number(r.capacity) >
        Math.floor((Number(r.staff) || 0) / requiredStaff(s, r.kind))
    ) {
      add(
        'overbook-' + r.id,
        'critical',
        'Capacidad sin personal suficiente: ' + r.name,
        'Reduce los equipos simultáneos o asigna personal distinto a cada intervención.'
      );
    }
  }

  if (!s.boundary || s.boundary.length < 3) {
    add(
      'boundary',
      'critical',
      'Perímetro operativo pendiente de definir',
      'Delimita el área operativa del evento sobre el mapa (mínimo 3 puntos) antes de configurar inventario o simular.'
    );
  }
  if ((s.pendingStock || []).length) {
    add(
      'pending',
      'critical',
      'Hay piezas del inventario sin colocar',
      'Coloca o retira las piezas pendientes; no cuentan como recursos disponibles.'
    );
  }
  if (publicPresent && !slots(response)) {
    add(
      'medical',
      'critical',
      'No hay equipo sanitario compatible disponible',
      'Coloca un equipo con personal, capacidad y presencia en Evento; la modalidad elegida necesita ' +
        requiredStaff(s, response) +
        ' persona(s) por intervención. Regla del ensayo, no mínimo legal.'
    );
  }
  if (publicPresent && !slots(security)) {
    add(
      'security',
      'critical',
      'No hay equipo de seguridad para intervenir',
      'Configura una patrulla compatible en el plano. El personal anotado en otros formularios no sustituye un recurso operativo.'
    );
  }
  const food = s.base.booths.filter((o) => o.type === 'food');
  if (food.length && !slots('fire')) {
    add(
      'fire',
      'critical',
      'La oferta de comida no dispone de respuesta de bomberos en el modelo',
      'Configura una dotación operativa y su aproximación. Un refuerzo solicitado o un extintor sin operador no equivale a bomberos disponibles.'
    );
  }
  if (s.responseMode === 'stretcher' && !slots('ambulance')) {
    add(
      'transfer',
      'critical',
      'La camilla no dispone de ambulancia para la entrega',
      'Coloca una ambulancia activa con personal y capacidad.'
    );
  }
  const gates = s.entrances.filter(
    (g) => (g.phases?.event || g.role) !== 'closed'
  );
  if (
    publicPresent &&
    !gates.some((g) =>
      ['both', 'in', 'free'].includes(g.phases?.event || g.role || 'both')
    )
  ) {
    add(
      'entry',
      'critical',
      'Falta entrada de público',
      'Define un acceso de entrada, entrada y salida o acceso libre.'
    );
  }
  if (
    publicPresent &&
    !gates.some((g) =>
      ['both', 'out', 'free'].includes(g.phases?.event || g.role || 'both')
    )
  ) {
    add(
      'exit',
      'critical',
      'Falta salida de público',
      'Define una salida conectada al recinto.'
    );
  }

  const vehicleKinds = [
    ...(food.length ? ['fire'] : []),
    ...(s.responseMode === 'ambulance' || s.responseMode === 'stretcher'
      ? ['ambulance']
      : []),
    ...(security === 'patrol' ? ['patrol'] : []),
  ];
  for (const kind of vehicleKinds) {
    if (
      slots(kind) &&
      !gates.some((g) =>
        gateAllowsAuthority(g, kind, RESPONSE_PROFILES[kind].width + 0.3)
      )
    ) {
      add(
        'gate-' + kind,
        'critical',
        'Falta acceso reservado compatible para ' +
          ({fire: 'bomberos', ambulance: 'ambulancia', patrol: 'policía'}[
            kind
          ] || kind),
        'Marca las autoridades recomendadas en un acceso y comprueba su anchura libre y recorrido.'
      );
    }
  }

  if (
    food.length &&
    (!s.trained ||
      !s.infrastructure.some(
        (o) => o.kind === 'extinguisher' && o.active !== false
      ))
  ) {
    add(
      'extinguisher',
      'warning',
      'Primera intervención con extintor sin completar',
      'Comprueba formación, ubicación, disponibilidad y recorrido del extintor.'
    );
  }
  if (s.base.weather === 'rain') {
    add(
      'wet-ground',
      'warning',
      'Lluvia: comprobar resbalones y pérdida de asientos secos',
      'Inspecciona pavimento de piedra, drenaje, secado, iluminación y pasos accesibles. Sin datos locales no se asigna una tasa real de caídas.'
    );
  }

  const p = s.demandInputs;
  const d = p ? demandPlan(p) : null;
  if (p && Math.abs(s.base.arrivals - p.arrivals) > 0.01) {
    add(
      'demand-sync',
      'critical',
      'La afluencia del cálculo y la del ensayo son distintas',
      'Actualiza Dimensionar oferta o iguala las llegadas/h; no combines resultados de dos demandas.'
    );
  }
  if (d) {
    const seats = s.infrastructure
      .filter((o) => o.kind === 'picnic')
      .reduce((n, o) => n + (Number(o.capacity) || 6), 0);
    if (seats < d.seats) {
      add(
        'seats',
        'warning',
        'Faltan plazas para la demanda de comida',
        'Se calculan ' +
          d.seats +
          ' plazas y hay ' +
          seats +
          '; revisa también lluvia, acompañamiento y accesibilidad.'
      );
    }
    if (d.remaining < 0) {
      add(
        'area',
        'critical',
        'La huella indicativa supera la superficie declarada',
        'Reduce módulos o revisa la superficie útil; no se acredita aforo mediante este cálculo.'
      );
    }
  }

  const venueMap = MAPS[s.site] || MAPS_DATA[s.site as VenueKey];
  if (venueMap && s.subsoil) {
    const loadConflicts = evaluateHeavyLoadConflicts(s, venueMap);
    for (const conflict of loadConflicts) {
      const sourceSummary = conflict.sources
        .slice(0, 3)
        .map(
          (src) =>
            `${src.kind === 'column' ? 'columna' : 'muro de carga'} «${src.name}»`
        )
        .join(', ');
      const pct = Math.round(conflict.heat * 100);
      add(
        'subsoil-load-' + conflict.itemId,
        conflict.level,
        `Carga pesada en zona de calor del subsuelo: ${conflict.itemName}`,
        `Afecta a ${sourceSummary} (intensidad ${pct} %). Reubica la pieza fuera de la zona restringida de Rayos X o ajusta su condición de carga pesada si no aplica.`
      );
    }
  }

  add(
    'technical',
    'warning',
    'Validación técnica del recinto pendiente',
    'Confirmar aforo autorizado, pavimento, accesibilidad, dispositivos y plan específico. Este ensayo no certifica seguridad.'
  );

  if (routes && engine) {
    const entries = engine.entries.filter((g) =>
      ['both', 'in', 'free'].includes(g.phases?.event || g.role || '')
    );
    const exits = engine.entries.filter((g) =>
      ['both', 'out', 'free'].includes(g.phases?.event || g.role || '')
    );
    for (const station of engine.stations) {
      if (
        station.cell < 0 ||
        !entries.some((g) => g.field[station.cell] >= 0) ||
        !exits.some((g) => g.field[station.cell] >= 0)
      ) {
        add(
          'connection-' + station.id,
          'critical',
          station.name + ': sin conexión comprobada entre acceso y salida',
          'Abre un recorrido transitable hasta la actividad; revisa obstáculos, entradas y salidas.'
        );
      }
    }
    const serviceLabels: Record<string, string> = {
      medical: 'equipo sanitario',
      ambulance: 'ambulancia',
      security: 'seguridad a pie',
      patrol: 'coche policial',
      fire: 'bomberos',
    };
    const targets: Array<{id: string; name: string; point: Point}> = [
      ...engine.entries.map((g) => ({
        id: g.id,
        name: g.name || 'Acceso',
        point: engine.g.point(g.cell),
      })),
      ...engine.stations
        .filter((t) => t.cell >= 0)
        .map((t) => ({
          id: t.id || '',
          name: t.name || 'Actividad',
          point: engine.g.point(t.cell),
        })),
    ];
    for (const kind of [...new Set([response, security, ...vehicleKinds])]) {
      const profileKey =
        kind === 'medical'
          ? s.responseMode === 'stretcher'
            ? 'stretcher'
            : 'firstaid'
          : kind;
      const profile = RESPONSE_PROFILES[profileKey];
      if (!profile) continue;
      const pool = resources.filter(
        (r) => r.kind === kind && resourceSlots(s, r) > 0
      );
      if (!pool.length) continue;
      const unreachableTargets: Array<{id: string; name: string; error: string}> =
        [];
      let requiredWidth = profile.width + 0.3;
      for (const target of targets) {
        let lastError = '';
        const reachable = pool.some((r) => {
          const origin: Point = [
            (r.x * engine.g.m.widthMeters) / 100,
            (r.y * engine.g.m.heightMeters) / 100,
          ];
          const vehicle = ['fire', 'ambulance', 'patrol'].includes(kind);
          const pr = {
            ...profile,
            width: vehicle ? r.width || profile.width : profile.width,
            length: vehicle ? r.depth || profile.length : profile.length,
          };
          requiredWidth = Math.round((pr.width + 0.3) * 10) / 10;
          let route = responseRoute(
            engine,
            origin,
            target.point,
            pr,
            pr.length / 2 + 1
          );
          if (route.error && kind === 'fire' && s.fireFootAccess) {
            route = responseRoute(
              engine,
              origin,
              target.point,
              {...pr, width: 0.9, length: 1.8, speed: 0.85},
              2
            );
          }
          if (route.error) lastError = route.error;
          return !route.error;
        });
        if (!reachable) {
          unreachableTargets.push({
            id: target.id,
            name: target.name,
            error: lastError,
          });
        }
      }
      if (unreachableTargets.length) {
        const primaryResource = pool[0];
        const firstTarget = unreachableTargets[0];
        const svcLabel = serviceLabels[kind] || kind;
        const errLower = firstTarget.error.toLowerCase();
        const reason: RiskIssueMeta['reason'] = errLower.includes('posición inicial')
          ? 'start_blocked'
          : errLower.includes('giro') || errLower.includes('huella')
            ? 'narrow_turn'
            : 'no_corridor';
        const sampleNames = unreachableTargets
          .slice(0, 3)
          .map((t) => `«${t.name}»`)
          .join(', ');
        const title =
          unreachableTargets.length === 1
            ? `Sin aproximación de ${svcLabel} hacia «${firstTarget.name}»`
            : `${unreachableTargets.length} puntos sin aproximación de ${svcLabel} (${sampleNames})`;
        const action =
          reason === 'start_blocked'
            ? `«${primaryResource.name}» está sobre un obstáculo o sin espacio libre en su posición inicial (necesita ~${requiredWidth} m despejados). Reubícalo sobre un paso libre.`
            : reason === 'narrow_turn'
              ? `El giro o estrechamiento hacia ${sampleNames} es inferior al ancho/radio de «${primaryResource.name}» (${requiredWidth} m). Ensancha el paso o suaviza el giro.`
              : `No hay corredor continuo de ${requiredWidth} m entre «${primaryResource.name}» y ${sampleNames}. Separa puestos, mesas o vallas en medio.`;
        add('route-' + kind, 'critical', title, action, {
          kind,
          resourceId: primaryResource.id,
          resourceName: primaryResource.name,
          targetId: firstTarget.id,
          targetName: firstTarget.name,
          unreachableNames: unreachableTargets.map((t) => t.name),
          reason,
          requiredWidth,
          errorDetail: firstTarget.error,
        });
      }
    }
  }

  const rate = raw.riskInputs?.medicalRate;
  const exposure = expected * (Number(s.base.hours) || 0);
  const medResources = resources.filter(
    (r) => r.kind === response && resourceSlots(s, r) > 0
  );
  const meanService = medResources.length
    ? medResources.reduce(
        (n, r) => n + (Number(r.handling) || 240) + (Number(r.delay) || 30),
        0
      ) /
      medResources.length /
      3600
    : 270 / 3600;
  const statistical: RiskStatisticalReport | null =
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate >= 0 &&
    rate <= 100
      ? {
          rate,
          exposure,
          expected: (rate * exposure) / 1000,
          any: poissonTail((rate * exposure) / 1000, 0),
          overlap: poissonTail(
            ((rate * expected) / 1000) * meanService,
            slots(response)
          ),
          slots: slots(response),
          serviceMinutes: meanService * 60,
        }
      : null;

  if (!statistical) {
    add(
      'calibration',
      'warning',
      'Probabilidad de incidencias sin calibrar',
      'Introduce una tasa por 1.000 personas·hora con fuente y contexto. No se deduce una probabilidad real de la edad o del pavimento.'
    );
  }
  if (statistical && statistical.overlap > 0.05) {
    add(
      'statistical-load',
      'warning',
      'El escenario estadístico anticipa demanda superior a los equipos',
      'La probabilidad teórica supera el 5 % en un instante; revisa reserva, tiempos y calibración. El 5 % es un aviso interno, no un umbral normativo.'
    );
  }

  return {
    issues,
    critical: issues.filter((i) => i.level === 'critical'),
    warnings: issues.filter((i) => i.level === 'warning'),
    expected,
    statistical,
    slots: {
      medical: slots(response),
      security: slots(security),
      fire: slots('fire'),
    },
    checkedAt: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function liveFailures(e: any): RiskIssue[] {
  const rows = (e.emergency.events as EmergencyIncident[]).filter(
    (r) => !['resolved', 'unreported'].includes(r.status)
  );
  const failures: RiskIssue[] = rows.flatMap((r) => {
    const problem =
      r.status === 'blocked' ||
      (r.status === 'waiting' &&
        r.reinforcements?.status?.includes('falta dotación')) ||
      r.status === 'waiting_transport' ||
      (['pending', 'waiting'].includes(r.status) &&
        e.time - (r.reportedAt ?? r.created ?? 0) >=
          (e.s.riskInputs?.maxWaitSeconds || 120));
    return problem
      ? [
          {
            id: 'incident-' + r.id,
            level: 'critical' as const,
            title: r.name + ' sin respuesta disponible',
            action:
              r.note ||
              'Revisa personal, ocupación y acceso antes de repetir el ensayo.',
          },
        ]
      : [];
  });
  if (
    [...(e.emergency.fire?.nodes?.values() || [])].some(
      (n: {damage: number}) => n.damage >= 1
    )
  ) {
    failures.push({
      id: 'destroyed',
      level: 'critical',
      title: 'El incendio ha destruido una estructura',
      action:
        'Revisa prevención, propagación y respuesta; el ensayo queda cancelado aunque el fuego se haya agotado.',
    });
  }
  if (
    [...(e.emergency.evacuation?.pending?.values() || [])].some(
      (t: {blocked?: boolean}) => t.blocked
    )
  ) {
    failures.push({
      id: 'evacuation-blocked',
      level: 'critical',
      title: 'Hay personas sin recorrido de desalojo',
      action:
        'Corrige salidas, barreras y recorridos antes de repetir el ensayo.',
    });
  }
  return failures;
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] || c
  );

export function riskHTML(r: RiskAssessmentReport): string {
  const stats = r.statistical;
  return (
    '<div class="risk-summary ' +
    (r.critical.length ? 'risk-stop' : '') +
    '"><b>' +
    r.critical.length +
    ' bloqueos · ' +
    r.warnings.length +
    ' aspectos por revisar</b><p>' +
    Math.round(r.expected) +
    ' personas de ocupación media estimada. Equipos simultáneos: sanitarios ' +
    r.slots.medical +
    ', seguridad ' +
    r.slots.security +
    ', bomberos ' +
    r.slots.fire +
    '.</p></div>' +
    r.issues
      .map(
        (i) =>
          '<article class="risk-item ' +
          i.level +
          '"><b>' +
          (i.level === 'critical' ? 'BLOQUEO · ' : 'REVISAR · ') +
          esc(i.title) +
          '</b><p>' +
          esc(i.action) +
          '</p></article>'
      )
      .join('') +
    (stats
      ? '<h3>Escenario estadístico sanitario</h3><p>Hipótesis: ' +
        stats.rate +
        ' incidencias/1.000 personas·hora. Exposición: ' +
        Math.round(stats.exposure) +
        ' personas·hora. Se esperan ' +
        stats.expected.toFixed(2) +
        ' incidencias por jornada. Probabilidad de al menos una: ' +
        (stats.any * 100).toFixed(1) +
        ' %. Probabilidad teórica de demanda simultánea superior a equipos: ' +
        (stats.overlap * 100).toFixed(2) +
        ' %.</p><p>Modelo Poisson de referencia, no probabilidad de daño ni de fallo real. Supone tasa constante e independencia; omite concentración por zonas, viajes, correlaciones y agravamiento por lluvia. No cubre incendios ni evacuación.</p>'
      : '')
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resultHTML(e: any, stopped = false): string {
  const d = e.dining?.summary() || {};
  const rows = (e.emergency?.events || []) as EmergencyIncident[];
  const closed = rows.filter((r) => r.status === 'resolved').length;
  const pending = rows.length - closed;
  const served = e.stats?.served || 0;
  const abandoned = e.stats?.abandoned || 0;
  const bars: Array<[string, number, number]> = [
    ['Incidencias resueltas', closed, rows.length],
    ['Atenciones completadas', served, served + abandoned],
    ['Comidas con asiento', Math.min(d.meals || 0, d.seated || 0), d.meals || 0],
  ];
  return (
    '<section class="result-visual"><h2>' +
    (stopped ? 'Ensayo cancelado por un fallo crítico' : 'Balance del ensayo') +
    '</h2><p>' +
    (stopped
      ? 'Los resultados son parciales. Corrige el modelo y empieza un ensayo nuevo.'
      : 'Resultados del modelo; no acreditan seguridad operativa.') +
    '</p><div class="result-numbers"><b>' +
    rows.length +
    '<small>incidencias</small></b><b>' +
    pending +
    '<small>sin cerrar</small></b><b>' +
    abandoned +
    '<small>abandonos de cola</small></b></div>' +
    bars
      .map(
        ([name, n, total]) =>
          '<div class="result-bar"><span>' +
          name +
          ' · ' +
          (total ? n + '/' + total : 'sin casos') +
          '</span><div role="img" aria-label="' +
          name +
          ': ' +
          n +
          ' de ' +
          total +
          '"><i style="width:' +
          (total ? Math.min(100, (n / total) * 100) : 0) +
          '%"></i></div></div>'
      )
      .join('') +
    '</section>'
  );
}
