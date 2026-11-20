/**
 * @module engine/crowd/personas
 * Catálogo de 1.000 personajes sintéticos y selector de perfiles para el motor de multitudes.
 */
import {DEMOGRAPHY, identity} from './demography';

const goals: Record<string, string[][]> = {
  buyer: [
    ['commerce', 'commerce', 'food'],
    ['commerce', 'workshop', 'food'],
    ['commerce', 'rest', 'commerce'],
  ],
  foodie: [
    ['food', 'food', 'commerce'],
    ['food', 'rest', 'stage'],
    ['food', 'stage', 'food'],
  ],
  culture: [
    ['workshop', 'stage', 'commerce'],
    ['workshop', 'workshop', 'food'],
    ['workshop', 'rest', 'stage'],
  ],
  music: [
    ['stage', 'food', 'stage'],
    ['stage', 'commerce', 'food'],
    ['stage', 'rest', 'stage'],
  ],
  walker: [
    ['rest'],
    ['commerce', 'rest'],
    ['stage', 'rest'],
  ],
};

const motivations = [
  'Descubrir',
  'Encontrar algo concreto',
  'Compartir la tarde',
  'Improvisar',
];

export interface SyntheticPersona {
  id: string;
  personName: string;
  age: number;
  sex: string;
  gender: string;
  home: string;
  education: string;
  household: string;
  travelMode: string;
  identitySynthetic: boolean;
  archetype: string;
  name: string;
  needs: string[];
  pace: number;
  patience: number;
  stayFactor: number;
  budget: number;
  purchaseFactor: number;
  goalCount: number;
  spontaneity: number;
  directness: number;
  shelterPreference: number;
  habits: string;
  description: string;
}

/** Los 1.000 personajes ficticios del simulador. */
export const PERSONAS: SyntheticPersona[] = Array.from(
  {length: 1000},
  (_, i) => {
    const archetype = Object.keys(goals)[i % 5];
    const p = Math.floor(i / 5) % 4;
    const t = Math.floor(i / 20) % 3;
    const v = Math.floor(i / 60) % 4;
    const id = identity(i);
    return {
      id: 'persona-' + String(i + 1).padStart(4, '0'),
      ...id,
      archetype,
      name: id.personName,
      needs: [...goals[archetype][t]],
      pace: [0.72, 0.86, 1.03, 1.22][p],
      patience: [0.7, 1, 1.5][t],
      stayFactor: [0.65, 0.9, 1.2, 1.5][v],
      budget: [12, 24, 45, 80][(p + v) % 4],
      purchaseFactor: [0.6, 0.85, 1, 1.2][(t + v) % 4],
      goalCount: archetype === 'walker' ? 0 : [1, 2, 2, 3][v],
      spontaneity: [0.1, 0.3, 0.5, 0.7][p],
      directness: [0.95, 0.75, 0.5, 0.3][(p + t) % 4],
      shelterPreference: [0.45, 0.65, 0.85, 1][(t + v) % 4],
      habits:
        motivations[v] +
        ', ' +
        [
          'recados directos',
          'paseo con paradas',
          'visita familiar',
          'curiosidad por los puestos',
        ][p],
      description:
        id.age +
        ' años · ' +
        id.home +
        ' · ' +
        id.education +
        '. ' +
        motivations[v] +
        '. Atributos ficticios.',
    };
  },
);

export const PERSONA_INFO = {
  count: 1000,
  synthetic: true,
  demography: DEMOGRAPHY,
  dimensions: [
    'edad',
    'sexo administrativo',
    'zona ficticia de residencia',
    'formación ficticia',
    'intereses',
    'ritmo',
    'paciencia',
    'estancia',
    'presupuesto',
    'recorrido',
    'refugio',
  ],
  note: '1.000 personajes ficticios. Cuotas marginales de edad y sexo ajustadas al padrón municipal consultado; no reproducen cruces demográficos ni asistentes reales. Residencia por zona, estudios, hábitos y motivaciones son hipótesis independientes, sin direcciones reales. No es una muestra representativa validada de la sociedad ni del público del evento.',
};

/**
 * Selecciona y combina una persona sintética del arquetipo dado usando el generador pseudoaleatorio.
 */
export function pickPersona(
  archetype: string,
  random: () => number,
  variation = 1,
): SyntheticPersona {
  const list = PERSONAS.filter(p => p.archetype === archetype);
  const base = list[Math.floor(random() * list.length)];
  const other = list[Math.floor(random() * list.length)];
  const blend = (v: number, neutral: number) =>
    neutral + (v - neutral) * variation;
  return {
    ...base,
    needs: [...base.needs],
    pace: blend(other.pace, 1),
    patience: blend(base.patience, 1),
    stayFactor: blend(other.stayFactor, 1),
    budget: variation > 0 ? base.budget : Infinity,
    purchaseFactor: blend(other.purchaseFactor, 1),
  };
}
