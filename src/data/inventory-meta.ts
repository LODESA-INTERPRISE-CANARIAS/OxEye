import type {ResponseConditions} from '../types';

export type InventoryCategoryKey =
  | 'all'
  | 'emergency'
  | 'commerce'
  | 'comfort'
  | 'logistics'
  | 'response';

export interface InventoryItemMeta {
  category: Exclude<InventoryCategoryKey, 'all' | 'response'>;
  icon: string;
  accent: string;
  /** Qué ocurre con 0, 1 o 2+ unidades en el recinto. */
  tiers: (rc: ResponseConditions) => {
    zero: string;
    one: string;
    multi: string;
  };
}

const fmtMinSec = (totalSec: number): string => {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem} s`;
  return rem === 0 ? `${m} min` : `${m} min ${rem} s`;
};

export const INVENTORY_CATEGORIES: Array<{
  key: InventoryCategoryKey;
  label: string;
  icon: string;
}> = [
  {key: 'all', label: 'Todos', icon: 'all'},
  {key: 'emergency', label: 'Emergencias y seguridad', icon: 'emergency'},
  {key: 'commerce', label: 'Comercio y actividad', icon: 'commerce'},
  {key: 'comfort', label: 'Confort y refugio', icon: 'comfort'},
  {key: 'logistics', label: 'Accesos y logística', icon: 'logistics'},
  {key: 'response', label: 'Tiempos de respuesta', icon: 'response'},
];

export const INVENTORY_META: Record<string, InventoryItemMeta> = {
  fire: {
    category: 'emergency',
    icon: '🚒',
    accent: '#dc2626',
    tiers: (rc) => ({
      zero: `0: Respuesta = detección (${rc.detectionSec} s) + traslado externo desde Parque de Bomberos de Tenerife (${fmtMinSec(rc.fireExternalSec)} → total ≈ ${fmtMinSec(rc.detectionSec + rc.fireExternalSec)}).`,
      one: '1: Dotación preventiva en recinto; acorta drásticamente la llegada inicial y solicita refuerzo externo si es superada.',
      multi: '2+: Cobertura simultánea en recinto sin depender de la central salvo escalada grave.',
    }),
  },
  patrol: {
    category: 'emergency',
    icon: '🚓',
    accent: '#2563eb',
    tiers: (rc) => ({
      zero: `0: Sin patrulla policial configurada; los refuerzos graves esperan unidad externa (≈ ${fmtMinSec(rc.detectionSec + rc.policeExternalSec)}).`,
      one: '1: Coche policial (2 agentes por defecto, modo reserva o patrulla exterior configurable).',
      multi: '2+: Varias patrullas disponibles como refuerzo o vigilancia exterior sin circular innecesariamente por el interior.',
    }),
  },
  police_van: {
    category: 'emergency',
    icon: '🚐',
    accent: '#1d4ed8',
    tiers: (rc) => ({
      zero: `0: Sin furgón policial de apoyo; refuerzos múltiples dependen de dotación externa (≈ ${fmtMinSec(rc.detectionSec + rc.policeExternalSec)}).`,
      one: '1: Furgón policial en reserva o servicio fijo con hasta 8 agentes configurables para despliegues a pie.',
      multi: '2+: Alta capacidad de refuerzo policial ante incidentes graves o control de masas.',
    }),
  },
  security: {
    category: 'emergency',
    icon: '👮',
    accent: '#3b82f6',
    tiers: (rc) => ({
      zero: `0: Sin agentes a pie en recinto; cualquier incidencia espera refuerzo desde el spawn (≈ ${fmtMinSec(rc.detectionSec + rc.policeExternalSec)}).`,
      one: '1: Interviene de inmediato en 1 incidencia; si se ocupa, activa refuerzos externos automáticamente.',
      multi: '2+: Cubren varias incidencias a la vez; solo piden refuerzo externo si toda la plantilla en recinto se satura.',
    }),
  },
  ambulance: {
    category: 'emergency',
    icon: '🚑',
    accent: '#0891b2',
    tiers: (rc) => ({
      zero: `0: Sin ambulancia preventiva; traslado supeditado al SUC 1-1-2 Canarias desde base externa (≈ ${fmtMinSec(rc.detectionSec + rc.medicalExternalSec)}).`,
      one: '1: Evacuación inmediata en recinto; pide segunda unidad externa si coincide otra urgencia.',
      multi: '2+: Traslados simultáneos sin esperas; refuerzo externo siempre en reserva desde el spawn.',
    }),
  },
  medical: {
    category: 'emergency',
    icon: '🏥',
    accent: '#e11d48',
    tiers: (rc) => ({
      zero: `0: Sin puesto sanitario en recinto; toda atención espera al SUC externo (≈ ${fmtMinSec(rc.detectionSec + rc.medicalExternalSec)}).`,
      one: '1: Primera asistencia en segundos dentro del recinto; solicita refuerzo si se satura.',
      multi: '2+: Atención sanitaria simultánea en varios focos; reduce drásticamente el riesgo de saturación.',
    }),
  },
  yellow_tent: {
    category: 'emergency',
    icon: '🟡',
    accent: '#E69A26',
    tiers: () => ({
      zero: '0: Sin Carpa Amarilla; las solicitudes de acompañamiento o accesibilidad quedarán en espera.',
      one: '1: Carpa Amarilla física con 2 auxiliares para acompañamiento, préstamo de materiales y punto de calma.',
      multi: '2+: Cobertura de accesibilidad distribuida en distintas zonas del recinto sin esperas por saturación.',
    }),
  },
  violet_point: {
    category: 'emergency',
    icon: '🟣',
    accent: '#9755C2',
    tiers: () => ({
      zero: '0: Sin Punto Violeta en el recinto; no habrá espacio físico reservado de atención.',
      one: '1: Punto Violeta físico con atención reservada, discreta y privacidad garantizada en modo público.',
      multi: '2+: Puntos de atención reservada en varios sectores para cobertura inmediata y segura.',
    }),
  },
  steward: {
    category: 'emergency',
    icon: '🦺',
    accent: '#0d9488',
    tiers: () => ({
      zero: '0: Sin orientación activa; los visitantes navegan solos y los cuellos de botella tardan más en detectarse.',
      one: '1: Orienta público, alivia aglomeraciones y atiende incidencias leves antes de escalar a emergencias.',
      multi: '2+: Redistribución dinámica por zonas calientes; reduce esperas, abandonos y falsas escaladas.',
    }),
  },
  extinguisher: {
    category: 'emergency',
    icon: '🧯',
    accent: '#b91c1c',
    tiers: () => ({
      zero: '0: Sin primera intervención manual frente a conatos de incendio.',
      one: '1: Permite contención inicial por personal formado en un único foco cercano.',
      multi: '2+: Cobertura repartida junto a puestos y cuadros eléctricos mientras llegan bomberos.',
    }),
  },
  commerce: {
    category: 'commerce',
    icon: '🏪',
    accent: '#d97706',
    tiers: () => ({
      zero: '0: Sin puestos generales de comercio.',
      one: '1: Atrae visitas comerciales concentradas en un solo punto de cola.',
      multi: '2+: Reparte el flujo comercial y reduce colas por puesto.',
    }),
  },
  craft: {
    category: 'commerce',
    icon: '🏺',
    accent: '#c2410c',
    tiers: () => ({
      zero: '0: Sin oferta de artesanía.',
      one: '1: Punto único de artesanía (estancia media-alta por visitante).',
      multi: '2+: Recorrido artesanal distribuido con menor densidad por puesto.',
    }),
  },
  books: {
    category: 'commerce',
    icon: '📚',
    accent: '#7c3aed',
    tiers: () => ({
      zero: '0: Sin puestos de librería.',
      one: '1: Puesto único de consulta y compra tranquila.',
      multi: '2+: Amplía capacidad de lectura y compra sin saturar pasillos.',
    }),
  },
  local: {
    category: 'commerce',
    icon: '🧺',
    accent: '#65a30d',
    tiers: () => ({
      zero: '0: Sin venta de producto local.',
      one: '1: Concentra la demanda local en un punto.',
      multi: '2+: Diversifica la oferta local y agiliza el servicio.',
    }),
  },
  ventorrillo: {
    category: 'commerce',
    icon: '🍢',
    accent: '#ea580c',
    tiers: () => ({
      zero: '0: Sin ventorrillos gastronómicos.',
      one: '1: Foco gastronómico único; puede generar colas en horas punta.',
      multi: '2+: Reparte la demanda de comida y bebida y reduce abandonos por espera.',
    }),
  },
  food: {
    category: 'commerce',
    icon: '🚚',
    accent: '#e11d48',
    tiers: () => ({
      zero: '0: Sin foodtrucks en el recinto.',
      one: '1: Servicio móvil único (elemento pesado: requiere comprobar subsuelo y paso).',
      multi: '2+: Múltiples puntos de comida; reduce colas pero exige pasillos amplios.',
    }),
  },
  workshop: {
    category: 'commerce',
    icon: '🎨',
    accent: '#0f766e',
    tiers: () => ({
      zero: '0: Sin talleres participativos.',
      one: '1: Actividad con permanencia prolongada en grupo reducido.',
      multi: '2+: Varias sesiones paralelas que retienen público fuera de los ejes de paso.',
    }),
  },
  stage: {
    category: 'commerce',
    icon: '🎤',
    accent: '#4f46e5',
    tiers: () => ({
      zero: '0: Sin escenario ni foco principal de espectáculos.',
      one: '1: Polo central de atracción (revisa presión sonora y área de público frontal).',
      multi: '2+: Programación simultánea; conviene separar ejes para evitar solape acústico.',
    }),
  },
  cover: {
    category: 'comfort',
    icon: '⛺',
    accent: '#15803d',
    tiers: () => ({
      zero: '0: Sin sombra ni refugio cubierto; con sol intenso o lluvia aumentan los abandonos.',
      one: '1: Refugio climático concentrado (recuerda vincular lastres).',
      multi: '2+: Cobertura repartida que protege puestos y mesas en todo el recinto.',
    }),
  },
  picnic: {
    category: 'comfort',
    icon: '🪑',
    accent: '#a16207',
    tiers: () => ({
      zero: '0: Sin mesas para sentarse ni consumir cómodamente.',
      one: '1: 6 plazas de asiento; se llena rápido en picos de comida.',
      multi: '2+: Mejora la estancia y el consumo (6 plazas por mesa; vigila pasillos entre ellas).',
    }),
  },
  rest: {
    category: 'comfort',
    icon: '🛋',
    accent: '#16a34a',
    tiers: () => ({
      zero: '0: Sin zona específica de descanso.',
      one: '1: Área tranquila de recuperación para familias y personas cansadas.',
      multi: '2+: Varios oasis de descanso repartidos que reducen fatiga y malestar.',
    }),
  },
  toilet: {
    category: 'comfort',
    icon: '🚻',
    accent: '#6366f1',
    tiers: () => ({
      zero: '0: Sin aseos en recinto; penaliza permanencia y bienestar.',
      one: '1: Módulo único; puede formar cola en eventos con alta asistencia.',
      multi: '2+: Servicio fluido sin esperas prolongadas.',
    }),
  },
  gate: {
    category: 'logistics',
    icon: '🚪',
    accent: '#059669',
    tiers: () => ({
      zero: '0: Sin accesos configurados (bloquea la entrada de público y refuerzos).',
      one: '1: Acceso único; concentra entradas, salidas y llegada de emergencias.',
      multi: '2+: Reparte flujos de entrada/salida y garantiza rutas alternativas de evacuación.',
    }),
  },
  bin: {
    category: 'logistics',
    icon: '🗑',
    accent: '#4d7c0f',
    tiers: () => ({
      zero: '0: Sin contenedores para vaciado de limpieza.',
      one: '1: Punto único de acopio de residuos.',
      multi: '2+: Reduce recorridos del equipo de limpieza en horas punta.',
    }),
  },
  ballast: {
    category: 'logistics',
    icon: '🪨',
    accent: '#475569',
    tiers: () => ({
      zero: '0: Sin lastres colocados (las carpas quedarán pendientes de lastrado).',
      one: '1: Contrapeso individual (≥ 500 kg/m² revisable en Rayos X).',
      multi: '2+: Permite completar el lastrado por tramo de todas las carpas.',
    }),
  },
  power: {
    category: 'logistics',
    icon: '⚡',
    accent: '#ca8a04',
    tiers: () => ({
      zero: '0: Sin puntos de luz / acometida registrados en el plano.',
      one: '1: Punto eléctrico centralizado.',
      multi: '2+: Distribución eléctrica sectorizada para evitar cableados largos.',
    }),
  },
  loading: {
    category: 'logistics',
    icon: '🅿',
    accent: '#b45309',
    tiers: () => ({
      zero: '0: Sin reserva de carga y descarga / servicios públicos.',
      one: '1: Zona dedicada para suministros y aparcamiento de servicio.',
      multi: '2+: Múltiples muelles logísticos para montaje y reposición simultánea.',
    }),
  },
  turning: {
    category: 'logistics',
    icon: '↪',
    accent: '#0369a1',
    tiers: () => ({
      zero: '0: Sin espacio libre reservado para maniobra de vehículos.',
      one: '1: Radio de giro garantizado en un punto crítico.',
      multi: '2+: Facilita maniobras de bomberos y logística en varios sectores.',
    }),
  },
  storage: {
    category: 'logistics',
    icon: '📦',
    accent: '#64748b',
    tiers: () => ({
      zero: '0: Sin zona de acopio de material.',
      one: '1: Almacén técnico único para montaje y desmontaje.',
      multi: '2+: Acopio distribuido cerca de cada zona operativa.',
    }),
  },
};

export function getInventoryMeta(key: string): InventoryItemMeta {
  return (
    INVENTORY_META[key] || {
      category: 'logistics',
      icon: '◻',
      accent: '#57367b',
      tiers: () => ({
        zero: '0: Sin unidades en el plano.',
        one: '1: Una unidad activa en la simulación.',
        multi: '2+: Varias unidades repartidas en el recinto.',
      }),
    }
  );
}
