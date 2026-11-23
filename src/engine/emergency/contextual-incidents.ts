/**
 * @module engine/emergency/contextual-incidents
 * Catálogo contextual de incidencias por instalación, clasificación de objetos,
 * conteo estadístico separado (automático vs manual) y comparación de diseños bajo incendio.
 */
import type {
  EmergencyIncident,
  IncidentAlertCategory,
  IncidentGenerationMode,
  IncidentSeverityLevel,
  Scene,
} from '../../types';
import {EventEngine} from '../crowd/event-engine';
import {ResponseSimulation} from './response-model';
import {phaseScene} from '../logistics/phases';

export type ContextualObjectProfile =
  | 'ceramic_workshop'
  | 'workshop'
  | 'foodtruck'
  | 'commerce'
  | 'stage'
  | 'yellow_tent'
  | 'violet_point'
  | 'toilet'
  | 'fence'
  | 'logistics'
  | 'cover'
  | 'entrance'
  | 'generic';

export interface ContextualIncidentTemplate {
  id: string;
  label: string;
  description: string;
  engineType: string;
  category: IncidentAlertCategory;
  defaultSeverity: IncidentSeverityLevel;
  sensitive?: boolean;
  requiresGas?: boolean;
  fireConfig?: {
    initialIntensity?: number;
    growthRate?: number;
    isGasLeak?: boolean;
  };
}

/** Resuelve el modo activo de generación de incidencias (automático, manual o mixto). */
export function resolveIncidentGenerationMode(scene: Partial<Scene> | undefined): IncidentGenerationMode {
  if (!scene) return 'mixed';
  if (
    scene.incidentMode === 'auto' ||
    scene.incidentMode === 'manual' ||
    scene.incidentMode === 'mixed'
  ) {
    return scene.incidentMode;
  }
  return scene.autoIncidents === false ? 'manual' : 'mixed';
}

/** Determina si una instalación dispone de gas compatible según sus propiedades reales. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasGasCompatibleInstallation(item: any): boolean {
  if (!item) return false;
  if (item.hasGas === false || item.noGas === true) return false;
  if (item.hasGas === true) return true;
  const kind = String(item.kind || item.type || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  if (name.includes('sin gas') || name.includes('helad') || name.includes('zumo') || name.includes('fruta')) {
    return false;
  }
  return kind === 'food' || name.includes('foodtruck') || name.includes('cocina') || name.includes('gas') || name.includes('brasa');
}

/** Clasifica cualquier elemento del plano para determinar su catálogo contextual compatible. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function classifyInstallableObject(item: any, scene?: Scene): ContextualObjectProfile {
  if (!item) return 'generic';
  const kind = String(item.kind || item.inventoryKind || '').toLowerCase();
  const type = String(item.type || '').toLowerCase();
  const role = String(item.role || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();

  if (kind === 'yellow_tent' || name.includes('carpa amarilla') || name.includes('accesibilidad')) {
    return 'yellow_tent';
  }
  if (kind === 'violet_point' || name.includes('punto violeta')) {
    return 'violet_point';
  }
  if (item.fenceKind || (scene?.fences || []).some((f) => f.id === item.id)) {
    return 'fence';
  }
  if (
    item.clearWidth != null ||
    item.gateAngle != null ||
    item.spawnType != null ||
    (scene?.entrances || []).some((e) => e.id === item.id)
  ) {
    return 'entrance';
  }
  if (kind === 'toilet' || type === 'toilet' || name.includes('aseo') || name.includes('baño') || name.includes('wc')) {
    return 'toilet';
  }
  if (
    kind === 'stage' ||
    type === 'stage' ||
    name.includes('escenario') ||
    name.includes('tarima')
  ) {
    return 'stage';
  }
  if (
    type === 'workshop' ||
    kind === 'workshop' ||
    name.includes('taller') ||
    name.includes('cerám') ||
    name.includes('ceram') ||
    name.includes('alfar')
  ) {
    return name.includes('cerám') || name.includes('ceram') || name.includes('alfar') || name.includes('barro')
      ? 'ceramic_workshop'
      : 'workshop';
  }
  if (
    type === 'food' ||
    kind === 'food' ||
    name.includes('foodtruck') ||
    name.includes('food') ||
    name.includes('gastronom') ||
    name.includes('cafeter') ||
    name.includes('churr') ||
    name.includes('cocina')
  ) {
    return 'foodtruck';
  }
  if (
    kind === 'power' ||
    kind === 'generator' ||
    kind === 'storage' ||
    kind === 'truck' ||
    role === 'logistics' ||
    item.origin === 'loading' ||
    item.origin === 'turning' ||
    name.includes('logíst') ||
    name.includes('logist') ||
    name.includes('cuadro') ||
    name.includes('generador') ||
    name.includes('almac')
  ) {
    return 'logistics';
  }
  if (role === 'cover' || kind === 'cover' || kind === 'picnic' || name.includes('carpa') || name.includes('pérgola')) {
    return 'cover';
  }
  if (type === 'commerce' || kind === 'booth' || role === 'booth' || name.includes('comercio') || name.includes('puesto') || name.includes('artesan')) {
    return 'commerce';
  }
  return 'generic';
}

const TEMPLATES_BY_PROFILE: Record<ContextualObjectProfile, ContextualIncidentTemplate[]> = {
  ceramic_workshop: [
    {
      id: 'ceramic_cut',
      label: 'Rotura de vasija y corte accidental',
      description: 'Asistencia sanitaria por corte con cerámica rota durante el taller.',
      engineType: 'cut',
      category: 'medical',
      defaultSeverity: 'leve',
    },
    {
      id: 'workshop_material_fall',
      label: 'Caída de material',
      description: 'Desprendimiento o caída de piezas y golpe accidental.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_burn',
      label: 'Quemadura',
      description: 'Lesión térmica leve o moderada durante la actividad del taller.',
      engineType: 'cut',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_electrical',
      label: 'Avería eléctrica',
      description: 'Fallo eléctrico en torno o toma de corriente que requiere revisión logística.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_fire',
      label: 'Incendio en el taller',
      description: 'Foco de incendio localizado en materiales de embalaje o equipo eléctrico.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.2, growthRate: 1.0},
    },
    {
      id: 'workshop_theft',
      label: 'Hurto de material o pertenencias',
      description: 'Incidente de seguridad ciudadana con aviso a vigilancia/policía.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_dispute',
      label: 'Discusión entre asistentes',
      description: 'Altercado verbal o conflicto de convivencia en el espacio del taller.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_saturation',
      label: 'Saturación de participantes',
      description: 'Aglomeración alrededor de las mesas por encima del aforo cómodo.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'leve',
    },
  ],
  workshop: [
    {
      id: 'workshop_cut',
      label: 'Corte o lesión con herramienta',
      description: 'Pequeño corte o lesión durante la actividad práctica.',
      engineType: 'cut',
      category: 'medical',
      defaultSeverity: 'leve',
    },
    {
      id: 'workshop_material_fall',
      label: 'Caída de material',
      description: 'Caída de equipamiento o mobiliario del taller.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_electrical',
      label: 'Avería eléctrica',
      description: 'Interrupción de suministro o disparo de protección eléctrica.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
    {
      id: 'workshop_fire',
      label: 'Incendio localizado',
      description: 'Foco inicial localizado en materiales del taller.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.2, growthRate: 0.95},
    },
    {
      id: 'workshop_dispute',
      label: 'Discusión en actividad',
      description: 'Conflicto entre participantes que requiere mediación.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'leve',
    },
    {
      id: 'workshop_saturation',
      label: 'Saturación de participantes',
      description: 'Exceso de afluencia junto al acceso del taller.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'leve',
    },
  ],
  foodtruck: [
    {
      id: 'foodtruck_kitchen_fire',
      label: 'Incendio de cocina',
      description: 'Foco de incendio localizado en freidora, plancha o campana.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.24, growthRate: 1.18},
    },
    {
      id: 'foodtruck_burn',
      label: 'Quemadura en cocina o mostrador',
      description: 'Lesión térmica en personal del puesto o cliente cercano.',
      engineType: 'cut',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'foodtruck_electrical',
      label: 'Avería eléctrica',
      description: 'Corte eléctrico en equipos de frío o cocina; afecta al servicio.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
    {
      id: 'foodtruck_gas_leak',
      label: 'Fuga de gas',
      description: 'Escape en instalación compatible de gas con riesgo de ignición y evacuación.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      requiresGas: true,
      fireConfig: {initialIntensity: 0.28, growthRate: 1.35, isGasLeak: true},
    },
    {
      id: 'foodtruck_queue_dispute',
      label: 'Discusión en la cola',
      description: 'Conflicto entre clientes esperando turno.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'leve',
    },
    {
      id: 'foodtruck_dine_dash',
      label: 'Intento de marcharse sin pagar',
      description: 'Incidente comercial que requiere intervención de seguridad.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'leve',
    },
    {
      id: 'foodtruck_spill_fall',
      label: 'Caída por derrame',
      description: 'Resbalón por líquido derramado frente al mostrador.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'foodtruck_saturation',
      label: 'Saturación de pedidos',
      description: 'Cola prolongada que invade zonas de paso adyacentes.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'leve',
    },
  ],
  commerce: [
    {
      id: 'commerce_theft',
      label: 'Hurto en puesto',
      description: 'Aviso de hurto a seguridad y patrulla de zona.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'moderada',
    },
    {
      id: 'commerce_merch_fall',
      label: 'Caída de mercancía',
      description: 'Desprendimiento de estantería o género hacia el paso público.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'leve',
    },
    {
      id: 'commerce_dispute',
      label: 'Discusión comercial',
      description: 'Desacuerdo o discusión en la atención al público.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'leve',
    },
    {
      id: 'commerce_pos_failure',
      label: 'Avería del terminal de pago',
      description: 'Fallo de TPV o conectividad que ralentiza la atención y genera cola.',
      engineType: 'orientation',
      category: 'information',
      defaultSeverity: 'informativa',
    },
    {
      id: 'commerce_trip',
      label: 'Tropiezo frente al puesto',
      description: 'Caída leve o moderada con necesidad de valoración sanitaria.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'commerce_queue_corridor',
      label: 'Cola que invade un corredor',
      description: 'Acumulación de clientes que estrecha el corredor peatonal o de emergencia.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'moderada',
    },
    {
      id: 'commerce_fire',
      label: 'Incendio en puesto comercial',
      description: 'Conato de incendio en embalajes, tela o instalación eléctrica del puesto.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.2, growthRate: 1.0},
    },
  ],
  stage: [
    {
      id: 'stage_sound_failure',
      label: 'Fallo de sonido',
      description: 'Pérdida de audio o acople que requiere soporte técnico inmediato.',
      engineType: 'orientation',
      category: 'logistics',
      defaultSeverity: 'leve',
    },
    {
      id: 'stage_electrical',
      label: 'Avería eléctrica',
      description: 'Corte parcial o fallo de cuadro en infraestructura escénica.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'grave',
    },
    {
      id: 'stage_rig_fall',
      label: 'Caída de equipamiento',
      description: 'Desprendimiento de equipo o foco en entorno escénico.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'grave',
    },
    {
      id: 'stage_overcrowding',
      label: 'Concentración excesiva frente al escenario',
      description: 'Densidad elevada de público en primera línea que compromete salidas.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'grave',
    },
    {
      id: 'stage_show_incident',
      label: 'Incidencia durante una actuación',
      description: 'Interrupción temporal del espectáculo por asistencia o incidente.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'stage_backstage_breach',
      label: 'Acceso no autorizado a zona técnica',
      description: 'Intrusión de visitante no autorizado en backstage o torres de sonido.',
      engineType: 'fence_breach',
      category: 'security',
      defaultSeverity: 'moderada',
    },
    {
      id: 'stage_fire',
      label: 'Incendio en equipamiento escénico',
      description: 'Foco de incendio en cableado, tarima o cuadro de iluminación.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.22, growthRate: 1.05},
    },
  ],
  yellow_tent: [
    {
      id: 'acc_escort_request',
      label: 'Solicitud de acompañamiento',
      description: 'Despliegue de auxiliar desde Carpa Amarilla hasta persona solicitante.',
      engineType: 'accessibility',
      category: 'accessibility',
      defaultSeverity: 'informativa',
    },
    {
      id: 'acc_wheelchair_loan',
      label: 'Préstamo de silla de ruedas',
      description: 'Entrega y traslado asistido con silla de ruedas en recinto.',
      engineType: 'accessibility',
      category: 'accessibility',
      defaultSeverity: 'leve',
    },
    {
      id: 'acc_noise_headphones',
      label: 'Solicitud de auriculares reductores de ruido',
      description: 'Atención sensorial de baja carga mediante préstamo de auriculares.',
      engineType: 'accessibility',
      category: 'accessibility',
      defaultSeverity: 'informativa',
    },
    {
      id: 'acc_rest_need',
      label: 'Necesidad de descanso en zona calma',
      description: 'Acogida temporal de visitante por fatiga o sobrecarga sensorial.',
      engineType: 'accessibility',
      category: 'accessibility',
      defaultSeverity: 'informativa',
    },
    {
      id: 'acc_staff_saturation',
      label: 'Saturación de auxiliares',
      description: 'Demanda simultánea superior a los auxiliares disponibles en la carpa.',
      engineType: 'congestion',
      category: 'accessibility',
      defaultSeverity: 'moderada',
    },
    {
      id: 'acc_route_blocked',
      label: 'Recorrido accesible bloqueado',
      description: 'Obstáculo o estrechamiento en itinerario PMR conectado a la carpa.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
  ],
  violet_point: [
    {
      id: 'vio_info_request',
      label: 'Solicitud de información',
      description: 'Atención reservada de consulta o asesoramiento preventivo.',
      engineType: 'violet_point',
      category: 'violet_point',
      defaultSeverity: 'informativa',
      sensitive: true,
    },
    {
      id: 'vio_escort_request',
      label: 'Solicitud de acompañamiento',
      description: 'Acompañamiento seguro y discreto hacia punto seguro o salida.',
      engineType: 'violet_point',
      category: 'violet_point',
      defaultSeverity: 'moderada',
      sensitive: true,
    },
    {
      id: 'vio_confidential_report',
      label: 'Comunicación confidencial de acoso',
      description: 'Activación de protocolo reservado con privacidad estricta y apoyo.',
      engineType: 'violet_point',
      category: 'violet_point',
      defaultSeverity: 'grave',
      sensitive: true,
    },
    {
      id: 'vio_referral',
      label: 'Necesidad de derivación',
      description: 'Coordinación reservada con recurso sanitario o autoridad competente.',
      engineType: 'violet_point',
      category: 'violet_point',
      defaultSeverity: 'grave',
      sensitive: true,
    },
    {
      id: 'vio_saturation',
      label: 'Saturación del servicio',
      description: 'Atención simultánea que ocupa todos los turnos del Punto Violeta.',
      engineType: 'violet_point',
      category: 'violet_point',
      defaultSeverity: 'moderada',
      sensitive: true,
    },
    {
      id: 'vio_staff_shortage',
      label: 'Falta temporal de personal',
      description: 'Cobertura reducida que requiere refuerzo o reasignación discreta.',
      engineType: 'violet_point',
      category: 'violet_point',
      defaultSeverity: 'moderada',
      sensitive: true,
    },
  ],
  toilet: [
    {
      id: 'toilet_out_of_service',
      label: 'Atasco o inutilización de módulo',
      description: 'Mantenimiento urgente en cabina o saneamiento.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
    {
      id: 'toilet_wet_slip',
      label: 'Caída por suelo mojado',
      description: 'Resbalón en zona de aseos con valoración sanitaria.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'toilet_indisposed',
      label: 'Persona indispuesta en aseos',
      description: 'Asistencia sanitaria discreta en cabina o entorno inmediato.',
      engineType: 'minor',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'toilet_queue_saturation',
      label: 'Saturación de cola en aseos',
      description: 'Cola excesiva que bloquea el paso adyacente.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'leve',
    },
  ],
  fence: [
    {
      id: 'fence_jump_attempt',
      label: 'Intento de saltar valla',
      description: 'Infracción de perímetro o desvío no autorizado.',
      engineType: 'fence_breach',
      category: 'security',
      defaultSeverity: 'moderada',
    },
    {
      id: 'fence_knockdown',
      label: 'Caída o desplazamiento de valla',
      description: 'Pérdida de cierre físico que requiere reposición logística.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
    {
      id: 'fence_passage_block',
      label: 'Bloqueo de paso por vallado',
      description: 'Estrechamiento no previsto que dificulta evacuación o tránsito.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'leve',
    },
  ],
  logistics: [
    {
      id: 'log_electrical_fault',
      label: 'Avería eléctrica o corte de suministro',
      description: 'Fallo técnico en acometida, cuadro o grupo electrógeno.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'grave',
    },
    {
      id: 'log_load_drop',
      label: 'Caída de carga o palet',
      description: 'Obstrucción física en zona de maniobra o corredor de servicio.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'moderada',
    },
    {
      id: 'log_corridor_block',
      label: 'Obstáculo en corredor logístico',
      description: 'Vehículo o material bloqueando el acceso reservado a emergencias.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'grave',
    },
    {
      id: 'log_technical_fire',
      label: 'Incendio técnico en zona logística',
      description: 'Foco de incendio localizado en grupo electrógeno o acopio combustible.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.25, growthRate: 1.1},
    },
  ],
  cover: [
    {
      id: 'cover_furniture_fall',
      label: 'Caída de mobiliario o sujeción',
      description: 'Desplazamiento de mesa, silla o lastre dentro de la carpa.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'cover_electrical',
      label: 'Avería de iluminación o electricidad',
      description: 'Fallo de alumbrado bajo carpa o zona cubierta.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'leve',
    },
    {
      id: 'cover_fire',
      label: 'Incendio en lona o mobiliario de carpa',
      description: 'Foco de incendio que afecta a la cubierta o puestos interiores.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.22, growthRate: 1.15},
    },
    {
      id: 'cover_overcrowding',
      label: 'Concentración excesiva bajo carpa',
      description: 'Refugio masivo de público por clima o evento superando holgura.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'moderada',
    },
  ],
  entrance: [
    {
      id: 'gate_congestion',
      label: 'Congestión en acceso',
      description: 'Tapón de entrada/salida en el ancho libre del acceso.',
      engineType: 'congestion',
      category: 'congestion',
      defaultSeverity: 'moderada',
    },
    {
      id: 'gate_emergency_obstacle',
      label: 'Obstáculo en acceso de emergencias',
      description: 'Elemento o vehículo mal estacionado que impide paso de camión/ambulancia.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'grave',
    },
    {
      id: 'gate_control_conflict',
      label: 'Conflicto en control de acceso',
      description: 'Altercado con control de aforo o acreditación en puerta.',
      engineType: 'conflict',
      category: 'security',
      defaultSeverity: 'moderada',
    },
    {
      id: 'gate_orientation',
      label: 'Acumulación por duda de orientación',
      description: 'Visitantes desorientados deteniendo el flujo en el acceso.',
      engineType: 'orientation',
      category: 'information',
      defaultSeverity: 'informativa',
    },
  ],
  generic: [
    {
      id: 'gen_fall',
      label: 'Caída de visitante',
      description: 'Asistencia sanitaria en el entorno del elemento.',
      engineType: 'fall',
      category: 'medical',
      defaultSeverity: 'moderada',
    },
    {
      id: 'gen_obstacle',
      label: 'Obstáculo junto a la instalación',
      description: 'Interferencia en el corredor cercano.',
      engineType: 'obstacle',
      category: 'logistics',
      defaultSeverity: 'leve',
    },
    {
      id: 'gen_fire',
      label: 'Incendio localizado',
      description: 'Foco de incendio inicial en la instalación.',
      engineType: 'fire',
      category: 'fire',
      defaultSeverity: 'critica',
      fireConfig: {initialIntensity: 0.2, growthRate: 1.0},
    },
  ],
};

const TEMPLATE_INDEX = new Map<string, ContextualIncidentTemplate>();
for (const list of Object.values(TEMPLATES_BY_PROFILE)) {
  for (const tpl of list) {
    TEMPLATE_INDEX.set(tpl.id, tpl);
  }
}

export function getContextualTemplateById(
  templateId: string
): ContextualIncidentTemplate | undefined {
  return TEMPLATE_INDEX.get(templateId);
}

/**
 * Devuelve las situaciones compatibles con un elemento real del plano, filtrando
 * opciones dependientes de propiedades concretas (p. ej. fuga de gas solo si tiene gas).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getContextualIncidentsForItem(item: any, scene?: Scene): ContextualIncidentTemplate[] {
  const profile = classifyInstallableObject(item, scene);
  const templates = TEMPLATES_BY_PROFILE[profile] || TEMPLATES_BY_PROFILE.generic;
  const hasGas = hasGasCompatibleInstallation(item);
  return templates.filter((tpl) => !tpl.requiresGas || hasGas);
}

export interface IncidentFrequencySummary {
  total: number;
  spontaneous: number;
  manual: number;
  spread: number;
  byCategory: Record<string, number>;
}

/**
 * Separa estadísticas entre incidencias espontáneas (modo automático/mixto),
 * manuales provocadas y focos secundarios por propagación.
 */
export function incidentFrequencyStats(events: EmergencyIncident[]): IncidentFrequencySummary {
  const byCategory: Record<string, number> = {};
  let spontaneous = 0;
  let manual = 0;
  let spread = 0;
  for (const ev of events || []) {
    const cat = ev.category || 'information';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (ev.originMode === 'spread' || ev.parentIncidentId != null) {
      spread++;
    } else if (ev.originMode === 'manual') {
      manual++;
    } else {
      spontaneous++;
    }
  }
  return {
    total: (events || []).length,
    spontaneous,
    manual,
    spread,
    byCategory,
  };
}

export interface DesignFireScenarioMetrics {
  designLabel: string;
  detectionSec: number | null;
  firstArrivalSec: number | null;
  focusCount: number;
  spreadChain: string[];
  mobilizedUnits: number;
  resourceLimitations: string[];
  controlTimeSec: number | null;
  affectedAreaM2: number;
  damagedStructures: number;
  destroyedStructures: number;
  estimatedCostEur: number;
  recoveryTimeSec: number | null;
  serviceThreatsCount: number;
}

export interface DesignFireComparisonResult {
  seed: number;
  designA: DesignFireScenarioMetrics;
  designB: DesignFireScenarioMetrics;
  deltaFocusCount: number;
  deltaAffectedAreaM2: number;
  deltaControlTimeSec: number | null;
  deltaEstimatedCostEur: number;
  summary: string;
}

export interface CompareFireDesignsOptions {
  seed?: number;
  targetBoothId?: string;
  templateId?: string;
  severity?: IncidentSeverityLevel;
  durationSec?: number;
  stepSec?: number;
  fireSpreadSeconds?: number;
  fireSpreadGap?: number;
  weather?: 'sun' | 'cloud' | 'rain' | 'wind';
  labelA?: string;
  labelB?: string;
}

function runFireScenarioSingle(
  sceneInput: Scene,
  designLabel: string,
  opts: CompareFireDesignsOptions
): DesignFireScenarioMetrics {
  const cloned = structuredClone(sceneInput);
  cloned.seed = opts.seed ?? sceneInput.seed ?? 42;
  cloned.incidentMode = 'manual';
  cloned.autoIncidents = false;
  if (opts.fireSpreadSeconds != null) cloned.fireSpreadSeconds = opts.fireSpreadSeconds;
  if (opts.fireSpreadGap != null) cloned.fireSpreadGap = opts.fireSpreadGap;
  if (opts.weather) cloned.base.weather = opts.weather;

  const phased = phaseScene(cloned, 'event');
  const engine = new EventEngine(phased);
  const sim = new ResponseSimulation(engine);
  engine.emergency = sim;

  const candidateTarget =
    (opts.targetBoothId &&
      ([...phased.base.booths, ...phased.infrastructure].find((b) => b.id === opts.targetBoothId) ||
        null)) ||
    phased.base.booths.find((b) => b.type === 'food') ||
    phased.base.booths[0] ||
    phased.infrastructure.find((i) => i.role === 'cover');

  const tplId = opts.templateId || 'foodtruck_kitchen_fire';
  if (candidateTarget) {
    sim.triggerContextualIncident(candidateTarget.id, tplId, {
      severity: opts.severity || 'critica',
      originMode: 'manual',
    });
  } else {
    sim.inject('fire');
  }

  const totalSec = opts.durationSec ?? 720;
  const stepSec = opts.stepSec ?? 2;
  const steps = Math.max(1, Math.ceil(totalSec / stepSec));
  for (let i = 0; i < steps; i++) {
    engine.tick(stepSec);
  }

  const fireEvents = sim.events.filter((ev) => ev.type === 'fire');
  const root = fireEvents[0];
  const detectionSec =
    root && root.reportedAt != null
      ? Math.max(0, Math.round(root.reportedAt - (root.created ?? 0)))
      : null;

  const arrivals = fireEvents
    .map((ev) => (ev.arrived != null ? Math.max(0, ev.arrived - (ev.created ?? 0)) : null))
    .filter((v): v is number => v != null);
  const firstArrivalSec = arrivals.length ? Math.round(Math.min(...arrivals)) : null;

  const spreadChain = fireEvents
    .filter((ev) => ev.spreadCause)
    .map((ev) => ev.spreadCause as string);

  const nodes = [...sim.fire.nodes.values()];
  const damagedStructures = nodes.filter((n) => n.damage > 0.02 && n.damage < 1).length;
  const destroyedStructures = nodes.filter((n) => n.damage >= 1).length;
  const affectedAreaM2 = Math.round(
    nodes.reduce((acc, n) => acc + Math.PI * Math.pow(n.safetyRadius || 4.5, 2), 0)
  );

  const mobilizedSet = new Set<string>();
  for (const ev of fireEvents) {
    if (ev.resourceId) mobilizedSet.add(ev.resourceId);
  }
  for (const m of sim.fleet?.missions?.values?.() || []) {
    const unit = sim.fleet.units.find((u) => u.resourceId === m.unitId);
    if (unit?.kind === 'fire') {
      mobilizedSet.add(m.unitId);
    }
  }

  const resourceLimitations = fireEvents
    .map((ev) => ev.resourceLimitation)
    .filter((v): v is string => !!v);

  const allExtinguished = fireEvents.length > 0 && fireEvents.every((ev) => ev.status === 'resolved' || ev.closed != null);
  const maxClosed = allExtinguished
    ? Math.max(...fireEvents.map((ev) => ev.closed ?? engine.time))
    : null;
  const controlTimeSec =
    maxClosed != null && root
      ? Math.max(0, Math.round(maxClosed - (root.created ?? 0)))
      : null;

  const reopened = sim.fire.cordons.filter((c) => c.state === 'reopened');
  const recoveryTimeSec =
    reopened.length > 0 && root
      ? Math.round(engine.time - (root.created ?? 0))
      : null;

  const estimatedCostEur =
    fireEvents.length * 420 +
    nodes.reduce((acc, n) => acc + Math.round(n.damage * 2400), 0) +
    mobilizedSet.size * 380;

  return {
    designLabel,
    detectionSec,
    firstArrivalSec,
    focusCount: Math.max(fireEvents.length, nodes.length),
    spreadChain,
    mobilizedUnits: mobilizedSet.size,
    resourceLimitations,
    controlTimeSec,
    affectedAreaM2,
    damagedStructures,
    destroyedStructures,
    estimatedCostEur,
    recoveryTimeSec,
    serviceThreatsCount: sim.fire.serviceThreats?.length || 0,
  };
}

/**
 * Compara el mismo incendio provocado sobre dos diseños distintos con idéntica semilla,
 * demanda y parámetros de fuego.
 */
export function compareFireDesignScenarios(
  sceneA: Scene,
  sceneB: Scene,
  opts: CompareFireDesignsOptions = {}
): DesignFireComparisonResult {
  const seed = opts.seed ?? sceneA.seed ?? 42;
  const mergedOpts = {...opts, seed};
  const designA = runFireScenarioSingle(sceneA, opts.labelA || sceneA.title || 'Diseño A', mergedOpts);
  const designB = runFireScenarioSingle(sceneB, opts.labelB || sceneB.title || 'Diseño B', mergedOpts);

  const deltaFocusCount = designB.focusCount - designA.focusCount;
  const deltaAffectedAreaM2 = designB.affectedAreaM2 - designA.affectedAreaM2;
  const deltaControlTimeSec =
    designA.controlTimeSec != null && designB.controlTimeSec != null
      ? designB.controlTimeSec - designA.controlTimeSec
      : null;
  const deltaEstimatedCostEur = designB.estimatedCostEur - designA.estimatedCostEur;

  const summary =
    deltaFocusCount < 0
      ? `${designB.designLabel} reduce focos de ${designA.focusCount} a ${designB.focusCount} y el área afectada en ${Math.abs(deltaAffectedAreaM2)} m².`
      : deltaFocusCount > 0
        ? `${designB.designLabel} incrementa los focos de ${designA.focusCount} a ${designB.focusCount}.`
        : `${designA.designLabel} y ${designB.designLabel} registran ${designA.focusCount} foco(s); diferencia de área ${deltaAffectedAreaM2} m².`;

  return {
    seed,
    designA,
    designB,
    deltaFocusCount,
    deltaAffectedAreaM2,
    deltaControlTimeSec,
    deltaEstimatedCostEur,
    summary,
  };
}
