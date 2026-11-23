/**
 * @module engine/planning/demand
 * Cálculo de demanda inicial de puestos de comida, mesas, carpas, comercios y baños,
 * conectado al perfil operativo SMART (`ProjectObjectives`).
 */
import type {
  DemandInputs,
  DemandPlanResult,
  InfrastructureItem,
  Scene,
} from '../../types';
import {ensureProjectObjectives, OBJECTIVE_BY_ID} from './objectives';

/** Valores por defecto del formulario de cálculo de servicios. */
export const demandDefaults: DemandInputs = {
  arrivals: 200,
  area: 1000,
  stayMinutes: 60,
  foodShare: 35,
  serviceHourly: 30,
  utilization: 75,
  seatedShare: 80,
  mealMin: 10,
  mealMax: 20,
  tablesPerRoof: 8,
  shopShare: 40,
  shopMinutes: 8,
  shopPlaces: 3,
  toiletShare: 15,
  toiletMinutes: 4,
  children: 20,
  older: 20,
};

/**
 * Dimensiona la oferta recomendada de servicios a partir de las hipótesis de público y tiempos.
 * @param p Parámetros de entrada de demanda.
 */
export function demandPlan(p: DemandInputs): DemandPlanResult {
  const hourly = (p.arrivals * p.foodShare) / 100;
  const mean = (p.mealMin + p.mealMax) / 2;
  const food = Math.ceil(
    hourly / Math.max(1, (p.serviceHourly * p.utilization) / 100),
  );
  const seats = Math.ceil((((hourly * mean) / 60) * p.seatedShare) / 100);
  const tables = Math.ceil(seats / 6);
  const roofs = Math.ceil(tables / Math.max(1, p.tablesPerRoof));
  const shops = Math.ceil(
    (((p.arrivals * p.shopShare) / 100) * p.shopMinutes) /
      60 /
      Math.max(1, p.shopPlaces),
  );
  const toilets = Math.ceil(
    (((p.arrivals * p.toiletShare) / 100) * p.toiletMinutes) /
      60 /
      Math.max(0.1, p.utilization / 100),
  );
  const occupied = (p.arrivals * p.stayMinutes) / 60;
  const modules = food * 20 + tables * 5.4 + shops * 12 + toilets * 2.5;
  const childSeats = Math.ceil((seats * p.children) / 100);
  const olderSeats = Math.ceil((seats * p.older) / 100);
  return {
    hourly,
    food,
    seats,
    tables,
    roofs,
    shops,
    toilets,
    occupied,
    modules,
    childSeats,
    olderSeats,
    remaining: p.area - modules,
  };
}

export interface InventoryGapRow {
  key: 'food' | 'tables' | 'roofs' | 'shops' | 'toilets';
  label: string;
  required: number;
  placed: number;
  delta: number;
  status: 'ok' | 'deficit' | 'surplus';
}

export interface ObjectiveNeedItem {
  objectiveId: string;
  objectiveLabel: string;
  recommendation: string;
  resources: string[];
  estimatedCostDelta: number;
}

export interface DemandProposalOption {
  key: 'spatial_efficiency' | 'visitor_experience' | 'economic_balance';
  title: string;
  food: number;
  tables: number;
  roofs: number;
  shops: number;
  toilets: number;
  estimatedCost: number;
  occupiedAreaM2: number;
  advantages: string[];
  tradeoffs: string[];
}

export interface ObjectiveDemandReport {
  base: DemandPlanResult;
  suggestedInputs: DemandInputs;
  inventoryComparison: InventoryGapRow[];
  objectiveNeeds: ObjectiveNeedItem[];
  proposals: DemandProposalOption[];
  tradeoffsSummary: string[];
}

/**
 * Sugiere hipótesis de entrada para la calculadora coherentes con los objetivos SMART
 * sin ocultar su origen ni modificar el escenario sin confirmación.
 */
export function suggestDemandInputsFromObjectives(
  scene: Scene,
  current: DemandInputs = demandDefaults
): DemandInputs {
  const obj = ensureProjectObjectives(scene);
  const ids = new Set(obj.selected.map((s) => s.id));
  const {radar} = obj.profile;

  const foodShare = Math.max(
    15,
    Math.min(75, Math.round(current.foodShare + (radar.food - 40) * 0.25))
  );
  const shopShare = Math.max(
    15,
    Math.min(80, Math.round(current.shopShare + (radar.local - 40) * 0.3))
  );
  const seatedShare = ids.has('gas_eat_seated')
    ? Math.max(current.seatedShare, obj.selected.find((s) => s.id === 'gas_eat_seated')?.targetValue ?? 85)
    : current.seatedShare;
  const stayMinutes = Math.max(
    25,
    Math.min(180, Math.round(current.stayMinutes * (obj.confirmedHypotheses.stayMultiplier || 1)))
  );
  const utilization = ids.has('gas_reduce_queues') ? 68 : current.utilization;

  return {
    ...current,
    arrivals: Number(scene.base?.arrivals) || current.arrivals,
    foodShare,
    shopShare,
    seatedShare,
    stayMinutes,
    utilization,
  };
}

/**
 * Genera el puente completo entre Objetivos SMART, hipótesis de demanda,
 * necesidades frente al inventario real y tres propuestas estratégicas comparables.
 */
export function buildObjectiveDemandReport(
  scene: Scene,
  inputs: DemandInputs
): ObjectiveDemandReport {
  const base = demandPlan(inputs);
  const obj = ensureProjectObjectives(scene);
  const suggestedInputs = suggestDemandInputsFromObjectives(scene, inputs);

  const placedFood = scene.base.booths.filter((b) => b.type === 'food').length;
  const placedShops = scene.base.booths.filter((b) => b.type === 'commerce').length;
  const placedTables = scene.infrastructure.filter((i) => i.kind === 'picnic').length;
  const placedRoofs = scene.infrastructure.filter(
    (i: InfrastructureItem) => i.role === 'cover'
  ).length;
  const placedToilets = scene.infrastructure.filter((i) => i.kind === 'toilet').length;

  const mkGap = (
    key: InventoryGapRow['key'],
    label: string,
    required: number,
    placed: number
  ): InventoryGapRow => {
    const delta = placed - required;
    return {
      key,
      label,
      required,
      placed,
      delta,
      status: delta < 0 ? 'deficit' : delta > 0 ? 'surplus' : 'ok',
    };
  };

  const inventoryComparison: InventoryGapRow[] = [
    mkGap('food', 'Puestos gastronómicos', base.food, placedFood),
    mkGap('tables', 'Mesas (6 plazas)', base.tables, placedTables),
    mkGap('roofs', 'Carpas / refugio', base.roofs, placedRoofs),
    mkGap('shops', 'Comercios locales', base.shops, placedShops),
    mkGap('toilets', 'Cabinas de aseo', base.toilets, placedToilets),
  ];

  const objectiveNeeds: ObjectiveNeedItem[] = obj.selected.map((sel) => {
    const def = OBJECTIVE_BY_ID[sel.id];
    return {
      objectiveId: sel.id,
      objectiveLabel: def?.label || sel.id,
      recommendation: def?.desiredOutcome || '',
      resources: def?.relatedResources || [],
      estimatedCostDelta: sel.id.startsWith('eco_') ? -300 : sel.id.startsWith('gas_') ? 650 : 350,
    };
  });

  const estimateCost = (
    f: number,
    t: number,
    r: number,
    s: number,
    w: number
  ) => f * 480 + t * 90 + r * 650 + s * 320 + w * 180;

  const calcArea = (f: number, t: number, r: number, s: number, w: number) =>
    Math.round(f * 20 + t * 5.4 + r * 36 + s * 12 + w * 2.5);

  const proposals: DemandProposalOption[] = [
    {
      key: 'spatial_efficiency',
      title: 'A · Eficiencia espacial y circulación',
      food: base.food,
      tables: Math.max(1, Math.round(base.tables * 0.85)),
      roofs: Math.max(1, Math.round(base.roofs * 0.9)),
      shops: base.shops,
      toilets: base.toilets,
      estimatedCost: estimateCost(
        base.food,
        Math.max(1, Math.round(base.tables * 0.85)),
        Math.max(1, Math.round(base.roofs * 0.9)),
        base.shops,
        base.toilets
      ),
      occupiedAreaM2: calcArea(
        base.food,
        Math.max(1, Math.round(base.tables * 0.85)),
        Math.max(1, Math.round(base.roofs * 0.9)),
        base.shops,
        base.toilets
      ),
      advantages: [
        'Maximiza pasillos libres (≥ 3 m) y reduce conflictos en rutas de evacuación.',
        'Menor ocupación superficial respecto a la plaza disponible.',
      ],
      tradeoffs: [
        'Menos margen de mesas en picos extremos de consumo simultáneo.',
      ],
    },
    {
      key: 'visitor_experience',
      title: 'B · Experiencia prioritaria del visitante',
      food: base.food + (obj.profile.radar.food >= 50 ? 1 : 0),
      tables: base.tables + (obj.selected.some((s) => s.id === 'gas_eat_seated' || s.id === 'fam_rest') ? 2 : 0),
      roofs: base.roofs + (obj.selected.some((s) => s.id === 'gas_shelter' || s.id === 'fam_rest') ? 1 : 0),
      shops: base.shops + (obj.profile.radar.local >= 50 ? 1 : 0),
      toilets: base.toilets + (obj.selected.some((s) => s.id === 'gas_reduce_queues' && s.contexts?.includes('toilets')) ? 1 : 0),
      estimatedCost: estimateCost(
        base.food + (obj.profile.radar.food >= 50 ? 1 : 0),
        base.tables + 2,
        base.roofs + 1,
        base.shops + (obj.profile.radar.local >= 50 ? 1 : 0),
        base.toilets
      ),
      occupiedAreaM2: calcArea(
        base.food + (obj.profile.radar.food >= 50 ? 1 : 0),
        base.tables + 2,
        base.roofs + 1,
        base.shops + (obj.profile.radar.local >= 50 ? 1 : 0),
        base.toilets
      ),
      advantages: [
        `Refuerza los ejes dominantes de tu perfil (${obj.profile.activeAxes.join(', ')}).`,
        'Holgura extra para reducir colas y mejorar comodidad sentado/refugio.',
      ],
      tradeoffs: [
        'Requiere mayor presupuesto y tiempo de montaje en Pre-evento.',
      ],
    },
    {
      key: 'economic_balance',
      title: 'C · Equilibrio económico y operativo',
      food: Math.max(1, base.food),
      tables: base.tables,
      roofs: base.roofs,
      shops: Math.max(placedShops, Math.min(base.shops, placedShops + 1)),
      toilets: Math.max(2, base.toilets),
      estimatedCost: estimateCost(
        Math.max(1, base.food),
        base.tables,
        base.roofs,
        Math.max(placedShops, Math.min(base.shops, placedShops + 1)),
        Math.max(2, base.toilets)
      ),
      occupiedAreaM2: calcArea(
        Math.max(1, base.food),
        base.tables,
        base.roofs,
        Math.max(placedShops, Math.min(base.shops, placedShops + 1)),
        Math.max(2, base.toilets)
      ),
      advantages: [
        'Aprovecha el inventario ya colocado minimizando nuevas adquisiciones y transporte.',
        'Mantiene todos los mínimos de seguridad, aseos y accesibilidad.',
      ],
      tradeoffs: [
        'Colas moderadas en hora punta si no se acompaña de rotación rápida.',
      ],
    },
  ];

  return {
    base,
    suggestedInputs,
    inventoryComparison,
    objectiveNeeds,
    proposals,
    tradeoffsSummary: obj.profile.tradeoffs.map((t) => `${t.title}: ${t.description}`),
  };
}
