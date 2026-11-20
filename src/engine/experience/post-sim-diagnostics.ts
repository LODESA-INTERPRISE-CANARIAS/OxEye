/**
 * @module engine/experience/post-sim-diagnostics
 * Motor de diagnóstico post-simulación: calcula la tasa de satisfacción,
 * desglosa gráficamente las causas de insatisfacción para todas las incidencias
 * posibles del simulador y genera guías paso a paso y acciones directas.
 */
import type {
  EmergencyIncident,
  ExperienceEpisode,
  Scene,
  SimStation,
} from '../../types';
import {satisfaction} from './experience-monitor';

/** Categorías exhaustivas de incidencias que explican la pérdida de satisfacción. */
export type IncidentCategoryKey =
  | 'queue'
  | 'price'
  | 'shelter'
  | 'sound'
  | 'blocked'
  | 'exit'
  | 'offer'
  | 'access'
  | 'dining'
  | 'emergency';

/** Tipos de acción guiada ejecutables desde una tarjeta de incidencia. */
export type GuidedActionKind =
  | 'select-target'
  | 'switch-design-tool'
  | 'open-inventory'
  | 'open-demand'
  | 'open-parameters'
  | 'open-org'
  | 'open-comparison'
  | 'apply-quick-fix';

/** Tipos de ajuste rápido en un clic (siempre con checkpoint de deshacer). */
export type QuickFixType =
  | 'lower-price'
  | 'add-slot'
  | 'lower-sound'
  | 'add-dry-staff';

/** Acción concreta mostrada como botón en la guía de resolución. */
export interface GuidedAction {
  label: string;
  kind: GuidedActionKind;
  primary?: boolean;
  tool?: string;
  targetId?: string | null;
  fixType?: QuickFixType;
}

/** Tarjeta diagnóstica de una categoría de incidencia con peso gráfico y guía. */
export interface GuidedIncidentCard {
  key: IncidentCategoryKey;
  label: string;
  icon: string;
  color: string;
  count: number;
  sharePct: number;
  severity: 'high' | 'medium' | 'low';
  whyItHurts: string;
  evidence: string;
  steps: string[];
  targetId?: string | null;
  actions: GuidedAction[];
}

/** Desglose cuantitativo de la tasa de satisfacción del ensayo. */
export interface SatisfactionBreakdown {
  averageScore: number;
  totalSampled: number;
  satisfied: number;
  neutral: number;
  dissatisfied: number;
  satisfiedPct: number;
  neutralPct: number;
  dissatisfiedPct: number;
  served: number;
  abandoned: number;
  entryBlocked: number;
  mealStanding: number;
}

/** Informe completo post-simulación para visualización gráfica y resolución guiada. */
export interface PostSimDiagnosticReport {
  satisfaction: SatisfactionBreakdown;
  totalIncidents: number;
  incidents: GuidedIncidentCard[];
  headline: string;
}

interface CategoryMeta {
  label: string;
  icon: string;
  color: string;
  whyItHurts: string;
  steps: string[];
}

const CATEGORY_META: Record<IncidentCategoryKey, CategoryMeta> = {
  queue: {
    label: 'Colas y esperas excesivas',
    icon: '⏳',
    color: '#d97706',
    whyItHurts:
      'Esperar más del 50 % de la tolerancia penaliza directamente la satisfacción y provoca abandonos de cola sin atención.',
    steps: [
      'Aumenta las plazas simultáneas o reduce el tiempo de servicio en los puestos saturados.',
      'Añade puestos adicionales de la misma categoría desde Inventario o separa los puestos más demandados.',
      'Deja espacio frontal libre para que la cola no bloquee el pasillo.',
    ],
  },
  price: {
    label: 'Precios por encima del presupuesto',
    icon: '€',
    color: '#9333ea',
    whyItHurts:
      'Los visitantes cuyo presupuesto restante es inferior al precio del puesto acumulan penalización y desisten de consumir.',
    steps: [
      'Revisa el precio medio del puesto señalado o incorpora opciones más asequibles en el recinto.',
      'Comprueba la mezcla de precios en el Inspector de cada puesto de comida o comercio.',
    ],
  },
  shelter: {
    label: 'Exposición a lluvia sin refugio',
    icon: '☂',
    color: '#2563eb',
    whyItHurts:
      'Bajo lluvia, los visitantes que pasan más de 30 s sin cubierta libre pierden confort rápidamente.',
    steps: [
      'Coloca carpas (cubiertas) próximas a las zonas de mayor afluencia y comedor.',
      'Agrupa mesas picnic bajo las carpas para mantener plazas secas durante la lluvia.',
    ],
  },
  sound: {
    label: 'Nivel sonoro excesivo (dB)',
    icon: '🔊',
    color: '#db2777',
    whyItHurts:
      'Superar el umbral de confort acústico (78 dB general / 88 dB perfil música) durante más de 30 s reduce la satisfacción en el entorno.',
    steps: [
      'Reduce el nivel de referencia (dB a 5 m) en el Inspector del escenario.',
      'Aleja zonas de descanso, comedor y comercio del frente directo del escenario.',
    ],
  },
  blocked: {
    label: 'Pasos bloqueados y cuellos de botella',
    icon: '🚧',
    color: '#dc2626',
    whyItHurts:
      'Quedar retenido más de 15 s sin poder avanzar genera frustración alta y colapsa recorridos hacia puestos y salidas.',
    steps: [
      'Separa puestos, mesas y vallas en el tramo congestionado dejando al menos 3–4 m de paso libre.',
      'Usa «Evaluar y comparar mapas» para probar desplazamientos automáticos libres de colisión.',
    ],
  },
  exit: {
    label: 'Visitantes sin salida conectada',
    icon: '🚪',
    color: '#991b1b',
    whyItHurts:
      'No encontrar una salida pública conectada es la penalización más severa (−55 puntos) y un riesgo crítico de evacuación.',
    steps: [
      'Añade un acceso configurado como «Solo salida», «Entrada y salida» o «Acceso libre».',
      'Comprueba que ninguna valla, reserva o puesto aísla el acceso respecto al interior transitable.',
    ],
  },
  offer: {
    label: 'Falta de oferta para perfiles de público',
    icon: '🏪',
    color: '#0d9488',
    whyItHurts:
      'Cuando un visitante busca una actividad (comida, comercio, cultura, música) y no encuentra puestos abiertos, abandona sin completar objetivos.',
    steps: [
      'Añade puestos de la categoría demandada desde el Inventario o el catálogo de Diseñar.',
      'Comprueba los horarios de apertura/cierre y la etiqueta de fase «Evento» en el Inspector.',
    ],
  },
  access: {
    label: 'Accesos saturados o bloqueados',
    icon: '⇄',
    color: '#ea580c',
    whyItHurts:
      'Si el entorno de un acceso está colapsado, las personas no logran entrar al recinto y aumenta el rechazo en puerta.',
    steps: [
      'Amplía la anchura libre del acceso o habilita una segunda entrada en otro lado del perímetro.',
      'Retira puestos, colas o vallas situados a menos de 4 m de la boca de acceso.',
    ],
  },
  dining: {
    label: 'Comidas de pie o mesas mojadas',
    icon: '🪑',
    color: '#b45309',
    whyItHurts:
      'Los visitantes con comida que no encuentran asiento seco en el tiempo límite comen de pie, reduciendo el confort del evento.',
    steps: [
      'Añade mesas picnic (6 plazas por mesa) y colócalas bajo carpa si hay previsión de lluvia.',
      'Incrementa el personal de secado en la Ficha de producción para recuperar mesas mojadas más rápido.',
    ],
  },
  emergency: {
    label: 'Incidencias de emergencia sin resolver o bloqueadas',
    icon: '✚',
    color: '#be123c',
    whyItHurts:
      'Un incidente sin recurso disponible o con ruta vehicular bloqueada retiene al público cercano y compromete la seguridad del ensayo.',
    steps: [
      'Verifica que hay dotaciones activas (sanitario, seguridad, bomberos/ambulancia) colocadas en el plano.',
      'Revisa en los accesos las unidades de autoridades autorizadas y deja un corredor libre de obstáculos.',
    ],
  },
};

function mapComplaintToCategory(type: string): IncidentCategoryKey {
  const t = String(type || '').toLowerCase();
  if (t.includes('acceso')) return 'access';
  if (t.includes('oferta')) return 'offer';
  if (t.includes('salida') || t.includes('exit')) return 'exit';
  if (t.includes('cuello') || t.includes('recorrido') || t.includes('block')) {
    return 'blocked';
  }
  if (t.includes('cola') || t.includes('espera') || t.includes('queue')) {
    return 'queue';
  }
  if (t.includes('asiento') || t.includes('comedor') || t.includes('mesa')) {
    return 'dining';
  }
  if (t.includes('lluvia') || t.includes('refugio') || t.includes('shelter')) {
    return 'shelter';
  }
  if (t.includes('sonido') || t.includes('ruido') || t.includes('sound')) {
    return 'sound';
  }
  if (t.includes('precio') || t.includes('price')) return 'price';
  return 'blocked';
}

function buildActionsForCategory(
  key: IncidentCategoryKey,
  targetId: string | null,
  targetName: string | null,
  stageId: string | null
): GuidedAction[] {
  switch (key) {
    case 'queue':
      return [
        ...(targetId
          ? [
              {
                label: `+1 plaza en ${targetName || 'el puesto'}`,
                kind: 'apply-quick-fix' as const,
                fixType: 'add-slot' as const,
                targetId,
                primary: true,
              },
              {
                label: 'Seleccionar puesto',
                kind: 'select-target' as const,
                targetId,
              },
            ]
          : []),
        {
          label: 'Añadir puestos en Inventario',
          kind: 'open-inventory',
          primary: !targetId,
        },
      ];
    case 'price':
      return [
        ...(targetId
          ? [
              {
                label: `Bajar precio 15 % (${targetName || 'puesto'})`,
                kind: 'apply-quick-fix' as const,
                fixType: 'lower-price' as const,
                targetId,
                primary: true,
              },
              {
                label: 'Editar en Inspector',
                kind: 'select-target' as const,
                targetId,
              },
            ]
          : [
              {
                label: 'Revisar puestos en Diseñar',
                kind: 'open-comparison' as const,
                primary: true,
              },
            ]),
      ];
    case 'shelter':
      return [
        {
          label: 'Colocar carpa en el plano',
          kind: 'switch-design-tool',
          tool: 'place:cover',
          primary: true,
        },
        {label: 'Calcular carpas (Demanda)', kind: 'open-demand'},
      ];
    case 'sound':
      return [
        ...(stageId
          ? [
              {
                label: 'Bajar escenario 3 dB',
                kind: 'apply-quick-fix' as const,
                fixType: 'lower-sound' as const,
                targetId: stageId,
                primary: true,
              },
              {
                label: 'Seleccionar escenario',
                kind: 'select-target' as const,
                targetId: stageId,
              },
            ]
          : [
              {
                label: 'Probar mejora automática',
                kind: 'open-comparison' as const,
                primary: true,
              },
            ]),
      ];
    case 'blocked':
      return [
        {
          label: 'Probar reubicación automática',
          kind: 'open-comparison',
          primary: true,
        },
        ...(targetId
          ? [
              {
                label: `Seleccionar ${targetName || 'obstáculo'}`,
                kind: 'select-target' as const,
                targetId,
              },
            ]
          : []),
      ];
    case 'exit':
      return [
        {
          label: 'Dibujar nuevo acceso / salida',
          kind: 'switch-design-tool',
          tool: 'gateLine',
          primary: true,
        },
        {label: 'Revisar inventario de accesos', kind: 'open-inventory'},
      ];
    case 'offer':
      return [
        {
          label: 'Ampliar oferta en Inventario',
          kind: 'open-inventory',
          primary: true,
        },
        {label: 'Dimensionar servicios', kind: 'open-demand'},
      ];
    case 'access':
      return [
        {
          label: 'Añadir otro acceso',
          kind: 'switch-design-tool',
          tool: 'gateLine',
          primary: true,
        },
        {label: 'Comparar redistribución', kind: 'open-comparison'},
      ];
    case 'dining':
      return [
        {
          label: 'Colocar mesa picnic',
          kind: 'switch-design-tool',
          tool: 'place:picnic',
          primary: true,
        },
        {
          label: '+1 operario de secado',
          kind: 'apply-quick-fix',
          fixType: 'add-dry-staff',
        },
        {label: 'Abrir ficha de producción', kind: 'open-parameters'},
      ];
    case 'emergency':
      return [
        {
          label: 'Ajustar equipos de emergencia',
          kind: 'open-inventory',
          primary: true,
        },
        {label: 'Revisar empresas y recursos', kind: 'open-org'},
      ];
  }
}

/**
 * Construye el informe diagnóstico completo a partir de una instancia de
 * `EventEngine` (durante o al finalizar el ensayo) y la escena activa.
 *
 * @param engine - Motor de simulación (`EventEngine` o mock compatible).
 * @param scene - Escena activa del recinto.
 * @returns Informe con desglose de satisfacción y tarjetas guiadas por incidencia.
 */
export function buildPostSimDiagnostics(
  engine: any,
  scene: Scene
): PostSimDiagnosticReport {
  const agents = (engine?.agents || []) as Array<{
    completed?: number;
    failed?: number;
    experiencePenalty?: number;
  }>;
  const stats = engine?.stats || {
    arrivals: 0,
    served: 0,
    abandoned: 0,
    entryBlocked: 0,
  };
  const dining = engine?.dining?.summary?.() || {
    meals: 0,
    seated: 0,
    standing: 0,
    wet: 0,
  };
  const episodes = (engine?.experience?.list?.() || []) as ExperienceEpisode[];
  const complaints = (engine?.complaints?.() || []) as Array<{
    type?: string;
    title?: string;
    reason?: string;
    place?: string;
  }>;
  const emergencyEvents = (engine?.emergency?.events || []) as EmergencyIncident[];
  const stations = (engine?.stations || []) as SimStation[];

  // 1. Acumular incidencias por categoría (todas: activas, cerradas y terminadas)
  const buckets = new Map<
    IncidentCategoryKey,
    {
      count: number;
      targetCounts: Map<string, number>;
      samples: string[];
    }
  >();

  const bump = (
    key: IncidentCategoryKey,
    amount: number,
    targetId?: string | null,
    sample?: string
  ) => {
    if (amount <= 0) return;
    let b = buckets.get(key);
    if (!b) {
      b = {count: 0, targetCounts: new Map(), samples: []};
      buckets.set(key, b);
    }
    b.count += amount;
    if (targetId) {
      b.targetCounts.set(targetId, (b.targetCounts.get(targetId) || 0) + amount);
    }
    if (sample && b.samples.length < 3 && !b.samples.includes(sample)) {
      b.samples.push(sample);
    }
  };

  for (const ep of episodes) {
    const key = (
      ['price', 'queue', 'shelter', 'sound', 'blocked', 'exit', 'offer'].includes(
        ep.type
      )
        ? ep.type
        : mapComplaintToCategory(ep.type)
    ) as IncidentCategoryKey;
    bump(key, 1, ep.target, ep.detail);
  }

  for (const c of complaints) {
    const key = mapComplaintToCategory(c.type || c.title || '');
    bump(key, 1, null, c.reason || c.title);
  }

  if ((stats.entryBlocked || 0) > 0 && !buckets.has('access')) {
    bump(
      'access',
      stats.entryBlocked,
      null,
      `${stats.entryBlocked} intentos de entrada bloqueados en acceso.`
    );
  }

  if ((stats.abandoned || 0) > 0 && !buckets.has('queue')) {
    bump(
      'queue',
      stats.abandoned,
      null,
      `${stats.abandoned} abandonos por espera en cola.`
    );
  }

  const diningIssues = (dining.standing || 0) + (dining.wet || 0);
  if (diningIssues > 0) {
    const parts: string[] = [];
    if (dining.standing > 0) parts.push(`${dining.standing} comidas de pie`);
    if (dining.wet > 0) parts.push(`${dining.wet} mesas mojadas`);
    bump('dining', diningIssues, null, parts.join(' · '));
  }

  const problemEmergencies = emergencyEvents.filter(
    (ev) => ev.status !== 'resolved'
  );
  if (problemEmergencies.length > 0) {
    bump(
      'emergency',
      problemEmergencies.length,
      null,
      problemEmergencies
        .slice(0, 2)
        .map((ev) => `${ev.name || ev.type} (${ev.status})`)
        .join(' · ')
    );
  }

  // 2. Calcular tasa de satisfacción (agentes activos o estimación global si ya salieron)
  let satisfied = 0;
  let neutral = 0;
  let dissatisfied = 0;
  let scoreSum = 0;

  if (agents.length > 0) {
    for (const a of agents) {
      const res = satisfaction(a as Parameters<typeof satisfaction>[0]);
      scoreSum += res.score;
      if (res.score >= 70) satisfied++;
      else if (res.score >= 40) neutral++;
      else dissatisfied++;
    }
  } else {
    const served = stats.served || 0;
    const failed =
      (stats.abandoned || 0) +
      (stats.entryBlocked || 0) +
      (dining.standing || 0);
    const total = served + failed;
    if (total > 0) {
      satisfied = served;
      dissatisfied = failed;
      scoreSum = served * 82 + failed * 25;
    } else if (episodes.length > 0) {
      dissatisfied = episodes.length;
      scoreSum = episodes.length * 30;
    }
  }

  const totalSampled = satisfied + neutral + dissatisfied;
  const averageScore =
    totalSampled > 0 ? Math.round(scoreSum / totalSampled) : 100;
  const satisfiedPct =
    totalSampled > 0 ? Math.round((satisfied / totalSampled) * 100) : 100;
  const neutralPct =
    totalSampled > 0 ? Math.round((neutral / totalSampled) * 100) : 0;
  const dissatisfiedPct =
    totalSampled > 0 ? Math.max(0, 100 - satisfiedPct - neutralPct) : 0;

  // 3. Ordenar incidencias y calcular porcentajes y acciones guiadas
  const totalIncidents = [...buckets.values()].reduce((s, b) => s + b.count, 0);
  const stageObj = scene.base.booths.find((b) => b.type === 'stage');

  const incidents: GuidedIncidentCard[] = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, data]) => {
      const meta = CATEGORY_META[key];
      const sharePct =
        totalIncidents > 0
          ? Math.max(1, Math.round((data.count / totalIncidents) * 100))
          : 0;
      const topTargetId =
        [...data.targetCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
        null;
      const topStation = topTargetId
        ? stations.find((st) => st.id === topTargetId) ||
          scene.base.booths.find((b) => b.id === topTargetId) ||
          scene.infrastructure.find((inf) => inf.id === topTargetId)
        : null;
      const severity: 'high' | 'medium' | 'low' =
        key === 'exit' || key === 'emergency' || sharePct >= 35
          ? 'high'
          : sharePct >= 15
            ? 'medium'
            : 'low';

      return {
        key,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        count: data.count,
        sharePct,
        severity,
        whyItHurts: meta.whyItHurts,
        evidence:
          data.samples.join(' · ') ||
          `${data.count} registros detectados durante el ensayo.`,
        steps: meta.steps,
        targetId: topTargetId,
        actions: buildActionsForCategory(
          key,
          topTargetId,
          topStation?.name || null,
          stageObj?.id || null
        ),
      };
    });

  let headline = 'Sin incidencias relevantes detectadas en este ensayo.';
  if (incidents.length > 0) {
    const top = incidents[0];
    headline =
      averageScore >= 70
        ? `Satisfacción alta (${averageScore}/100). Principal margen de mejora: ${top.label.toLowerCase()} (${top.sharePct} % de las incidencias).`
        : `Satisfacción reducida (${averageScore}/100) debido principalmente a ${top.label.toLowerCase()} (${top.sharePct} % del total de incidencias).`;
  }

  return {
    satisfaction: {
      averageScore,
      totalSampled,
      satisfied,
      neutral,
      dissatisfied,
      satisfiedPct,
      neutralPct,
      dissatisfiedPct,
      served: stats.served || 0,
      abandoned: stats.abandoned || 0,
      entryBlocked: stats.entryBlocked || 0,
      mealStanding: dining.standing || 0,
    },
    totalIncidents,
    incidents,
    headline,
  };
}
