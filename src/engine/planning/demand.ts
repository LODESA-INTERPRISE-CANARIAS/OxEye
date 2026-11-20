/**
 * @module engine/planning/demand
 * Cálculo de demanda inicial de puestos de comida, mesas, carpas, comercios y baños.
 */
import type {DemandInputs, DemandPlanResult} from '../../types';

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
