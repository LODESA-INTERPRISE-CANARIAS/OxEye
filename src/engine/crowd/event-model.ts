/**
 * @module engine/crowd/event-model
 * Modelo analítico base de sitios, tipos de puesto, clima y valores por defecto.
 */
import type {BaseScenarioConfig, BoothItem, WeatherKind} from '../../types';

export const SITES: Record<
  string,
  {
    name: string;
    area: number;
    excluded: number;
    kind: string;
    basis?: string;
    obstacles?: string;
    source?: string;
  }
> = {
  cristo: {
    name: 'Plaza del Cristo',
    area: 11600,
    excluded: 18,
    kind: 'plaza',
    basis:
      '≈11.600 m²: referencia aproximada del Plan de Autoprotección de 2021. El perímetro actual no está medido aquí.',
    obstacles:
      '18 % no disponible: hipótesis inicial de escenario, sin inventario medido de mercado, obstáculos o mobiliario.',
    source:
      'https://www.aytolalaguna.es/CDN/files/servicios/fiestas/galerias/documentos/Plan-de-Autoproteccion-y-Seguridad-La-Laguna.pdf',
  },
  adelantado: {
    name: 'Plaza del Adelantado',
    area: 4300,
    excluded: 25,
    kind: 'plaza',
    basis:
      '≈4.300 m² de trabajo: hipótesis del 60 % del ámbito de intervención de 7.221,24 m² del Plan Especial de 2005, redondeada. El ámbito incluye viales; este 60 % no está medido.',
    obstacles:
      '25 % no disponible: hipótesis para jardines, fuente y elementos, sin medición geométrica.',
    source:
      'https://www.urbanismolalaguna.es/sites/default/files/planeamiento/pecasco_ad/6_ordsec/esppub/06_pza_adelantado.pdf',
  },
  vega: {
    name: 'Parque de La Vega',
    area: 22000,
    excluded: 65,
    kind: 'parque',
    basis:
      '≈22.000 m² de trabajo: referencia municipal de «más de 22.000 m²». Se usa 22.000 como base orientativa, sin afirmar un total exacto.',
    obstacles:
      '65 % no disponible: hipótesis por la combinación de jardines, agua, deporte y otros usos; no es una superficie medida.',
    source:
      'https://www.aytolalaguna.es/actualidad/noticias/El-Ayuntamiento-ultima-la-renovacion-del-parque-de-La-Vega-con-la-puesta-a-punto-de-la-charca-y-la-red-de-riego/',
  },
};

export const TYPES: Record<
  string,
  {
    name: string;
    icon?: string;
    color: string;
    area: number;
    time: number;
    simultaneous: number;
    interest: number;
    commercial: boolean;
  }
> = {
  stage: {
    name: 'Escenario',
    color: '#7b527d',
    area: 48,
    time: 1,
    simultaneous: 1,
    interest: 0,
    commercial: false,
  },
  commerce: {
    name: 'Comercio',
    icon: '▤',
    color: '#c56336',
    area: 20,
    time: 4,
    simultaneous: 2,
    interest: 1,
    commercial: true,
  },
  food: {
    name: 'Comida',
    icon: '◒',
    color: '#b98930',
    area: 24,
    time: 5,
    simultaneous: 3,
    interest: 1.3,
    commercial: true,
  },
  workshop: {
    name: 'Taller',
    icon: '✳',
    color: '#537c70',
    area: 30,
    time: 20,
    simultaneous: 8,
    interest: 1,
    commercial: false,
  },
  rest: {
    name: 'Descanso',
    icon: '▱',
    color: '#728b9b',
    area: 36,
    time: 15,
    simultaneous: 10,
    interest: 0,
    commercial: false,
  },
};

export const WEATHER: Record<
  WeatherKind,
  {name: string; icon: string; loss: number; operation: number}
> = {
  sun: {name: 'Sol', icon: '☀', loss: 0, operation: 100},
  cloud: {name: 'Nubes', icon: '☁', loss: 0, operation: 100},
  rain: {name: 'Lluvia', icon: '☂', loss: 40, operation: 85},
  wind: {name: 'Viento', icon: '≋', loss: 25, operation: 90},
};

/**
 * Crea un puesto por defecto del tipo indicado.
 */
export function booth(type: string, index = 0): BoothItem {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ||
      String(Date.now()) + '-' + index + '-' + Math.random(),
    type,
    name: TYPES[type].name,
    area: TYPES[type].area,
    time: TYPES[type].time,
    simultaneous: TYPES[type].simultaneous,
    interest: TYPES[type].interest,
    covered: false,
    local: true,
    fee: null,
    x: 25 + (index % 4) * 17,
    y: 33 + Math.floor(index / 4) * 20,
  };
}

/**
 * Devuelve la configuración base por defecto de un escenario de evento.
 */
export function defaults(): BaseScenarioConfig {
  return {
    site: 'cristo',
    hours: 6,
    days: 2,
    start: 10,
    stay: 60,
    arrivals: 180,
    participation: 80,
    interactions: 1.2,
    space: 2,
    circulation: 25,
    queueArea: 6,
    availability: 80,
    exposure: 80,
    weather: 'sun',
    rent: 'free',
    rate: 3,
    ticket: 12,
    conversion: 35,
    margin: 45,
    staff: 12,
    logistics: 45,
    organizerFixed: 900,
    organizerHourly: 35,
    funding: 1500,
    support: 0,
    overrides: {
      area: '',
      excluded: '',
      limit: '',
      counts: '',
      weatherLoss: '',
      operation: '',
    },
    booths: [booth('commerce', 0), booth('food', 1), booth('workshop', 2)],
  };
}
